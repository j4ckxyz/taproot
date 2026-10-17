import type { NodePatch, Op, TaskNode } from '@shared/types';
import { buildTree, descendants, sortBetween } from '@shared/tree';

export function newId(): string {
  const a = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const b = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(b, (x) => a[x % 62]).join('');
}

const NODE_FIELDS = [
  'parentId', 'sort', 'title', 'notes', 'shape', 'color', 'childLayout', 'collapsed', 'done',
  'startDate', 'dueDate', 'tags', 'meta',
] as const;

function nodeToCreate(n: TaskNode): Op {
  const node: Record<string, unknown> = { id: n.id };
  for (const k of NODE_FIELDS) node[k] = n[k];
  return { op: 'create', node: node as Op extends { node: infer N } ? N : never };
}

/**
 * Applies ops to a local copy of the nodes (optimistically, before the server confirms)
 * and returns the ops that would undo them.
 */
export function applyLocal(
  nodes: Map<string, TaskNode>,
  ops: Op[],
  projectId: string,
): { nodes: Map<string, TaskNode>; inverse: Op[] } {
  const next = new Map(nodes);
  const inverse: Op[] = [];
  const t = new Date().toISOString();
  for (const op of ops) {
    if (op.op === 'create') {
      const id = op.node.id ?? newId();
      op.node.id = id;
      const siblings = [...next.values()].filter((n) => n.parentId === op.node.parentId).sort((a, b) => a.sort - b.sort);
      const n: TaskNode = {
        projectId,
        sort: sortBetween(siblings[siblings.length - 1]?.sort, undefined),
        title: '',
        notes: '',
        shape: 'rounded',
        color: null,
        childLayout: 'column',
        collapsed: false,
        done: false,
        doneAt: null,
        startDate: null,
        dueDate: null,
        tags: [],
        meta: {},
        createdAt: t,
        updatedAt: t,
        ...(op.node as Partial<TaskNode>),
        id,
        parentId: op.node.parentId,
      };
      next.set(id, n);
      inverse.unshift({ op: 'delete', id });
    } else if (op.op === 'update') {
      const cur = next.get(op.id);
      if (!cur) continue;
      const before: NodePatch = {};
      for (const k of Object.keys(op.patch) as (keyof NodePatch)[]) (before as Record<string, unknown>)[k] = cur[k];
      const upd: TaskNode = { ...cur, ...op.patch, updatedAt: t } as TaskNode;
      if (op.patch.done !== undefined && op.patch.done !== cur.done) upd.doneAt = op.patch.done ? t : null;
      next.set(op.id, upd);
      inverse.unshift({ op: 'update', id: op.id, patch: before });
    } else {
      const cur = next.get(op.id);
      if (!cur) continue;
      const tree = buildTree(next.values());
      const gone = [cur, ...descendants(tree, cur.id)];
      // Recreate parents before children when undoing.
      const order = new Map(gone.map((g, i) => [g.id, i]));
      const depth = (n: TaskNode): number => (n.id === cur.id ? 0 : 1 + depth(next.get(n.parentId!)!));
      const sorted = [...gone].sort((a, b) => depth(a) - depth(b) || order.get(a.id)! - order.get(b.id)!);
      for (const g of gone) next.delete(g.id);
      inverse.unshift(...sorted.map(nodeToCreate));
    }
  }
  return { nodes: next, inverse };
}

/** Ops that copy a sub-tree (with fresh ids) under a parent. */
export function cloneSubtree(nodes: Map<string, TaskNode>, rootId: string, parentId: string, sort?: number): Op[] {
  const tree = buildTree(nodes.values());
  const root = nodes.get(rootId);
  if (!root) return [];
  const ops: Op[] = [];
  const walk = (n: TaskNode, newParent: string, s?: number) => {
    const id = newId();
    const node: Record<string, unknown> = { id };
    for (const k of NODE_FIELDS) node[k] = n[k];
    node.parentId = newParent;
    if (s !== undefined) node.sort = s;
    else delete node.sort;
    ops.push({ op: 'create', node: node as never });
    for (const c of tree.children.get(n.id) ?? []) walk(c, id);
  };
  walk(root, parentId, sort);
  return ops;
}

export interface Clip {
  kind: 'taproot-subtree' | 'cascade-subtree';
  nodes: TaskNode[];
  rootId: string;
}

export function makeClip(nodes: Map<string, TaskNode>, id: string): Clip {
  const tree = buildTree(nodes.values());
  return { kind: 'taproot-subtree', rootId: id, nodes: [nodes.get(id)!, ...descendants(tree, id)] };
}

export function pasteOps(clip: Clip, parentId: string): Op[] {
  const map = new Map(clip.nodes.map((n) => [n.id, n]));
  return cloneSubtree(map, clip.rootId, parentId);
}
