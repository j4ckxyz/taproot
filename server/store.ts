import type { z } from 'zod';
import {
  DEFAULT_SETTINGS,
  type ActivityEntry,
  type ChangeEvent,
  type ColorName,
  type NodePatch,
  type Op,
  type Project,
  type ProjectDoc,
  type ProjectSettings,
  type ProjectSummary,
  type TaskNode,
} from '../shared/types.js';
import { buildTree, checkPlacement, descendants, isAncestor, sortBetween, subtreeHeight } from '../shared/tree.js';
import { actorName, type Actor } from './auth.js';
import { bus } from './bus.js';
import { agentActivity, presenceKey } from './presence.js';
import { formatDate } from '../shared/deadline.js';
import { db, tx } from './db.js';
import type { ProjectCreateSchema, ProjectPatchSchema } from './schemas.js';
import { badRequest, forbidden, HttpError, newId, notFound, now } from './util.js';

export { bus };

// ---------- rows ----------

interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  settings: string;
  archived: number;
  root_id: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface NodeRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  sort: number;
  title: string;
  notes: string;
  shape: string;
  color: string | null;
  child_layout: string;
  collapsed: number;
  done: number;
  done_at: string | null;
  start_date: string | null;
  due_date: string | null;
  tags: string;
  meta: string;
  created_at: string;
  updated_at: string;
}

const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  ownerId: r.owner_id,
  name: r.name,
  icon: r.icon,
  color: r.color as ColorName,
  description: r.description,
  settings: { ...DEFAULT_SETTINGS, ...(JSON.parse(r.settings) as Partial<ProjectSettings>) },
  archived: !!r.archived,
  rootId: r.root_id,
  version: r.version,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toNode = (r: NodeRow): TaskNode => ({
  id: r.id,
  projectId: r.project_id,
  parentId: r.parent_id,
  sort: r.sort,
  title: r.title,
  notes: r.notes,
  shape: r.shape as TaskNode['shape'],
  color: r.color as ColorName | null,
  childLayout: r.child_layout as TaskNode['childLayout'],
  collapsed: !!r.collapsed,
  done: !!r.done,
  doneAt: r.done_at,
  startDate: r.start_date,
  dueDate: r.due_date,
  tags: JSON.parse(r.tags),
  meta: JSON.parse(r.meta),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

function writeNode(n: TaskNode) {
  db()
    .prepare(
      `INSERT INTO nodes (id, project_id, parent_id, sort, title, notes, shape, color, child_layout, collapsed, done, done_at,
         start_date, due_date, tags, meta, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET parent_id = excluded.parent_id, sort = excluded.sort, title = excluded.title,
         notes = excluded.notes, shape = excluded.shape, color = excluded.color, child_layout = excluded.child_layout,
         collapsed = excluded.collapsed, done = excluded.done, done_at = excluded.done_at, start_date = excluded.start_date,
         due_date = excluded.due_date, tags = excluded.tags, meta = excluded.meta, updated_at = excluded.updated_at`,
    )
    .run(
      n.id,
      n.projectId,
      n.parentId,
      n.sort,
      n.title,
      n.notes,
      n.shape,
      n.color,
      n.childLayout,
      n.collapsed ? 1 : 0,
      n.done ? 1 : 0,
      n.doneAt,
      n.startDate,
      n.dueDate,
      JSON.stringify(n.tags),
      JSON.stringify(n.meta),
      n.createdAt,
      n.updatedAt,
    );
}

export function blankNode(projectId: string, parentId: string | null, init: Partial<TaskNode> = {}): TaskNode {
  const t = now();
  return {
    id: newId(),
    projectId,
    parentId,
    sort: 1,
    title: '',
    notes: '',
    shape: 'rounded',
    color: null,
    childLayout: parentId === null ? 'row' : 'column',
    collapsed: false,
    done: false,
    doneAt: null,
    startDate: null,
    dueDate: null,
    tags: [],
    meta: {},
    createdAt: t,
    updatedAt: t,
    ...init,
  };
}

// ---------- access ----------

function canSee(actor: Actor, p: ProjectRow): boolean {
  if (p.owner_id !== actor.user.id) return false;
  if (actor.token?.projectIds && !actor.token.projectIds.includes(p.id)) return false;
  return true;
}

export function assertWrite(actor: Actor) {
  if (actor.token && !actor.token.canWrite) {
    throw forbidden('This API token is read-only. Enable write access for it in Settings → API tokens.');
  }
}

function projectRow(actor: Actor, id: string): ProjectRow {
  const r = db().prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
  if (!r || !canSee(actor, r)) throw notFound('Project not found');
  return r;
}

// ---------- projects ----------

export function listProjects(actor: Actor, opts: { includeArchived?: boolean } = {}): ProjectSummary[] {
  const rows = db()
    .prepare('SELECT * FROM projects WHERE owner_id = ? ORDER BY archived, updated_at DESC')
    .all(actor.user.id) as unknown as ProjectRow[];
  const stats = db().prepare(
    `SELECT COUNT(*) - 1 AS total, SUM(done) AS done,
       MIN(CASE WHEN done = 0 THEN due_date END) AS next_due
     FROM nodes WHERE project_id = ?`,
  );
  return rows
    .filter((r) => canSee(actor, r) && (opts.includeArchived || !r.archived))
    .map((r) => {
      const s = stats.get(r.id) as { total: number; done: number | null; next_due: string | null };
      const p = toProject(r);
      // The root node is excluded from counts.
      const rootDone = (db().prepare('SELECT done FROM nodes WHERE id = ?').get(r.root_id) as { done: number } | undefined)?.done ?? 0;
      return { ...p, total: Math.max(0, s.total), done: (s.done ?? 0) - rootDone, nextDue: s.next_due };
    });
}

export function getProject(actor: Actor, id: string): Project {
  return toProject(projectRow(actor, id));
}

export function getDoc(actor: Actor, id: string): ProjectDoc {
  const project = getProject(actor, id);
  const nodes = (db().prepare('SELECT * FROM nodes WHERE project_id = ?').all(id) as unknown as NodeRow[]).map(toNode);
  return { project, nodes };
}

export function createProject(actor: Actor, input: z.infer<typeof ProjectCreateSchema>, rootTitle?: string): ProjectDoc {
  assertWrite(actor);
  if (actor.token?.projectIds) throw forbidden('This token is limited to specific projects and cannot create new ones');
  const id = newId();
  const t = now();
  const root = blankNode(id, null, { title: rootTitle ?? input.name, color: null, shape: 'rounded' });
  const settings = { ...DEFAULT_SETTINGS, ...input.settings };
  tx(db(), () => {
    db()
      .prepare(
        `INSERT INTO projects (id, owner_id, name, icon, color, description, settings, root_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, actor.user.id, input.name.trim(), input.icon, input.color, input.description, JSON.stringify(settings), root.id, t, t);
    writeNode(root);
    logActivity(actor, id, `created project “${input.name}”`);
  });
  return getDoc(actor, id);
}

export function updateProject(actor: Actor, id: string, patch: z.infer<typeof ProjectPatchSchema>, clientId?: string): Project {
  assertWrite(actor);
  const r = projectRow(actor, id);
  const cur = toProject(r);
  const next = {
    name: patch.name?.trim() ?? cur.name,
    icon: patch.icon ?? cur.icon,
    color: patch.color ?? cur.color,
    description: patch.description ?? cur.description,
    settings: { ...cur.settings, ...patch.settings },
    archived: patch.archived ?? cur.archived,
  };
  const version = cur.version + 1;
  db()
    .prepare(
      'UPDATE projects SET name = ?, icon = ?, color = ?, description = ?, settings = ?, archived = ?, version = ?, updated_at = ? WHERE id = ?',
    )
    .run(next.name, next.icon, next.color, next.description, JSON.stringify(next.settings), next.archived ? 1 : 0, version, now(), id);
  const project = getProject(actor, id);
  emit(actor, project, [], [], clientId ?? null, true);
  return project;
}

export function deleteProject(actor: Actor, id: string) {
  assertWrite(actor);
  if (actor.token) throw forbidden('Projects can only be deleted from the app');
  projectRow(actor, id);
  db().prepare('DELETE FROM projects WHERE id = ?').run(id);
}

// ---------- node operations ----------

export interface ApplyResult {
  version: number;
  upserted: TaskNode[];
  deleted: string[];
  /** Maps the index of each create op to the id it was given. */
  created: string[];
}

export function applyOps(actor: Actor, projectId: string, ops: Op[], clientId: string | null = null): ApplyResult {
  assertWrite(actor);
  return tx(db(), () => {
    const prow = projectRow(actor, projectId);
    const project = toProject(prow);
    const nodes = (db().prepare('SELECT * FROM nodes WHERE project_id = ?').all(projectId) as unknown as NodeRow[]).map(toNode);
    const map = new Map(nodes.map((n) => [n.id, n]));
    const dirty = new Set<string>();
    const deleted = new Set<string>();
    const created: string[] = [];
    const t = now();
    const summary: string[] = [];
    /** The card this batch is mostly about (the first one it touched). */
    let focusId: string | null = null;
    const touched = (id: string) => (focusId ??= id);
    const treeNow = () => buildTree(map.values());

    for (const [i, op] of ops.entries()) {
      const where = `ops[${i}]`;
      if (op.op === 'create') {
        const tree = treeNow();
        const parentId = op.node.parentId;
        if (!map.has(parentId)) throw badRequest(`${where}: parent ${parentId} not found in this project`);
        const err = checkPlacement(tree, project.settings, parentId);
        if (err) throw new HttpError(422, `${where}: ${err}`, 'limit_reached');
        if (op.node.id && (map.has(op.node.id) || deleted.has(op.node.id))) {
          throw new HttpError(409, `${where}: id ${op.node.id} already exists`, 'id_taken');
        }
        if (op.node.id && db().prepare('SELECT 1 FROM nodes WHERE id = ?').get(op.node.id)) {
          throw new HttpError(409, `${where}: id ${op.node.id} already exists`, 'id_taken');
        }
        const siblings = tree.children.get(parentId) ?? [];
        const { id, ...init } = op.node;
        const n = blankNode(projectId, parentId, {
          ...stripUndefined(init),
          ...(id ? { id } : {}),
          sort: init.sort ?? sortBetween(siblings[siblings.length - 1]?.sort, undefined),
          projectId,
          parentId,
          createdAt: t,
          updatedAt: t,
        });
        if (n.done) n.doneAt = t;
        map.set(n.id, n);
        dirty.add(n.id);
        created.push(n.id);
        touched(n.id);
        const parent = map.get(parentId);
        summary.push(`added “${n.title || 'Untitled'}”${parent && parent.parentId !== null ? ` under “${parent.title || 'Untitled'}”` : ''}`);
      } else if (op.op === 'update') {
        const n = map.get(op.id);
        if (!n) throw notFound(`${where}: node ${op.id} not found`);
        const patch = stripUndefined(op.patch);
        if (patch.parentId === null && n.parentId !== null) throw badRequest(`${where}: a project has exactly one root`);
        if (n.parentId === null && patch.parentId === null) delete patch.parentId;
        const newParent = patch.parentId;
        if (newParent && newParent !== n.parentId) {
          if (n.parentId === null) throw badRequest(`${where}: the root node cannot be moved`);
          const tree = treeNow();
          if (newParent === n.id || isAncestor(tree, n.id, newParent)) {
            throw badRequest(`${where}: a node cannot be moved inside itself`);
          }
          const err = checkPlacement(tree, project.settings, newParent, subtreeHeight(tree, n.id), n.id);
          if (err) throw new HttpError(422, `${where}: ${err}`, 'limit_reached');
          if (patch.sort === undefined) {
            const sib = tree.children.get(newParent) ?? [];
            patch.sort = sortBetween(sib[sib.length - 1]?.sort, undefined);
          }
        }
        const said = describeUpdate(n, patch, map);
        if (said.length) touched(n.id);
        summary.push(...said);
        const next: TaskNode = { ...n, ...patch, updatedAt: t } as TaskNode;
        if (patch.done !== undefined && patch.done !== n.done) next.doneAt = patch.done ? t : null;
        map.set(n.id, next);
        dirty.add(n.id);
      } else {
        const n = map.get(op.id);
        if (!n) {
          if (deleted.has(op.id)) continue;
          throw notFound(`${where}: node ${op.id} not found`);
        }
        if (n.parentId === null) throw badRequest(`${where}: the root node cannot be deleted`);
        const tree = treeNow();
        const gone = [n, ...descendants(tree, n.id)];
        for (const g of gone) {
          map.delete(g.id);
          dirty.delete(g.id);
          deleted.add(g.id);
        }
        touched(n.parentId);
        summary.push(`removed “${n.title || 'Untitled'}”${gone.length > 1 ? ` and ${gone.length - 1} below it` : ''}`);
      }
    }

    // Created-then-deleted nodes never reach the database.
    const persistedDeletes = [...deleted].filter((id) => nodes.some((n) => n.id === id));
    const del = db().prepare('DELETE FROM nodes WHERE id = ?');
    for (const id of persistedDeletes) del.run(id);
    const upserted = [...dirty].map((id) => map.get(id)!);
    for (const n of upserted) writeNode(n);
    const version = prow.version + 1;
    db().prepare('UPDATE projects SET version = ?, updated_at = ? WHERE id = ?').run(version, t, projectId);
    const text = summary.length ? summarize(summary) : undefined;
    if (text) logActivity(actor, projectId, text, focusId);
    const project2 = { ...project, version, updatedAt: t };
    emit(actor, project2, upserted, persistedDeletes, clientId, false, text, focusId);
    agentActivity(actor, projectId, focusId, 'editing');
    return { version, upserted, deleted: persistedDeletes, created };
  });
}

const SHAPE_NAMES: Record<string, string> = { rounded: 'a card', rect: 'a square card', ellipse: 'a pill', diamond: 'a milestone', text: 'plain text' };

/** Says what an update changed, in words, one phrase per meaningful field. */
function describeUpdate(n: TaskNode, patch: NodePatch, map: Map<string, TaskNode>): string[] {
  const name = `“${n.title || 'Untitled'}”`;
  const out: string[] = [];
  if (patch.title !== undefined && patch.title !== n.title) out.push(n.title ? `renamed ${name} to “${patch.title || 'Untitled'}”` : `named a card “${patch.title}”`);
  const label = patch.title ? `“${patch.title}”` : name;
  if (patch.done !== undefined && patch.done !== n.done) out.push(`${patch.done ? 'checked off' : 'reopened'} ${label}`);
  if (patch.parentId && patch.parentId !== n.parentId) out.push(`moved ${label} under “${map.get(patch.parentId)?.title || 'Untitled'}”`);
  if (patch.dueDate !== undefined && patch.dueDate !== n.dueDate) {
    out.push(patch.dueDate ? `set ${label} due ${formatDate(patch.dueDate)}` : `cleared the due date on ${label}`);
  }
  if (patch.startDate !== undefined && patch.startDate !== n.startDate) {
    out.push(patch.startDate ? `set ${label} to start ${formatDate(patch.startDate)}` : `cleared the start date on ${label}`);
  }
  if (patch.color !== undefined && patch.color !== n.color) out.push(patch.color ? `coloured ${label} ${patch.color}` : `reset the colour of ${label}`);
  if (patch.shape !== undefined && patch.shape !== n.shape) out.push(`made ${label} ${SHAPE_NAMES[patch.shape] ?? patch.shape}`);
  if (patch.notes !== undefined && patch.notes !== n.notes) out.push(patch.notes ? `edited the notes on ${label}` : `cleared the notes on ${label}`);
  if (patch.tags !== undefined && patch.tags.join() !== n.tags.join()) {
    const added = patch.tags.filter((t) => !n.tags.includes(t));
    out.push(added.length ? `tagged ${label} ${added.map((t) => '#' + t).join(' ')}` : `changed the tags on ${label}`);
  }
  if (patch.meta !== undefined && JSON.stringify(patch.meta) !== JSON.stringify(n.meta)) out.push(`updated the details on ${label}`);
  if (patch.childLayout !== undefined && patch.childLayout !== n.childLayout) {
    out.push(patch.childLayout === 'row' ? `spread out the sub-tasks of ${label}` : `listed the sub-tasks of ${label}`);
  }
  if (out.length === 0 && patch.sort !== undefined && !patch.parentId) out.push(`reordered ${label}`);
  return out;
}

function summarize(items: string[]): string {
  if (items.length <= 3) return items.join('; ');
  return `${items.slice(0, 2).join('; ')}; and ${items.length - 2} more changes`;
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function emit(
  actor: Actor,
  project: Project,
  upserted: TaskNode[],
  deleted: string[],
  clientId: string | null,
  withProject: boolean,
  summary?: string,
  focusId?: string | null,
) {
  const ev: ChangeEvent = {
    projectId: project.id,
    version: project.version,
    clientId,
    actor: { kind: actor.token ? 'token' : 'user', name: actor.token ? actor.token.name : actorName(actor), key: presenceKey(actor, clientId) },
    upserted,
    deleted,
    ...(withProject ? { project } : {}),
    ...(summary ? { summary } : {}),
    focusId: focusId ?? null,
  };
  queueMicrotask(() => bus.emit(`project:${project.id}`, ev));
}

// ---------- import ----------

/** Creates a new project from an exported document, giving every node a fresh id. */
export function importDoc(actor: Actor, doc: { project: Partial<Project>; nodes: Partial<TaskNode>[] }): ProjectDoc {
  assertWrite(actor);
  const root = doc.nodes.find((n) => !n.parentId);
  if (!root) throw badRequest('Import has no root node');
  const created = createProject(
    actor,
    {
      name: doc.project.name || root.title || 'Imported project',
      icon: doc.project.icon || '📥',
      color: (doc.project.color as ColorName) || 'blue',
      description: doc.project.description || '',
      settings: { ...DEFAULT_SETTINGS, ...(doc.project.settings ?? {}) },
    },
    root.title,
  );
  const pid = created.project.id;
  const rootId = created.project.rootId;
  const idMap = new Map<string, string>([[root.id!, rootId]]);
  const byParent = new Map<string, Partial<TaskNode>[]>();
  for (const n of doc.nodes) {
    if (!n.parentId) continue;
    const l = byParent.get(n.parentId) ?? [];
    l.push(n);
    byParent.set(n.parentId, l);
  }
  // Imports skip the project limits so that nothing is lost; the limits apply to later edits.
  const t = now();
  tx(db(), () => {
    const rootNode = { ...created.nodes[0], ...pickNodeFields(root), id: rootId, parentId: null, projectId: pid };
    writeNode(rootNode as TaskNode);
    const walk = (oldId: string) => {
      for (const [i, c] of (byParent.get(oldId) ?? []).entries()) {
        const n = blankNode(pid, idMap.get(oldId)!, { ...pickNodeFields(c), sort: c.sort ?? i + 1, createdAt: c.createdAt ?? t });
        idMap.set(c.id!, n.id);
        writeNode(n);
        walk(c.id!);
      }
    };
    walk(root.id!);
  });
  return getDoc(actor, pid);
}

function pickNodeFields(n: Partial<TaskNode>): Partial<TaskNode> {
  const out: Partial<TaskNode> = {};
  const keys = ['title', 'notes', 'shape', 'color', 'childLayout', 'collapsed', 'done', 'doneAt', 'startDate', 'dueDate', 'tags', 'meta'] as const;
  for (const k of keys) if (n[k] !== undefined) (out as Record<string, unknown>)[k] = n[k];
  if (out.done && !out.doneAt) out.doneAt = now();
  return out;
}

// ---------- queries ----------

export function searchNodes(
  actor: Actor,
  q: { query?: string; projectId?: string; status?: 'open' | 'done' | 'all'; dueBefore?: string; tag?: string; limit?: number },
): (TaskNode & { projectName: string })[] {
  const projects = q.projectId ? [getProject(actor, q.projectId)] : listProjects(actor, { includeArchived: false });
  const names = new Map(projects.map((p) => [p.id, p.name]));
  if (!projects.length) return [];
  const where: string[] = [`project_id IN (${projects.map(() => '?').join(',')})`];
  const args: (string | number)[] = projects.map((p) => p.id);
  if (q.query) {
    where.push('(title LIKE ? OR notes LIKE ? OR tags LIKE ? OR meta LIKE ?)');
    const like = `%${q.query.replace(/[%_]/g, (m) => '\\' + m)}%`;
    args.push(like, like, like, like);
  }
  if (q.status === 'open') where.push('done = 0');
  if (q.status === 'done') where.push('done = 1');
  if (q.dueBefore) {
    where.push('due_date IS NOT NULL AND due_date <= ?');
    args.push(q.dueBefore);
  }
  const rows = db()
    .prepare(`SELECT * FROM nodes WHERE ${where.join(' AND ')} ORDER BY due_date IS NULL, due_date, updated_at DESC LIMIT ?`)
    .all(...args, Math.min(q.limit ?? 50, 500)) as unknown as NodeRow[];
  return rows
    .map(toNode)
    .filter((n) => !q.tag || n.tags.some((t) => t.toLowerCase() === q.tag!.toLowerCase()))
    .map((n) => ({ ...n, projectName: names.get(n.projectId) ?? '' }));
}

export function listActivity(actor: Actor, projectId: string, limit = 50): ActivityEntry[] {
  projectRow(actor, projectId);
  return db()
    .prepare(
      'SELECT id, actor_name AS actor, token_id AS tokenId, summary, at, node_id AS nodeId FROM activity WHERE project_id = ? ORDER BY id DESC LIMIT ?',
    )
    .all(projectId, limit) as unknown as ActivityEntry[];
}

function logActivity(actor: Actor, projectId: string, summary: string, nodeId: string | null = null) {
  db()
    .prepare('INSERT INTO activity (project_id, user_id, token_id, actor_name, summary, at, node_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(projectId, actor.user.id, actor.token?.id ?? null, actorName(actor), summary, now(), nodeId);
  // Keep the log light: the newest 1000 entries per project.
  db()
    .prepare('DELETE FROM activity WHERE project_id = ? AND id <= (SELECT id FROM activity WHERE project_id = ? ORDER BY id DESC LIMIT 1 OFFSET 1000)')
    .run(projectId, projectId);
}
