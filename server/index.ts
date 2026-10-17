import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { startBackupSchedule } from './backup.js';
import { startUpdateCheck } from './version.js';
import { config } from './config.js';
import { db } from './db.js';

db();
const app = createApp();
startBackupSchedule();
startUpdateCheck();

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`${config.appName} listening on http://${info.address === '0.0.0.0' ? 'localhost' : info.address}:${info.port}`);
  console.log(`  data: ${config.dataDir}`);
  console.log(`  MCP:  /mcp   API docs: /api/docs`);
});

const shutdown = () => {
  server.close();
  db().close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
