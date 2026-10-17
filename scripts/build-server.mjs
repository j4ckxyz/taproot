import { build } from 'esbuild';
import fs from 'node:fs';

await build({
  entryPoints: ['server/index.ts', 'server/cli.ts'],
  outdir: 'dist/server',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  packages: 'external',
  logLevel: 'info',
});

fs.cpSync('server/assets', 'dist/server/assets', { recursive: true });
