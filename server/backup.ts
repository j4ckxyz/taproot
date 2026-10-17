// Lightweight backups: a consistent SQLite snapshot (VACUUM INTO), gzipped.
// Typical projects compress to a few kilobytes.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { config } from './config.js';
import { db } from './db.js';
import { badRequest, notFound } from './util.js';

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: string;
  kind: 'auto' | 'manual' | 'pre-restore' | 'pre-upgrade';
}

// Backups made before the rename start with "cascade-".
const NAME_RE = /^(?:taproot|cascade)-(\d{8}T\d{6}Z)-(auto|manual|pre-restore|pre-upgrade)\.db\.gz$/;

export function createBackup(kind: BackupInfo['kind'] = 'manual'): BackupInfo {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const name = `taproot-${stamp}-${kind}.db.gz`;
  const tmp = path.join(config.backupDir, `.${name}.tmp.db`);
  fs.rmSync(tmp, { force: true });
  db().exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  const gz = zlib.gzipSync(fs.readFileSync(tmp), { level: 9 });
  fs.writeFileSync(path.join(config.backupDir, name), gz);
  fs.rmSync(tmp, { force: true });
  if (kind === 'auto') prune();
  return info(name)!;
}

function info(name: string): BackupInfo | null {
  const m = name.match(NAME_RE);
  if (!m) return null;
  const st = fs.statSync(path.join(config.backupDir, name));
  const s = m[1];
  const createdAt = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`;
  return { name, size: st.size, createdAt, kind: m[2] as BackupInfo['kind'] };
}

export function listBackups(): BackupInfo[] {
  if (!fs.existsSync(config.backupDir)) return [];
  return fs
    .readdirSync(config.backupDir)
    .map(info)
    .filter((b): b is BackupInfo => !!b)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function backupFile(name: string): string {
  if (!NAME_RE.test(name)) throw badRequest('Invalid backup name');
  const p = path.join(config.backupDir, name);
  if (!fs.existsSync(p)) throw notFound('Backup not found');
  return p;
}

export function deleteBackup(name: string) {
  fs.rmSync(backupFile(name));
}

function prune() {
  const autos = listBackups().filter((b) => b.kind === 'auto');
  for (const b of autos.slice(Math.max(0, config.backupKeep))) fs.rmSync(path.join(config.backupDir, b.name), { force: true });
}

/** Restores a backup over the live database. Only run while the server is stopped. */
export function restoreBackupFile(file: string) {
  const data = zlib.gunzipSync(fs.readFileSync(file));
  if (data.subarray(0, 15).toString() !== 'SQLite format 3') throw new Error('Not a SQLite backup');
  for (const suffix of ['-wal', '-shm']) fs.rmSync(config.dbPath + suffix, { force: true });
  fs.writeFileSync(config.dbPath, data);
}

let timer: NodeJS.Timeout | null = null;

export function startBackupSchedule() {
  if (config.backupIntervalHours <= 0) return;
  const intervalMs = config.backupIntervalHours * 3_600_000;
  const tick = () => {
    const last = listBackups().find((b) => b.kind === 'auto');
    if (!last || Date.now() - Date.parse(last.createdAt) >= intervalMs - 60_000) {
      try {
        const b = createBackup('auto');
        console.log(`[backup] wrote ${b.name} (${(b.size / 1024).toFixed(1)} KB)`);
      } catch (e) {
        console.error('[backup] failed', e);
      }
    }
  };
  setTimeout(tick, 5_000).unref();
  timer = setInterval(tick, Math.min(intervalMs, 3_600_000));
  timer.unref();
}
