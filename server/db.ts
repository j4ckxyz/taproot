import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE api_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    can_write INTEGER NOT NULL DEFAULT 0,
    project_ids TEXT,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    expires_at TEXT,
    revoked_at TEXT
  );
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT 'blue',
    description TEXT NOT NULL DEFAULT '',
    settings TEXT NOT NULL DEFAULT '{}',
    archived INTEGER NOT NULL DEFAULT 0,
    root_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX projects_owner ON projects(owner_id);
  CREATE TABLE nodes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_id TEXT,
    sort REAL NOT NULL DEFAULT 0,
    title TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    shape TEXT NOT NULL DEFAULT 'rounded',
    color TEXT,
    child_layout TEXT NOT NULL DEFAULT 'row',
    collapsed INTEGER NOT NULL DEFAULT 0,
    done INTEGER NOT NULL DEFAULT 0,
    done_at TEXT,
    start_date TEXT,
    due_date TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    meta TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX nodes_project ON nodes(project_id);
  CREATE INDEX nodes_due ON nodes(due_date) WHERE due_date IS NOT NULL;
  CREATE TABLE activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    token_id TEXT,
    actor_name TEXT NOT NULL,
    summary TEXT NOT NULL,
    at TEXT NOT NULL
  );
  CREATE INDEX activity_project ON activity(project_id, id);
  `,
  `
  ALTER TABLE users ADD COLUMN prefs TEXT NOT NULL DEFAULT '{}';
  UPDATE nodes SET shape = 'rounded' WHERE parent_id IS NULL AND shape = 'ellipse';
  `,
  `
  ALTER TABLE activity ADD COLUMN node_id TEXT;
  `,
];

export type DB = DatabaseSync;

export function openDb(file = config.dbPath): DatabaseSync {
  if (file !== ':memory:') fs.mkdirSync(config.dataDir, { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  migrate(db, file !== ':memory:');
  return db;
}

function migrate(db: DatabaseSync, onDisk: boolean) {
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  // Updating to a version with database changes? Keep a copy of the data from before.
  if (user_version > 0 && user_version < MIGRATIONS.length && onDisk) snapshotBeforeUpgrade(db);
  for (let v = user_version; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

function snapshotBeforeUpgrade(db: DatabaseSync) {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const tmp = path.join(config.backupDir, `.pre-upgrade-${stamp}.tmp.db`);
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  fs.writeFileSync(path.join(config.backupDir, `taproot-${stamp}-pre-upgrade.db.gz`), zlib.gzipSync(fs.readFileSync(tmp), { level: 9 }));
  fs.rmSync(tmp, { force: true });
}

export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

let instance: DatabaseSync | null = null;
export function db(): DatabaseSync {
  if (!instance) instance = openDb();
  return instance;
}
export function setDb(d: DatabaseSync) {
  instance = d;
}
