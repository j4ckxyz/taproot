import type { ProjectSettings, TaskNode } from './types.js';

export interface Tree {
  byId: Map<string, TaskNode>;
  children: Map<string, TaskNode[]>;
  root: TaskNode | undefined;
}

export function buildTree(nodes: Iterable<TaskNode>): Tree {
  const byId = new Map<string, TaskNode>();
  const children = new Map<string, TaskNode[]>();
  let root: TaskNode | undefined;
  for (const n of nodes) {
    byId.set(n.id, n);
    if (n.parentId === null) root = n;
  }
  for (const n of byId.values()) {
    if (n.parentId === null) continue;
    const list = children.get(n.parentId);
    if (list) list.push(n);
    else children.set(n.parentId, [n]);
  }
  for (const list of children.values()) list.sort((a, b) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt));
  return { byId, children, root };
}

export function depthOf(tree: Tree, id: string): number {
  let d = 0;
  let cur = tree.byId.get(id);
  while (cur && cur.parentId !== null) {
    d++;
    cur = tree.byId.get(cur.parentId);
    if (d > 1000) break;
  }
  return d;
}

export function descendants(tree: Tree, id: string): TaskNode[] {
  const out: TaskNode[] = [];
  const stack = [...(tree.children.get(id) ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    out.push(n);
    stack.push(...(tree.children.get(n.id) ?? []));
  }
  return out;
}

/** Height of the subtree below a node (0 for a leaf). */
export function subtreeHeight(tree: Tree, id: string): number {
  const kids = tree.children.get(id) ?? [];
  let h = 0;
  for (const k of kids) h = Math.max(h, 1 + subtreeHeight(tree, k.id));
  return h;
}

export function isAncestor(tree: Tree, ancestorId: string, id: string): boolean {
  let cur = tree.byId.get(id);
  while (cur && cur.parentId !== null) {
    if (cur.parentId === ancestorId) return true;
    cur = tree.byId.get(cur.parentId);
  }
  return false;
}

export function progress(tree: Tree, id: string): { done: number; total: number } {
  const all = descendants(tree, id);
  return { done: all.filter((n) => n.done).length, total: all.length };
}

/** Sort key that places a node between two neighbours. */
export function sortBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 1;
  if (before === undefined) return after! - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}

/** Returns an error message if placing a subtree of `subtreeDepth` under `parentId` breaks the project limits. */
export function checkPlacement(
  tree: Tree,
  settings: ProjectSettings,
  parentId: string,
  subtreeDepth = 0,
  movingId?: string,
): string | null {
  if (!tree.byId.has(parentId)) return 'Parent not found';
  const depth = depthOf(tree, parentId) + 1;
  if (depth + subtreeDepth > settings.maxDepth) {
    return `Branches can go ${settings.maxDepth} levels deep in this project`;
  }
  const siblings = (tree.children.get(parentId) ?? []).filter((n) => n.id !== movingId);
  if (siblings.length >= settings.maxChildren) {
    return `A node can have at most ${settings.maxChildren} branches in this project`;
  }
  return null;
}

/** Plain-text outline, used by the MCP server and Markdown export. */
export function toMarkdown(tree: Tree, opts: { includeDone?: boolean; heading?: string } = {}): string {
  const lines: string[] = [];
  if (opts.heading) lines.push(`# ${opts.heading}`, '');
  const walk = (n: TaskNode, depth: number) => {
    if (!opts.includeDone && n.done && depth > 0) return;
    const bits: string[] = [];
    if (n.dueDate) bits.push(`due:${n.dueDate}`);
    if (n.startDate) bits.push(`start:${n.startDate}`);
    for (const t of n.tags) bits.push(`#${t.replace(/\s+/g, '-')}`);
    for (const [k, v] of Object.entries(n.meta)) bits.push(`${k}:${v}`);
    const suffix = bits.length ? `  (${bits.join(', ')})` : '';
    const title = n.title.replace(/\n/g, ' ') || 'Untitled';
    if (depth === 0) {
      lines.push(`**${title}**${suffix}`);
    } else {
      lines.push(`${'  '.repeat(depth - 1)}- [${n.done ? 'x' : ' '}] ${title}${suffix}`);
    }
    if (n.notes.trim()) {
      const pad = depth === 0 ? '' : '  '.repeat(depth);
      for (const l of n.notes.trim().split('\n')) lines.push(`${pad}> ${l}`);
    }
    for (const c of tree.children.get(n.id) ?? []) walk(c, depth + 1);
  };
  if (tree.root) walk(tree.root, 0);
  return lines.join('\n') + '\n';
}
