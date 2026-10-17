import type { ColorName, Op, Shape, TaskNode } from '@shared/types';
import { buildTree, descendants, sortBetween } from '@shared/tree';
import { todayISO } from '@shared/deadline';
import type { Layout } from '@shared/layout';
import { useProject, type DetailField } from './projectStore';
import { makeClip, newId, pasteOps, type Clip } from './ops';

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

const st = () => useProject.getState();

function tree() {
  return buildTree(st().nodes.values());
}

export function addChild(parentId: string, init: Partial<TaskNode> = {}) {
  const s = st();
  const err = s.canAddChild(parentId);
  if (err) return s.toast(err, 'error');
  const parent = s.nodes.get(parentId);
  const id = newId();
  const ops: Op[] = [];
  if (parent?.collapsed) ops.push({ op: 'update', id: parentId, patch: { collapsed: false } });
  ops.push({ op: 'create', node: { title: '', ...init, id, parentId } });
  if (s.apply(ops, { select: id })) useProject.setState({ editingId: id, freshId: id, draft: null });
}

export function addSibling(id: string, before = false) {
  const s = st();
  const n = s.nodes.get(id);
  if (!n) return;
  if (n.parentId === null) return addChild(id);
  const err = s.canAddChild(n.parentId);
  if (err) return s.toast(err, 'error');
  const sibs = tree().children.get(n.parentId) ?? [];
  const i = sibs.findIndex((x) => x.id === id);
  const sort = before ? sortBetween(sibs[i - 1]?.sort, n.sort) : sortBetween(n.sort, sibs[i + 1]?.sort);
  const nid = newId();
  if (s.apply([{ op: 'create', node: { id: nid, parentId: n.parentId, title: '', sort, shape: n.shape } }], { select: nid })) {
    useProject.setState({ editingId: nid, freshId: nid, draft: null });
  }
}

export function removeNode(id: string) {
  const s = st();
  const n = s.nodes.get(id);
  if (!n) return;
  if (n.parentId === null) return s.toast('The central idea can’t be deleted. Rename it instead.', 'error');
  const sibs = tree().children.get(n.parentId) ?? [];
  const i = sibs.findIndex((x) => x.id === id);
  const nextSel = sibs[i + 1]?.id ?? sibs[i - 1]?.id ?? n.parentId;
  const below = descendants(tree(), id).length;
  if (s.apply([{ op: 'delete', id }], { select: nextSel }) && below > 0) {
    s.toast(`Deleted “${n.title || 'Untitled'}” and ${below} sub-task${below === 1 ? '' : 's'}. ${MOD}+Z to undo.`);
  }
}

export function toggleDone(id: string) {
  const n = st().nodes.get(id);
  if (!n) return;
  st().apply([{ op: 'update', id, patch: { done: !n.done } }]);
}

export function patchNode(id: string, patch: Partial<TaskNode>) {
  st().apply([{ op: 'update', id, patch }]);
}

export function setShape(id: string, shape: Shape) {
  const n = st().nodes.get(id);
  if (!n) return;
  // Pressing R on a rectangle flips between rounded and sharp corners.
  if (shape === 'rounded' && n.shape === 'rounded') shape = 'rect';
  patchNode(id, { shape });
}

export function setColor(id: string, color: ColorName | null) {
  patchNode(id, { color });
}

export function toggleLayout(id: string) {
  const n = st().nodes.get(id);
  if (n) patchNode(id, { childLayout: n.childLayout === 'row' ? 'column' : 'row' });
}

export function toggleCollapse(id: string) {
  const n = st().nodes.get(id);
  if (!n || !(tree().children.get(id)?.length)) return;
  patchNode(id, { collapsed: !n.collapsed });
}

export function moveAmongSiblings(id: string, dir: -1 | 1) {
  const n = st().nodes.get(id);
  if (!n?.parentId) return;
  const sibs = tree().children.get(n.parentId) ?? [];
  const i = sibs.findIndex((x) => x.id === id);
  const j = i + dir;
  if (j < 0 || j >= sibs.length) return;
  const sort = dir < 0 ? sortBetween(sibs[j - 1]?.sort, sibs[j].sort) : sortBetween(sibs[j].sort, sibs[j + 1]?.sort);
  patchNode(id, { sort });
}

/** Moves a node one level up (becomes a sibling of its parent) or into its previous sibling. */
export function indent(id: string, dir: 'in' | 'out') {
  const s = st();
  const n = s.nodes.get(id);
  if (!n?.parentId) return;
  const t = tree();
  if (dir === 'out') {
    const parent = s.nodes.get(n.parentId);
    if (!parent?.parentId) return;
    const sibs = t.children.get(parent.parentId) ?? [];
    const i = sibs.findIndex((x) => x.id === parent.id);
    s.apply([{ op: 'update', id, patch: { parentId: parent.parentId, sort: sortBetween(parent.sort, sibs[i + 1]?.sort) } }]);
  } else {
    const sibs = t.children.get(n.parentId) ?? [];
    const i = sibs.findIndex((x) => x.id === id);
    const prev = sibs[i - 1];
    if (!prev) return;
    moveNode(id, prev.id);
  }
}

export function moveNode(id: string, newParentId: string, sort?: number) {
  const s = st();
  const t = tree();
  const n = s.nodes.get(id);
  if (!n || !s.project) return;
  if (newParentId === n.parentId && sort === undefined) return;
  // Check limits locally to give instant feedback.
  const height = (nid: string): number => Math.max(0, ...(t.children.get(nid) ?? []).map((c) => 1 + height(c.id)));
  let d = 0;
  for (let cur = s.nodes.get(newParentId); cur?.parentId; cur = s.nodes.get(cur.parentId)) d++;
  if (d + 1 + height(id) > s.project.settings.maxDepth) {
    return s.toast(`Branches can go ${s.project.settings.maxDepth} levels deep in this project`, 'error');
  }
  if (newParentId !== n.parentId && (t.children.get(newParentId)?.length ?? 0) >= s.project.settings.maxChildren) {
    return s.toast(`A node can have at most ${s.project.settings.maxChildren} branches in this project`, 'error');
  }
  const ops: Op[] = [];
  const parent = s.nodes.get(newParentId);
  if (parent?.collapsed) ops.push({ op: 'update', id: newParentId, patch: { collapsed: false } });
  ops.push({ op: 'update', id, patch: { parentId: newParentId, ...(sort !== undefined ? { sort } : {}) } });
  s.apply(ops);
}

let clipboard: Clip | null = null;

export async function copy(id: string) {
  clipboard = makeClip(st().nodes, id);
  try {
    await navigator.clipboard.writeText(JSON.stringify(clipboard));
  } catch {
    /* in-app clipboard still works */
  }
}

export async function cut(id: string) {
  await copy(id);
  removeNode(id);
}

export async function paste(parentId: string) {
  let clip = clipboard;
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch {
    /* no clipboard permission: fall back to the in-app clipboard */
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* plain text */
  }
  if (['taproot-subtree', 'cascade-subtree'].includes((parsed as Clip | null)?.kind ?? '')) clip = parsed as Clip;
  else if (text.trim()) {
    // Plain text: each line becomes a new branch.
    const lines = text.split('\n').map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])?\s*(?:\[[ xX]\]\s*)?/, '').trim()).filter(Boolean).slice(0, 30);
    const ops: Op[] = lines.map((title) => ({ op: 'create', node: { id: newId(), parentId, title } }));
    if (ops.length) return pasteChecked(parentId, ops);
  }
  if (!clip) return;
  pasteChecked(parentId, pasteOps(clip, parentId));
}

function pasteChecked(parentId: string, ops: Op[]) {
  const s = st();
  const roots = ops.filter((o) => o.op === 'create' && o.node.parentId === parentId).length;
  const have = tree().children.get(parentId)?.length ?? 0;
  if (s.project && have + roots > s.project.settings.maxChildren) {
    return s.toast(`A node can have at most ${s.project.settings.maxChildren} branches in this project`, 'error');
  }
  const first = ops[0]?.op === 'create' ? ops[0].node.id! : null;
  s.apply(ops, { select: first });
}

export function duplicate(id: string) {
  const s = st();
  const n = s.nodes.get(id);
  if (!n?.parentId) return;
  const err = s.canAddChild(n.parentId);
  if (err) return s.toast(err, 'error');
  const sibs = tree().children.get(n.parentId) ?? [];
  const i = sibs.findIndex((x) => x.id === id);
  const clip = makeClip(s.nodes, id);
  const ops = pasteOps(clip, n.parentId);
  if (ops[0]?.op === 'create') ops[0].node.sort = sortBetween(n.sort, sibs[i + 1]?.sort);
  s.apply(ops, { select: ops[0]?.op === 'create' ? ops[0].node.id! : id });
}

/** Spatial arrow-key navigation using the drawn layout. */
export function navigate(layout: Layout, from: string | null, dir: 'up' | 'down' | 'left' | 'right'): string | null {
  const s = st();
  const rootId = s.project?.rootId ?? null;
  if (!from || !layout.boxes.has(from)) return rootId;
  const a = layout.boxes.get(from)!;
  const n = s.nodes.get(from);
  // Up always prefers the parent in column layouts' first child, keeping the tree feel.
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  let best: string | null = null;
  let bestScore = Infinity;
  for (const b of layout.boxes.values()) {
    if (b.id === from) continue;
    const bx = b.x + b.w / 2;
    const by = b.y + b.h / 2;
    const dx = bx - ax;
    const dy = by - ay;
    let primary: number, secondary: number;
    if (dir === 'down') [primary, secondary] = [dy, Math.abs(dx)];
    else if (dir === 'up') [primary, secondary] = [-dy, Math.abs(dx)];
    else if (dir === 'right') [primary, secondary] = [dx, Math.abs(dy)];
    else [primary, secondary] = [-dx, Math.abs(dy)];
    if (primary <= 4) continue;
    const score = primary + secondary * 2.2;
    if (score < bestScore) {
      bestScore = score;
      best = b.id;
    }
  }
  if (!best && dir === 'up' && n?.parentId) return n.parentId;
  return best ?? from;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Sets the due date to today plus `days`, or clears it. */
export function setDue(id: string, days: number | null) {
  patchNode(id, { dueDate: days === null ? null : addDays(todayISO(), days) });
}

/** Collapses every branch (leaving the central idea's children visible), or expands them all again. */
export function toggleCollapseAll() {
  const s = st();
  const t = tree();
  const parents = [...s.nodes.values()].filter((n) => n.parentId && (t.children.get(n.id)?.length ?? 0) > 0);
  if (!parents.length) return;
  const collapse = parents.some((n) => !n.collapsed);
  const ops: Op[] = parents.filter((n) => n.collapsed !== collapse).map((n) => ({ op: 'update', id: n.id, patch: { collapsed: collapse } }));
  // Keep the selection on something that stays visible.
  let sel = s.selectedId;
  if (collapse && sel) {
    for (let cur = s.nodes.get(sel); cur?.parentId; cur = s.nodes.get(cur.parentId)) {
      if (s.nodes.get(cur.parentId)?.parentId === null) {
        sel = cur.id;
        break;
      }
    }
  }
  s.apply(ops, { select: sel });
}

/** Opens the details panel's field for the selected card. */
export function focusDetail(field: DetailField) {
  useProject.setState({ focusField: { field, n: Date.now() } });
}
