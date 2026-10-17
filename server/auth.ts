import crypto from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { ApiToken, Preferences, User } from '../shared/types.js';
import { config } from './config.js';
import { db } from './db.js';
import { forbidden, HttpError, newId, now, sha256, unauthorized } from './util.js';

export const SESSION_COOKIE = 'taproot_session';
export const TOKEN_PREFIX = 'tap_';
/** Tokens created before the rename. */
const LEGACY_PREFIX = 'cas_';
/** Header the web client sends on cookie-authenticated writes, to block cross-site form posts. */
export const CSRF_HEADER = 'x-taproot-client';

export interface TokenContext {
  id: string;
  name: string;
  canWrite: boolean;
  projectIds: string[] | null;
}

export interface Actor {
  user: User;
  token: TokenContext | null;
}

export type AppEnv = { Variables: { actor: Actor | null } };

// ---------- passwords ----------

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, N, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(expected, got);
}

// ---------- users ----------

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  is_admin: number;
  created_at: string;
  prefs?: string;
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  name: r.name,
  isAdmin: !!r.is_admin,
  createdAt: r.created_at,
  prefs: parsePrefs(r.prefs),
});

function parsePrefs(s: string | undefined): Partial<Preferences> {
  try {
    const v = JSON.parse(s ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function userCount(): number {
  return (db().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

export function createUser(input: { email: string; name: string; password: string; isAdmin?: boolean }): User {
  if (input.password.length < 8) throw new HttpError(422, 'Password must be at least 8 characters', 'weak_password');
  const exists = db().prepare('SELECT 1 FROM users WHERE email = ?').get(input.email);
  if (exists) throw new HttpError(409, 'An account with that email already exists', 'email_taken');
  const row: UserRow = {
    id: newId(),
    email: input.email.trim(),
    name: input.name.trim() || input.email.split('@')[0],
    password_hash: hashPassword(input.password),
    is_admin: input.isAdmin ? 1 : 0,
    created_at: now(),
  };
  db()
    .prepare('INSERT INTO users (id, email, name, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(row.id, row.email, row.name, row.password_hash, row.is_admin, row.created_at);
  return toUser(row);
}

export function listUsers(): User[] {
  return (db().prepare('SELECT * FROM users ORDER BY created_at').all() as unknown as UserRow[]).map(toUser);
}

export function getUser(id: string): User | null {
  const r = db().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return r ? toUser(r) : null;
}

export function updateUser(
  id: string,
  patch: { name?: string; email?: string; password?: string; isAdmin?: boolean; prefs?: Partial<Preferences> },
) {
  const d = db();
  if (patch.prefs !== undefined) {
    const cur = getUser(id)?.prefs ?? {};
    d.prepare('UPDATE users SET prefs = ? WHERE id = ?').run(JSON.stringify({ ...cur, ...patch.prefs }), id);
  }
  if (patch.name !== undefined) d.prepare('UPDATE users SET name = ? WHERE id = ?').run(patch.name.trim(), id);
  if (patch.email !== undefined) {
    const taken = d.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(patch.email, id);
    if (taken) throw new HttpError(409, 'An account with that email already exists', 'email_taken');
    d.prepare('UPDATE users SET email = ? WHERE id = ?').run(patch.email.trim(), id);
  }
  if (patch.password !== undefined) {
    if (patch.password.length < 8) throw new HttpError(422, 'Password must be at least 8 characters', 'weak_password');
    d.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(patch.password), id);
    d.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
  if (patch.isAdmin !== undefined) d.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(patch.isAdmin ? 1 : 0, id);
  return getUser(id);
}

export function deleteUser(id: string) {
  db().prepare('DELETE FROM users WHERE id = ?').run(id);
}

const attempts = new Map<string, { n: number; until: number }>();

export function login(email: string, password: string, ip: string): User {
  const key = `${ip}|${email.toLowerCase()}`;
  const a = attempts.get(key);
  if (a && a.n >= 8 && a.until > Date.now()) {
    throw new HttpError(429, 'Too many attempts. Try again in a few minutes.', 'rate_limited');
  }
  const r = db().prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
  if (!r || !verifyPassword(password, r.password_hash)) {
    attempts.set(key, { n: (a?.n ?? 0) + 1, until: Date.now() + 10 * 60_000 });
    throw new HttpError(401, 'Wrong email or password', 'bad_credentials');
  }
  attempts.delete(key);
  return toUser(r);
}

// ---------- sessions ----------

export function startSession(c: Context, userId: string) {
  const raw = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 86_400_000);
  db()
    .prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(sha256(raw), userId, now(), expires.toISOString());
  setCookie(c, SESSION_COOKIE, raw, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.secureCookies,
    path: '/',
    expires,
  });
}

export function endSession(c: Context) {
  const raw = getCookie(c, SESSION_COOKIE);
  if (raw) db().prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha256(raw));
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

function userFromSession(raw: string): User | null {
  const r = db()
    .prepare(
      'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ? AND s.expires_at > ?',
    )
    .get(sha256(raw), now()) as UserRow | undefined;
  return r ? toUser(r) : null;
}

// ---------- API tokens ----------

interface TokenRow {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  prefix: string;
  can_write: number;
  project_ids: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

const toToken = (r: TokenRow): ApiToken => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  canWrite: !!r.can_write,
  projectIds: r.project_ids ? JSON.parse(r.project_ids) : null,
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
  expiresAt: r.expires_at,
});

export function createToken(
  userId: string,
  input: { name: string; canWrite: boolean; projectIds: string[] | null; expiresAt: string | null },
): { token: ApiToken; secret: string } {
  const secret = TOKEN_PREFIX + crypto.randomBytes(24).toString('base64url');
  const row: TokenRow = {
    id: newId(),
    user_id: userId,
    name: input.name.trim() || 'Agent',
    token_hash: sha256(secret),
    prefix: secret.slice(0, TOKEN_PREFIX.length + 6),
    can_write: input.canWrite ? 1 : 0,
    project_ids: input.projectIds ? JSON.stringify(input.projectIds) : null,
    created_at: now(),
    last_used_at: null,
    expires_at: input.expiresAt,
    revoked_at: null,
  };
  db()
    .prepare(
      `INSERT INTO api_tokens (id, user_id, name, token_hash, prefix, can_write, project_ids, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(row.id, row.user_id, row.name, row.token_hash, row.prefix, row.can_write, row.project_ids, row.created_at, row.expires_at);
  return { token: toToken(row), secret };
}

export function listTokens(userId: string): ApiToken[] {
  return (
    db()
      .prepare('SELECT * FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC')
      .all(userId) as unknown as TokenRow[]
  ).map(toToken);
}

export function updateToken(
  userId: string,
  id: string,
  patch: { name?: string; canWrite?: boolean; projectIds?: string[] | null; expiresAt?: string | null },
): ApiToken {
  const d = db();
  const r = d.prepare('SELECT * FROM api_tokens WHERE id = ? AND user_id = ? AND revoked_at IS NULL').get(id, userId) as
    | TokenRow
    | undefined;
  if (!r) throw new HttpError(404, 'Token not found', 'not_found');
  if (patch.name !== undefined) d.prepare('UPDATE api_tokens SET name = ? WHERE id = ?').run(patch.name.trim(), id);
  if (patch.canWrite !== undefined) d.prepare('UPDATE api_tokens SET can_write = ? WHERE id = ?').run(patch.canWrite ? 1 : 0, id);
  if (patch.projectIds !== undefined)
    d.prepare('UPDATE api_tokens SET project_ids = ? WHERE id = ?').run(
      patch.projectIds ? JSON.stringify(patch.projectIds) : null,
      id,
    );
  if (patch.expiresAt !== undefined) d.prepare('UPDATE api_tokens SET expires_at = ? WHERE id = ?').run(patch.expiresAt, id);
  return toToken(d.prepare('SELECT * FROM api_tokens WHERE id = ?').get(id) as unknown as TokenRow);
}

export function revokeToken(userId: string, id: string) {
  const res = db().prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL').run(now(), id, userId);
  if (!res.changes) throw new HttpError(404, 'Token not found', 'not_found');
}

const lastUsedWrites = new Map<string, number>();

export function actorFromToken(secret: string): Actor | null {
  if (!secret.startsWith(TOKEN_PREFIX) && !secret.startsWith(LEGACY_PREFIX)) return null;
  const r = db()
    .prepare('SELECT * FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL')
    .get(sha256(secret)) as TokenRow | undefined;
  if (!r) return null;
  if (r.expires_at && r.expires_at < now()) return null;
  const user = getUser(r.user_id);
  if (!user) return null;
  // Throttle last-used bookkeeping to once a minute per token.
  const last = lastUsedWrites.get(r.id) ?? 0;
  if (Date.now() - last > 60_000) {
    lastUsedWrites.set(r.id, Date.now());
    db().prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(now(), r.id);
  }
  const t = toToken(r);
  return { user, token: { id: t.id, name: t.name, canWrite: t.canWrite, projectIds: t.projectIds } };
}

// ---------- middleware ----------

export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('authorization');
  let actor: Actor | null = null;
  if (header?.toLowerCase().startsWith('bearer ')) {
    actor = actorFromToken(header.slice(7).trim());
    if (!actor) throw unauthorized('Invalid, expired or revoked API token');
  } else {
    const raw = getCookie(c, SESSION_COOKIE);
    if (raw) {
      const user = userFromSession(raw);
      if (user) {
        actor = { user, token: null };
        const m = c.req.method;
        if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' && !c.req.header(CSRF_HEADER)) {
          throw forbidden(`Missing ${CSRF_HEADER} header`);
        }
      }
    }
  }
  c.set('actor', actor);
  await next();
};

export function requireActor(c: Context<AppEnv>): Actor {
  const a = c.get('actor');
  if (!a) throw unauthorized();
  return a;
}

/** Endpoints that manage accounts and tokens are for people, not agents. */
export function requireSession(c: Context<AppEnv>): Actor {
  const a = requireActor(c);
  if (a.token) throw forbidden('This endpoint needs a signed-in user, not an API token');
  return a;
}

export function requireAdmin(c: Context<AppEnv>): Actor {
  const a = requireSession(c);
  if (!a.user.isAdmin) throw forbidden('Admins only');
  return a;
}

export function actorName(a: Actor): string {
  return a.token ? `${a.token.name} (API)` : a.user.name;
}
