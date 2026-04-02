import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { google } from 'googleapis';
import * as pdfParseModule from 'pdf-parse';
import mammoth from 'mammoth';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { OAuth2Client as GoogleOAuthClient } from 'google-auth-library';

import { config, hasGoogleDriveConfig } from './config.js';
import { decryptText, encryptText } from './crypto.js';
import { ensureUser, getDb } from './db.js';
import { buildModelQueue, getModelsForProviders, sanitizeUserModels } from './models.js';

const projectRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const clientDistDir = path.join(projectRootDir, 'dist');
const UPLOAD_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
const pdfParse = pdfParseModule.default || pdfParseModule;

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: UPLOAD_MAX_FILE_SIZE_BYTES } });

const allowedOrigins = (config.frontendBaseUrl || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
}));

if (fs.existsSync(clientDistDir)) {
  app.use(express.static(clientDistDir));
}

app.use('/api', cors({
  origin: (origin, callback) => {
    // If there's no origin (like a same-origin asset request), allow it.
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

const tutorRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

const PROVIDERS = new Set(['openai', 'groq', 'mistral', 'nvidia', 'openrouter', 'gemini', 'claude', 'puter']);
const AUTH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;
const AUTH_REFRESH_WINDOW_SECONDS = 60 * 60 * 24 * 2;
const AUTH_ISSUER = 'antiforget-app';
const AUTH_COOKIE_NAME = 'af_auth_token';
const isProduction = process.env.NODE_ENV === 'production';
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const setAuthCookie = (res, token) => {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'lax' : 'lax',
    maxAge: AUTH_TOKEN_TTL_SECONDS * 1000,
    path: '/',
  });
};

const clearAuthCookie = (res) => {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'lax' : 'lax',
    path: '/',
  });
};
const deriveKeyBuffer = (raw) => {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  return crypto.createHash('sha256').update(raw).digest();
};
const JWT_SECRET = deriveKeyBuffer(config.jwtSecret);
const HMAC_SECRET = crypto.createHmac('sha256', JWT_SECRET).update('oauth-state-hmac').digest();

const normalizeProvider = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  const aliasMap = {
    'openai api': 'openai',
    'open ai': 'openai',
    'gemini api': 'gemini',
    'google gemini': 'gemini',
    'google-gemini': 'gemini',
    'google_gemini': 'gemini',
    'claude api': 'claude',
    anthropic: 'claude',
    'anthropic api': 'claude',
    'nvidia api': 'nvidia',
    'nvidia-ai': 'nvidia',
    'nvidia_ai': 'nvidia',
    nvidiaai: 'nvidia',
    'open router': 'openrouter',
    'open-router': 'openrouter',
    puterai: 'puter',
    'puter-ai': 'puter',
    'puter_ai': 'puter',
    'puter ai': 'puter',
    'puter.js': 'puter',
  };

  if (normalized.startsWith('puter')) {
    return 'puter';
  }

  return aliasMap[normalized] || normalized;
};

const getOAuthClient = () =>
  new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );

const parseJson = (value, fallback) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const normalizeAiLanguage = (value) => {
  if (typeof value !== 'string') {
    return 'English';
  }

  const normalized = value.trim();
  if (!normalized) {
    return 'English';
  }

  return normalized.slice(0, 80);
};

const getUserRevisionModels = async (db, userId) => {
  const rows = await db.all(
    `SELECT id, provider, model, reasoning
     FROM user_revision_models
     WHERE user_id = ?
     ORDER BY updated_at ASC, created_at ASC`,
    [userId]
  );

  return sanitizeUserModels(
    rows
      .map((row) => ({
        id: row.id,
        provider: normalizeProvider(row.provider),
        model: row.model,
        reasoning: Boolean(row.reasoning),
      }))
      .filter((row) => PROVIDERS.has(row.provider))
  );
};

const getModelProvidersFromModels = (models = []) => {
  const providers = [];
  const seen = new Set();

  for (const model of sanitizeUserModels(models)) {
    const provider = normalizeProvider(model.provider);
    if (!PROVIDERS.has(provider) || seen.has(provider)) {
      continue;
    }
    seen.add(provider);
    providers.push(provider);
  }

  return providers;
};

const orderUserModelsByPriority = (models = [], modelPriorityIds = []) => {
  const providers = getModelProvidersFromModels(models);
  return buildModelQueue({
    modelPriorityIds,
    userModels: models,
    availableProviders: providers,
  });
};

const getUserModelPriorityIds = async (db, userId) => {
  const rows = await db.all(
    `SELECT model_id FROM user_model_priorities WHERE user_id = ? ORDER BY sort_order ASC, updated_at ASC`,
    [userId]
  );
  return rows
    .map((row) => row.model_id)
    .filter((modelId) => typeof modelId === 'string' && modelId.trim())
    .map((modelId) => modelId.trim());
};

const saveUserModelPriorityIds = async (db, userId, modelPriority, allowedModelIds) => {
  const allowed = new Set(
    Array.isArray(allowedModelIds)
      ? allowedModelIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
      : []
  );

  const seen = new Set();
  const sanitized = [];
  for (const id of Array.isArray(modelPriority) ? modelPriority : []) {
    if (typeof id !== 'string' || !id.trim()) {
      continue;
    }
    const normalized = id.trim();
    if (!allowed.has(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    sanitized.push(normalized);
  }

  await db.run(`DELETE FROM user_model_priorities WHERE user_id = ?`, [userId]);

  let sortOrder = 0;
  for (const modelId of sanitized) {
    await db.run(
      `INSERT INTO user_model_priorities(user_id, model_id, sort_order, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      [userId, modelId, sortOrder]
    );
    sortOrder += 1;
  }

  return sanitized;
};

const addUserRevisionModel = async (db, userId, provider, model, reasoning) => {
  const normalizedProvider = normalizeProvider(provider);
  const normalizedModel = typeof model === 'string' ? model.trim() : '';

  if (!PROVIDERS.has(normalizedProvider)) {
    throw new Error('Invalid provider');
  }

  if (!normalizedModel) {
    throw new Error('Model name is required');
  }

  if (normalizedModel.length > 200) {
    throw new Error('Model name is too long (max 200 characters)');
  }

  const row = await db.get(
    `SELECT id FROM user_revision_models WHERE user_id = ? AND provider = ? AND model = ?`,
    [userId, normalizedProvider, normalizedModel]
  );

  if (row?.id) {
    await db.run(
      `UPDATE user_revision_models
       SET reasoning = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [reasoning ? 1 : 0, row.id, userId]
    );
    return row.id;
  }

  const id = crypto.randomUUID();
  await db.run(
    `INSERT INTO user_revision_models(id, user_id, provider, model, reasoning, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [id, userId, normalizedProvider, normalizedModel, reasoning ? 1 : 0]
  );
  return id;
};

const removeUserRevisionModel = async (db, userId, modelId) => {
  await db.run(`DELETE FROM user_revision_models WHERE user_id = ? AND id = ?`, [userId, modelId]);
  await db.run(`DELETE FROM user_model_priorities WHERE user_id = ? AND model_id = ?`, [userId, modelId]);
};

const getUserId = (req) => {
  if (req.authUserId && typeof req.authUserId === 'string') {
    return req.authUserId;
  }
  return null;
};

const normalizeAuthEmail = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '');

const timingSafeEqualHex = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length === 0 || left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
};

const KDF_CURRENT_VERSION = 2;
const KDF_ITERATIONS = { 1: 120_000, 2: 600_000 };

const hashPasswordWithSalt = (password, saltHex, version = KDF_CURRENT_VERSION) => {
  const normalized = typeof password === 'string' ? password : '';
  const iterations = KDF_ITERATIONS[version] ?? 600_000;
  return crypto.pbkdf2Sync(normalized, Buffer.from(saltHex, 'hex'), iterations, 32, 'sha256').toString('hex');
};

const signOAuthState = (payload) => {
  const json = JSON.stringify(payload);
  const data = Buffer.from(json, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', HMAC_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
};

const verifyOAuthState = (state) => {
  if (typeof state !== 'string' || !state.includes('.')) return null;
  const dotIndex = state.lastIndexOf('.');
  const data = state.slice(0, dotIndex);
  const sig = state.slice(dotIndex + 1);
  const expected = crypto.createHmac('sha256', HMAC_SECRET).update(data).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
};

const createAuthToken = (payload) => {
  return jwt.sign(
    { sub: payload.userId, email: payload.email },
    JWT_SECRET,
    { expiresIn: AUTH_TOKEN_TTL_SECONDS, issuer: AUTH_ISSUER }
  );
};

const verifyAuthToken = (token) => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { issuer: AUTH_ISSUER });
    if (typeof decoded.sub !== 'string') return null;
    return { userId: decoded.sub, email: typeof decoded.email === 'string' ? decoded.email : '' };
  } catch {
    return null;
  }
};

const readBearerToken = (req) => {
  const value = req.header('authorization');
  if (!value || typeof value !== 'string') {
    return null;
  }

  const [type, token] = value.trim().split(/\s+/, 2);
  if (!type || !token || type.toLowerCase() !== 'bearer') {
    return null;
  }

  return token;
};

const getOriginFromUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const FRONTEND_ORIGIN = allowedOrigins[0] || null;

const isTrustedRequestOrigin = (req) => {
  const origin = getOriginFromUrl(req.get('origin'));
  if (origin && allowedOrigins.includes(origin)) {
    return true;
  }

  const refererOrigin = getOriginFromUrl(req.get('referer'));
  if (refererOrigin && allowedOrigins.includes(refererOrigin)) {
    return true;
  }

  // Non-browser clients may omit Origin/Referer entirely.
  return !origin && !refererOrigin;
};

const getStorageBundle = async (userId) => {
  const db = await getDb();

  const pref = await db.get(
      `SELECT completed_revisions_today, revision_seconds_today, daily_revision_minutes_limit, last_revision_date, student_education_level, student_major, student_focus_topic, ai_language, missed_questions_json, ai_provider, ai_model_overrides_json
       FROM user_preferences WHERE user_id = ?`,
    [userId]
  );

    const modelPriorityIds = await getUserModelPriorityIds(db, userId);

  const topics = await db.all(
    `SELECT id, title, summary, tags_json, has_pdf_blob, position_x, position_y
       FROM topics WHERE user_id = ?`,
    [userId]
  );

  const edges = await db.all(
    `SELECT id, source, target FROM topic_relations WHERE user_id = ?`,
    [userId]
  );

  const fsrsRows = await db.all(
    `SELECT node_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state
       FROM fsrs_records WHERE user_id = ?`,
    [userId]
  );

  const fsrsData = {};
  for (const row of fsrsRows) {
    fsrsData[row.node_id] = {
      nodeId: row.node_id,
      due: row.due,
      stability: row.stability,
      difficulty: row.difficulty,
      elapsed_days: row.elapsed_days,
      scheduled_days: row.scheduled_days,
      reps: row.reps,
      lapses: row.lapses,
      state: row.state,
    };
  }

  return {
    nodes: topics.map((row) => ({
      id: row.id,
      title: row.title,
      summary: row.summary,
      tags: parseJson(row.tags_json, []),
      hasPdfBlob: Boolean(row.has_pdf_blob),
      position: { x: row.position_x, y: row.position_y },
    })),
    edges: edges.map((row) => ({ id: row.id, source: row.source, target: row.target })),
    fsrsData,
    completedRevisionsToday: pref?.completed_revisions_today ?? 0,
    revisionSecondsToday: pref?.revision_seconds_today ?? 0,
    dailyRevisionMinutesLimit: pref?.daily_revision_minutes_limit ?? 60,
    lastRevisionDate: pref?.last_revision_date ?? new Date().toISOString().slice(0, 10),
    studentEducationLevel: pref?.student_education_level || 'high school',
    studentMajor: pref?.student_major || '',
    studentFocusTopic: pref?.student_focus_topic || '',
    aiLanguage: normalizeAiLanguage(pref?.ai_language || 'English'),
    missedQuestionHistoryByTopic: parseJson(pref?.missed_questions_json || '{}', {}),
    aiProvider: pref?.ai_provider || 'groq',
    aiModelOverrides: parseJson(pref?.ai_model_overrides_json || '{}', {}),
    aiModelPriority: modelPriorityIds,
    openaiApiKey: null,
    groqApiKey: null,
    mistralApiKey: null,
    nvidiaApiKey: null,
    openrouterApiKey: null,
    geminiApiKey: null,
    claudeApiKey: null,
  };
};

const saveApiKeyIfProvided = async (db, userId, provider, maybeKey) => {
  if (!PROVIDERS.has(provider) || typeof maybeKey === 'undefined') {
    return;
  }

  if (maybeKey === null || (typeof maybeKey === 'string' && !maybeKey.trim())) {
    await db.run(`DELETE FROM api_credentials WHERE user_id = ? AND provider = ?`, [userId, provider]);
    return;
  }

  if (typeof maybeKey !== 'string') {
    return;
  }

  const encrypted = encryptText(maybeKey.trim());
  await db.run(
    `INSERT INTO api_credentials(user_id, provider, ciphertext, iv, tag, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, provider)
     DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, tag = excluded.tag, updated_at = CURRENT_TIMESTAMP`,
    [userId, provider, encrypted.ciphertext, encrypted.iv, encrypted.tag]
  );
};

const saveApiKeyFromStoragePatch = async (db, userId, provider, maybeKey) => {
  if (typeof maybeKey !== 'string' || !maybeKey.trim()) {
    return;
  }
  await saveApiKeyIfProvided(db, userId, provider, maybeKey);
};

const replaceTopics = async (db, userId, nodes) => {
  const nodeIds = nodes.map((node) => node.id);
  if (nodeIds.length === 0) {
    await db.run(`DELETE FROM topics WHERE user_id = ?`, [userId]);
    return;
  }

  const placeholders = nodeIds.map(() => '?').join(',');
  await db.run(`DELETE FROM topics WHERE user_id = ? AND id NOT IN (${placeholders})`, [userId, ...nodeIds]);

  for (const node of nodes) {
    const tagsJson = JSON.stringify(Array.isArray(node.tags) ? node.tags : []);
    const positionX = typeof node.position?.x === 'number' ? node.position.x : 100;
    const positionY = typeof node.position?.y === 'number' ? node.position.y : 100;

    await db.run(
      `INSERT INTO topics(id, user_id, title, summary, tags_json, has_pdf_blob, position_x, position_y, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id, user_id)
       DO UPDATE SET title = excluded.title,
                     summary = excluded.summary,
                     tags_json = excluded.tags_json,
                     has_pdf_blob = excluded.has_pdf_blob,
                     position_x = excluded.position_x,
                     position_y = excluded.position_y,
                     updated_at = CURRENT_TIMESTAMP`,
      [
        node.id,
        userId,
        (node.title || '').slice(0, 500),
        (node.summary || '').slice(0, 50000),
        tagsJson,
        node.hasPdfBlob ? 1 : 0,
        positionX,
        positionY,
      ]
    );
  }
};

const replaceEdges = async (db, userId, edges) => {
  const edgeIds = edges.map((edge) => edge.id);
  if (edgeIds.length === 0) {
    await db.run(`DELETE FROM topic_relations WHERE user_id = ?`, [userId]);
    return;
  }

  const placeholders = edgeIds.map(() => '?').join(',');
  await db.run(`DELETE FROM topic_relations WHERE user_id = ? AND id NOT IN (${placeholders})`, [userId, ...edgeIds]);

  for (const edge of edges) {
    await db.run(
      `INSERT INTO topic_relations(id, user_id, source, target)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id, user_id)
       DO UPDATE SET source = excluded.source, target = excluded.target`,
      [edge.id, userId, edge.source, edge.target]
    );
  }
};

const replaceFsrs = async (db, userId, fsrsData) => {
  const nodeIds = Object.keys(fsrsData);
  if (nodeIds.length === 0) {
    await db.run(`DELETE FROM fsrs_records WHERE user_id = ?`, [userId]);
    return;
  }

  const placeholders = nodeIds.map(() => '?').join(',');
  await db.run(`DELETE FROM fsrs_records WHERE user_id = ? AND node_id NOT IN (${placeholders})`, [userId, ...nodeIds]);

  for (const nodeId of nodeIds) {
    const item = fsrsData[nodeId];
    await db.run(
      `INSERT INTO fsrs_records(
         user_id, node_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, node_id)
       DO UPDATE SET due = excluded.due,
                     stability = excluded.stability,
                     difficulty = excluded.difficulty,
                     elapsed_days = excluded.elapsed_days,
                     scheduled_days = excluded.scheduled_days,
                     reps = excluded.reps,
                     lapses = excluded.lapses,
                     state = excluded.state,
                     updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        nodeId,
        item.due,
        item.stability,
        item.difficulty,
        item.elapsed_days,
        item.scheduled_days,
        item.reps,
        item.lapses,
        item.state,
      ]
    );
  }
};

const providerConfig = {
  openai: {
    remoteUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-5.4-nano',
  },
  groq: {
    remoteUrl: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'openai/gpt-oss-120b',
  },
  mistral: {
    remoteUrl: 'https://api.mistral.ai/v1/chat/completions',
    model: 'mistral-small-latest',
  },
  nvidia: {
    remoteUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
    model: 'meta/llama-3.1-405b-instruct',
  },
  openrouter: {
    remoteUrl: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'xiaomi/mimo-v2-flash',
  },
  gemini: {
    remoteUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    model: 'gemini-2.5-flash',
  },
  claude: {
    remoteUrl: 'https://api.anthropic.com/v1/messages',
    model: 'claude-3-7-sonnet-latest',
  },
};

const FALLBACK_RETRY_HINT = /(insufficient|balance|credit|quota|rate\s*limit|limit exceeded|not enough|forbidden|unauthorized|permission|model.+not found|not available|temporar|overloaded|capacity|invalid input|expected object|bad request|unsupported|invalid model|invalid_request_error)/i;

const shouldTryNextCandidate = (status, errorText) => {
  if (status >= 500) {
    return true;
  }

  if ([400, 401, 402, 403, 404, 408, 409, 422, 429].includes(status)) {
    return true;
  }

  return FALLBACK_RETRY_HINT.test(String(errorText || ''));
};

const getAvailableCredentialMap = async (db, userId) => {
  const rows = await db.all(`SELECT provider, ciphertext, iv, tag FROM api_credentials WHERE user_id = ?`, [userId]);
  const keyMap = {};

  for (const row of rows) {
    const provider = normalizeProvider(row.provider);
    if (!PROVIDERS.has(provider)) {
      continue;
    }
    try {
      const decrypted = decryptText(row).trim();
      if (decrypted) {
        keyMap[provider] = decrypted;
      }
    } catch {
      // Ignore malformed credentials and continue to the next provider.
    }
  }

  return keyMap;
};

const getCredentialDecryptionSummary = async (db, userId) => {
  const rows = await db.all(`SELECT provider, ciphertext, iv, tag FROM api_credentials WHERE user_id = ?`, [userId]);
  const keyMap = {};
  const failedProviders = [];

  for (const row of rows) {
    const provider = normalizeProvider(row.provider);
    if (!PROVIDERS.has(provider)) {
      continue;
    }

    try {
      const decrypted = decryptText(row).trim();
      if (decrypted) {
        keyMap[provider] = decrypted;
      } else {
        failedProviders.push(provider);
      }
    } catch {
      failedProviders.push(provider);
    }
  }

  return {
    keyMap,
    totalStoredProviders: rows.length,
    failedProviders,
  };
};

const getProviderErrorMessage = (raw, status) => {
  const text = String(raw || '').trim();
  if (!text) {
    return `HTTP ${status}`;
  }

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.error === 'string' && parsed.error.trim()) {
      return parsed.error;
    }
    if (typeof parsed?.error?.message === 'string' && parsed.error.message.trim()) {
      return parsed.error.message;
    }
    if (typeof parsed?.message === 'string' && parsed.message.trim()) {
      return parsed.message;
    }
  } catch {
    // Keep original text when upstream response is not JSON.
  }

  return text;
};

const toDebugRawProviderMessage = (raw) => {
  if (typeof raw !== 'string') {
    return '';
  }
  const text = raw.trim();
  if (!text) {
    return '';
  }
  return text.length > 4000 ? `${text.slice(0, 4000)}... [truncated]` : text;
};

const buildProviderHeaders = (provider, apiKey) => {
  if (provider === 'claude') {
    return {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  // OpenRouter recommends these headers for app identification and analytics.
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = config.frontendBaseUrl;
    headers['X-Title'] = 'AntiForget';
  }

  return headers;
};

const buildProviderPayload = ({ provider, model, messages, temperature, maxTokens, reasoning, isFirstTurn }) => {
  if (provider === 'claude') {
    const systemText = messages
      .filter((message) => message.role === 'system')
      .map((message) => String(message.content || ''))
      .join('\n\n')
      .trim();

    const anthropicMessages = messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: Array.isArray(message.content) ? message.content : String(message.content || ''),
      }));

    return {
      model,
      system: systemText || undefined,
      messages: anthropicMessages,
      temperature,
      max_tokens: maxTokens,
      ...(reasoning ? { thinking: { type: 'enabled', budget_tokens: isFirstTurn ? 1024 : 2048 } } : {}),
    };
  }

  const payload = {
    model,
    messages,
    temperature,
  };

  if (provider === 'openai') {
    payload.max_completion_tokens = maxTokens;
  } else {
    payload.max_tokens = maxTokens;
  }

  if (provider === 'nvidia') {
    payload.top_p = 0.95;
    if (reasoning) {
      payload.max_tokens = 8192;
      payload.chat_template_kwargs = { thinking: true };
    }
  }

  if (provider === 'openrouter') {
    payload.reasoning = { enabled: reasoning };
  }

  return payload;
};

const extractProviderText = (provider, parsed) => {
  if (provider === 'claude') {
    if (!Array.isArray(parsed?.content)) {
      return '';
    }

    return parsed.content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
      .trim();
  }

  return String(parsed?.choices?.[0]?.message?.content || '').trim();
};

const generationSystemPrompt = `
You are a Socratic Tutor for revision topics. First assistant turn for a topic:
- Generate exactly 3 open-ended questions in one message.
- Number and label them in this exact order: Q1 (CONCEPTUAL), Q2 (APPLIED), Q3 (CONNECTION).
- Q1 (CONCEPTUAL): A theoretical conceptual question probing deep understanding ("why" or "what happens when").
- Q2 (APPLIED): A practical scenario-based problem requiring reasoning.
- Q3 (CONNECTION): Ask about the relationship with linked topics and how the idea is used.
- Ensure each question asks exactly ONE specific thing. Do NOT include multiple sub-questions or compound questions within a single question.
- CRITICAL FORMAT OUT: You MUST output each question STRICTLY using this exact machine-readable format:
Q[n] ([LABEL]): <Your Question Here>
- EXACT FORMATTING RULES: Do NOT use bolding or asterisks (e.g. no **Q1**). Do NOT output any introductory text (like "Here are your questions:"). Do NOT output any concluding text. JUST output the questions starting with Q1. Keep responses concise to save generation time.
- Do not grade in this first turn.
- Use the provided Topic, Linked topics, Topic summary, Student level, Student major, and Student focus to tailor difficulty and framing.
- If prior wrong-question history is provided, re-ask a similar version for reinforcement.
- Do NOT ask questions about the topic title itself, naming, spelling, or generic definitions.
`;

const gradingSystemPrompt = `
You are a Socratic Tutor evaluating user answers to revision questions.
- Grade each answered question from 0 to 4 using this rubric:
  0 = Blank, "I don't know", completely wrong, or reveals a misconception that needs unlearning.
  1 = Surface: correct vocabulary or vague direction, but no real understanding.
  2 = Functional: correct and usable in standard contexts, but shallow on the "why".
  3 = Deep: correct reasoning, understands the mechanics.
  4 = Insightful: everything in 3, plus an unprompted nuance, edge case, limitation, or non-obvious connection.
- If the user says "I don't know" (or equivalent), that answer must get 0.
- Provide the score and short correct answer ONLY for the questions that were originally asked. Correct answers MUST be a single concise sentence.
- Use this exact machine-readable format for every provided question:
  Q[n] Score: <0-4>
  Q[n] Correct Answer: <text>
- Do not output average score.
- STOP GENERATING IMMEDIATELY. Do NOT add any pleasantries, wrap-up text, or conversational filler. Output ONLY the grades and concise correct answers.
`;

const chatSystemPrompt = `
You are a Socratic Tutor helping a student after they completed a revision quiz.
- Answer follow-up questions clearly and directly.
- Keep explanations concise, practical, and adapted to student level when possible.
- Use examples or analogies when they improve understanding.
- If asked for extra practice, give one focused question at a time unless the user asks for more.
`;

const parseStructuredQuestions = (text) => {
  const cleanText = String(text || '').replace(/\*/g, '');
  const regex = /(?:^|\n)\s*(?:Q)?([1-3])\s*(?:\([^)]*\))?\s*[:.)-]\s*([\s\S]*?)(?=(?:\n\s*(?:Q)?[1-3]\s*(?:\([^)]*\))?\s*[:.)-])|$)/gi;
  const questions = [];
  for (const match of cleanText.matchAll(regex)) {
    const index = Number(match[1]);
    const content = String(match[2] || '').trim();
    if (index >= 1 && index <= 3 && content) {
      questions.push({ index, content });
    }
  }
  return questions;
};

const ATTACHMENT_PROMPT_CHAR_LIMIT = 10000;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const truncateForPrompt = (text, maxChars = ATTACHMENT_PROMPT_CHAR_LIMIT) => {
  if (!text || typeof text !== 'string') {
    return '';
  }
  const cleaned = text.replace(/\0/g, '').trim();
  if (!cleaned) {
    return '';
  }
  if (cleaned.length <= maxChars) {
    return cleaned;
  }
  return `${cleaned.slice(0, maxChars)}\n...[truncated]`;
};

const extractAttachmentText = async ({ mimeType, buffer }) => {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    return '';
  }

  if (mimeType === 'application/pdf') {
    const parsed = await pdfParse(buffer);
    return parsed?.text || '';
  }

  if (mimeType === DOCX_MIME) {
    const parsed = await mammoth.extractRawText({ buffer });
    return parsed?.value || '';
  }

  // Legacy .doc extraction is intentionally metadata-only fallback for now.
  return '';
};

const providerSupportsNativeAttachment = (provider, attachment) => {
  if (!attachment) {
    return false;
  }
  // Anthropic Messages supports document blocks with base64 sources.
  return provider === 'claude';
};

const appendNativeAttachmentToClaudeMessages = (messages, attachment) => {
  if (!attachment?.base64 || !attachment?.mimeType) {
    return messages;
  }

  const nextMessages = [...messages];
  for (let i = nextMessages.length - 1; i >= 0; i -= 1) {
    const entry = nextMessages[i];
    if (entry.role !== 'user') {
      continue;
    }

    const textContent = typeof entry.content === 'string'
      ? entry.content
      : Array.isArray(entry.content)
        ? entry.content
            .filter((part) => part?.type === 'text' && typeof part.text === 'string')
            .map((part) => part.text)
            .join('\n')
        : '';

    nextMessages[i] = {
      ...entry,
      content: [
        { type: 'text', text: textContent },
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: attachment.mimeType,
            data: attachment.base64,
          },
        },
      ],
    };
    break;
  }

  return nextMessages;
};

const getTopicAttachmentForTutor = async ({ db, userId, topicId }) => {
  if (!topicId || typeof topicId !== 'string') {
    return null;
  }

  const asset = await db.get(
    `SELECT drive_file_id, original_name, mime_type, size_bytes
       FROM file_assets
      WHERE user_id = ? AND topic_id = ?`,
    [userId, topicId]
  );

  if (!asset?.drive_file_id) {
    return null;
  }

  const drive = await getDriveClientForUser(userId);
  const download = await drive.files.get(
    { fileId: asset.drive_file_id, alt: 'media' },
    { responseType: 'arraybuffer' }
  );

  const rawData = download?.data;
  const buffer = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData || []);
  if (!buffer.length) {
    return null;
  }

  return {
    fileName: asset.original_name || 'attachment',
    mimeType: asset.mime_type || 'application/octet-stream',
    sizeBytes: Number(asset.size_bytes || buffer.length),
    buffer,
    base64: buffer.toString('base64'),
  };
};

app.get('/api/app/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/app/auth/signup', authRateLimiter, async (req, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const email = normalizeAuthEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!name) {
      return res.status(400).json({ error: 'Name is required.' });
    }
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const db = await getDb();
    const existing = await db.get(`SELECT id FROM users WHERE lower(email) = ?`, [email]);
    if (existing?.id) {
      return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
    }

    const userId = crypto.randomUUID();
    const saltHex = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPasswordWithSalt(password, saltHex);

    await db.exec('BEGIN');
    await db.run(
      `INSERT INTO users(id, name, email, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      [userId, name, email]
    );
    await db.run(
      `INSERT INTO user_auth_credentials(user_id, password_salt, password_hash, kdf_version, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [userId, saltHex, passwordHash, KDF_CURRENT_VERSION]
    );
    await ensureUser(userId);
    await db.exec('COMMIT');

    const token = createAuthToken({ userId, email });
    setAuthCookie(res, token);
    return res.status(201).json({ user: { id: userId, name, email } });
  } catch (error) {
    try {
      const db = await getDb();
      await db.exec('ROLLBACK');
    } catch {
      // no-op
    }
    console.error(error);
    return res.status(500).json({ error: 'Failed to create account.' });
  }
});

app.post('/api/app/auth/signin', authRateLimiter, async (req, res) => {
  try {
    const email = normalizeAuthEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (!password) {
      return res.status(400).json({ error: 'Password is required.' });
    }

    const db = await getDb();
    const row = await db.get(
      `SELECT u.id, u.name, u.email, c.password_salt, c.password_hash, c.kdf_version
       FROM users u
       INNER JOIN user_auth_credentials c ON c.user_id = u.id
       WHERE lower(u.email) = ?`,
      [email]
    );

    if (!row?.id || !row.password_salt || !row.password_hash) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const storedVersion = row.kdf_version || 1;
    const expectedHash = hashPasswordWithSalt(password, row.password_salt, storedVersion);
    if (!timingSafeEqualHex(expectedHash, row.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (storedVersion < KDF_CURRENT_VERSION) {
      const upgradedHash = hashPasswordWithSalt(password, row.password_salt, KDF_CURRENT_VERSION);
      await db.run(
        `UPDATE user_auth_credentials SET password_hash = ?, kdf_version = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
        [upgradedHash, KDF_CURRENT_VERSION, row.id]
      );
    }

    const token = createAuthToken({ userId: row.id, email: row.email });
    setAuthCookie(res, token);
    return res.json({ user: { id: row.id, name: row.name || 'Learner', email: row.email } });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to sign in.' });
  }
});

app.post('/api/app/auth/google', authRateLimiter, async (req, res) => {
  try {
    const { credential } = req.body || {};
    if (!credential || typeof credential !== 'string') {
      return res.status(400).json({ error: 'credential is required.' });
    }

    const googleClientId = process.env.VITE_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
    if (!googleClientId) {
      return res.status(400).json({ error: 'Google Sign-In is not configured on the server.' });
    }

    const client = new GoogleOAuthClient(googleClientId);
    const ticket = await client.verifyIdToken({ idToken: credential, audience: googleClientId });
    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
      return res.status(401).json({ error: 'Invalid Google credential.' });
    }

    const db = await getDb();
    await db.run(
      `INSERT INTO users(id, name, email, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email, updated_at = CURRENT_TIMESTAMP`,
      [payload.sub, payload.name || 'Learner', payload.email]
    );
    await ensureUser(payload.sub);

    const user = await db.get(`SELECT id, name, email FROM users WHERE id = ?`, [payload.sub]);
    const token = createAuthToken({ userId: payload.sub, email: payload.email });
    setAuthCookie(res, token);
    return res.json({
      user: { id: payload.sub, name: user?.name || 'Learner', email: payload.email, avatarUrl: payload.picture },
    });
  } catch (error) {
    console.error(error);
    return res.status(401).json({ error: 'Google Sign-In verification failed.' });
  }
});

app.post('/api/app/auth/passkey/challenge', authRateLimiter, async (req, res) => {
  try {
    const { type, userName } = req.body || {};
    if (type !== 'registration' && type !== 'authentication') {
      return res.status(400).json({ error: 'type must be "registration" or "authentication"' });
    }

    const db = await getDb();
    await db.run(`DELETE FROM passkey_challenges WHERE expires_at < ?`, [Date.now()]);

    const rpID = new URL(config.frontendBaseUrl).hostname;
    const expiresAt = Date.now() + 5 * 60 * 1000;

    if (type === 'registration') {
      if (!userName) {
        return res.status(400).json({ error: 'userName is required for registration' });
      }

      const registrationUserId = req.authUserId || crypto.randomUUID();

      const existingCredentials = await db.all(
        `SELECT credential_id FROM passkey_credentials WHERE user_id = ?`,
        [registrationUserId]
      );

      const options = await generateRegistrationOptions({
        rpName: 'AntiForget',
        rpID,
        userID: new TextEncoder().encode(registrationUserId),
        userName: registrationUserId,
        userDisplayName: userName,
        attestationType: 'none',
        excludeCredentials: existingCredentials.map((c) => ({ id: c.credential_id, type: 'public-key' })),
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
      });

      const challengeId = crypto.randomUUID();
      await db.run(
        `INSERT INTO passkey_challenges(id, challenge, user_id, expires_at) VALUES (?, ?, ?, ?)`,
        [challengeId, options.challenge, registrationUserId, expiresAt]
      );
      return res.json({ challengeId, options, userId: registrationUserId });
    }

    const requestedUserId = req.authUserId || null;
    const allCredentials = requestedUserId
      ? await db.all(`SELECT credential_id FROM passkey_credentials WHERE user_id = ?`, [requestedUserId])
      : [];

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'preferred',
      allowCredentials: allCredentials.map((c) => ({ id: c.credential_id, type: 'public-key' })),
    });

    const challengeId = crypto.randomUUID();
    await db.run(
      `INSERT INTO passkey_challenges(id, challenge, user_id, expires_at) VALUES (?, ?, ?, ?)`,
      [challengeId, options.challenge, requestedUserId || null, expiresAt]
    );
    return res.json({ challengeId, options });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to generate passkey challenge' });
  }
});

app.post('/api/app/auth/passkey/register', authRateLimiter, async (req, res) => {
  try {
    const { challengeId, response, name } = req.body || {};
    if (!challengeId || !response || !name) {
      return res.status(400).json({ error: 'challengeId, response, and name are required' });
    }

    const db = await getDb();
    const challengeRow = await db.get(
      `SELECT challenge, user_id FROM passkey_challenges WHERE id = ? AND expires_at > ?`,
      [challengeId, Date.now()]
    );
    if (!challengeRow || !challengeRow.user_id) {
      return res.status(400).json({ error: 'Challenge not found or expired.' });
    }

    const userId = challengeRow.user_id;

    const rpID = new URL(config.frontendBaseUrl).hostname;
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: config.frontendBaseUrl,
      expectedRPID: rpID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Passkey registration verification failed.' });
    }

    const { credential } = verification.registrationInfo;
    await db.run(`DELETE FROM passkey_challenges WHERE id = ?`, [challengeId]);

    await db.run(
      `INSERT INTO users(id, name, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET name = COALESCE(excluded.name, users.name), updated_at = CURRENT_TIMESTAMP`,
      [userId, name]
    );
    await ensureUser(userId);

    const credId = crypto.randomUUID();
    await db.run(
      `INSERT INTO passkey_credentials(id, user_id, credential_id, public_key, counter, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(credential_id) DO UPDATE SET counter = excluded.counter, updated_at = CURRENT_TIMESTAMP`,
      [credId, userId, credential.id, Buffer.from(credential.publicKey).toString('base64'), credential.counter]
    );

    const user = await db.get(`SELECT id, name, email FROM users WHERE id = ?`, [userId]);
    const token = createAuthToken({ userId, email: user?.email || '' });
    setAuthCookie(res, token);
    return res.status(201).json({
      user: { id: userId, name: user?.name || name, email: user?.email || `${userId}@passkey.local` },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Passkey registration failed.' });
  }
});

app.post('/api/app/auth/passkey/authenticate', authRateLimiter, async (req, res) => {
  try {
    const { challengeId, response } = req.body || {};
    if (!challengeId || !response) {
      return res.status(400).json({ error: 'challengeId and response are required' });
    }

    const db = await getDb();
    const challengeRow = await db.get(
      `SELECT challenge FROM passkey_challenges WHERE id = ? AND expires_at > ?`,
      [challengeId, Date.now()]
    );
    if (!challengeRow) {
      return res.status(400).json({ error: 'Challenge not found or expired.' });
    }

    const credentialId = response.id;
    const credRow = await db.get(
      `SELECT id, user_id, public_key, counter FROM passkey_credentials WHERE credential_id = ?`,
      [credentialId]
    );
    if (!credRow) {
      return res.status(401).json({ error: 'Passkey not found.' });
    }

    const rpID = new URL(config.frontendBaseUrl).hostname;
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: config.frontendBaseUrl,
      expectedRPID: rpID,
      credential: {
        id: credentialId,
        publicKey: new Uint8Array(Buffer.from(credRow.public_key, 'base64')),
        counter: credRow.counter,
      },
    });

    if (!verification.verified) {
      return res.status(401).json({ error: 'Passkey authentication failed.' });
    }

    await db.run(
      `UPDATE passkey_credentials SET counter = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [verification.authenticationInfo.newCounter, credRow.id]
    );
    await db.run(`DELETE FROM passkey_challenges WHERE id = ?`, [challengeId]);

    const user = await db.get(`SELECT id, name, email FROM users WHERE id = ?`, [credRow.user_id]);
    if (!user) return res.status(401).json({ error: 'User not found.' });

    const token = createAuthToken({ userId: user.id, email: user.email || '' });
    setAuthCookie(res, token);
    return res.json({
      user: { id: user.id, name: user.name || 'Learner', email: user.email || `${user.id}@passkey.local` },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Passkey authentication failed.' });
  }
});

app.post('/api/app/auth/refresh', authRateLimiter, async (req, res) => {
  try {
    const token = readBearerToken(req) || (req.cookies && req.cookies[AUTH_COOKIE_NAME]) || null;
    if (!token) {
      return res.status(401).json({ error: 'Token is required.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET, { issuer: AUTH_ISSUER });
    } catch (err) {
      if (err?.name === 'TokenExpiredError') {
        // Verify signature even for expired tokens — ignoring only the expiration claim.
        let expired;
        try {
          expired = jwt.verify(token, JWT_SECRET, { issuer: AUTH_ISSUER, ignoreExpiration: true });
        } catch {
          return res.status(401).json({ error: 'Token signature is invalid.' });
        }
        if (expired && typeof expired.sub === 'string') {
          const expAt = (expired.exp || 0) * 1000;
          const now = Date.now();
          if (now - expAt <= AUTH_REFRESH_WINDOW_SECONDS * 1000) {
            const db = await getDb();
            const user = await db.get(`SELECT id, name, email FROM users WHERE id = ?`, [expired.sub]);
            if (user) {
              const newToken = createAuthToken({ userId: user.id, email: user.email || '' });
              setAuthCookie(res, newToken);
              return res.json({ user: { id: user.id, name: user.name || 'Learner', email: user.email || '' } });
            }
          }
        }
      }
      return res.status(401).json({ error: 'Token is invalid or too old to refresh.' });
    }

    if (typeof decoded.sub !== 'string') {
      return res.status(401).json({ error: 'Invalid token.' });
    }

    const db = await getDb();
    const user = await db.get(`SELECT id, name, email FROM users WHERE id = ?`, [decoded.sub]);
    if (!user) {
      return res.status(401).json({ error: 'User not found.' });
    }

    const newToken = createAuthToken({ userId: user.id, email: user.email || '' });
    setAuthCookie(res, newToken);
    return res.json({ user: { id: user.id, name: user.name || 'Learner', email: user.email || '' } });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Token refresh failed.' });
  }
});

app.post('/api/app/auth/google/token', authRateLimiter, async (req, res) => {
  try {
    const { accessToken } = req.body || {};
    if (!accessToken || typeof accessToken !== 'string') {
      return res.status(400).json({ error: 'accessToken is required.' });
    }

    const googleClientId = process.env.VITE_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';

    const tokenInfoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
    if (!tokenInfoRes.ok) {
      return res.status(401).json({ error: 'Failed to verify Google access token.' });
    }
    const tokenInfo = await tokenInfoRes.json();
    if (googleClientId && tokenInfo.aud !== googleClientId) {
      return res.status(401).json({ error: 'Google access token was not issued for this application.' });
    }

    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userInfoRes.ok) {
      return res.status(401).json({ error: 'Failed to verify Google access token.' });
    }

    const payload = await userInfoRes.json();
    if (!payload || !payload.sub || !payload.email) {
      return res.status(401).json({ error: 'Invalid Google token payload.' });
    }

    const db = await getDb();
    await db.run(
      `INSERT INTO users(id, name, email, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email, updated_at = CURRENT_TIMESTAMP`,
      [payload.sub, payload.name || 'Learner', payload.email]
    );
    await ensureUser(payload.sub);

    const user = await db.get(`SELECT id, name, email FROM users WHERE id = ?`, [payload.sub]);
    const token = createAuthToken({ userId: payload.sub, email: payload.email });
    setAuthCookie(res, token);
    return res.json({
      user: { id: payload.sub, name: user?.name || 'Learner', email: payload.email, avatarUrl: payload.picture },
    });
  } catch (error) {
    console.error(error);
    return res.status(401).json({ error: 'Google token verification failed.' });
  }
});

app.post('/api/app/auth/signout', (_req, res) => {
  clearAuthCookie(res);
  return res.json({ ok: true });
});

const PUBLIC_API_PATHS = new Set([
  '/health',
  '/auth/signup',
  '/auth/signin',
  '/auth/signout',
  '/auth/google',
  '/auth/google/token',
  '/auth/refresh',
  '/auth/passkey/challenge',
  '/auth/passkey/register',
  '/auth/passkey/authenticate',
  '/drive/callback',
]);

app.use('/api/app', (req, _res, next) => {
  const token = readBearerToken(req) || (req.cookies && req.cookies[AUTH_COOKIE_NAME]) || null;
  if (token) {
    const claims = verifyAuthToken(token);
    if (claims?.userId) {
      req.authUserId = claims.userId;
    }
  }
  return next();
});

app.use('/api/app', (req, res, next) => {
  if (!STATE_CHANGING_METHODS.has(req.method)) {
    return next();
  }

  if (!isTrustedRequestOrigin(req)) {
    return res.status(403).json({ error: 'Request origin is not allowed.' });
  }

  return next();
});

app.use('/api/app', (req, res, next) => {
  if (PUBLIC_API_PATHS.has(req.path)) {
    return next();
  }
  if (!req.authUserId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  return next();
});

app.get('/api/app/storage', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    await ensureUser(userId);
    const storage = await getStorageBundle(userId);
    return res.json(storage);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to load storage' });
  }
});

app.patch('/api/app/storage', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    await ensureUser(userId);
    const db = await getDb();
    const payload = req.body || {};

    if (
      (typeof payload.missedQuestionHistoryByTopic === 'object' && payload.missedQuestionHistoryByTopic !== null
        && JSON.stringify(payload.missedQuestionHistoryByTopic).length > 100_000) ||
      (typeof payload.aiModelOverrides === 'object' && payload.aiModelOverrides !== null
        && JSON.stringify(payload.aiModelOverrides).length > 50_000)
    ) {
      return res.status(400).json({ error: 'Payload fields exceed allowed size limit.' });
    }

    await db.exec('BEGIN');

    if (Array.isArray(payload.nodes)) {
      await replaceTopics(db, userId, payload.nodes);
    }

    if (Array.isArray(payload.edges)) {
      await replaceEdges(db, userId, payload.edges);
    }

    if (payload.fsrsData && typeof payload.fsrsData === 'object') {
      await replaceFsrs(db, userId, payload.fsrsData);
    }

    if (
      typeof payload.completedRevisionsToday === 'number' ||
      typeof payload.revisionSecondsToday === 'number' ||
      typeof payload.dailyRevisionMinutesLimit === 'number' ||
      typeof payload.lastRevisionDate === 'string' ||
      typeof payload.studentEducationLevel === 'string' ||
      typeof payload.studentMajor === 'string' ||
      typeof payload.studentFocusTopic === 'string' ||
      typeof payload.aiLanguage === 'string' ||
      typeof payload.missedQuestionHistoryByTopic !== 'undefined' ||
      typeof payload.aiProvider === 'string' ||
      typeof payload.aiModelOverrides !== 'undefined'
    ) {
      const currentPref = await db.get(
        `SELECT completed_revisions_today, revision_seconds_today, daily_revision_minutes_limit, last_revision_date, student_education_level, student_major, student_focus_topic, ai_language, missed_questions_json, ai_provider, ai_model_overrides_json
           FROM user_preferences WHERE user_id = ?`,
        [userId]
      );

      await db.run(
        `UPDATE user_preferences
            SET completed_revisions_today = ?,
                revision_seconds_today = ?,
                daily_revision_minutes_limit = ?,
                last_revision_date = ?,
                student_education_level = ?,
                student_major = ?,
                student_focus_topic = ?,
                ai_language = ?,
                missed_questions_json = ?,
                ai_provider = ?,
                ai_model_overrides_json = ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ?`,
        [
          typeof payload.completedRevisionsToday === 'number'
            ? payload.completedRevisionsToday
            : (currentPref?.completed_revisions_today ?? 0),
          typeof payload.revisionSecondsToday === 'number'
            ? Math.max(0, Math.round(payload.revisionSecondsToday))
            : (currentPref?.revision_seconds_today ?? 0),
          typeof payload.dailyRevisionMinutesLimit === 'number'
            ? Math.max(10, Math.min(300, Math.round(payload.dailyRevisionMinutesLimit)))
            : (currentPref?.daily_revision_minutes_limit ?? 60),
          typeof payload.lastRevisionDate === 'string'
            ? payload.lastRevisionDate
            : (currentPref?.last_revision_date ?? new Date().toISOString().slice(0, 10)),
          typeof payload.studentEducationLevel === 'string'
            ? payload.studentEducationLevel.trim().slice(0, 120) || 'high school'
            : (currentPref?.student_education_level || 'high school'),
          typeof payload.studentMajor === 'string'
            ? payload.studentMajor.trim().slice(0, 120)
            : (currentPref?.student_major || ''),
          typeof payload.studentFocusTopic === 'string'
            ? payload.studentFocusTopic.trim().slice(0, 240)
            : (currentPref?.student_focus_topic || ''),
          typeof payload.aiLanguage === 'string'
            ? normalizeAiLanguage(payload.aiLanguage)
            : normalizeAiLanguage(currentPref?.ai_language || 'English'),
          typeof payload.missedQuestionHistoryByTopic === 'object' && payload.missedQuestionHistoryByTopic !== null
            ? JSON.stringify(payload.missedQuestionHistoryByTopic)
            : (currentPref?.missed_questions_json || '{}'),
          PROVIDERS.has(normalizeProvider(payload.aiProvider))
            ? normalizeProvider(payload.aiProvider)
            : (currentPref?.ai_provider || 'groq'),
          typeof payload.aiModelOverrides === 'object'
            ? JSON.stringify(payload.aiModelOverrides)
            : (currentPref?.ai_model_overrides_json || '{}'),
          userId,
        ]
      );
    }

    if (typeof payload.aiModelPriority !== 'undefined') {
      const userModels = await getUserRevisionModels(db, userId);
      await saveUserModelPriorityIds(
        db,
        userId,
        payload.aiModelPriority,
        userModels.map((candidate) => candidate.id)
      );
    }

    // Keep /storage patch non-destructive for credentials.
    await saveApiKeyFromStoragePatch(db, userId, 'groq', payload.groqApiKey);
    await saveApiKeyFromStoragePatch(db, userId, 'mistral', payload.mistralApiKey);
    await saveApiKeyFromStoragePatch(db, userId, 'nvidia', payload.nvidiaApiKey);
    await saveApiKeyFromStoragePatch(db, userId, 'openrouter', payload.openrouterApiKey);
    await saveApiKeyFromStoragePatch(db, userId, 'gemini', payload.geminiApiKey);
    await saveApiKeyFromStoragePatch(db, userId, 'claude', payload.claudeApiKey);
    await saveApiKeyFromStoragePatch(db, userId, 'openai', payload.openaiApiKey);

    await db.exec('COMMIT');
    return res.json({ ok: true });
  } catch (error) {
    const db = await getDb();
    await db.exec('ROLLBACK');
    console.error(error);
    return res.status(500).json({ error: 'Failed to update storage' });
  }
});

app.get('/api/app/ai/credentials/status', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    await ensureUser(userId);

    const db = await getDb();
    const { keyMap } = await getCredentialDecryptionSummary(db, userId);
    const providers = new Set(Object.keys(keyMap));

    return res.json({
      providers: {
        openai: providers.has('openai'),
        groq: providers.has('groq'),
        mistral: providers.has('mistral'),
        nvidia: providers.has('nvidia'),
        openrouter: providers.has('openrouter'),
        gemini: providers.has('gemini'),
        claude: providers.has('claude'),
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to read API key status' });
  }
});

app.post('/api/app/ai/credentials', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { provider: rawProvider, apiKey } = req.body || {};
    const provider = normalizeProvider(rawProvider);
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!PROVIDERS.has(provider)) {
      return res.status(400).json({ error: 'Invalid provider' });
    }

    await ensureUser(userId);
    const db = await getDb();
    await saveApiKeyIfProvided(db, userId, provider, apiKey);

    return res.json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to save API key' });
  }
});

app.post('/api/app/ai/test', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { provider: rawProvider, modelOverride, apiKey } = req.body || {};
    const provider = normalizeProvider(rawProvider);
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!PROVIDERS.has(provider)) {
      return res.status(400).json({ error: 'Invalid provider' });
    }

    await ensureUser(userId);
    const db = await getDb();

    let resolvedApiKey = typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : '';
    if (!resolvedApiKey) {
      const keyRows = await db.all(
        `SELECT provider, ciphertext, iv, tag FROM api_credentials WHERE user_id = ?`,
        [userId]
      );
      const keyRow = keyRows.find((row) => normalizeProvider(row.provider) === provider);
      if (!keyRow) {
        return res.status(400).json({ error: `${provider} API key is not configured.` });
      }
      try {
        resolvedApiKey = decryptText(keyRow).trim();
      } catch {
        return res.status(400).json({
          error: `${provider} API key could not be decrypted. Re-save the key in Settings and test again.`,
        });
      }
    }

    if (!resolvedApiKey) {
      return res.status(400).json({ error: `${provider} API key is empty. Please re-save your API key.` });
    }

    const payload = buildProviderPayload({
      provider,
      model: (modelOverride || '').trim() || providerConfig[provider].model,
      messages: [{ role: 'user', content: 'Reply with OK only.' }],
      temperature: 0,
      maxTokens: 128,
      reasoning: false,
      isFirstTurn: false,
    });

    const startedAt = Date.now();
    const aiRes = await fetch(providerConfig[provider].remoteUrl, {
      method: 'POST',
      headers: buildProviderHeaders(provider, resolvedApiKey),
      body: JSON.stringify(payload),
    });

    const latencyMs = Date.now() - startedAt;
    const raw = await aiRes.text();
    if (!aiRes.ok) {
      return res.status(aiRes.status).json({
        ok: false,
        error: getProviderErrorMessage(raw, aiRes.status),
      });
    }

    const parsed = JSON.parse(raw);
    const reply = extractProviderText(provider, parsed);

    return res.json({
      ok: true,
      latencyMs,
      model: payload.model,
      replyPreview: String(reply).slice(0, 120),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: 'Connectivity test failed' });
  }
});

app.get('/api/app/ai/model-priority', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    await ensureUser(userId);
    const db = await getDb();

    const credentialMap = await getAvailableCredentialMap(db, userId);
    const userModels = await getUserRevisionModels(db, userId);
    const availableProviders = getModelProvidersFromModels(userModels);
    const activeProviders = Array.from(
      new Set([...Object.keys(credentialMap), ...availableProviders.filter((provider) => provider === 'puter')])
    );
    const availableModels = getModelsForProviders(userModels, availableProviders);
    const userPriority = await getUserModelPriorityIds(db, userId);
    const currentPriority = orderUserModelsByPriority(userModels, userPriority).map((candidate) => candidate.id);

    return res.json({
      activeProviders,
      availableModels,
      currentPriority,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to load model priority' });
  }
});

app.get('/api/app/ai/models', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    await ensureUser(userId);
    const db = await getDb();
    const credentialMap = await getAvailableCredentialMap(db, userId);
    const userPriority = await getUserModelPriorityIds(db, userId);
    const models = orderUserModelsByPriority(await getUserRevisionModels(db, userId), userPriority);

    return res.json({
      activeProviders: Object.keys(credentialMap),
      models,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to load custom models' });
  }
});

app.post('/api/app/ai/models', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { provider, model, reasoning } = req.body || {};
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    await ensureUser(userId);
    const db = await getDb();

    const modelId = await addUserRevisionModel(db, userId, provider, model, Boolean(reasoning));
    const userPriority = await getUserModelPriorityIds(db, userId);
    const models = orderUserModelsByPriority(await getUserRevisionModels(db, userId), userPriority);
    const created = models.find((item) => item.id === modelId);

    return res.json({ ok: true, model: created || null, models });
  } catch (error) {
    if (error instanceof Error && /invalid provider|model name is required/i.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    console.error(error);
    return res.status(500).json({ error: 'Failed to save custom model' });
  }
});

app.delete('/api/app/ai/models/:modelId', async (req, res) => {
  try {
    const userId = getUserId(req);
    const modelId = typeof req.params.modelId === 'string' ? req.params.modelId.trim() : '';
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    if (!modelId) {
      return res.status(400).json({ error: 'modelId is required' });
    }

    await ensureUser(userId);
    const db = await getDb();
    await removeUserRevisionModel(db, userId, modelId);
    const userPriority = await getUserModelPriorityIds(db, userId);
    const models = orderUserModelsByPriority(await getUserRevisionModels(db, userId), userPriority);

    return res.json({ ok: true, models });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to delete custom model' });
  }
});

app.put('/api/app/ai/model-priority', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { modelPriority } = req.body || {};
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!Array.isArray(modelPriority)) {
      return res.status(400).json({ error: 'modelPriority must be an array' });
    }

    await ensureUser(userId);
    const db = await getDb();
    const userModels = await getUserRevisionModels(db, userId);
    const sanitized = await saveUserModelPriorityIds(
      db,
      userId,
      modelPriority,
      userModels.map((candidate) => candidate.id)
    );

    return res.json({ ok: true, modelPriority: sanitized });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to save model priority' });
  }
});

app.get('/api/app/settings/storage-provider', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    await ensureUser(userId);
    const db = await getDb();
    const driveConnection = await db.get(`SELECT user_id FROM drive_connections WHERE user_id = ?`, [userId]);

    return res.json({
      provider: 'google-drive',
      driveConnected: Boolean(driveConnection),
      driveReady: hasGoogleDriveConfig(),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to load storage provider setting' });
  }
});

app.put('/api/app/settings/storage-provider', async (req, res) => {
  try {
    const userId = getUserId(req);
    const provider = 'google-drive';
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    await ensureUser(userId);

    if (provider === 'google-drive' && !hasGoogleDriveConfig()) {
      return res.status(400).json({ error: 'Google Drive is not configured on the server.' });
    }

    const db = await getDb();
    await db.run(
      `UPDATE user_preferences SET file_storage_provider = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
      [provider, userId]
    );

    return res.json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to update storage provider' });
  }
});

app.delete('/api/app/settings/storage-provider/google-drive', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    await ensureUser(userId);
    const db = await getDb();
    const existing = await db.get(
      `SELECT access_token, refresh_token FROM drive_connections WHERE user_id = ?`,
      [userId]
    );

    if (!existing) {
      return res.json({ ok: true, disconnected: false });
    }

    const oauthClient = getOAuthClient();
    const accessToken = decryptDriveToken(existing.access_token);
    const refreshToken = decryptDriveToken(existing.refresh_token);

    // Revoke tokens if possible, then clear local linkage regardless.
    const tokensToRevoke = [accessToken, refreshToken].filter((token) => typeof token === 'string' && token.trim());
    for (const token of tokensToRevoke) {
      try {
        await oauthClient.revokeToken(token);
      } catch (revokeError) {
        console.warn('Failed to revoke Google Drive token during disconnect', revokeError);
      }
    }

    await db.run(`DELETE FROM drive_connections WHERE user_id = ?`, [userId]);
    return res.json({ ok: true, disconnected: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to disconnect Google Drive.' });
  }
});

app.get('/api/app/drive/auth-url', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    if (!hasGoogleDriveConfig()) {
      return res.status(400).json({ error: 'Google Drive OAuth is not configured on the server.' });
    }

    await ensureUser(userId);

    const statePayload = {
      userId,
      nonce: crypto.randomUUID(),
      returnUrl: `${config.frontendBaseUrl}/?view=settings&drive=connected`,
    };

    const oauthClient = getOAuthClient();
    const authUrl = oauthClient.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/drive.file'],
      state: signOAuthState(statePayload),
    });

    return res.json({ authUrl });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to create Google auth URL' });
  }
});

app.get('/api/app/drive/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
      return res.status(400).send('Missing code/state');
    }

    const decodedState = verifyOAuthState(state);
    if (!decodedState) {
      return res.status(400).send('Invalid or tampered state parameter');
    }

    const userId = decodedState.userId;
    const rawReturnUrl = typeof decodedState.returnUrl === 'string' ? decodedState.returnUrl : '';
    const returnUrl = rawReturnUrl.startsWith(config.frontendBaseUrl)
      ? rawReturnUrl
      : config.frontendBaseUrl;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).send('Invalid state payload');
    }

    await ensureUser(userId);

    const oauthClient = getOAuthClient();
    const tokenResponse = await oauthClient.getToken(code);
    const tokens = tokenResponse.tokens;

    if (!tokens.access_token) {
      return res.status(400).send('Google did not return an access token');
    }

    const db = await getDb();
    const encryptedAccessToken = JSON.stringify(encryptText(tokens.access_token));
    const encryptedRefreshToken = tokens.refresh_token
      ? JSON.stringify(encryptText(tokens.refresh_token))
      : null;
    await db.run(
      `INSERT INTO drive_connections(user_id, access_token, refresh_token, scope, expiry_date, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id)
       DO UPDATE SET access_token = excluded.access_token,
                     refresh_token = COALESCE(excluded.refresh_token, drive_connections.refresh_token),
                     scope = excluded.scope,
                     expiry_date = excluded.expiry_date,
                     updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        encryptedAccessToken,
        encryptedRefreshToken,
        tokens.scope || null,
        tokens.expiry_date || null,
      ]
    );

    return res.redirect(returnUrl);
  } catch (error) {
    console.error(error);
    return res.status(500).send('Google Drive connect failed');
  }
});

const decryptDriveToken = (raw) => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.ciphertext && parsed.iv && parsed.tag) {
      return decryptText(parsed);
    }
  } catch {
    // Reject tokens that are not valid encrypted JSON.
  }
  return null;
};

const getDriveClientForUser = async (userId) => {
  const db = await getDb();
  const row = await db.get(
    `SELECT access_token, refresh_token, scope, expiry_date FROM drive_connections WHERE user_id = ?`,
    [userId]
  );
  if (!row) {
    throw new Error('Google Drive is not connected for this user.');
  }

  const oauthClient = getOAuthClient();
  oauthClient.setCredentials({
    access_token: decryptDriveToken(row.access_token),
    refresh_token: decryptDriveToken(row.refresh_token),
    scope: row.scope,
    expiry_date: row.expiry_date,
  });

  oauthClient.on('tokens', async (tokens) => {
    if (!tokens.access_token && !tokens.refresh_token) {
      return;
    }

    const newEncryptedAccess = tokens.access_token
      ? JSON.stringify(encryptText(tokens.access_token))
      : null;
    const newEncryptedRefresh = tokens.refresh_token
      ? JSON.stringify(encryptText(tokens.refresh_token))
      : null;

    await db.run(
      `UPDATE drive_connections
          SET access_token = COALESCE(?, access_token),
              refresh_token = COALESCE(?, refresh_token),
              scope = COALESCE(?, scope),
              expiry_date = COALESCE(?, expiry_date),
              updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?`,
      [newEncryptedAccess, newEncryptedRefresh, tokens.scope || null, tokens.expiry_date || null, userId]
    );
  });

  return google.drive({ version: 'v3', auth: oauthClient });
};

const ALLOWED_UPLOAD_MIMES = new Set([
  'application/pdf',
  'application/msword',
  DOCX_MIME,
]);

const ALLOWED_UPLOAD_EXTENSIONS = new Set(['.pdf', '.doc', '.docx']);

const MAGIC_BYTES = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },          // %PDF
  { mime: 'application/msword', bytes: [0xd0, 0xcf, 0x11, 0xe0] },       // OLE2
  { mime: DOCX_MIME, bytes: [0x50, 0x4b, 0x03, 0x04] },                  // ZIP header (.docx container)
];

const detectMimeFromMagic = (buffer) => {
  for (const entry of MAGIC_BYTES) {
    if (buffer.length >= entry.bytes.length && entry.bytes.every((b, i) => buffer[i] === b)) {
      return entry.mime;
    }
  }
  return null;
};

const hasAllowedUploadExtension = (originalName) => {
  const extension = path.extname(String(originalName || '')).toLowerCase();
  return ALLOWED_UPLOAD_EXTENSIONS.has(extension);
};

const isUploadMimeAllowed = (claimedMime, buffer, originalName) => {
  if (!ALLOWED_UPLOAD_MIMES.has(claimedMime)) {
    return false;
  }
  if (!hasAllowedUploadExtension(originalName)) {
    return false;
  }

  const detected = detectMimeFromMagic(buffer);
  if (!detected) {
    return false;
  }

  // .docx shares ZIP header; require docx extension to avoid accepting generic ZIP files.
  if (claimedMime === DOCX_MIME) {
    return detected === DOCX_MIME && /\.docx$/i.test(String(originalName || ''));
  }

  return detected === claimedMime;
};

const DRIVE_APP_FOLDER_NAME = 'AntiForget Uploads';

const ensureDriveAppFolder = async (drive) => {
  const existing = await drive.files.list({
    q: `mimeType = 'application/vnd.google-apps.folder' and name = '${DRIVE_APP_FOLDER_NAME.replace(/'/g, "\\'")}' and trashed = false and 'root' in parents`,
    spaces: 'drive',
    pageSize: 1,
    fields: 'files(id, name)',
  });

  const existingFolderId = existing.data.files?.[0]?.id;
  if (existingFolderId) {
    return existingFolderId;
  }

  const created = await drive.files.create({
    requestBody: {
      name: DRIVE_APP_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      parents: ['root'],
    },
    fields: 'id',
  });

  const folderId = created.data.id;
  if (!folderId) {
    throw new Error('Failed to create Google Drive upload folder.');
  }

  return folderId;
};

app.get('/api/app/drive/debug', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!hasGoogleDriveConfig()) {
      return res.status(400).json({ error: 'Google Drive OAuth is not configured on the server.' });
    }

    await ensureUser(userId);
    const drive = await getDriveClientForUser(userId);
    const folderId = await ensureDriveAppFolder(drive);

    const [aboutRes, filesRes] = await Promise.all([
      drive.about.get({ fields: 'user(emailAddress,displayName)' }),
      drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        orderBy: 'createdTime desc',
        pageSize: 10,
        fields: 'files(id,name,mimeType,createdTime,webViewLink)',
      }),
    ]);

    return res.json({
      ok: true,
      connectedDriveUser: aboutRes.data.user || null,
      appFolderId: folderId,
      appFolderLink: `https://drive.google.com/drive/folders/${folderId}`,
      recentFiles: filesRes.data.files || [],
    });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : 'Failed to load Google Drive debug status';
    return res.status(500).json({ error: message });
  }
});

app.post('/api/app/files/upload', upload.single('file'), async (req, res) => {
  try {
    const userId = getUserId(req);
    const topicId = req.body.topicId;
    const file = req.file;

    if (!userId || !topicId || !file) {
      return res.status(400).json({ error: 'userId, topicId and file are required' });
    }

    if (file.size > UPLOAD_MAX_FILE_SIZE_BYTES) {
      return res.status(400).json({ error: 'File exceeds 2MB limit.' });
    }

    if (!isUploadMimeAllowed(file.mimetype, file.buffer, file.originalname)) {
      return res.status(400).json({
        error: `File type "${file.mimetype}" is not allowed. Accepted types: PDF, DOC, DOCX (max 2MB).`,
      });
    }

    await ensureUser(userId);
    const db = await getDb();
    const provider = 'google-drive';
    let driveFileId = null;

    if (!hasGoogleDriveConfig()) {
      return res.status(400).json({ error: 'Google Drive is not configured on server.' });
    }

    const drive = await getDriveClientForUser(userId);
    const existingAsset = await db.get(
      `SELECT drive_file_id FROM file_assets WHERE user_id = ? AND topic_id = ?`,
      [userId, topicId]
    );
    const parentFolderId = await ensureDriveAppFolder(drive);

    if (existingAsset?.drive_file_id) {
      try {
        await drive.files.delete({ fileId: existingAsset.drive_file_id });
      } catch (deleteErr) {
        console.warn('Failed to delete previous Drive file for topic before replacing', deleteErr);
      }
    }

    const uploadResponse = await drive.files.create({
      requestBody: {
        name: file.originalname,
        parents: [parentFolderId],
      },
      media: {
        mimeType: file.mimetype,
        body: Readable.from(file.buffer),
      },
      fields: 'id, webViewLink',
    });
    driveFileId = uploadResponse.data.id || null;
    const driveFileLink = uploadResponse.data.webViewLink || null;

    if (!driveFileId) {
      throw new Error('Google Drive upload did not return a file id.');
    }

    await db.run(
      `INSERT INTO file_assets(user_id, topic_id, provider, storage_path, drive_file_id, original_name, mime_type, size_bytes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, topic_id)
       DO UPDATE SET provider = excluded.provider,
                     storage_path = excluded.storage_path,
                     drive_file_id = excluded.drive_file_id,
                     original_name = excluded.original_name,
                     mime_type = excluded.mime_type,
                     size_bytes = excluded.size_bytes,
                     updated_at = CURRENT_TIMESTAMP`,
      [userId, topicId, provider, null, driveFileId, file.originalname, file.mimetype, file.size]
    );

    await db.run(`UPDATE topics SET has_pdf_blob = 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id = ?`, [userId, topicId]);

    return res.json({
      ok: true,
      provider,
      driveFileId,
      driveFileLink,
      driveFolderId: parentFolderId,
      driveFolderLink: `https://drive.google.com/drive/folders/${parentFolderId}`,
    });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : 'Failed to upload file';
    return res.status(500).json({ error: message });
  }
});

app.delete('/api/app/files/:topicId', async (req, res) => {
  try {
    const userId = getUserId(req);
    const topicId = req.params.topicId;
    if (!userId || !topicId) {
      return res.status(400).json({ error: 'userId and topicId are required' });
    }

    await ensureUser(userId);
    const db = await getDb();
    const asset = await db.get(
      `SELECT provider, storage_path, drive_file_id FROM file_assets WHERE user_id = ? AND topic_id = ?`,
      [userId, topicId]
    );

    if (asset?.provider === 'google-drive' && asset.drive_file_id) {
      const drive = await getDriveClientForUser(userId);
      await drive.files.delete({ fileId: asset.drive_file_id });
    }

    await db.run(`DELETE FROM file_assets WHERE user_id = ? AND topic_id = ?`, [userId, topicId]);
    await db.run(`UPDATE topics SET has_pdf_blob = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id = ?`, [userId, topicId]);

    return res.json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to delete file' });
  }
});

app.post('/api/app/ai/tutor', tutorRateLimiter, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { history, newPrompt, topicContext, mode, aiLanguage } = req.body || {};
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    await ensureUser(userId);
    const db = await getDb();

    const credentialMap = await getAvailableCredentialMap(db, userId);
    const availableProviders = Object.keys(credentialMap);
    if (availableProviders.length === 0) {
      const { totalStoredProviders } = await getCredentialDecryptionSummary(db, userId);
      if (totalStoredProviders > 0) {
        return res.status(400).json({
          error: 'Stored API keys could not be decrypted. This usually means APP_ENCRYPTION_KEY changed. Re-save your provider keys in Settings.',
        });
      }
      return res.status(400).json({ error: 'No API key is configured. Add at least one provider key in Settings.' });
    }

    const isFirstTurn = !history || history.length === 0;
    const resolvedMode = mode === 'questions' || mode === 'grading' || mode === 'chat'
      ? mode
      : (isFirstTurn ? 'questions' : 'grading');
    const userPref = await db.get(`SELECT ai_language FROM user_preferences WHERE user_id = ?`, [userId]);
    const resolvedLanguage = normalizeAiLanguage(aiLanguage || userPref?.ai_language || 'English');
    const shouldInjectTopicContext = resolvedMode === 'questions' && isFirstTurn;
    let tutorAttachment = null;
    let attachmentPromptContext = 'Attached file context: none';
    let finalPrompt = newPrompt;
    if (shouldInjectTopicContext) {
      const topicName = typeof topicContext?.topicName === 'string' && topicContext.topicName.trim()
        ? topicContext.topicName.trim()
        : 'Unknown topic';
      const linkedTopics = Array.isArray(topicContext?.linkedTopicNames)
        ? topicContext.linkedTopicNames.filter((name) => typeof name === 'string' && name.trim())
        : [];
      const summaryContent = typeof topicContext?.summaryContent === 'string' && topicContext.summaryContent.trim()
        ? topicContext.summaryContent.trim()
        : 'No summary available.';
      const studentLevel = typeof topicContext?.studentLevel === 'string' && topicContext.studentLevel.trim()
        ? topicContext.studentLevel.trim()
        : 'high school';
      const studentMajor = typeof topicContext?.studentMajor === 'string' && topicContext.studentMajor.trim()
        ? topicContext.studentMajor.trim()
        : 'not specified';
      const studentFocus = typeof topicContext?.studentFocusTopic === 'string' && topicContext.studentFocusTopic.trim()
        ? topicContext.studentFocusTopic.trim()
        : 'not specified';
      const weakHistory = Array.isArray(topicContext?.missedQuestionHistory)
        ? topicContext.missedQuestionHistory.filter((item) => typeof item === 'string' && item.trim()).slice(0, 5)
        : [];

      try {
        tutorAttachment = await getTopicAttachmentForTutor({
          db,
          userId,
          topicId: topicContext?.topicId,
        });

        if (tutorAttachment) {
          const extracted = await extractAttachmentText({
            mimeType: tutorAttachment.mimeType,
            buffer: tutorAttachment.buffer,
          });
          const snippet = truncateForPrompt(extracted);
          attachmentPromptContext = snippet
            ? [
                `Attached file: ${tutorAttachment.fileName}`,
                `Type: ${tutorAttachment.mimeType}`,
                'Extracted content:',
                snippet,
              ].join('\n')
            : `Attached file: ${tutorAttachment.fileName} (${tutorAttachment.mimeType}, ${tutorAttachment.sizeBytes} bytes). No extractable text found.`;
        }
      } catch (attachmentErr) {
        console.warn('Unable to load attachment context for tutor prompt:', attachmentErr);
      }

      finalPrompt = [
        `Topic: ${topicName}`,
        `Linked topics: ${linkedTopics.length > 0 ? linkedTopics.join(', ') : 'None'}`,
        `Topic summary: ${summaryContent}`,
        attachmentPromptContext,
        `Student level: ${studentLevel}`,
        `Student major: ${studentMajor}`,
        `Student focus topic: ${studentFocus}`,
        '',
        weakHistory.length > 0
          ? `Previously wrong questions to revisit:\n${weakHistory.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
          : 'Previously wrong questions to revisit: none',
        '',
        'Generate exactly 3 questions of these types, in this order:',
        '1. CONCEPTUAL',
        '2. APPLIED',
        '3. CONNECTION',
        '',
        `User: ${newPrompt}`,
      ].join('\n');
    }

    const messages = [
      {
        role: 'system',
        content: [
          resolvedMode === 'questions'
            ? generationSystemPrompt
            : resolvedMode === 'grading'
              ? gradingSystemPrompt
              : chatSystemPrompt,
          `- Generate all output in ${resolvedLanguage}.`,
        ].join('\n'),
      },
      ...((history || []).slice(-6)).map((entry) => ({
        role: entry.role === 'model' ? 'assistant' : 'user',
        content: (entry.parts || []).map((part) => part.text).join('\n'),
      })),
      { role: 'user', content: finalPrompt },
    ];

    const generationStartedAt = Date.now();
    const attempts = [];

    const seen = new Set();
    const userPriority = await getUserModelPriorityIds(db, userId);
    const userModels = await getUserRevisionModels(db, userId);

    const candidateQueue = buildModelQueue({
      modelPriorityIds: userPriority,
      userModels,
      availableProviders: Object.keys(credentialMap),
    }).filter((candidate) => {
      const dedupeKey = `${candidate.provider}:${candidate.model}`;
      if (seen.has(dedupeKey)) {
        return false;
      }
      seen.add(dedupeKey);
      return true;
    });

    console.log(`[Model Selection] Starting model selection with ${candidateQueue.length} candidates`);
    console.log(`[Model Selection] Available providers: ${Object.keys(credentialMap).join(', ')}`);

    if (candidateQueue.length === 0) {
      return res.status(400).json({
        error: 'No models configured. Add at least one model in Settings before requesting tutor generation.',
      });
    }

    for (const candidate of candidateQueue) {
      const provider = candidate.provider;
      const apiKey = credentialMap[provider];
      
      const currentAttempt = {
        id: candidate.id,
        provider,
        model: candidate.model,
        endpoint: providerConfig[provider]?.remoteUrl || 'unknown',
        status: 0,
        startTime: Date.now()
      };
      attempts.push(currentAttempt);

      console.log(`[Model Selection] Trying: ${candidate.id} (${provider}/${candidate.model})`);

      if (!apiKey) {
        currentAttempt.status = 401;
        currentAttempt.error = 'Provider API key is not configured in settings.';
        console.log(`[Model Selection] ❌ Skipped ${candidate.id}: No API key configured`);
        continue;
      }

      const tokenLimit = candidate.reasoning ? 4096 : 1024;
      const nativeAttachment = shouldInjectTopicContext && providerSupportsNativeAttachment(candidate.provider, tutorAttachment);
      const candidateMessages = nativeAttachment
        ? appendNativeAttachmentToClaudeMessages(messages, tutorAttachment)
        : messages;

      currentAttempt.attachmentMode = nativeAttachment ? 'native-file' : (tutorAttachment ? 'text-fallback' : 'none');
      const payload = buildProviderPayload({
        provider: candidate.provider,
        model: candidate.model,
        messages: candidateMessages,
        temperature: resolvedMode === 'questions' ? 0.2 : resolvedMode === 'chat' ? 0.3 : 0,
        maxTokens: tokenLimit,
        reasoning: Boolean(candidate.reasoning),
        isFirstTurn: resolvedMode === 'questions',
      });

      const requestController = new AbortController();
      const requestTimeoutMs = candidate.provider === 'nvidia'
        ? (resolvedMode === 'questions' ? 10000 : 45000)
        : (resolvedMode === 'questions' ? 10000 : 14000);
      const timeoutId = setTimeout(() => requestController.abort(), requestTimeoutMs);

      let aiRes;
      try {
        aiRes = await fetch(providerConfig[provider].remoteUrl, {
          method: 'POST',
          headers: buildProviderHeaders(provider, apiKey),
          body: JSON.stringify(payload),
          signal: requestController.signal,
        });
      } catch (error) {
        clearTimeout(timeoutId);
        const timedOut = error?.name === 'AbortError';
        currentAttempt.status = timedOut ? 408 : 500;
        currentAttempt.error = timedOut ? `Request timed out after ${requestTimeoutMs}ms (Provider unresponsive).` : `Network error: ${error.message}`;
        currentAttempt.providerRawError = error?.message || '';
        console.log(`[Model Selection] ❌ Failed ${candidate.id}: ${currentAttempt.error}`);
        continue;
      }
      clearTimeout(timeoutId);

      const raw = await aiRes.text();
      currentAttempt.durationMs = Date.now() - currentAttempt.startTime;

      if (aiRes.ok) {
        const data = JSON.parse(raw);
        const generatedText = extractProviderText(candidate.provider, data);

        // Validate text contains the required formats
        let isValid = true;
        if (resolvedMode === 'questions') {
          const parsedQuestions = parseStructuredQuestions(generatedText);
          if (parsedQuestions.length === 0) {
            currentAttempt.status = 422;
            currentAttempt.error = 'Response received but failed to parse into the 3 required question categories.';
            currentAttempt.providerRawError = toDebugRawProviderMessage(raw);
            console.log(`[Model Selection] ❌ Failed ${candidate.id}: No parseable questions found`);
            continue;
          }
          if (parsedQuestions.length < 3) {
            isValid = false;
            console.log(`[Model Selection] ⚠️  ${candidate.id}: Only ${parsedQuestions.length}/3 questions parsed, marking invalid`);
          }
        } else if (resolvedMode === 'grading') {
          if (!/Score\s*:/i.test(generatedText)) isValid = false;
        }

        if (isValid && generatedText.trim()) {
          currentAttempt.status = 200;
          console.log(`[Model Selection] ✅ SUCCESS with ${candidate.id} (${currentAttempt.durationMs}ms)`);
          return res.json({
            text: generatedText,
            provider,
            model: candidate.model,
            generationMs: Date.now() - generationStartedAt,
            attempts: attempts, // Return all attempts including the winner
          });
        }

        // If validation fails, treat it as a provider failure to trigger fallback loop
        currentAttempt.status = 422;
        currentAttempt.error = 'Provider response was malformed or incomplete (Validation dropped).';
        currentAttempt.providerRawError = toDebugRawProviderMessage(raw);
        console.log(`[Model Selection] ❌ Failed ${candidate.id}: Validation failed (isValid=${isValid})`);
        continue;
      }

      const errorMessage = getProviderErrorMessage(raw, aiRes.status);
      currentAttempt.status = aiRes.status;
      currentAttempt.error = errorMessage;
      currentAttempt.providerRawError = toDebugRawProviderMessage(raw);

      console.log(`[Model Selection] ❌ Failed ${candidate.id}: HTTP ${aiRes.status} - ${errorMessage}`);

      if (!shouldTryNextCandidate(aiRes.status, errorMessage)) {
        console.log(`[Model Selection] 🛑 Stopping fallback chain due to non-retryable error`);
        return res.status(aiRes.status).json({ error: errorMessage, attempts });
      }
    }

    console.log(`[Model Selection] ❌ All ${attempts.length} models failed`);
    const failedAttemptWithProvider = attempts.find((a) => a.status > 0);
    const latestError = failedAttemptWithProvider?.error || 'No prioritized model could be used with current provider limits/credits.';
    return res.status(503).json({ error: latestError, attempts });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Tutor request failed' });
  }
});

app.use((error, _req, res, next) => {
  if (error && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File exceeds 2MB limit. Please upload PDF, DOC, or DOCX up to 2MB.' });
  }
  return next(error);
});

if (fs.existsSync(clientDistDir)) {
  app.use(express.static(clientDistDir));

  app.get(/^(?!\/api\/).*/, (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return next();
    }

    return res.sendFile(path.join(clientDistDir, 'index.html'));
  });
}

app.listen(config.port, () => {
  console.log(`AntiForget API server running on http://localhost:${config.port}`);
});
