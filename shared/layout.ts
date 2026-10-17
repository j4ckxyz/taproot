// Deterministic "waterfall" layout. The root sits at the top; each node lays its
// children out either spread in a row beneath it or stacked in a column down its
// right-hand side. Sizes are estimated from character counts so the server can
// render images that match the browser exactly.

import type { Shape, TaskNode } from './types.js';
import type { Tree } from './tree.js';

export interface NodeBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  lines: string[];
  fontSize: number;
  lineHeight: number;
  /** Top offset of the first text baseline box inside the node. */
  textTop: number;
  /** Horizontal offset of the text centre from the box centre (milestones make room for their marker). */
  textDx: number;
  hasMeta: boolean;
  hiddenChildren: number;
}

export interface Edge {
  from: string;
  to: string;
  kind: 'row' | 'column';
  /** SVG path data. */
  d: string;
}

export interface Layout {
  boxes: Map<string, NodeBox>;
  edges: Edge[];
  width: number;
  height: number;
}

export const LAYOUT = {
  rowGapX: 32,
  rowGapY: 60,
  colIndent: 40,
  colGapY: 14,
  colTop: 22,
  padX: 16,
  padY: 11,
  metaH: 20,
  margin: 80,
};

const FONT = {
  // Inter: average advance ~0.53em, rounded up so text never overflows.
  root: { size: 20, line: 26, charW: 11.0, maxChars: 24, minW: 180 },
  node: { size: 14.5, line: 20, charW: 7.7, maxChars: 28, minW: 88 },
};

export function wrapText(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (const para of (text || 'Untitled').split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push('');
      continue;
    }
    let line = '';
    for (let w of words) {
      while (w.length > maxChars) {
        if (line) {
          out.push(line);
          line = '';
        }
        out.push(w.slice(0, maxChars - 1) + '-');
        w = w.slice(maxChars - 1);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= maxChars) line += ' ' + w;
      else {
        out.push(line);
        line = w;
      }
    }
    if (line) out.push(line);
  }
  return out.slice(0, 8);
}

/** Extra width a shape needs: pills for their round ends, milestones for their diamond marker. */
export const MILESTONE_MARKER = 22;
function shapeExtra(shape: Shape): { w: number; dx: number } {
  switch (shape) {
    case 'ellipse':
      return { w: 14, dx: 0 };
    case 'diamond':
      return { w: MILESTONE_MARKER, dx: MILESTONE_MARKER / 2 };
    case 'text':
      return { w: 0, dx: 0 };
    default:
      // Room for the accent bar on the left.
      return { w: 8, dx: 4 };
  }
}

export function metaWidth(node: TaskNode, progressTotal: number): number {
  let chars = 0;
  if (node.dueDate) chars += 11;
  if (progressTotal > 0) chars += 6;
  for (const t of node.tags.slice(0, 2)) chars += Math.min(t.length, 12) + 3;
  if (node.notes.trim()) chars += 8;
  return chars * 6.6 + 12;
}

// Node objects are replaced (not mutated) when they change, so measurements can be cached per object.
const measured = new WeakMap<TaskNode, { depth: number; progressTotal: number; m: ReturnType<typeof measureUncached> }>();

function measure(node: TaskNode, depth: number, progressTotal: number) {
  const hit = measured.get(node);
  if (hit && hit.depth === depth && hit.progressTotal === progressTotal) return hit.m;
  const m = measureUncached(node, depth, progressTotal);
  measured.set(node, { depth, progressTotal, m });
  return m;
}

function measureUncached(node: TaskNode, depth: number, progressTotal: number) {
  const f = depth === 0 ? FONT.root : FONT.node;
  const lines = wrapText(node.title, f.maxChars);
  const longest = Math.max(...lines.map((l) => l.length), 1);
  const hasMeta = !!(node.dueDate || progressTotal > 0 || node.tags.length || node.notes.trim());
  const innerW = Math.max(longest * f.charW, hasMeta ? metaWidth(node, progressTotal) : 0);
  const innerH = lines.length * f.line + (hasMeta ? LAYOUT.metaH : 0);
  // The root is a solid block with no marker or accent bar.
  const extra = depth === 0 ? { w: 0, dx: 0 } : shapeExtra(node.shape);
  const w = Math.ceil(Math.max(f.minW, innerW + LAYOUT.padX * 2 + extra.w));
  const h = Math.ceil(innerH + LAYOUT.padY * 2);
  return {
    w,
    h,
    lines,
    fontSize: f.size,
    lineHeight: f.line,
    textTop: (h - innerH) / 2,
    textDx: extra.dx,
    hasMeta,
  };
}

interface Sub {
  node: TaskNode;
  w: number;
  h: number;
  /** x of node's left edge relative to subtree's left edge. */
  nodeX: number;
  m: ReturnType<typeof measure>;
  kids: { sub: Sub; dx: number; dy: number }[];
  depth: number;
  hidden: number;
}

export function computeLayout(tree: Tree, opts: { progressTotals?: Map<string, number> } = {}): Layout {
  const boxes = new Map<string, NodeBox>();
  const edges: Edge[] = [];
  if (!tree.root) return { boxes, edges, width: 0, height: 0 };

  const totals = opts.progressTotals ?? countDescendants(tree);

  const build = (node: TaskNode, depth: number): Sub => {
    const m = measure(node, depth, totals.get(node.id) ?? 0);
    const children = tree.children.get(node.id) ?? [];
    if (node.collapsed || children.length === 0) {
      return { node, w: m.w, h: m.h, nodeX: 0, m, kids: [], depth, hidden: node.collapsed ? (totals.get(node.id) ?? 0) : 0 };
    }
    const subs = children.map((c) => build(c, depth + 1));
    if (node.childLayout === 'column') {
      let y = m.h + LAYOUT.colTop;
      let maxW = m.w;
      const kids = subs.map((s) => {
        const k = { sub: s, dx: LAYOUT.colIndent, dy: y };
        y += s.h + LAYOUT.colGapY;
        maxW = Math.max(maxW, LAYOUT.colIndent + s.w);
        return k;
      });
      return { node, w: maxW, h: y - LAYOUT.colGapY, nodeX: 0, m, kids, depth, hidden: 0 };
    }
    const rowW = subs.reduce((a, s) => a + s.w, 0) + LAYOUT.rowGapX * (subs.length - 1);
    const w = Math.max(m.w, rowW);
    // Centre the parent over the span between its first and last child's own boxes,
    // so connectors look balanced even when sub-trees are lopsided.
    let x = (w - rowW) / 2;
    const top = m.h + LAYOUT.rowGapY;
    let maxH = 0;
    const kids = subs.map((s) => {
      const k = { sub: s, dx: x, dy: top };
      x += s.w + LAYOUT.rowGapX;
      maxH = Math.max(maxH, s.h);
      return k;
    });
    const first = kids[0];
    const last = kids[kids.length - 1];
    const firstC = first.dx + first.sub.nodeX + first.sub.m.w / 2;
    const lastC = last.dx + last.sub.nodeX + last.sub.m.w / 2;
    let nodeX = (firstC + lastC) / 2 - m.w / 2;
    nodeX = Math.max(0, Math.min(w - m.w, nodeX));
    return { node, w, h: top + maxH, nodeX, m, kids, depth, hidden: 0 };
  };

  const place = (s: Sub, ox: number, oy: number) => {
    const x = ox + s.nodeX;
    const y = oy;
    boxes.set(s.node.id, {
      id: s.node.id,
      x,
      y,
      w: s.m.w,
      h: s.m.h,
      depth: s.depth,
      lines: s.m.lines,
      fontSize: s.m.fontSize,
      lineHeight: s.m.lineHeight,
      textTop: s.m.textTop,
      textDx: s.m.textDx,
      hasMeta: s.m.hasMeta,
      hiddenChildren: s.hidden,
    });
    for (const k of s.kids) {
      place(k.sub, ox + k.dx, oy + k.dy);
      const child = boxes.get(k.sub.node.id)!;
      const kind = s.node.childLayout === 'column' ? 'column' : 'row';
      edges.push({ from: s.node.id, to: child.id, kind, d: edgePath(kind, { x, y, w: s.m.w, h: s.m.h }, child) });
    }
  };

  const rootSub = build(tree.root, 0);
  place(rootSub, LAYOUT.margin, LAYOUT.margin);
  return {
    boxes,
    edges,
    width: rootSub.w + LAYOUT.margin * 2,
    height: rootSub.h + LAYOUT.margin * 2,
  };
}

type Rect = { x: number; y: number; w: number; h: number };

/** Connector from a parent to a child. Also used to redraw edges while cards animate. */
export function edgePath(kind: 'row' | 'column', p: Rect, c: Rect): string {
  const f = (n: number) => Math.round(n * 10) / 10;
  if (kind === 'column') {
    const sx = f(p.x + LAYOUT.colIndent / 2);
    const sy = f(p.y + p.h);
    const ey = f(c.y + c.h / 2);
    const r = Math.max(0, Math.min(12, (ey - sy) / 2));
    return `M ${sx} ${sy} L ${sx} ${f(ey - r)} Q ${sx} ${ey} ${f(sx + r)} ${ey} L ${f(c.x)} ${ey}`;
  }
  const sx = f(p.x + p.w / 2);
  const sy = f(p.y + p.h);
  const ex = f(c.x + c.w / 2);
  const ey = f(c.y);
  const my = f((sy + ey) / 2);
  return `M ${sx} ${sy} C ${sx} ${my}, ${ex} ${my}, ${ex} ${ey}`;
}

export function countDescendants(tree: Tree): Map<string, number> {
  const out = new Map<string, number>();
  const visit = (id: string): number => {
    let n = 0;
    for (const c of tree.children.get(id) ?? []) n += 1 + visit(c.id);
    out.set(id, n);
    return n;
  };
  if (tree.root) visit(tree.root.id);
  return out;
}
