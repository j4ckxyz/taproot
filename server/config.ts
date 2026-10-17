import fs from 'node:fs';
import path from 'node:path';

const env = process.env;

const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
const num = (v: string | undefined, d: number) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

const dataDir = path.resolve(env.DATA_DIR ?? './data');

export const config = {
  appName: env.APP_NAME ?? 'Taproot',
  port: num(env.PORT, 8787),
  host: env.HOST ?? '0.0.0.0',
  /** Public URL, used in generated snippets (MCP config, .env examples). */
  publicUrl: (env.PUBLIC_URL ?? '').replace(/\/$/, ''),
  dataDir,
  // Installs from before the rename keep using their existing database file.
  dbPath: fs.existsSync(path.join(dataDir, 'cascade.db')) && !fs.existsSync(path.join(dataDir, 'taproot.db'))
    ? path.join(dataDir, 'cascade.db')
    : path.join(dataDir, 'taproot.db'),
  backupDir: env.BACKUP_DIR ? path.resolve(env.BACKUP_DIR) : path.join(dataDir, 'backups'),
  /** Hours between automatic backups. 0 disables them. */
  backupIntervalHours: num(env.BACKUP_INTERVAL_HOURS, 24),
  /** Number of automatic backups to keep. */
  backupKeep: num(env.BACKUP_KEEP, 14),
  /** Allow anyone who can reach the server to create an account. The first account is always allowed and becomes admin. */
  allowSignup: bool(env.ALLOW_SIGNUP, false),
  /** Set when serving over HTTPS so session cookies are marked Secure. */
  secureCookies: bool(env.SECURE_COOKIES, false),
  sessionDays: num(env.SESSION_DAYS, 30),
  /** Allow MCP clients that cannot send headers to put the token in the URL path (/mcp/t/<token>). */
  allowTokenInUrl: bool(env.MCP_ALLOW_TOKEN_IN_URL, true),
  isDev: env.NODE_ENV !== 'production',
};
