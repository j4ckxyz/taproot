import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { actorFromToken, authenticate, type AppEnv } from './auth.js';
import { config } from './config.js';
import { handleMcp } from './mcp/server.js';
import { docsPage, llmsTxt, openApiSpec } from './openapi.js';
import { apiRoutes } from './routes/api.js';
import { VERSION } from './version.js';
import { HttpError } from './util.js';

export function baseUrl(c: Context): string {
  if (config.publicUrl) return config.publicUrl;
  const u = new URL(c.req.url);
  const proto = c.req.header('x-forwarded-proto') ?? u.protocol.replace(':', '');
  const host = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? u.host;
  return `${proto}://${host}`;
}

export function createApp(opts: { webDir?: string } = {}) {
  const app = new Hono<AppEnv>();

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status);
    }
    console.error(err);
    return c.json({ error: { code: 'internal', message: 'Something went wrong on the server' } }, 500);
  });

  app.get('/healthz', (c) => c.json({ ok: true, version: VERSION }));

  const agentCors = cors({
    origin: '*',
    allowHeaders: ['authorization', 'content-type', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id'],
    exposeHeaders: ['mcp-session-id'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.use('/api/v1/*', agentCors, authenticate);
  app.route('/api/v1', apiRoutes());

  app.get('/api/openapi.json', (c) => c.json(openApiSpec(baseUrl(c))));
  app.get('/api/docs', (c) => c.html(docsPage(config.appName)));
  app.get('/llms.txt', (c) => c.text(llmsTxt(baseUrl(c))));

  // ---------- MCP ----------

  const mcp = async (c: Context<AppEnv>, secret: string | undefined) => {
    const actor = secret ? actorFromToken(secret) : null;
    if (!actor) {
      return c.json(
        { jsonrpc: '2.0', error: { code: -32001, message: 'Missing or invalid API token. Create one in Settings → API tokens.' }, id: null },
        401,
        { 'WWW-Authenticate': 'Bearer realm="taproot"' },
      );
    }
    return handleMcp(actor, c.req.raw);
  };
  app.use('/mcp', agentCors);
  app.use('/mcp/*', agentCors);
  app.all('/mcp', (c) => {
    const h = c.req.header('authorization');
    return mcp(c, h?.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : undefined);
  });
  app.all('/mcp/t/:token', async (c) => {
    if (!config.allowTokenInUrl) return c.json({ error: { code: 'disabled', message: 'Token-in-URL is disabled on this server' } }, 403);
    return mcp(c, c.req.param('token'));
  });

  // ---------- web app ----------

  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDir = opts.webDir ?? [path.join(here, '../web'), path.join(here, '../dist/web')].find((p) => fs.existsSync(path.join(p, 'index.html')));
  if (webDir) {
    const rel = path.relative(process.cwd(), webDir) || '.';
    app.use('/assets/*', serveStatic({ root: rel, onFound: (_p, c) => c.header('cache-control', 'public, max-age=31536000, immutable') }));
    app.use('*', serveStatic({ root: rel }));
    const index = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
    app.get('*', (c) => c.html(index));
  } else {
    app.get('/', (c) => c.text(`${config.appName} API is running. Build the web app with "npm run build", or run "npm run dev".`));
  }

  return app;
}
