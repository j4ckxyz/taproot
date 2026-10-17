import type { Presence } from '../shared/types.js';
import type { Actor } from './auth.js';
import { actorName } from './auth.js';
import { bus } from './bus.js';

// Who is looking at which project right now. In memory only: presence is ephemeral and
// rebuilds itself within seconds of a restart (tabs heartbeat, agents show up when they act).

const TAB_TTL = 45_000;
const AGENT_TTL = 25_000;
const projects = new Map<string, Map<string, Presence>>();

function publish(projectId: string) {
  bus.emit(`presence:${projectId}`, list(projectId));
}

export function list(projectId: string): Presence[] {
  return [...(projects.get(projectId)?.values() ?? [])];
}

export function touch(projectId: string, p: Omit<Presence, 'at'>) {
  let m = projects.get(projectId);
  if (!m) projects.set(projectId, (m = new Map()));
  const prev = m.get(p.key);
  m.set(p.key, { ...p, at: Date.now() });
  // Heartbeats that change nothing don't need to be broadcast.
  if (!prev || prev.nodeId !== p.nodeId || prev.doing !== p.doing || prev.name !== p.name) publish(projectId);
}

export function leave(projectId: string, key: string) {
  if (projects.get(projectId)?.delete(key)) publish(projectId);
}

/** Records an agent (API token) acting on a project, so people can watch it work. */
export function agentActivity(actor: Actor, projectId: string, nodeId: string | null, doing: string) {
  if (!actor.token) return;
  touch(projectId, {
    key: `token:${actor.token.id}`,
    clientId: null,
    userId: actor.user.id,
    name: actor.token.name,
    kind: 'agent',
    nodeId,
    doing,
  });
}

export function presenceKey(actor: Actor, clientId: string | null): string {
  return actor.token ? `token:${actor.token.id}` : `tab:${clientId ?? actor.user.id}`;
}

export function userPresence(actor: Actor, projectId: string, clientId: string, nodeId: string | null) {
  touch(projectId, {
    key: presenceKey(actor, clientId),
    clientId,
    userId: actor.user.id,
    name: actor.token ? actor.token.name : actorName(actor),
    kind: actor.token ? 'agent' : 'user',
    nodeId,
    doing: null,
  });
}

setInterval(() => {
  const t = Date.now();
  for (const [pid, m] of projects) {
    let changed = false;
    for (const [k, p] of m) {
      if (t - p.at > (p.kind === 'agent' ? AGENT_TTL : TAB_TTL)) {
        m.delete(k);
        changed = true;
      }
    }
    if (!m.size) projects.delete(pid);
    if (changed) publish(pid);
  }
}, 5_000).unref();
