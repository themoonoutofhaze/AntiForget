import pg from 'pg';
import { config } from './config.js';

const { Pool, types } = pg;

// PostgreSQL returns int8 as string by default; this app stores epoch ms in bigint columns.
types.setTypeParser(20, (value) => Number(value));

let dbPromise;

const nowTextDefault = "DEFAULT (CURRENT_TIMESTAMP::text)";

const toPgPlaceholders = (sql) => {
  let index = 1;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;
  let out = '';

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];

    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }

    if (!inDoubleQuote && ch === "'") {
      inSingleQuote = !inSingleQuote;
      out += ch;
      continue;
    }

    if (!inSingleQuote && ch === '"') {
      inDoubleQuote = !inDoubleQuote;
      out += ch;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && ch === '?') {
      out += `$${index}`;
      index += 1;
      continue;
    }

    out += ch;
  }

  return out;
};

const splitSqlStatements = (sql) => {
  const statements = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      current += ch;
      escaped = true;
      continue;
    }

    if (!inDoubleQuote && ch === "'") {
      inSingleQuote = !inSingleQuote;
      current += ch;
      continue;
    }

    if (!inSingleQuote && ch === '"') {
      inDoubleQuote = !inDoubleQuote;
      current += ch;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && ch === ';') {
      const trimmed = current.trim();
      if (trimmed) {
        statements.push(trimmed);
      }
      current = '';
      continue;
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail) {
    statements.push(tail);
  }

  return statements;
};

const normalizeParams = (params) => {
  if (Array.isArray(params)) {
    return params;
  }
  if (params === undefined) {
    return [];
  }
  return [params];
};

class PostgresCompatDb {
  constructor(pool) {
    this.pool = pool;
    this.txClient = null;
  }

  async _query(sql, params = []) {
    const text = toPgPlaceholders(sql);
    const values = normalizeParams(params);
    const executor = this.txClient || this.pool;
    return executor.query({ text, values });
  }

  async run(sql, params = []) {
    const result = await this._query(sql, params);
    return {
      changes: result.rowCount ?? 0,
      lastID: null,
    };
  }

  async get(sql, params = []) {
    const result = await this._query(sql, params);
    return result.rows[0] || undefined;
  }

  async all(sql, params = []) {
    const result = await this._query(sql, params);
    return result.rows;
  }

  async exec(sql) {
    const statements = splitSqlStatements(sql);
    if (statements.length === 0) {
      return;
    }

    for (const statement of statements) {
      const upper = statement.trim().toUpperCase();

      if (upper === 'BEGIN') {
        if (this.txClient) {
          throw new Error('Nested transactions are not supported');
        }
        this.txClient = await this.pool.connect();
        await this.txClient.query('BEGIN');
        continue;
      }

      if (upper === 'COMMIT') {
        if (!this.txClient) {
          throw new Error('COMMIT called without active transaction');
        }
        const client = this.txClient;
        this.txClient = null;
        try {
          await client.query('COMMIT');
        } finally {
          client.release();
        }
        continue;
      }

      if (upper === 'ROLLBACK') {
        if (!this.txClient) {
          return;
        }
        const client = this.txClient;
        this.txClient = null;
        try {
          await client.query('ROLLBACK');
        } finally {
          client.release();
        }
        continue;
      }

      await this._query(statement);
    }
  }
}

const ensureSchema = async (db) => {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT,
      created_at TEXT NOT NULL ${nowTextDefault},
      updated_at TEXT NOT NULL ${nowTextDefault}
    );

    CREATE TABLE IF NOT EXISTS topics (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      has_pdf_blob INTEGER NOT NULL DEFAULT 0,
      position_x REAL NOT NULL,
      position_y REAL NOT NULL,
      created_at TEXT NOT NULL ${nowTextDefault},
      updated_at TEXT NOT NULL ${nowTextDefault},
      PRIMARY KEY (id, user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS topic_relations (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      created_at TEXT NOT NULL ${nowTextDefault},
      PRIMARY KEY (id, user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS fsrs_records (
      user_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      due BIGINT NOT NULL,
      stability REAL NOT NULL,
      difficulty REAL NOT NULL,
      elapsed_days INTEGER NOT NULL,
      scheduled_days INTEGER NOT NULL,
      reps INTEGER NOT NULL,
      lapses INTEGER NOT NULL,
      state TEXT NOT NULL,
      updated_at TEXT NOT NULL ${nowTextDefault},
      PRIMARY KEY (user_id, node_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY,
      completed_revisions_today INTEGER NOT NULL DEFAULT 0,
      revision_seconds_today INTEGER NOT NULL DEFAULT 0,
      daily_revision_minutes_limit INTEGER NOT NULL DEFAULT 60,
      last_revision_date TEXT NOT NULL,
      student_education_level TEXT NOT NULL DEFAULT 'high school',
      student_major TEXT NOT NULL DEFAULT '',
      student_focus_topic TEXT NOT NULL DEFAULT '',
      ai_language TEXT NOT NULL DEFAULT 'English',
      missed_questions_json TEXT NOT NULL DEFAULT '{}',
      ai_provider TEXT NOT NULL DEFAULT 'groq',
      ai_model_overrides_json TEXT NOT NULL DEFAULT '{}',
      ai_model_priority_json TEXT NOT NULL DEFAULT '[]',
      file_storage_provider TEXT NOT NULL DEFAULT 'google-drive',
      created_at TEXT NOT NULL ${nowTextDefault},
      updated_at TEXT NOT NULL ${nowTextDefault},
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS api_credentials (
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      tag TEXT NOT NULL,
      updated_at TEXT NOT NULL ${nowTextDefault},
      PRIMARY KEY (user_id, provider),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_auth_credentials (
      user_id TEXT PRIMARY KEY,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      kdf_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL ${nowTextDefault},
      updated_at TEXT NOT NULL ${nowTextDefault},
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_model_priorities (
      user_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      updated_at TEXT NOT NULL ${nowTextDefault},
      PRIMARY KEY (user_id, model_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_revision_models (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      reasoning INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL ${nowTextDefault},
      updated_at TEXT NOT NULL ${nowTextDefault},
      UNIQUE (user_id, provider, model),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS file_assets (
      user_id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      storage_path TEXT,
      drive_file_id TEXT,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size_bytes BIGINT,
      created_at TEXT NOT NULL ${nowTextDefault},
      updated_at TEXT NOT NULL ${nowTextDefault},
      PRIMARY KEY (user_id, topic_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS drive_connections (
      user_id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      scope TEXT,
      expiry_date BIGINT,
      created_at TEXT NOT NULL ${nowTextDefault},
      updated_at TEXT NOT NULL ${nowTextDefault},
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL ${nowTextDefault}
    );

    CREATE TABLE IF NOT EXISTS passkey_challenges (
      id TEXT PRIMARY KEY,
      challenge TEXT NOT NULL,
      user_id TEXT,
      expires_at BIGINT NOT NULL,
      created_at TEXT NOT NULL ${nowTextDefault}
    );

    CREATE TABLE IF NOT EXISTS passkey_credentials (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      credential_id TEXT NOT NULL UNIQUE,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL ${nowTextDefault},
      updated_at TEXT NOT NULL ${nowTextDefault},
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_topics_user ON topics(user_id);
    CREATE INDEX IF NOT EXISTS idx_relations_user ON topic_relations(user_id);
    CREATE INDEX IF NOT EXISTS idx_fsrs_user_due ON fsrs_records(user_id, due);
    CREATE INDEX IF NOT EXISTS idx_user_model_priorities_order ON user_model_priorities(user_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_user_revision_models_user ON user_revision_models(user_id);
  `);

  await db.exec(`
    ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS revision_seconds_today INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS daily_revision_minutes_limit INTEGER NOT NULL DEFAULT 60;
    ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS student_education_level TEXT NOT NULL DEFAULT 'high school';
    ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS student_focus_topic TEXT NOT NULL DEFAULT '';
    ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS ai_language TEXT NOT NULL DEFAULT 'English';
    ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS missed_questions_json TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS student_major TEXT NOT NULL DEFAULT '';
    ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS ai_model_priority_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE user_auth_credentials ADD COLUMN IF NOT EXISTS kdf_version INTEGER NOT NULL DEFAULT 1;
  `);

  const legacyRows = await db.all(
    `SELECT user_id, ai_model_priority_json FROM user_preferences
     WHERE ai_model_priority_json IS NOT NULL AND ai_model_priority_json != '[]'`
  );

  for (const row of legacyRows) {
    let parsed = [];
    try {
      parsed = JSON.parse(row.ai_model_priority_json || '[]');
    } catch {
      parsed = [];
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      continue;
    }

    const seen = new Set();
    let sortOrder = 0;
    for (const modelId of parsed) {
      if (typeof modelId !== 'string' || !modelId.trim()) {
        continue;
      }

      const normalized = modelId.trim();
      if (seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      await db.run(
        `INSERT INTO user_model_priorities(user_id, model_id, sort_order, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP::text)
         ON CONFLICT(user_id, model_id)
         DO UPDATE SET sort_order = excluded.sort_order, updated_at = CURRENT_TIMESTAMP::text`,
        [row.user_id, normalized, sortOrder]
      );
      sortOrder += 1;
    }
  }

  await db.run(
    `UPDATE user_preferences
     SET file_storage_provider = 'google-drive',
         updated_at = CURRENT_TIMESTAMP::text
     WHERE file_storage_provider IS NULL OR file_storage_provider != 'google-drive'`
  );
};

export const getDb = async () => {
  if (!dbPromise) {
    const pool = new Pool({
      connectionString: config.databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      ssl: config.databaseUrl.includes('supabase.co')
        ? {
            rejectUnauthorized: false,
          }
        : undefined,
    });

    const db = new PostgresCompatDb(pool);
    dbPromise = Promise.resolve(db);
    await ensureSchema(db);
  }

  return dbPromise;
};

export const ensureUser = async (userId) => {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = await getDb();
  const today = new Date().toISOString().slice(0, 10);

  await db.run(
    `INSERT INTO users(id) VALUES (?) ON CONFLICT(id) DO NOTHING`,
    [userId]
  );

  await db.run(
    `INSERT INTO user_preferences(user_id, last_revision_date)
     VALUES (?, ?)
     ON CONFLICT(user_id) DO NOTHING`,
    [userId, today]
  );
};
