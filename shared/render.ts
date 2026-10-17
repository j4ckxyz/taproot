// Drawing primitives shared by the browser canvas and the server-side SVG/PNG
// renderer, so agents "see" exactly what people see.

import { PALETTE, type ColorName, type ProjectDoc, type TaskNode } from './types.js';
import { buildTree, type Tree } from './tree.js';
import { computeLayout, countDescendants, LAYOUT, MILESTONE_MARKER, type Edge, type NodeBox } from './layout.js';
import { allDeadlines, isHighlighted, todayISO, type DeadlineInfo, type DeadlineLevel } from './deadline.js';

export type Theme = 'light' | 'dark';

export interface PathSpec {
  d: string;
  stroke: string;
  strokeWidth: number;
  fill?: string;
}

export const FONT_FAMILY = "Inter, 'Inter Variable', ui-sans-serif, system-ui, sans-serif";

export const THEME = {
  light: {
    paper: '#f6f7f9',
    panel: '#ffffff',
    card: '#ffffff',
    border: '#e2e3e8',
    ink: '#18181b',
    muted: '#71717a',
    edge: '#c3c8d0',
    shadow: '#0f172a',
    done: '#22c55e',
    soon: '#f59e0b',
    today: '#f97316',
    overdue: '#ef4444',
  },
  dark: {
    paper: '#111214',
    panel: '#1a1b1e',
    card: '#1c1d21',
    border: '#2e3036',
    ink: '#ececef',
    muted: '#a1a1aa',
    edge: '#3a3e45',
    shadow: '#000000',
    done: '#4ade80',
    soon: '#fbbf24',
    today: '#fb923c',
    overdue: '#f87171',
  },
} as const;

export function nodeColors(color: ColorName, theme: Theme) {
  const p = PALETTE[color];
  return theme === 'light' ? { stroke: p.stroke, fill: p.fill, solid: p.solid } : { stroke: p.darkStroke, fill: p.dark, solid: p.solid };
}

/**
 * The deadline level a node is drawn with. Pressure from sub-tasks only shows on the
 * node itself when it is collapsed (otherwise the sub-task is visible and highlighted).
 */
export function visibleLevel(node: TaskNode, dl: DeadlineInfo): DeadlineLevel {
  if (dl.fromChild && !node.collapsed) return 'none';
  return dl.level;
}

export function levelColor(level: DeadlineLevel, theme: Theme): string {
  const t = THEME[theme];
  return level === 'overdue' ? t.overdue : level === 'today' ? t.today : t.soon;
}

/** Branch colours flow down the tree: a node without its own colour uses its parent's (the root is excluded). */
export function resolveColors(tree: Tree, projectColor: ColorName): Map<string, ColorName> {
  const out = new Map<string, ColorName>();
  const walk = (n: TaskNode, inherited: ColorName) => {
    const c = n.color ?? inherited;
    out.set(n.id, c);
    for (const k of tree.children.get(n.id) ?? []) walk(k, n.parentId === null ? 'slate' : c);
  };
  if (tree.root) walk(tree.root, projectColor);
  return out;
}

export function seedFor(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (Math.abs(h) % 2_000_000) + 1;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function roundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  r = Math.min(r, w / 2, h / 2);
  const [L, T, R, B] = [x, y, x + w, y + h].map(r1);
  return `M ${r1(L + r)} ${T} H ${r1(R - r)} A ${r} ${r} 0 0 1 ${R} ${r1(T + r)} V ${r1(B - r)} A ${r} ${r} 0 0 1 ${r1(R - r)} ${B} H ${r1(L + r)} A ${r} ${r} 0 0 1 ${L} ${r1(B - r)} V ${r1(T + r)} A ${r} ${r} 0 0 1 ${r1(L + r)} ${T} Z`;
}

function shapePath(shape: TaskNode['shape'], x: number, y: number, w: number, h: number, depth: number): string {
  switch (shape) {
    case 'rect':
      return roundedRectPath(x, y, w, h, 3);
    case 'ellipse':
      // A pill: fully rounded ends.
      return roundedRectPath(x, y, w, h, h / 2);
    default:
      // Cards (and milestones, which add a marker) share the rounded rectangle.
      return roundedRectPath(x, y, w, h, depth === 0 ? 12 : 9);
  }
}

export interface NodeDrawing {
  /** Deadline halo behind the node. */
  highlight: PathSpec[];
  shape: PathSpec[];
  check: PathSpec[];
  /** Text colour for the title. */
  ink: string;
}

export function drawNode(
  node: TaskNode,
  box: Pick<NodeBox, 'w' | 'h' | 'depth'>,
  color: ColorName,
  theme: Theme,
  level: DeadlineLevel,
): NodeDrawing {
  const t = THEME[theme];
  const { stroke, fill, solid } = nodeColors(color, theme);
  const isRoot = box.depth === 0;
  const flagged = !node.done && isHighlighted(level);
  const highlight: PathSpec[] = [];
  if (flagged) {
    // A soft halo in the deadline colour.
    const hc = levelColor(level, theme);
    const pad = 6;
    const shape = node.shape === 'text' ? 'rounded' : node.shape;
    highlight.push({
      d: shapePath(shape, -pad, -pad, box.w + pad * 2, box.h + pad * 2, box.depth + 1),
      stroke: 'none',
      strokeWidth: 0,
      fill: hc + (theme === 'light' ? '2e' : '38'),
    });
  }
  const shape: PathSpec[] = [];
  if (node.shape !== 'text') {
    // Two offset layers make a cheap, filter-free drop shadow.
    const sa = theme === 'light' ? ['0d', '08'] : ['40', '30'];
    shape.push({ d: shapePath(node.shape, 0, 3, box.w, box.h, box.depth), stroke: 'none', strokeWidth: 0, fill: t.shadow + sa[1] });
    shape.push({ d: shapePath(node.shape, 0, 1, box.w, box.h, box.depth), stroke: 'none', strokeWidth: 0, fill: t.shadow + sa[0] });
    const pill = node.shape === 'ellipse';
    // Cards are neutral with a colour marker; pills carry the branch colour as a tint.
    const border = flagged ? levelColor(level, theme) : pill ? stroke + (theme === 'light' ? '73' : '80') : t.border;
    shape.push({
      d: shapePath(node.shape, 0, 0, box.w, box.h, box.depth),
      stroke: isRoot ? solid : border,
      strokeWidth: flagged && !isRoot ? 1.5 : 1,
      fill: isRoot ? solid : pill ? (theme === 'light' ? mix(fill, t.panel) : fill) : t.card,
    });
    if (!isRoot && node.shape === 'diamond') {
      const cx = LAYOUT.padX + MILESTONE_MARKER / 2 - 4;
      const cy = box.h / 2;
      const k = 5.5;
      shape.push({
        d: `M ${r1(cx)} ${r1(cy - k)} L ${r1(cx + k)} ${r1(cy)} L ${r1(cx)} ${r1(cy + k)} L ${r1(cx - k)} ${r1(cy)} Z`,
        stroke: 'none',
        strokeWidth: 0,
        fill: stroke,
      });
    } else if (!isRoot && !pill) {
      // Inset accent bar on the left edge.
      shape.push({ d: roundedRectPath(4, 7, 3, Math.max(6, box.h - 14), 1.5), stroke: 'none', strokeWidth: 0, fill: stroke });
    }
  }
  const check: PathSpec[] = [];
  if (node.done) {
    // A filled tick badge on the top-right corner.
    const { cx, cy, r } = checkBadge(node, box);
    check.push({
      d: `M ${r1(cx - r)} ${r1(cy)} A ${r} ${r} 0 1 0 ${r1(cx + r)} ${r1(cy)} A ${r} ${r} 0 1 0 ${r1(cx - r)} ${r1(cy)} Z`,
      stroke: t.panel,
      strokeWidth: 2,
      fill: t.done,
    });
    check.push({
      d: `M ${r1(cx - 4)} ${r1(cy + 0.2)} L ${r1(cx - 1.2)} ${r1(cy + 3)} L ${r1(cx + 4.2)} ${r1(cy - 2.8)}`,
      stroke: '#ffffff',
      strokeWidth: 2,
    });
  }
  return { highlight, shape, check, ink: isRoot && node.shape !== 'text' ? '#ffffff' : t.ink };
}

/** Where the done badge sits, relative to the node's top-left corner. */
export function checkBadge(node: Pick<TaskNode, 'shape'>, box: Pick<NodeBox, 'w' | 'h'>) {
  // On a pill, sit on the rounded end at 45 degrees.
  const k = node.shape === 'ellipse' ? (box.h / 2) * 0.293 : 2;
  return { cx: box.w - k, cy: k, r: 9 };
}

/** Light tints are very pale; nudge them towards white so cards read as cards. */
function mix(a: string, b: string): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((v, i) => Math.round(v * 0.7 + pb[i] * 0.3).toString(16).padStart(2, '0')).join('');
}

export function drawEdge(edge: Edge, theme: Theme, faded: boolean): PathSpec[] {
  return [{ d: edge.d, stroke: THEME[theme].edge + (faded ? '66' : ''), strokeWidth: 1.5 }];
}

export interface MetaSegment {
  text: string;
  kind: 'due' | 'progress' | 'tag' | 'notes';
  level?: DeadlineLevel;
}

export function metaSegments(node: TaskNode, prog: { done: number; total: number }, dl: DeadlineInfo): MetaSegment[] {
  const out: MetaSegment[] = [];
  if (node.dueDate) out.push({ text: dl.label || node.dueDate, kind: 'due', level: dl.fromChild ? 'none' : dl.level });
  if (prog.total > 0) out.push({ text: `${prog.done}/${prog.total}`, kind: 'progress' });
  for (const t of node.tags.slice(0, 2)) out.push({ text: `#${t.length > 12 ? t.slice(0, 11) + '…' : t}`, kind: 'tag' });
  if (node.notes.trim()) out.push({ text: 'notes', kind: 'notes' });
  return out;
}

export const META_FONT = 11.5;

/** Colour of a meta segment (or of the separator when `seg` is null). */
export function metaColor(seg: MetaSegment | null, theme: Theme, onSolid: boolean): string {
  if (seg?.kind === 'due' && seg.level && isHighlighted(seg.level)) return onSolid ? '#ffffff' : levelColor(seg.level, theme);
  return onSolid ? '#ffffffbf' : THEME[theme].muted;
}

export interface Scene {
  tree: Tree;
  layout: ReturnType<typeof computeLayout>;
  colors: Map<string, ColorName>;
  deadlines: Map<string, DeadlineInfo>;
  progress: Map<string, { done: number; total: number }>;
}

export function buildScene(doc: ProjectDoc, today = todayISO()): Scene {
  const tree = buildTree(doc.nodes);
  const totals = countDescendants(tree);
  const layout = computeLayout(tree, { progressTotals: totals });
  const colors = resolveColors(tree, doc.project.color);
  const deadlines = allDeadlines(tree, today, doc.project.settings.warnDays);
  const progress = new Map<string, { done: number; total: number }>();
  const visit = (n: TaskNode): { done: number; total: number } => {
    let done = 0;
    let total = 0;
    for (const c of tree.children.get(n.id) ?? []) {
      const p = visit(c);
      done += p.done + (c.done ? 1 : 0);
      total += p.total + 1;
    }
    progress.set(n.id, { done, total });
    return { done, total };
  };
  if (tree.root) visit(tree.root);
  return { tree, layout, colors, deadlines, progress };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function pathsToSvg(paths: PathSpec[]): string {
  return paths
    .map(
      (p) =>
        `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill ?? 'none'}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join('');
}

/** Stand-alone SVG of a whole project (used for exports, the REST API and MCP images). */
export function renderSVG(
  doc: ProjectDoc,
  opts: { theme?: Theme; today?: string; fontFamily?: string; title?: boolean } = {},
): string {
  const theme = opts.theme ?? 'light';
  const t = THEME[theme];
  const font = opts.fontFamily ?? FONT_FAMILY;
  const scene = buildScene(doc, opts.today);
  const { layout, tree, colors, deadlines, progress } = scene;
  const titleH = opts.title === false ? 0 : 56;
  const W = Math.ceil(layout.width);
  const H = Math.ceil(layout.height + titleH);
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family='${font}'>`,
    `<rect width="100%" height="100%" fill="${t.paper}"/>`,
  );
  if (titleH) {
    parts.push(
      `<text x="${LAYOUT.margin / 2}" y="38" font-size="18" font-weight="600" fill="${t.muted}">${esc(doc.project.name)}</text>`,
    );
  }
  parts.push(`<g transform="translate(0 ${titleH})">`);
  for (const e of layout.edges) {
    const child = tree.byId.get(e.to)!;
    parts.push(`<g${child.done ? ' opacity="0.35"' : ''}>${pathsToSvg(drawEdge(e, theme, false))}</g>`);
  }
  for (const box of layout.boxes.values()) {
    const node = tree.byId.get(box.id)!;
    const dl = deadlines.get(box.id)!;
    const drawing = drawNode(node, box, colors.get(box.id)!, theme, visibleLevel(node, dl));
    parts.push(`<g transform="translate(${box.x} ${box.y})"${node.done ? ' opacity="0.32"' : ''}>`);
    parts.push(pathsToSvg(drawing.highlight), pathsToSvg(drawing.shape));
    let y = box.textTop;
    for (const line of box.lines) {
      y += box.lineHeight;
      parts.push(
        `<text x="${box.w / 2 + box.textDx}" y="${y - box.lineHeight * 0.28}" text-anchor="middle" font-size="${box.fontSize}" font-weight="${box.depth === 0 ? 600 : 500}" fill="${drawing.ink}"${node.done ? ' text-decoration="line-through"' : ''}>${esc(line)}</text>`,
      );
    }
    if (box.hasMeta) {
      const segs = metaSegments(node, progress.get(box.id)!, dl);
      const text = segs
        .map((s) => {
          const fill = metaColor(s, theme, box.depth === 0);
          return `<tspan fill="${fill}"${s.kind === 'due' ? ' font-weight="600"' : ''}>${esc(s.text)}</tspan>`;
        })
        .join(`<tspan fill="${metaColor(null, theme, box.depth === 0)}">  ·  </tspan>`);
      parts.push(`<text x="${box.w / 2 + box.textDx}" y="${y + LAYOUT.metaH - 5}" text-anchor="middle" font-size="${META_FONT}" font-weight="500">${text}</text>`);
    }
    if (box.hiddenChildren > 0) {
      parts.push(
        `<text x="${box.w / 2}" y="${box.h + 20}" text-anchor="middle" font-size="11.5" font-weight="500" fill="${t.muted}">+${box.hiddenChildren} hidden</text>`,
      );
    }
    parts.push(pathsToSvg(drawing.check), '</g>');
  }
  parts.push('</g></svg>');
  return parts.join('');
}
