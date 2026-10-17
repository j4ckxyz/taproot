import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { ChangeEvent, Presence, Op } from '../../shared/types.js';
import { buildTree, toMarkdown } from '../../shared/tree.js';
import { buildScene } from '../../shared/render.js';
import { todayISO } from '../../shared/deadline.js';
import {
  createToken,
  createUser,
  deleteUser,
  endSession,
  listTokens,
  listUsers,
  login,
  requireActor,
  requireAdmin,
  requireSession,
  revokeToken,
  startSession,
  updateToken,
  updateUser,
  userCount,
  type AppEnv,
} from '../auth.js';
import { config } from '../config.js';
import {
  applyOps,
  bus,
  createProject,
  deleteProject,
  getDoc,
  getProject,
  importDoc,
  listActivity,
  listProjects,
  searchNodes,
  updateProject,
} from '../store.js';
import {
  OpsBodySchema,
  ProjectCreateSchema,
  ProjectPatchSchema,
  TokenCreateSchema,
  TokenPatchSchema,
  NodePatchSchema,
  NodeCreateSchema,
  PreferencesSchema,
} from '../schemas.js';
import { backupFile, createBackup, deleteBackup, listBackups } from '../backup.js';
import {
  exportExcalidraw,
  exportJSON,
  exportMarkdown,
  exportOPML,
  exportMermaid,
  exportSVG,
  importMarkdown,
  importOPML,
} from '../export/formats.js';
import { renderPNG } from '../export/png.js';
import { badRequest, forbidden, HttpError } from '../util.js';
import { agentActivity, leave as leavePresence, list as listPresence, presenceKey, userPresence } from '../presence.js';
import { versionInfo } from '../version.js';
import fs from 'node:fs';

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest('Body must be JSON');
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    throw new HttpError(422, r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), 'validation');
  }
  return r.data;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';

export function apiRoutes() {
  const api = new Hono<AppEnv>();

  // ---------- auth ----------

  api.get('/auth/status', (c) => {
    const a = c.get('actor');
    return c.json({
      appName: config.appName,
      needsSetup: userCount() === 0,
      allowSignup: config.allowSignup,
      user: a && !a.token ? a.user : null,
    });
  });

  api.post('/auth/setup', async (c) => {
    if (userCount() > 0) throw forbidden('Setup has already been completed');
    const b = await body(c, z.object({ email: z.email(), name: z.string().max(80).default(''), password: z.string().min(8) }));
    const user = createUser({ ...b, isAdmin: true });
    startSession(c, user.id);
    return c.json({ user });
  });

  api.post('/auth/signup', async (c) => {
    if (!config.allowSignup) throw forbidden('Sign-up is disabled on this server. Ask an admin for an account.');
    const b = await body(c, z.object({ email: z.email(), name: z.string().max(80).default(''), password: z.string().min(8) }));
    const user = createUser(b);
    startSession(c, user.id);
    return c.json({ user });
  });

  api.post('/auth/login', async (c) => {
    const b = await body(c, z.object({ email: z.string(), password: z.string() }));
    const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'local';
    const user = login(b.email, b.password, ip);
    startSession(c, user.id);
    return c.json({ user });
  });

  api.post('/auth/logout', (c) => {
    endSession(c);
    return c.json({ ok: true });
  });

  api.get('/version', (c) => {
    requireActor(c);
    return c.json(versionInfo());
  });

  api.get('/me', (c) => {
    const a = requireActor(c);
    return c.json({ user: a.user, token: a.token });
  });

  api.patch('/me', async (c) => {
    const a = requireSession(c);
    const b = await body(
      c,
      z.object({ name: z.string().min(1).max(80), email: z.email(), password: z.string().min(8), prefs: PreferencesSchema }).partial(),
    );
    return c.json({ user: updateUser(a.user.id, b) });
  });

  // ---------- users (admin) ----------

  api.get('/users', (c) => {
    requireAdmin(c);
    return c.json({ users: listUsers() });
  });

  api.post('/users', async (c) => {
    requireAdmin(c);
    const b = await body(
      c,
      z.object({ email: z.email(), name: z.string().max(80).default(''), password: z.string().min(8), isAdmin: z.boolean().default(false) }),
    );
    return c.json({ user: createUser(b) }, 201);
  });

  api.patch('/users/:id', async (c) => {
    const a = requireAdmin(c);
    const b = await body(c, z.object({ name: z.string().min(1), password: z.string().min(8), isAdmin: z.boolean() }).partial());
    if (c.req.param('id') === a.user.id && b.isAdmin === false) throw badRequest('You cannot remove your own admin rights');
    return c.json({ user: updateUser(c.req.param('id'), b) });
  });

  api.delete('/users/:id', (c) => {
    const a = requireAdmin(c);
    if (c.req.param('id') === a.user.id) throw badRequest('You cannot delete your own account here');
    deleteUser(c.req.param('id'));
    return c.json({ ok: true });
  });

  // ---------- tokens ----------

  api.get('/tokens', (c) => {
    const a = requireSession(c);
    return c.json({ tokens: listTokens(a.user.id) });
  });

  api.post('/tokens', async (c) => {
    const a = requireSession(c);
    const b = await body(c, TokenCreateSchema);
    if (b.projectIds) for (const id of b.projectIds) getProject(a, id);
    const { token, secret } = createToken(a.user.id, b);
    return c.json({ token, secret }, 201);
  });

  api.patch('/tokens/:id', async (c) => {
    const a = requireSession(c);
    const b = await body(c, TokenPatchSchema);
    if (b.projectIds) for (const id of b.projectIds) getProject(a, id);
    return c.json({ token: updateToken(a.user.id, c.req.param('id'), b) });
  });

  api.delete('/tokens/:id', (c) => {
    const a = requireSession(c);
    revokeToken(a.user.id, c.req.param('id'));
    return c.json({ ok: true });
  });

  // ---------- projects ----------

  api.get('/projects', (c) => {
    const a = requireActor(c);
    return c.json({ projects: listProjects(a, { includeArchived: c.req.query('archived') === 'true' }) });
  });

  api.post('/projects', async (c) => {
    const a = requireActor(c);
    const b = await body(c, ProjectCreateSchema.extend({ rootTitle: z.string().max(500).optional() }));
    const { rootTitle, ...input } = b;
    return c.json(createProject(a, input, rootTitle), 201);
  });

  api.post('/projects/import', async (c) => {
    const a = requireActor(c);
    const format = c.req.query('format') ?? 'json';
    const text = await c.req.text();
    if (text.length > 5_000_000) throw new HttpError(413, 'Import too large', 'too_large');
    let doc;
    if (format === 'json') {
      try {
        doc = JSON.parse(text);
      } catch {
        throw badRequest('Invalid JSON');
      }
      if (!Array.isArray(doc?.nodes)) throw badRequest('Expected a Taproot project export with a "nodes" array');
    } else if (format === 'markdown' || format === 'md') doc = importMarkdown(text, c.req.query('name') ?? 'Imported');
    else if (format === 'opml') doc = importOPML(text, c.req.query('name') ?? 'Imported');
    else throw badRequest('format must be json, markdown or opml');
    return c.json(importDoc(a, doc), 201);
  });

  api.get('/projects/:id', (c) => {
    const a = requireActor(c);
    const doc = getDoc(a, c.req.param('id'));
    agentActivity(a, doc.project.id, null, 'reading');
    if (c.req.query('include') === 'deadlines') {
      const scene = buildScene(doc, c.req.query('today') ?? todayISO());
      return c.json({
        ...doc,
        deadlines: Object.fromEntries([...scene.deadlines].filter(([, d]) => d.level !== 'none')),
      });
    }
    return c.json(doc);
  });

  api.patch('/projects/:id', async (c) => {
    const a = requireActor(c);
    const b = await body(c, ProjectPatchSchema);
    return c.json({ project: updateProject(a, c.req.param('id'), b, c.req.header('x-client-id')) });
  });

  api.delete('/projects/:id', (c) => {
    const a = requireActor(c);
    deleteProject(a, c.req.param('id'));
    return c.json({ ok: true });
  });

  api.post('/projects/:id/ops', async (c) => {
    const a = requireActor(c);
    const b = await body(c, OpsBodySchema);
    return c.json(applyOps(a, c.req.param('id'), b.ops as Op[], b.clientId ?? null));
  });

  // Single-node conveniences, handy for agents and scripts.
  api.post('/projects/:id/nodes', async (c) => {
    const a = requireActor(c);
    const b = await body(c, NodeCreateSchema);
    const r = applyOps(a, c.req.param('id'), [{ op: 'create', node: b }] as Op[]);
    return c.json({ node: r.upserted[0], version: r.version }, 201);
  });

  api.patch('/projects/:id/nodes/:nodeId', async (c) => {
    const a = requireActor(c);
    const b = await body(c, NodePatchSchema);
    const r = applyOps(a, c.req.param('id'), [{ op: 'update', id: c.req.param('nodeId'), patch: b }] as Op[]);
    return c.json({ node: r.upserted[0], version: r.version });
  });

  api.delete('/projects/:id/nodes/:nodeId', (c) => {
    const a = requireActor(c);
    const r = applyOps(a, c.req.param('id'), [{ op: 'delete', id: c.req.param('nodeId') }]);
    return c.json({ deleted: r.deleted, version: r.version });
  });

  api.get('/projects/:id/activity', (c) => {
    const a = requireActor(c);
    return c.json({ activity: listActivity(a, c.req.param('id'), Number(c.req.query('limit') ?? 50)) });
  });

  api.get('/projects/:id/export', (c) => {
    const a = requireActor(c);
    const doc = getDoc(a, c.req.param('id'));
    const format = c.req.query('format') ?? 'json';
    const theme = c.req.query('theme') === 'dark' ? 'dark' : 'light';
    const name = slug(doc.project.name);
    const download = c.req.query('download') !== 'false';
    const send = (data: string | Uint8Array, type: string, ext: string) => {
      c.header('content-type', type);
      if (download) c.header('content-disposition', `attachment; filename="${name}.${ext}"`);
      return c.body(data as string);
    };
    switch (format) {
      case 'json':
        return send(JSON.stringify(exportJSON(doc), null, 2), 'application/json', 'taproot.json');
      case 'markdown':
      case 'md':
        return send(exportMarkdown(doc), 'text/markdown; charset=utf-8', 'md');
      case 'opml':
        return send(exportOPML(doc), 'text/x-opml; charset=utf-8', 'opml');
      case 'mermaid':
      case 'mmd':
        return send(exportMermaid(doc, theme), 'text/vnd.mermaid; charset=utf-8', 'mmd');
      case 'excalidraw':
        return send(JSON.stringify(exportExcalidraw(doc, theme)), 'application/json', 'excalidraw');
      case 'svg':
        return send(exportSVG(doc, theme), 'image/svg+xml', 'svg');
      case 'png':
        return send(new Uint8Array(renderPNG(doc, { theme, maxWidth: Number(c.req.query('maxWidth') ?? 2400) })), 'image/png', 'png');
      default:
        throw badRequest('format must be one of json, markdown, opml, mermaid, excalidraw, svg, png');
    }
  });

  api.get('/projects/:id/outline', (c) => {
    const a = requireActor(c);
    const doc = getDoc(a, c.req.param('id'));
    c.header('content-type', 'text/markdown; charset=utf-8');
    return c.body(toMarkdown(buildTree(doc.nodes), { includeDone: c.req.query('includeDone') !== 'false', heading: doc.project.name }));
  });

  /** Live updates for a project, as Server-Sent Events. */
  // Where a browser tab (or an agent) is: the selected card, refreshed every ~15s while open.
  api.post('/projects/:id/presence', async (c) => {
    const a = requireActor(c);
    const id = c.req.param('id');
    getProject(a, id);
    const b = await body(c, z.object({ clientId: z.string().min(4).max(64), nodeId: z.string().max(40).nullable().default(null), leave: z.boolean().default(false) }));
    if (b.leave) leavePresence(id, presenceKey(a, b.clientId));
    else userPresence(a, id, b.clientId, b.nodeId);
    return c.json({ ok: true });
  });

  api.get('/projects/:id/presence', (c) => {
    const a = requireActor(c);
    getProject(a, c.req.param('id'));
    return c.json({ presence: listPresence(c.req.param('id')) });
  });

  api.get('/projects/:id/events', (c) => {
    const a = requireActor(c);
    const id = c.req.param('id');
    const project = getProject(a, id);
    return streamSSE(c, async (stream) => {
      const queue: ChangeEvent[] = [];
      let wake: (() => void) | null = null;
      let presence: Presence[] | null = null;
      const onChange = (ev: ChangeEvent) => {
        queue.push(ev);
        wake?.();
      };
      // Presence is a snapshot; only the latest one matters.
      const onPresence = (list: Presence[]) => {
        presence = list;
        wake?.();
      };
      bus.on(`project:${id}`, onChange);
      bus.on(`presence:${id}`, onPresence);
      const stop = () => {
        bus.off(`project:${id}`, onChange);
        bus.off(`presence:${id}`, onPresence);
      };
      stream.onAbort(() => {
        stop();
        wake?.();
      });
      await stream.writeSSE({ event: 'hello', data: JSON.stringify({ version: project.version }) });
      await stream.writeSSE({ event: 'presence', data: JSON.stringify(listPresence(id)) });
      while (!stream.aborted) {
        if (presence) {
          const p = presence;
          presence = null;
          await stream.writeSSE({ event: 'presence', data: JSON.stringify(p) });
          continue;
        }
        if (!queue.length) {
          await Promise.race([new Promise<void>((r) => (wake = r)), stream.sleep(25_000)]);
          wake = null;
          if (!queue.length && !presence && !stream.aborted) await stream.writeSSE({ event: 'ping', data: '{}' });
          continue;
        }
        const ev = queue.shift()!;
        await stream.writeSSE({ event: 'change', data: JSON.stringify(ev) });
      }
      stop();
    });
  });

  // ---------- search & deadlines ----------

  api.get('/search', (c) => {
    const a = requireActor(c);
    const q = c.req.query();
    return c.json({
      results: searchNodes(a, {
        query: q.q,
        projectId: q.projectId,
        status: (q.status as 'open' | 'done' | 'all') ?? 'all',
        dueBefore: q.dueBefore,
        tag: q.tag,
        limit: q.limit ? Number(q.limit) : undefined,
      }),
    });
  });

  api.get('/deadlines', (c) => {
    const a = requireActor(c);
    const days = Number(c.req.query('days') ?? 14);
    const today = c.req.query('today') ?? todayISO();
    const until = new Date(Date.parse(today) + days * 86_400_000).toISOString().slice(0, 10);
    return c.json({ today, until, results: searchNodes(a, { status: 'open', dueBefore: until, limit: 200 }) });
  });

  // ---------- backups (admin) ----------

  api.get('/backups', (c) => {
    requireAdmin(c);
    return c.json({ backups: listBackups(), intervalHours: config.backupIntervalHours, keep: config.backupKeep, dir: config.backupDir });
  });

  api.post('/backups', (c) => {
    requireAdmin(c);
    return c.json({ backup: createBackup('manual') }, 201);
  });

  api.get('/backups/:name', (c) => {
    requireAdmin(c);
    const file = backupFile(c.req.param('name'));
    c.header('content-type', 'application/gzip');
    c.header('content-disposition', `attachment; filename="${c.req.param('name')}"`);
    return c.body(new Uint8Array(fs.readFileSync(file)) as unknown as string);
  });

  api.delete('/backups/:name', (c) => {
    requireAdmin(c);
    deleteBackup(c.req.param('name'));
    return c.json({ ok: true });
  });

  // ---------- full account export ----------

  api.get('/export', (c) => {
    const a = requireSession(c);
    const projects = listProjects(a, { includeArchived: true }).map((p) => exportJSON(getDoc(a, p.id)));
    c.header('content-disposition', `attachment; filename="taproot-export-${todayISO()}.json"`);
    return c.json({ format: 'taproot-account', version: 1, exportedAt: new Date().toISOString(), projects });
  });

  return api;
}
