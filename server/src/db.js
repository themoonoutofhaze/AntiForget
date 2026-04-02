import fs from 'node:fs';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { config } from './config.js';

let dbPromise;

export const getDb = async () => {
  if (!dbPromise) {
    const dbDir = path.dirname(config.dbPath);
    fs.mkdirSync(dbDir, { recursive: true });

    dbPromise = open({
      filename: config.dbPath,
      driver: sqlite3.Database,
    });

    const db = await dbPromise;
    await db.exec('PRAGMA foreign_keys = ON;');
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT,
        email TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id, user_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS topic_relations (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        source TEXT NOT NULL,
        target TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id, user_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS fsrs_records (
        user_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        due INTEGER NOT NULL,
        stability REAL NOT NULL,
        difficulty REAL NOT NULL,
        elapsed_days INTEGER NOT NULL,
        scheduled_days INTEGER NOT NULL,
        reps INTEGER NOT NULL,
        lapses INTEGER NOT NULL,
        state TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
        missed_questions_json TEXT NOT NULL DEFAULT '{}',
        ai_provider TEXT NOT NULL DEFAULT 'groq',
        ai_model_overrides_json TEXT NOT NULL DEFAULT '{}',
        ai_model_priority_json TEXT NOT NULL DEFAULT '[]',
        file_storage_provider TEXT NOT NULL DEFAULT 'local',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS api_credentials (
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        iv TEXT NOT NULL,
        tag TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, provider),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS user_auth_credentials (
        user_id TEXT PRIMARY KEY,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS user_model_priorities (
        user_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, model_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS user_revision_models (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        reasoning INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
        size_bytes INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, topic_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS drive_connections (
        user_id TEXT PRIMARY KEY,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        scope TEXT,
        expiry_date INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS passkey_challenges (
        id TEXT PRIMARY KEY,
        challenge TEXT NOT NULL,
        user_id TEXT,
        expires_at INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS passkey_credentials (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        credential_id TEXT NOT NULL UNIQUE,
        public_key TEXT NOT NULL,
        counter INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_topics_user ON topics(user_id);
      CREATE INDEX IF NOT EXISTS idx_relations_user ON topic_relations(user_id);
      CREATE INDEX IF NOT EXISTS idx_fsrs_user_due ON fsrs_records(user_id, due);
      CREATE INDEX IF NOT EXISTS idx_user_model_priorities_order ON user_model_priorities(user_id, sort_order);
      CREATE INDEX IF NOT EXISTS idx_user_revision_models_user ON user_revision_models(user_id);
    `);

    // Lightweight migration path for existing databases.
    try {
      await db.exec(`ALTER TABLE user_preferences ADD COLUMN revision_seconds_today INTEGER NOT NULL DEFAULT 0`);
    } catch {
      // Column already exists.
    }
    try {
      await db.exec(`ALTER TABLE user_preferences ADD COLUMN daily_revision_minutes_limit INTEGER NOT NULL DEFAULT 60`);
    } catch {
      // Column already exists.
    }
    try {
      await db.exec(`ALTER TABLE user_preferences ADD COLUMN student_education_level TEXT NOT NULL DEFAULT 'high school'`);
    } catch {
      // Column already exists.
    }
    try {
      await db.exec(`ALTER TABLE user_preferences ADD COLUMN student_focus_topic TEXT NOT NULL DEFAULT ''`);
    } catch {
      // Column already exists.
    }
    try {
      await db.exec(`ALTER TABLE user_preferences ADD COLUMN missed_questions_json TEXT NOT NULL DEFAULT '{}'`);
    } catch {
      // Column already exists.
    }
    try {
      await db.exec(`ALTER TABLE user_preferences ADD COLUMN student_major TEXT NOT NULL DEFAULT ''`);
    } catch {
      // Column already exists.
    }
    try {
      await db.exec(`ALTER TABLE user_preferences ADD COLUMN ai_model_priority_json TEXT NOT NULL DEFAULT '[]'`);
    } catch {
      // Column already exists.
    }

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
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(user_id, model_id)
           DO UPDATE SET sort_order = excluded.sort_order, updated_at = CURRENT_TIMESTAMP`,
          [row.user_id, normalized, sortOrder]
        );
        sortOrder += 1;
      }
    }

    await db.run(
      `INSERT INTO app_settings(key, value)
       VALUES ('local_storage_path', ?)
       ON CONFLICT(key) DO NOTHING`,
      [config.uploadsRoot]
    );
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
