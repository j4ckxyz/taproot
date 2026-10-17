// Export to and import from formats other tools understand.

import { buildTree, toMarkdown } from '../../shared/tree.js';
import { buildScene, nodeColors, renderSVG, seedFor, THEME, type Theme } from '../../shared/render.js';
import type { ColorName, ProjectDoc, TaskNode } from '../../shared/types.js';
import { formatDate } from '../../shared/deadline.js';

export const FORMAT_VERSION = 1;

export function exportJSON(doc: ProjectDoc) {
  return {
    format: 'taproot-project',
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    project: {
      name: doc.project.name,
      icon: doc.project.icon,
      color: doc.project.color,
      description: doc.project.description,
      settings: doc.project.settings,
    },
    nodes: doc.nodes.map(({ projectId: _p, ...n }) => n),
  };
}

export function exportMarkdown(doc: ProjectDoc): string {
  const tree = buildTree(doc.nodes);
  const head = `${doc.project.icon} ${doc.project.name}`.trim();
  const desc = doc.project.description ? `${doc.project.description}\n\n` : '';
  return toMarkdown(tree, { includeDone: true, heading: head }).replace(/^(# .*\n\n)/, `$1${desc}`);
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;');

/** Escapes text for a quoted Mermaid label. */
function mmd(s: string): string {
  return s.replace(/#/g, '#35;').replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;').replace(/\r?\n/g, '<br/>');
}

/**
 * Mermaid flowchart of the project, for GitHub, GitLab, Notion, Obsidian and other places that render
 * Mermaid. Shapes map to Mermaid's: card → rounded, square card → rectangle, pill → stadium,
 * milestone → hexagon. Branch colours, done and deadline states become class definitions.
 */
export function exportMermaid(doc: ProjectDoc, theme: Theme = 'light'): string {
  const scene = buildScene(doc);
  const { tree, colors, deadlines } = scene;
  const t = THEME[theme];
  const alias = new Map<string, string>();
  const lines: string[] = [`%% ${doc.project.name.replace(/\n/g, ' ')} (exported from Taproot)`, 'flowchart TD'];
  const used = new Set<string>();
  const classes: string[] = [];
  const walk = (n: TaskNode) => {
    const id = `n${alias.size}`;
    alias.set(n.id, id);
    const dl = deadlines.get(n.id)!;
    const meta: string[] = [];
    if (n.dueDate) meta.push(`due ${formatDate(n.dueDate)}`);
    const p = scene.progress.get(n.id);
    if (p && p.total) meta.push(`${p.done}/${p.total}`);
    const label = mmd((n.done ? '✓ ' : '') + (n.title || 'Untitled')) + (meta.length ? `<br/><small>${mmd(meta.join(' · '))}</small>` : '');
    const q = `"${label}"`;
    const isRoot = n.parentId === null;
    const shape = n.shape === 'rect' || n.shape === 'text' ? `[${q}]` : n.shape === 'ellipse' ? `([${q}])` : n.shape === 'diamond' ? `{{${q}}}` : `(${q})`;
    lines.push(`  ${id}${shape}`);
    if (n.parentId) lines.push(`  ${alias.get(n.parentId)} --> ${id}`);
    const cls = isRoot ? ['root'] : [`c_${colors.get(n.id)}`];
    used.add(cls[0]);
    if (n.done) cls.push('done');
    else if (dl.level === 'overdue' || dl.level === 'today' || dl.level === 'soon') cls.push(dl.level === 'soon' ? 'soon' : 'late');
    if (n.shape === 'text') cls.push('plain');
    classes.push(`  class ${id} ${cls.join(',')}`);
    for (const k of tree.children.get(n.id) ?? []) walk(k);
  };
  if (tree.root) walk(tree.root);
  lines.push(...classes);
  const rootColor = nodeColors(doc.project.color, theme).solid;
  lines.push(`  classDef root fill:${rootColor},stroke:${rootColor},color:#ffffff,font-weight:600`);
  for (const c of used) {
    if (!c.startsWith('c_')) continue;
    const nc = nodeColors(c.slice(2) as ColorName, theme);
    lines.push(`  classDef ${c} fill:${nc.fill},stroke:${nc.stroke},color:${t.ink}`);
  }
  lines.push(
    `  classDef done opacity:0.45`,
    `  classDef soon stroke:${t.soon},stroke-width:2px`,
    `  classDef late stroke:${t.overdue},stroke-width:2px`,
    `  classDef plain fill:none,stroke:none`,
  );
  return lines.join('\n') + '\n';
}

export function exportOPML(doc: ProjectDoc): string {
  const tree = buildTree(doc.nodes);
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    `  <head><title>${xml(doc.project.name)}</title><dateModified>${new Date(doc.project.updatedAt).toUTCString()}</dateModified></head>`,
    '  <body>',
  ];
  const walk = (n: TaskNode, depth: number) => {
    const attrs = [`text="${xml(n.title || 'Untitled')}"`];
    if (n.done) attrs.push('_status="checked"');
    if (n.notes) attrs.push(`_note="${xml(n.notes)}"`);
    if (n.dueDate) attrs.push(`due="${n.dueDate}"`);
    if (n.startDate) attrs.push(`start="${n.startDate}"`);
    if (n.tags.length) attrs.push(`tags="${xml(n.tags.join(','))}"`);
    const kids = tree.children.get(n.id) ?? [];
    const pad = '    ' + '  '.repeat(depth);
    if (!kids.length) out.push(`${pad}<outline ${attrs.join(' ')}/>`);
    else {
      out.push(`${pad}<outline ${attrs.join(' ')}>`);
      for (const k of kids) walk(k, depth + 1);
      out.push(`${pad}</outline>`);
    }
  };
  if (tree.root) walk(tree.root, 0);
  out.push('  </body>', '</opml>');
  return out.join('\n') + '\n';
}

/** A .excalidraw file that opens in excalidraw.com with the same layout. */
export function exportExcalidraw(doc: ProjectDoc, theme: Theme = 'light') {
  const scene = buildScene(doc);
  const { layout, tree, colors } = scene;
  const elements: Record<string, unknown>[] = [];
  const base = (id: string) => ({
    id,
    angle: 0,
    strokeStyle: 'solid',
    groupIds: [],
    frameId: null,
    seed: seedFor(id),
    version: 1,
    versionNonce: seedFor(id + 'n'),
    isDeleted: false,
    updated: Date.now(),
    link: null,
    locked: false,
  });
  const arrowsFor = new Map<string, string[]>();
  for (const e of layout.edges) {
    const id = `arrow-${e.to}`;
    arrowsFor.set(e.from, [...(arrowsFor.get(e.from) ?? []), id]);
    arrowsFor.set(e.to, [...(arrowsFor.get(e.to) ?? []), id]);
  }
  for (const box of layout.boxes.values()) {
    const n = tree.byId.get(box.id)!;
    const { stroke, fill } = nodeColors(colors.get(box.id)!, theme);
    const textId = `text-${n.id}`;
    const opacity = n.done ? 35 : 100;
    const label = n.title || 'Untitled';
    const meta = [n.dueDate ? `due ${n.dueDate}` : '', ...n.tags.map((t) => `#${t}`)].filter(Boolean).join('  ');
    const text = meta ? `${label}\n${meta}` : label;
    if (n.shape !== 'text') {
      elements.push({
        ...base(n.id),
        // Pills and milestones are rounded cards in Taproot; Excalidraw draws them as rounded rectangles.
        type: 'rectangle',
        x: box.x,
        y: box.y,
        width: box.w,
        height: box.h,
        strokeColor: box.depth === 0 ? nodeColors(doc.project.color, theme).solid : stroke,
        backgroundColor: box.depth === 0 ? nodeColors(doc.project.color, theme).solid : fill,
        fillStyle: 'solid',
        strokeWidth: box.depth === 0 ? 2 : 1,
        roughness: 0,
        opacity,
        roundness: n.shape === 'rect' ? null : { type: 3 },
        boundElements: [{ type: 'text', id: textId }, ...(arrowsFor.get(n.id) ?? []).map((id) => ({ type: 'arrow', id }))],
        customData: { taprootId: n.id, done: n.done, dueDate: n.dueDate, tags: n.tags, meta: n.meta, notes: n.notes },
      });
    }
    elements.push({
      ...base(textId),
      type: 'text',
      x: box.x + 10,
      y: box.y + box.textTop,
      width: box.w - 20,
      height: box.h - box.textTop * 2,
      strokeColor: box.depth === 0 && n.shape !== 'text' ? '#ffffff' : THEME[theme].ink,
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 1,
      roughness: 0,
      opacity,
      roundness: null,
      boundElements: n.shape === 'text' ? (arrowsFor.get(n.id) ?? []).map((id) => ({ type: 'arrow', id })) : null,
      text,
      originalText: text,
      fontSize: box.depth === 0 ? 24 : 16,
      fontFamily: 2,
      textAlign: 'center',
      verticalAlign: 'middle',
      containerId: n.shape === 'text' ? null : n.id,
      autoResize: true,
      lineHeight: 1.25,
    });
  }
  for (const e of layout.edges) {
    const a = layout.boxes.get(e.from)!;
    const b = layout.boxes.get(e.to)!;
    const child = tree.byId.get(e.to)!;
    const startBound = tree.byId.get(e.from)!.shape === 'text' ? `text-${e.from}` : e.from;
    const endBound = child.shape === 'text' ? `text-${e.to}` : e.to;
    let x: number, y: number, points: number[][];
    if (e.kind === 'column') {
      x = a.x + 22;
      y = a.y + a.h;
      const ey = b.y + b.h / 2 - y;
      points = [
        [0, 0],
        [0, ey],
        [b.x - x, ey],
      ];
    } else {
      x = a.x + a.w / 2;
      y = a.y + a.h;
      points = [
        [0, 0],
        [b.x + b.w / 2 - x, b.y - y],
      ];
    }
    const last = points[points.length - 1];
    elements.push({
      ...base(`arrow-${e.to}`),
      type: 'arrow',
      x,
      y,
      width: Math.abs(last[0]),
      height: Math.abs(last[1]),
      strokeColor: THEME[theme].edge,
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 1,
      roughness: 0,
      opacity: child.done ? 35 : 100,
      roundness: e.kind === 'row' ? { type: 2 } : null,
      boundElements: null,
      points,
      lastCommittedPoint: null,
      startBinding: { elementId: startBound, focus: 0, gap: 2 },
      endBinding: { elementId: endBound, focus: 0, gap: 2 },
      startArrowhead: null,
      endArrowhead: 'arrow',
      elbowed: false,
    });
  }
  return {
    type: 'excalidraw',
    version: 2,
    source: 'taproot',
    elements,
    appState: { viewBackgroundColor: THEME[theme].paper, gridSize: null },
    files: {},
  };
}

export function exportSVG(doc: ProjectDoc, theme: Theme = 'light') {
  return renderSVG(doc, { theme });
}

// ---------- importers ----------

export interface ImportedDoc {
  project: { name?: string; icon?: string; color?: string; description?: string; settings?: Record<string, number> };
  nodes: Partial<TaskNode>[];
}

let tmp = 0;
const tmpId = () => `imp${(++tmp).toString(36).padStart(6, '0')}`;

function parseSuffix(n: Partial<TaskNode>, raw: string): string {
  const m = raw.match(/^(.*?)\s+\(([^()]*)\)\s*$/);
  if (!m) return raw;
  const tags: string[] = [];
  const meta: Record<string, string> = {};
  let known = false;
  for (const part of m[2].split(',').map((s) => s.trim())) {
    if (part.startsWith('#')) {
      tags.push(part.slice(1));
      known = true;
    } else if (/^due:\d{4}-\d{2}-\d{2}$/.test(part)) {
      n.dueDate = part.slice(4);
      known = true;
    } else if (/^start:\d{4}-\d{2}-\d{2}$/.test(part)) {
      n.startDate = part.slice(6);
      known = true;
    } else if (/^[\w-]+:.+/.test(part)) {
      const i = part.indexOf(':');
      meta[part.slice(0, i)] = part.slice(i + 1);
      known = true;
    }
  }
  if (!known) return raw;
  if (tags.length) n.tags = tags;
  if (Object.keys(meta).length) n.meta = meta;
  return m[1];
}

/** Parses a Markdown checklist / outline. Indentation sets nesting. */
export function importMarkdown(text: string, fallbackName = 'Imported'): ImportedDoc {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const root: Partial<TaskNode> = { id: tmpId(), parentId: null, title: fallbackName };
  const nodes: Partial<TaskNode>[] = [root];
  const stack: { indent: number; node: Partial<TaskNode> }[] = [{ indent: -1, node: root }];
  let name: string | undefined;
  let last: Partial<TaskNode> = root;
  for (const line of lines) {
    if (!line.trim()) continue;
    const h = line.match(/^#\s+(.*)$/);
    if (h && !name) {
      name = h[1].trim();
      root.title = name.replace(/^\p{Extended_Pictographic}\s*/u, '');
      continue;
    }
    const bold = line.match(/^\*\*(.+?)\*\*(.*)$/);
    if (bold && nodes.length === 1) {
      root.title = parseSuffix(root, bold[1] + bold[2]).replace(/\*\*/g, '');
      continue;
    }
    const note = line.match(/^(\s*)>\s?(.*)$/);
    if (note) {
      last.notes = (last.notes ? last.notes + '\n' : '') + note[2];
      continue;
    }
    const item = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/);
    const heading = line.match(/^(#{2,6})\s+(.*)$/);
    let indent: number;
    let body: string;
    let done = false;
    if (item) {
      indent = item[1].replace(/\t/g, '    ').length + 100;
      body = item[3];
      done = item[2]?.toLowerCase() === 'x';
    } else if (heading) {
      indent = heading[1].length;
      body = heading[2];
    } else {
      continue;
    }
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    const n: Partial<TaskNode> = { id: tmpId(), parentId: parent.id!, done };
    n.title = parseSuffix(n, body.trim());
    nodes.push(n);
    stack.push({ indent, node: n });
    last = n;
  }
  return { project: { name: name ?? fallbackName }, nodes };
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m
    ? m[1]
        .replace(/&#10;/g, '\n')
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
    : undefined;
}

export function importOPML(text: string, fallbackName = 'Imported'): ImportedDoc {
  const title = text.match(/<title>([^<]*)<\/title>/)?.[1];
  const root: Partial<TaskNode> = { id: tmpId(), parentId: null, title: title ?? fallbackName };
  const nodes: Partial<TaskNode>[] = [root];
  const stack: Partial<TaskNode>[] = [root];
  const body = text.slice(text.indexOf('<body'));
  const tags = body.match(/<\/?outline\b[^>]*>/g) ?? [];
  let first = true;
  for (const tag of tags) {
    if (tag.startsWith('</')) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const selfClosing = tag.endsWith('/>');
    const n: Partial<TaskNode> = {
      title: attr(tag, 'text') ?? attr(tag, 'title') ?? '',
      done: attr(tag, '_status') === 'checked',
      notes: attr(tag, '_note') ?? '',
      dueDate: attr(tag, 'due') ?? null,
      startDate: attr(tag, 'start') ?? null,
      tags: attr(tag, 'tags')?.split(',').filter(Boolean) ?? [],
    };
    // A single top-level outline becomes the root itself.
    if (first && stack.length === 1 && tags.filter((t) => /^<outline/.test(t)).length > 0 && isSingleTop(tags)) {
      Object.assign(root, n, { id: root.id, parentId: null });
      first = false;
      if (!selfClosing) stack.push(root);
      continue;
    }
    first = false;
    n.id = tmpId();
    n.parentId = stack[stack.length - 1].id!;
    nodes.push(n);
    if (!selfClosing) stack.push(n);
  }
  return { project: { name: title ?? root.title ?? fallbackName }, nodes };
}

function isSingleTop(tags: string[]): boolean {
  let depth = 0;
  let tops = 0;
  for (const t of tags) {
    if (t.startsWith('</')) depth--;
    else {
      if (depth === 0) tops++;
      if (!t.endsWith('/>')) depth++;
    }
  }
  return tops === 1;
}
