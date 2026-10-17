import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The running version, and (unless turned off) a once-a-day look at the latest GitHub release
// so admins can see when an update is out. Only the public releases API is contacted.

export const REPO = process.env.UPDATE_REPO ?? 'j4ckxyz/taproot';

function readVersion(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    const p = path.join(dir, 'package.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')).version ?? '0.0.0';
    dir = path.dirname(dir);
  }
  return '0.0.0';
}

export const VERSION = readVersion();

const enabled = !/^(0|false|no|off)$/i.test(process.env.UPDATE_CHECK ?? '');
let latest: { version: string; url: string; notes: string; checkedAt: number } | null = null;

function newer(a: string, b: string): boolean {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

async function check() {
  if (!enabled) return;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': `taproot/${VERSION}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return;
    const j = (await r.json()) as { tag_name: string; html_url: string; body?: string };
    latest = { version: j.tag_name.replace(/^v/, ''), url: j.html_url, notes: (j.body ?? '').slice(0, 2000), checkedAt: Date.now() };
  } catch {
    /* offline or rate-limited: try again later */
  }
}

export function startUpdateCheck() {
  if (!enabled) return;
  setTimeout(check, 10_000).unref();
  setInterval(check, 24 * 3600_000).unref();
}

export function versionInfo() {
  return {
    version: VERSION,
    updateCheck: enabled,
    latest: latest?.version ?? null,
    updateAvailable: !!latest && newer(latest.version, VERSION),
    releaseUrl: latest?.url ?? `https://github.com/${REPO}/releases`,
    releaseNotes: latest && newer(latest.version, VERSION) ? latest.notes : null,
  };
}
