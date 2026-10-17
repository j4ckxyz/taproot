import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, setDb } from '../server/db.js';
import { createToken, createUser, actorFromToken, type Actor } from '../server/auth.js';
import { applyOps, createProject, getDoc, importDoc, listProjects } from '../server/store.js';
import { exportJSON, exportMarkdown, exportMermaid, exportOPML, exportExcalidraw, importMarkdown, importOPML } from '../server/export/formats.js';
import { parse as parseMermaid, render as renderMermaid } from 'pele';
import { updateUser, getUser } from '../server/auth.js';
import { allDeadlines, deadlineFor, ownDeadline } from '../shared/deadline.js';
import { buildTree } from '../shared/tree.js';
import { computeLayout } from '../shared/layout.js';
import type { TaskNode } from '../shared/types.js';

let me: Actor;

beforeEach(() => {
  setDb(openDb(':memory:'));
  me = { user: createUser({ email: `u${Math.random()}@x.co`, name: 'U', password: 'password123' }), token: null };
});

function project(settings = {}) {
  const doc = createProject(me, { name: 'P', icon: '🌊', color: 'blue', description: '', settings });
  return { id: doc.project.id, root: doc.project.rootId };
}

describe('ops', () => {
  it('creates nested nodes in one batch using client ids', () => {
    const p = project();
    const r = applyOps(me, p.id, [
      { op: 'create', node: { id: 'aaaaaaaa', parentId: p.root, title: 'A' } },
      { op: 'create', node: { parentId: 'aaaaaaaa', title: 'A1', dueDate: '2030-01-01' } },
    ]);
    expect(r.created).toHaveLength(2);
    expect(getDoc(me, p.id).nodes).toHaveLength(3);
  });

  it('enforces depth and branch limits', () => {
    const p = project({ maxDepth: 2, maxChildren: 2 });
    applyOps(me, p.id, [
      { op: 'create', node: { id: 'aaaaaaaa', parentId: p.root, title: 'A' } },
      { op: 'create', node: { id: 'bbbbbbbb', parentId: 'aaaaaaaa', title: 'B' } },
    ]);
    expect(() => applyOps(me, p.id, [{ op: 'create', node: { parentId: 'bbbbbbbb', title: 'too deep' } }])).toThrow(/levels deep/);
    applyOps(me, p.id, [{ op: 'create', node: { parentId: p.root, title: 'A2' } }]);
    expect(() => applyOps(me, p.id, [{ op: 'create', node: { parentId: p.root, title: 'A3' } }])).toThrow(/at most 2/);
  });

  it('is atomic: a failing op rolls back the whole batch', () => {
    const p = project();
    expect(() =>
      applyOps(me, p.id, [
        { op: 'create', node: { parentId: p.root, title: 'ok' } },
        { op: 'delete', id: p.root },
      ]),
    ).toThrow();
    expect(getDoc(me, p.id).nodes).toHaveLength(1);
  });

  it('rejects moving a node inside itself and deletes sub-trees', () => {
    const p = project();
    applyOps(me, p.id, [
      { op: 'create', node: { id: 'aaaaaaaa', parentId: p.root, title: 'A' } },
      { op: 'create', node: { id: 'bbbbbbbb', parentId: 'aaaaaaaa', title: 'B' } },
    ]);
    expect(() => applyOps(me, p.id, [{ op: 'update', id: 'aaaaaaaa', patch: { parentId: 'bbbbbbbb' } }])).toThrow(/inside itself/);
    const r = applyOps(me, p.id, [{ op: 'delete', id: 'aaaaaaaa' }]);
    expect(r.deleted.sort()).toEqual(['aaaaaaaa', 'bbbbbbbb']);
  });

  it('records doneAt when checking off', () => {
    const p = project();
    applyOps(me, p.id, [{ op: 'create', node: { id: 'aaaaaaaa', parentId: p.root, title: 'A' } }]);
    const r = applyOps(me, p.id, [{ op: 'update', id: 'aaaaaaaa', patch: { done: true } }]);
    expect(r.upserted[0].doneAt).toBeTruthy();
    expect(listProjects(me)[0]).toMatchObject({ done: 1, total: 1 });
  });
});

describe('tokens', () => {
  it('read-only tokens cannot write; scoped tokens see only their projects', () => {
    const a = project();
    project();
    const ro = actorFromToken(createToken(me.user.id, { name: 'r', canWrite: false, projectIds: [a.id], expiresAt: null }).secret)!;
    expect(listProjects(ro)).toHaveLength(1);
    expect(() => applyOps(ro, a.id, [{ op: 'create', node: { parentId: a.root, title: 'x' } }])).toThrow(/read-only/);
    const rw = actorFromToken(createToken(me.user.id, { name: 'w', canWrite: true, projectIds: null, expiresAt: null }).secret)!;
    expect(listProjects(rw)).toHaveLength(2);
    expect(applyOps(rw, a.id, [{ op: 'create', node: { parentId: a.root, title: 'x' } }]).upserted).toHaveLength(1);
  });

  it('expired tokens are rejected', () => {
    const { secret } = createToken(me.user.id, { name: 'e', canWrite: true, projectIds: null, expiresAt: '2000-01-01T00:00:00.000Z' });
    expect(actorFromToken(secret)).toBeNull();
  });

  it('other users cannot see your projects', () => {
    const p = project();
    const other: Actor = { user: createUser({ email: 'o@x.co', name: 'O', password: 'password123' }), token: null };
    expect(listProjects(other)).toHaveLength(0);
    expect(() => getDoc(other, p.id)).toThrow(/not found/);
  });
});

describe('deadlines', () => {
  const node = (over: Partial<TaskNode>): TaskNode => ({
    id: Math.random().toString(36), projectId: 'p', parentId: 'r', sort: 1, title: 'T', notes: '', shape: 'rounded', color: null,
    childLayout: 'column', collapsed: false, done: false, doneAt: null, startDate: null, dueDate: null, tags: [], meta: {},
    createdAt: '', updatedAt: '', ...over,
  });

  it('classifies levels', () => {
    expect(ownDeadline(node({ dueDate: '2026-10-16' }), '2026-10-17', 3).level).toBe('overdue');
    expect(ownDeadline(node({ dueDate: '2026-10-17' }), '2026-10-17', 3).level).toBe('today');
    expect(ownDeadline(node({ dueDate: '2026-10-19' }), '2026-10-17', 3).level).toBe('soon');
    expect(ownDeadline(node({ dueDate: '2026-11-19' }), '2026-10-17', 3).level).toBe('upcoming');
    expect(ownDeadline(node({ dueDate: '2026-10-01', done: true }), '2026-10-17', 3).level).toBe('none');
  });

  it('explains pressure from sub-tasks', () => {
    const root = node({ id: 'root', parentId: null });
    const kid = node({ id: 'kid', parentId: 'root', title: 'Ship', dueDate: '2026-10-18' });
    const info = deadlineFor(buildTree([root, kid]), root, '2026-10-17', 3);
    expect(info.level).toBe('soon');
    expect(info.fromChild?.id).toBe('kid');
    expect(info.explanation).toMatch(/Ship/);
  });

  it('single-pass allDeadlines matches deadlineFor on every node', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const nodes = [node({ id: 'root', parentId: null })];
    for (let i = 0; i < 300; i++) {
      const p = nodes[Math.floor(rnd() * nodes.length)];
      nodes.push(node({ id: `n${i}`, parentId: p.id, title: `T${i}`, done: rnd() < 0.3, dueDate: rnd() < 0.4 ? `2026-10-${String(10 + Math.floor(rnd() * 15)).padStart(2, '0')}` : null }));
    }
    const tree = buildTree(nodes);
    const all = allDeadlines(tree, '2026-10-17', 3);
    for (const n of nodes) expect(all.get(n.id)).toEqual(deadlineFor(tree, n, '2026-10-17', 3));
  });
});

describe('layout', () => {
  it('lays row children side by side and column children stacked', () => {
    const mk = (id: string, parentId: string | null, childLayout: 'row' | 'column' = 'row', sort = 1) =>
      ({ id, parentId, sort, title: id, notes: '', shape: 'rounded', color: null, childLayout, collapsed: false, done: false, tags: [], meta: {}, dueDate: null, createdAt: '' }) as unknown as TaskNode;
    const tree = buildTree([mk('r', null), mk('a', 'r', 'column', 1), mk('b', 'r', 'row', 2), mk('a1', 'a', 'row', 1), mk('a2', 'a', 'row', 2)]);
    const l = computeLayout(tree);
    const [a, b, a1, a2] = ['a', 'b', 'a1', 'a2'].map((id) => l.boxes.get(id)!);
    expect(a.y).toBe(b.y);
    expect(b.x).toBeGreaterThan(a.x);
    expect(a2.y).toBeGreaterThan(a1.y);
    expect(a1.x).toBeGreaterThan(a.x);
    expect(l.edges).toHaveLength(4);
  });
});

describe('import / export', () => {
  it('round-trips through JSON, Markdown and OPML', () => {
    const p = project();
    applyOps(me, p.id, [
      { op: 'create', node: { id: 'aaaaaaaa', parentId: p.root, title: 'Design', tags: ['ui'] } },
      { op: 'create', node: { parentId: 'aaaaaaaa', title: 'Wireframes', done: true, dueDate: '2026-11-01', notes: 'rough first' } },
    ]);
    const doc = getDoc(me, p.id);

    const fromJson = importDoc(me, exportJSON(doc) as never);
    expect(fromJson.nodes).toHaveLength(3);

    const md = exportMarkdown(doc);
    expect(md).toContain('- [x] Wireframes  (due:2026-11-01)');
    const parsedMd = importMarkdown(md);
    expect(parsedMd.nodes.find((n) => n.title === 'Wireframes')).toMatchObject({ done: true, dueDate: '2026-11-01', notes: 'rough first' });
    expect(parsedMd.nodes.find((n) => n.title === 'Design')?.tags).toEqual(['ui']);

    const parsedOpml = importOPML(exportOPML(doc));
    expect(parsedOpml.nodes).toHaveLength(3);
    expect(parsedOpml.nodes.find((n) => n.title === 'Wireframes')).toMatchObject({ done: true, notes: 'rough first' });

    const ex = exportExcalidraw(doc);
    expect(ex.type).toBe('excalidraw');
    expect(ex.elements.filter((e) => e.type === 'arrow')).toHaveLength(2);
  });
});

describe('mermaid export', () => {
  it('produces a flowchart Pele can parse and render, with tricky titles escaped', () => {
    const p = project();
    applyOps(me, p.id, [
      { op: 'create', node: { id: 'aaaaaaaa', parentId: p.root, title: 'Say "hi" <b>#1</b> --> end', shape: 'ellipse', tags: ['x'] } },
      { op: 'create', node: { parentId: 'aaaaaaaa', title: 'Ship it', shape: 'diamond', done: true, dueDate: '2026-11-01' } },
      { op: 'create', node: { parentId: p.root, title: 'plain', shape: 'text', color: 'green' } },
    ]);
    const src = exportMermaid(getDoc(me, p.id));
    expect(src).toContain('flowchart TD');
    expect(src).toContain('#quot;hi#quot;');
    expect(src).toMatch(/n1\(\[/); // pill -> stadium
    expect(src).toMatch(/n2\{\{/); // milestone -> hexagon
    expect(() => parseMermaid(src)).not.toThrow();
    const out = renderMermaid(src);
    expect(out.svg).toContain('<svg');
    expect(out.svg).toContain('Ship it');
  });
});

describe('preferences', () => {
  it('merges partial updates per user', () => {
    updateUser(me.user.id, { prefs: { accent: 'teal', background: 'grid' } });
    updateUser(me.user.id, { prefs: { background: 'plain' } });
    expect(getUser(me.user.id)?.prefs).toEqual({ accent: 'teal', background: 'plain' });
  });
});
