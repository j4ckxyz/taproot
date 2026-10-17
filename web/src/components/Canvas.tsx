import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ColorName, TaskNode, ProjectDoc } from '@shared/types';
import { buildScene, checkBadge, drawEdge, nodeColors, drawNode, levelColor, META_FONT, metaColor, metaSegments, THEME, visibleLevel, type PathSpec, type Theme } from '@shared/render';
import { formatDate, isHighlighted, type DeadlineInfo } from '@shared/deadline';
import { LAYOUT, type Layout, type NodeBox } from '@shared/layout';
import { isAncestor, sortBetween } from '@shared/tree';
import { presenceColor, useProject } from '../lib/projectStore';
import { addChild, addSibling, moveNode, toggleDone } from '../lib/commands';
import { useTheme } from '../lib/theme';
import { usePrefs } from '../lib/prefs';
import { Motion } from '../lib/motion';

const MotionCtx = createContext<Motion | null>(null);
/** Commits the inline editor if one is open (it saves on blur). */
export function finishEditing() {
  const el = document.activeElement;
  if (el instanceof HTMLTextAreaElement && el.hasAttribute('data-inline-editor')) el.blur();
  else if (useProject.getState().editingId) useProject.getState().edit(null);
}

const reducedMotion = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
import { CalendarDays, Check, MoreHorizontal, NotebookPen, Plus, Shapes } from 'lucide-react';

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 2.5;
const EDGE_PAD = 140;
const ZOOM_STEPS = [0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5];

/** The next fixed zoom step above (dir 1) or below (dir -1) the current scale. */
function snapScale(scale: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > scale + 0.001) ?? MAX_SCALE;
  return [...ZOOM_STEPS].reverse().find((s) => s < scale - 0.001) ?? MIN_SCALE;
}

export interface CanvasHandle {
  zoomBy: (f: number) => void;
  zoomTo: (s: number) => void;
  fit: () => void;
  focus: (id: string) => void;
  viewport: Viewport;
}

function Paths({ paths, className }: { paths: PathSpec[]; className?: string }) {
  return (
    <g className={className}>
      {paths.map((p, i) => (
        <path key={i} d={p.d} stroke={p.stroke} strokeWidth={p.strokeWidth} fill={p.fill ?? 'none'} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </g>
  );
}

interface NodeViewProps {
  node: TaskNode;
  box: NodeBox;
  color: Parameters<typeof drawNode>[2];
  theme: Theme;
  deadline: DeadlineInfo;
  progress: { done: number; total: number };
  selected: boolean;
  editing: boolean;
  dropHint: 'into' | 'before' | 'after' | null;
  dragging: boolean;
}

const NodeView = memo(function NodeView({ node, box, color, theme, deadline, progress, selected, editing, dropHint, dragging }: NodeViewProps) {
  const level = visibleLevel(node, deadline);
  const drawing = useMemo(
    () => drawNode(node, box, color, theme, level),
    // Re-draw only when something visible changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node.id, node.shape, node.done, box.w, box.h, box.depth, color, theme, level],
  );
  const t = THEME[theme];
  const segs = box.hasMeta ? metaSegments(node, progress, deadline) : [];
  const onSolid = box.depth === 0 && node.shape !== 'text';
  const motion = useContext(MotionCtx)!;
  // Position comes from the motion engine, which springs the card to its place.
  const place = useCallback((el: SVGGElement | null) => motion.registerNode(node.id, el), [motion, node.id]);
  let y = box.textTop;
  return (
    <g
      ref={place}
      data-node={node.id}
      className={`node ${node.done ? 'is-done' : ''} ${dragging ? 'opacity-30' : ''}`}
      style={{ cursor: 'default' }}
    >
      <g>
        <Paths paths={drawing.highlight} />
        {node.shape === 'text' && <rect x={0} y={0} width={box.w} height={box.h} fill="transparent" />}
        <Paths paths={drawing.shape} />
        {!editing &&
          box.lines.map((line, i) => {
            y += box.lineHeight;
            return (
              <text
                key={i}
                x={box.w / 2 + box.textDx}
                y={y - box.lineHeight * 0.28}
                textAnchor="middle"
                fontSize={box.fontSize}
                fontWeight={box.depth === 0 ? 600 : 500}
                fill={drawing.ink}
                className="title select-none"
              >
                {line || (i === 0 && !node.title ? '' : line)}
              </text>
            );
          })}
        {!editing && !node.title && (
          <text x={box.w / 2 + box.textDx} y={box.textTop + box.lineHeight * 0.72} textAnchor="middle" fontSize={box.fontSize} fontWeight={box.depth === 0 ? 600 : 500} fill={drawing.ink} className="select-none" opacity={0.45}>
            Untitled
          </text>
        )}
        {segs.length > 0 && (
          <text x={box.w / 2 + box.textDx} y={box.textTop + box.lines.length * box.lineHeight + LAYOUT.metaH - 5} textAnchor="middle" fontSize={META_FONT} fontWeight={500} className="select-none">
            {segs.map((s, i) => (
              <tspan key={i}>
                {i > 0 && <tspan fill={metaColor(null, theme, onSolid)}>{'  ·  '}</tspan>}
                <tspan fill={metaColor(s, theme, onSolid)} fontWeight={s.kind === 'due' ? 600 : 500}>
                  {s.text}
                </tspan>
              </tspan>
            ))}
          </text>
        )}
        {drawing.check.length > 0 && <Paths paths={drawing.check} />}
      </g>
      {box.hiddenChildren > 0 && (
        <g data-expand={node.id} style={{ cursor: 'pointer' }}>
          <rect x={box.w / 2 - 36} y={box.h + 7} width={72} height={20} rx={10} fill={t.panel} stroke={t.edge} />
          <text x={box.w / 2} y={box.h + 21} textAnchor="middle" fontSize={11} fontWeight={500} fill={t.muted} className="select-none">
            +{box.hiddenChildren} hidden
          </text>
        </g>
      )}
      {selected && (
        <rect
          x={-4}
          y={-4}
          width={box.w + 8}
          height={box.h + 8}
          rx={node.shape === 'rect' ? 6 : 14}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
          pointerEvents="none"
        />
      )}
      {dropHint === 'into' && (
        <rect x={-8} y={-8} width={box.w + 16} height={box.h + 16} rx={10} fill="var(--accent)" fillOpacity={0.12} stroke="var(--accent)" strokeWidth={2} pointerEvents="none" />
      )}
      {dropHint === 'before' && <line x1={-10} y1={-10} x2={box.w + 10} y2={-10} stroke="var(--accent)" strokeWidth={3} strokeLinecap="round" />}
      {dropHint === 'after' && <line x1={-10} y1={box.h + 10} x2={box.w + 10} y2={box.h + 10} stroke="var(--accent)" strokeWidth={3} strokeLinecap="round" />}
    </g>
  );
}, sameNodeView);

/**
 * Layout objects are rebuilt on every change, so compare by value to keep untouched nodes from re-rendering.
 * Position is left out on purpose: moving is the motion engine's job, not React's.
 */
function sameNodeView(a: NodeViewProps, b: NodeViewProps): boolean {
  return (
    a.node === b.node &&
    a.color === b.color &&
    a.theme === b.theme &&
    a.selected === b.selected &&
    a.editing === b.editing &&
    a.dropHint === b.dropHint &&
    a.dragging === b.dragging &&
    a.box.w === b.box.w &&
    a.box.h === b.box.h &&
    a.box.depth === b.box.depth &&
    a.box.hiddenChildren === b.box.hiddenChildren &&
    a.box.lines.join('\n') === b.box.lines.join('\n') &&
    a.deadline.level === b.deadline.level &&
    a.deadline.label === b.deadline.label &&
    !!a.deadline.fromChild === !!b.deadline.fromChild &&
    a.progress.done === b.progress.done &&
    a.progress.total === b.progress.total
  );
}

interface Drag {
  id: string;
  startX: number;
  startY: number;
  active: boolean;
  x: number;
  y: number;
  target: { id: string; zone: 'into' | 'before' | 'after' } | null;
}

export type MenuKind = 'card' | 'paper' | 'due' | 'color' | 'shape';

export function Canvas({
  handleRef,
  onViewport,
  rightInset = 0,
  onMenu,
  onDetails,
}: {
  handleRef: React.RefObject<CanvasHandle | null>;
  onViewport?: (v: Viewport) => void;
  /** Width covered by a side panel; the drawing is kept clear of it. */
  rightInset?: number;
  /** Open a menu at a screen position (right-click, or a card toolbar button). */
  onMenu: (x: number, y: number, kind: MenuKind, id: string | null) => void;
  /** Open the details panel on a field. */
  onDetails: (field: 'notes' | 'due') => void;
}) {
  const project = useProject((s) => s.project)!;
  const nodes = useProject((s) => s.nodes);
  const selectedId = useProject((s) => s.selectedId);
  const editingId = useProject((s) => s.editingId);
  const justDone = useProject((s) => s.justDone);
  const { resolved: theme } = useTheme();
  const { background, gridSize, doneStyle, celebrate, lockCanvas: locked, snapZoom, motion: motionPref } = usePrefs((s) => s.prefs);
  const smooth = motionPref && !reducedMotion?.matches;

  const draft = useProject((s) => (s.draft && s.draft.id === s.editingId ? s.draft : null));
  const scene = useMemo(() => {
    const list = [...nodes.values()];
    // Lay out the card being edited with its unsaved text, so it grows while you type.
    const shown = draft ? list.map((n) => (n.id === draft.id ? { ...n, title: draft.title } : n)) : list;
    return buildScene({ project, nodes: shown } as ProjectDoc);
  }, [project, nodes, draft]);
  const { layout, tree, colors, deadlines, progress } = scene;

  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const [vp, setVp] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const vpRef = useRef(vp);
  vpRef.current = vp;
  const fitted = useRef(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const pan = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const wheelAcc = useRef(0);
  // The canvas captures the pointer on press (for dragging and panning), which stops browsers
  // from firing native dblclick events, so double-clicks are detected here instead.
  const lastPress = useRef<{ t: number; x: number; y: number; id: string | null } | null>(null);
  /** Pressing a card that is already selected renames it on release (if it wasn't dragged). */
  const clickToEdit = useRef<{ id: string; x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const clamp = useCallback(
    (v: Viewport): Viewport => {
      const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale));
      const cw = layout.width * s;
      const ch = layout.height * s;
      const ax = EDGE_PAD;
      const bx = size.w - rightInset - cw - EDGE_PAD;
      const ay = EDGE_PAD;
      const by = size.h - ch - EDGE_PAD;
      return {
        scale: s,
        x: Math.min(Math.max(ax, bx), Math.max(Math.min(ax, bx), v.x)),
        y: Math.min(Math.max(ay, by), Math.max(Math.min(ay, by), v.y)),
      };
    },
    [layout.width, layout.height, size.w, size.h, rightInset],
  );

  // Camera glide: a critically damped spring towards a target viewport.
  const glideRef = useRef<{ raf: number; target: Viewport; v: Viewport } | null>(null);
  const stopGlide = () => {
    if (glideRef.current) cancelAnimationFrame(glideRef.current.raf);
    glideRef.current = null;
  };
  /** Where the camera is heading (or is, when it isn't moving). */
  const aim = () => glideRef.current?.target ?? vpRef.current;

  const setViewport = useCallback(
    (v: Viewport | ((p: Viewport) => Viewport)) => {
      stopGlide();
      setVp((prev) => {
        const next = clamp(typeof v === 'function' ? v(prev) : v);
        return next;
      });
    },
    [clamp],
  );

  const glide = useCallback(
    (to: Viewport) => {
      const target = clamp(to);
      if (!smooth) return setViewport(target);
      const g = glideRef.current ?? { raf: 0, target, v: { x: 0, y: 0, scale: 0 } };
      g.target = target;
      glideRef.current = g;
      if (g.raf) return;
      let last = performance.now();
      const step = (now: number) => {
        const cur = glideRef.current;
        if (!cur) return;
        let dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const v = { ...vpRef.current };
        while (dt > 0) {
          const h = Math.min(1 / 240, dt);
          dt -= h;
          for (const k of ['x', 'y', 'scale'] as const) {
            cur.v[k] += (420 * (cur.target[k] - v[k]) - 41 * cur.v[k]) * h;
            v[k] += cur.v[k] * h;
          }
        }
        const done = Math.abs(v.x - cur.target.x) < 0.3 && Math.abs(v.y - cur.target.y) < 0.3 && Math.abs(v.scale - cur.target.scale) < 0.0005;
        const next = done ? cur.target : v;
        vpRef.current = next;
        setVp(next);
        if (done) glideRef.current = null;
        else cur.raf = requestAnimationFrame(step);
      };
      g.raf = requestAnimationFrame(step);
    },
    [clamp, smooth, setViewport],
  );

  useEffect(() => onViewport?.(vp), [vp, onViewport]);

  // Keep the drawing inside bounds when the layout or window changes.
  useEffect(() => {
    if (glideRef.current) glide(glideRef.current.target);
    else setViewport((v) => v);
  }, [setViewport, glide]);

  const fit = useCallback(
    (instant = false) => {
      const w = size.w - rightInset;
      const s = Math.min(1, (w - 40) / layout.width, Math.max(0.45, (size.h - 40) / layout.height));
      const scale = Math.max(MIN_SCALE, s);
      const v = { scale, x: (w - layout.width * scale) / 2, y: 40 - 40 * scale };
      if (instant) setViewport(v);
      else glide(v);
    },
    [layout.width, layout.height, size.w, size.h, rightInset, setViewport, glide],
  );

  useEffect(() => {
    if (!fitted.current && layout.width > 0 && size.w > 0) {
      fitted.current = true;
      fit(true);
    }
  }, [fit, layout.width, size.w]);

  const zoomAt = useCallback(
    (factor: number, cx = size.w / 2, cy = size.h / 2, exact = false, animate = false) => {
      const v = animate ? aim() : vpRef.current;
      let scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      if (snapZoom && !exact && factor !== 1) scale = snapScale(v.scale, factor > 1 ? 1 : -1);
      const k = scale / v.scale;
      const next = { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
      if (animate) glide(next);
      else setViewport(next);
    },
    [setViewport, glide, size.w, size.h, snapZoom],
  );

  const focus = useCallback(
    (id: string) => {
      const b = layout.boxes.get(id);
      if (!b) return;
      const v = aim();
      const sx = b.x * v.scale + v.x;
      const sy = b.y * v.scale + v.y;
      const m = 80;
      let { x, y } = v;
      if (sx < m) x += m - sx;
      if (sx + b.w * v.scale > size.w - rightInset - m) x -= sx + b.w * v.scale - (size.w - rightInset - m);
      if (sy < m) y += m - sy;
      if (sy + b.h * v.scale > size.h - m - 60) y -= sy + b.h * v.scale - (size.h - m - 60);
      if (x !== v.x || y !== v.y) glide({ ...v, x, y });
    },
    [layout.boxes, size.w, size.h, rightInset, glide],
  );

  // Cards spring between layouts; see lib/motion.ts.
  const motion = useMemo(() => new Motion(), []);
  useEffect(() => () => motion.dispose(), [motion]);
  const ghostLayer = useCallback((el: SVGGElement | null) => motion.setGhostLayer(el), [motion]);
  motion.scale = () => vpRef.current.scale;
  useLayoutEffect(() => {
    motion.enabled = smooth;
    motion.update(layout, (id) => tree.byId.get(id)?.parentId ?? null);
  }, [layout, tree, motion, smooth]);
  useEffect(() => {
    for (const id of justDone) motion.kick(id);
  }, [justDone, motion]);

  useEffect(() => {
    handleRef.current = {
      zoomBy: (f) => zoomAt(f, undefined, undefined, false, true),
      zoomTo: (s) => zoomAt(s / aim().scale, undefined, undefined, true, true),
      fit: () => fit(),
      focus,
      viewport: vp,
    };
  });

  // Keep the selection in view.
  useEffect(() => {
    if (selectedId) focus(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, layout]);

  // Wheel: scroll pans, pinch / ctrl+wheel zooms (like Excalidraw).
  useEffect(() => {
    const el = wrapRef.current!;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('textarea')) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        if (snapZoom) {
          // Trackpads send many tiny deltas; step once per notch's worth of movement.
          wheelAcc.current += e.deltaY;
          if (Math.abs(wheelAcc.current) < 40) return;
          const dir = wheelAcc.current < 0 ? 1.1 : 1 / 1.1;
          wheelAcc.current = 0;
          zoomAt(dir, e.clientX - r.left, e.clientY - r.top);
        } else {
          zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
        }
      } else {
        setViewport((v) => ({ ...v, x: v.x - (e.shiftKey ? e.deltaY : e.deltaX), y: v.y - (e.shiftKey ? 0 : e.deltaY) }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, setViewport, snapZoom]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement).closest('input,textarea,[contenteditable]')) setSpaceDown(true);
    };
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpaceDown(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const toWorld = (clientX: number, clientY: number) => {
    const r = wrapRef.current!.getBoundingClientRect();
    const v = vpRef.current;
    return { x: (clientX - r.left - v.x) / v.scale, y: (clientY - r.top - v.y) / v.scale };
  };

  const hitNode = (wx: number, wy: number, exclude?: string): NodeBox | null => {
    let found: NodeBox | null = null;
    for (const b of layout.boxes.values()) {
      if (b.id === exclude) continue;
      if (wx >= b.x - 10 && wx <= b.x + b.w + 10 && wy >= b.y - 10 && wy <= b.y + b.h + 10) found = b;
    }
    return found;
  };

  const dropTarget = (d: Drag, wx: number, wy: number): Drag['target'] => {
    const b = hitNode(wx, wy, d.id);
    if (!b) return null;
    const target = tree.byId.get(b.id)!;
    if (isAncestor(tree, d.id, b.id)) return null;
    const parent = target.parentId ? tree.byId.get(target.parentId) : null;
    if (parent) {
      const rel = parent.childLayout === 'column' ? (wy - b.y) / b.h : (wx - b.x) / b.w;
      if (rel < 0.22) return { id: b.id, zone: 'before' };
      if (rel > 0.78) return { id: b.id, zone: 'after' };
    }
    return { id: b.id, zone: 'into' };
  };

  const isDoublePress = (e: React.PointerEvent, id: string | null) => {
    const p = lastPress.current;
    const now = performance.now();
    const double = !!p && now - p.t < 450 && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 8 && p.id === id;
    lastPress.current = double ? null : { t: now, x: e.clientX, y: e.clientY, id };
    return double;
  };

  const onDoublePress = (id: string | null) => {
    if (locked) return void useProject.getState().edit(id ?? null);
    if (id) return useProject.getState().edit(id);
    // Double-click on empty paper starts a new branch, like dropping a new thought.
    addChild(selectedId ?? project.rootId);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || spaceDown || e.button === 0) {
      const el = (e.target as Element).closest('[data-node],[data-expand],[data-add]');
      // Leaving the card being edited saves it (the editor commits on blur).
      finishEditing();
      if (el && !spaceDown && e.button === 0) {
        const expand = el.getAttribute('data-expand');
        if (expand) {
          useProject.getState().apply([{ op: 'update', id: expand, patch: { collapsed: false } }]);
          return;
        }
        const add = el.getAttribute('data-add');
        if (add) return;
        const id = el.getAttribute('data-node')!;
        const wasSelected = useProject.getState().selectedId === id;
        useProject.getState().select(id);
        if (isDoublePress(e, id)) {
          clickToEdit.current = null;
          e.preventDefault();
          return onDoublePress(id);
        }
        clickToEdit.current = wasSelected && !locked ? { id, x: e.clientX, y: e.clientY } : null;
        const w = toWorld(e.clientX, e.clientY);
        if (tree.byId.get(id)?.parentId && !locked) setDrag({ id, startX: w.x, startY: w.y, active: false, x: w.x, y: w.y, target: null });
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        return;
      }
      if (e.button === 0 && !spaceDown) {
        useProject.getState().select(null);
        if (isDoublePress(e, null)) {
          e.preventDefault();
          return onDoublePress(null);
        }
      }
      pan.current = { x: e.clientX, y: e.clientY, vx: vpRef.current.x, vy: vpRef.current.y };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pan.current) {
      const p = pan.current;
      setViewport((v) => ({ ...v, x: p.vx + e.clientX - p.x, y: p.vy + e.clientY - p.y }));
      return;
    }
    if (drag) {
      const w = toWorld(e.clientX, e.clientY);
      const active = drag.active || Math.hypot(w.x - drag.startX, w.y - drag.startY) > 6 / vpRef.current.scale;
      const next = { ...drag, active, x: w.x, y: w.y };
      next.target = active ? dropTarget(next, w.x, w.y) : null;
      setDrag(next);
      return;
    }
    const el = (e.target as Element).closest('[data-node]');
    const id = el?.getAttribute('data-node') ?? null;
    window.clearTimeout(hoverTimer.current);
    if (!id) {
      if (hover) setHover(null);
      return;
    }
    if (hover?.id === id) {
      setHover({ id, x: e.clientX, y: e.clientY });
      return;
    }
    const cx = e.clientX;
    const cy = e.clientY;
    hoverTimer.current = window.setTimeout(() => setHover({ id, x: cx, y: cy }), 350);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pan.current = null;
    const c = clickToEdit.current;
    clickToEdit.current = null;
    if (c && !drag?.active && Math.hypot(e.clientX - c.x, e.clientY - c.y) < 5) {
      setDrag(null);
      lastPress.current = null;
      return useProject.getState().edit(c.id);
    }
    if (drag?.active && drag.target) {
      const target = tree.byId.get(drag.target.id)!;
      if (drag.target.zone === 'into') {
        moveNode(drag.id, target.id);
      } else if (target.parentId) {
        const sibs = (tree.children.get(target.parentId) ?? []).filter((n) => n.id !== drag.id);
        const i = sibs.findIndex((n) => n.id === target.id);
        const sort = drag.target.zone === 'before' ? sortBetween(sibs[i - 1]?.sort, target.sort) : sortBetween(target.sort, sibs[i + 1]?.sort);
        moveNode(drag.id, target.parentId, sort);
      }
    }
    setDrag(null);
  };

  // Keep the backdrop from turning into noise when zoomed far out.
  let gridPx = gridSize * vp.scale;
  while (gridPx < 10) gridPx *= 2;

  const hovered = hover ? tree.byId.get(hover.id) : null;
  const hoverDl = hover ? deadlines.get(hover.id) : null;
  const selBox = selectedId ? layout.boxes.get(selectedId) : null;
  const selNode = selectedId ? tree.byId.get(selectedId) : null;
  const editBox = editingId ? layout.boxes.get(editingId) : null;

  return (
    <MotionCtx.Provider value={motion}>
      <div
        ref={wrapRef}
        data-done={doneStyle}
        className={`paper-${background} absolute inset-0 overflow-hidden touch-none ${spaceDown || pan.current ? 'cursor-grab' : ''} ${drag?.active ? 'cursor-grabbing' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onContextMenu={(e) => {
          e.preventDefault();
          finishEditing();
          const id = (e.target as Element).closest('[data-node]')?.getAttribute('data-node') ?? null;
          if (id) useProject.getState().select(id);
          onMenu(e.clientX, e.clientY, id ? 'card' : 'paper', id);
        }}
        style={{ backgroundPosition: `${vp.x}px ${vp.y}px`, backgroundSize: `${gridPx}px ${gridPx}px` }}
      >
        <svg width={size.w} height={size.h} className="block">
          <g transform={`translate(${vp.x} ${vp.y}) scale(${vp.scale})`}>
            {/* The canvas is finite: a faint sheet marks its edges. */}
            <rect
              x={0}
              y={0}
              width={layout.width}
              height={layout.height}
              rx={20}
              fill={THEME[theme].panel}
              fillOpacity={theme === 'light' ? 0.45 : 0.25}
              stroke={THEME[theme].border}
              strokeWidth={1 / vp.scale}
            />
            {layout.edges.map((e) => (
              <EdgeView key={e.to} d={e.d} to={e.to} theme={theme} faded={!!tree.byId.get(e.to)?.done} />
            ))}
            {[...layout.boxes.values()].map((b) => {
              const n = tree.byId.get(b.id)!;
              return (
                <NodeView
                  key={b.id}
                  node={n}
                  box={b}
                  color={colors.get(b.id)!}
                  theme={theme}
                  deadline={deadlines.get(b.id)!}
                  progress={progress.get(b.id)!}
                  selected={b.id === selectedId && !drag?.active}
                  editing={b.id === editingId}
                  dropHint={drag?.active && drag.target?.id === b.id ? drag.target.zone : null}
                  dragging={!!drag?.active && (drag.id === b.id || isAncestor(tree, drag.id, b.id))}
                />
              );
            })}
            <g ref={ghostLayer} pointerEvents="none" />
            <PresenceLayer layout={layout} scale={vp.scale} />
            {drag?.active && (
              <g transform={`translate(${drag.x + 8} ${drag.y + 8})`} pointerEvents="none" opacity={0.85}>
                <rect width={140} height={34} rx={10} fill="var(--panel)" stroke="var(--accent)" strokeWidth={1.5} />
                <text x={70} y={22} textAnchor="middle" fontSize={14} fontWeight={500} fill={THEME[theme].ink}>
                  {(tree.byId.get(drag.id)?.title || 'Untitled').slice(0, 16)}
                </text>
              </g>
            )}
          </g>
        </svg>

        {celebrate && [...justDone].map((id) => {
          const b = layout.boxes.get(id);
          const n = tree.byId.get(id);
          if (!b || !n?.done) return null;
          const { cx, cy } = checkBadge(n, b);
          return <DoneBurst key={id} x={vp.x + (b.x + cx) * vp.scale} y={vp.y + (b.y + cy) * vp.scale} scale={vp.scale} theme={theme} />;
        })}

        {selBox && selNode && !editingId && !drag?.active && (
          <CardToolbar node={selNode} locked={locked} theme={theme} color={colors.get(selNode.id)!} onMenu={onMenu} onDetails={onDetails} inset={rightInset} />
        )}

        {editingId && editBox && <InlineEditor key={editingId} node={nodes.get(editingId)!} box={editBox} vp={vp} />}

        {hovered && hoverDl && !drag && !editingId && <HoverCard node={hovered} dl={hoverDl} x={hover!.x} y={hover!.y} theme={theme} />}
      </div>
    </MotionCtx.Provider>
  );
}

/** Draws its children relative to a card, moving with it while it springs into place. */
function FollowCard({ id, box, children }: { id: string; box: NodeBox; children: React.ReactNode }) {
  const motion = useContext(MotionCtx)!;
  const ref = useRef<SVGGElement>(null);
  useLayoutEffect(() => motion.follow(id, ref.current!, 'svg'), [motion, id]);
  return (
    <g ref={ref} transform={`translate(${box.x} ${box.y})`}>
      {children}
    </g>
  );
}

/**
 * Other people, tabs and agents: a ring on the card they're on and a labelled cursor that glides
 * between cards as they move or edit. Cards someone else just changed pulse in their colour.
 */
function PresenceLayer({ layout, scale }: { layout: Layout; scale: number }) {
  const presence = useProject((s) => s.presence);
  const flashes = useProject((s) => s.flashes);
  const k = 1 / Math.max(scale, 0.5);
  return (
    <g pointerEvents="none">
      {flashes.map((f) => {
        const b = layout.boxes.get(f.id);
        if (!b) return null;
        return (
          <FollowCard key={f.n} id={f.id} box={b}>
            <rect className="change-pulse" x={-5} y={-5} width={b.w + 10} height={b.h + 10} rx={14} fill={f.color} fillOpacity={0.14} stroke={f.color} strokeWidth={2} />
          </FollowCard>
        );
      })}
      {presence.map((p) => {
        const b = p.nodeId ? layout.boxes.get(p.nodeId) : null;
        if (!b) return null;
        const color = presenceColor(p.key);
        const label = p.kind === 'agent' ? `${p.name}${p.doing ? ` · ${p.doing}` : ''}` : p.name;
        const w = label.length * 6.6 + 18;
        return (
          <g key={p.key}>
            <FollowCard id={p.nodeId!} box={b}>
              <rect x={-3} y={-3} width={b.w + 6} height={b.h + 6} rx={12} fill="none" stroke={color} strokeWidth={2} opacity={0.85} />
            </FollowCard>
            <g className="presence-cursor" style={{ transform: `translate(${b.x + b.w - 6}px, ${b.y + b.h - 4}px)` }}>
              <g transform={`scale(${k})`}>
                <path d="M0 0 L0 15 L4.2 11.2 L7 17.2 L9.6 16 L6.9 10.2 L12 10.2 Z" fill={color} stroke="#fff" strokeWidth={1.4} strokeLinejoin="round" />
                <rect x={10} y={16} width={w} height={20} rx={10} fill={color} />
                <text x={10 + w / 2} y={30} textAnchor="middle" fontSize={11.5} fontWeight={600} fill="#fff">
                  {p.kind === 'agent' ? '✦ ' : ''}
                  {label}
                </text>
              </g>
            </g>
          </g>
        );
      })}
    </g>
  );
}

/**
 * Bar docked at the bottom centre while a card is selected: the things you change most, with
 * labels, always in the same place so it never covers a card. Everything else is in the
 * right-click menu (the ⋯ button opens it too).
 */
function CardToolbar({
  node,
  locked,
  theme,
  color,
  onMenu,
  onDetails,
  inset,
}: {
  node: TaskNode;
  inset: number;
  locked: boolean;
  theme: Theme;
  color: ColorName;
  onMenu: (x: number, y: number, kind: MenuKind, id: string | null) => void;
  onDetails: (field: 'notes' | 'due') => void;
}) {
  const isRoot = node.parentId === null;
  const above = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Menus flip upwards from the bar (there's no room below it).
    return [r.left, r.top - 6] as const;
  };
  const btn = 'flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[13px] text-ink/75 transition hover:bg-ink/[0.07] hover:text-ink';
  const swatch = nodeColors(color, theme);
  return (
    <div
      style={{ left: `calc(50% - ${inset / 2}px)`, maxWidth: `calc(100% - ${inset + 24}px)` }}
      className="card-toolbar toast-enter absolute bottom-3 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-line bg-panel p-1 shadow-lg shadow-black/10"
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <span className="hidden max-w-44 items-center gap-2 truncate px-2 text-[13px] font-medium lg:flex">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: swatch.stroke }} />
        <span className="truncate">{node.title || 'Untitled'}</span>
      </span>
      <span className="mx-0.5 hidden h-5 w-px bg-line lg:block" />
      {!isRoot && (
        <button className={`${btn} ${node.done ? 'text-green-600 dark:text-green-400' : ''}`} title="Check off / reopen (X)" onClick={() => toggleDone(node.id)}>
          <Check size={15} strokeWidth={node.done ? 3 : 2.25} />
          <span className="hidden sm:inline">{node.done ? 'Done' : 'Mark done'}</span>
        </button>
      )}
      {!locked && (
        <>
          <button className={btn} title="Due date (Alt+1 today, Alt+2 tomorrow)" onClick={(e) => onMenu(...above(e), 'due', node.id)}>
            <CalendarDays size={15} />
            <span className="hidden sm:inline">{node.dueDate ? formatDate(node.dueDate) : 'Due'}</span>
          </button>
          <button className={btn} title="Colour (1–9)" onClick={(e) => onMenu(...above(e), 'color', node.id)}>
            <span className="h-3.5 w-3.5 rounded-full ring-2 ring-inset ring-black/10" style={{ background: swatch.stroke }} />
            <span className="hidden sm:inline">Colour</span>
          </button>
          <button className={btn} title="Shape (R, O, D, T)" onClick={(e) => onMenu(...above(e), 'shape', node.id)}>
            <Shapes size={15} />
            <span className="hidden sm:inline">Shape</span>
          </button>
          <button className={`${btn} ${node.notes ? 'text-accent' : ''}`} title="Notes (N)" onClick={() => onDetails('notes')}>
            <NotebookPen size={15} />
            <span className="hidden sm:inline">Notes</span>
          </button>
          <button className={btn} title="Add a sub-task (Tab)" onClick={() => addChild(node.id)}>
            <Plus size={15} />
            <span className="hidden sm:inline">Sub-task</span>
          </button>
        </>
      )}
      <span className="mx-0.5 h-5 w-px bg-line" />
      <button className={btn} title="Everything else (right-click)" onClick={(e) => onMenu(...above(e), 'card', node.id)}>
        <MoreHorizontal size={15} />
      </button>
    </div>
  );
}

/**
 * Check-off celebration, drawn in its own small composited layer above the canvas.
 * Animating inside the main SVG would repaint every node on each frame. The canvas already
 * shows the finished tick on the first frame; this only adds a pop and a ring on top.
 */
function DoneBurst({ x, y, scale, theme }: { x: number; y: number; scale: number; theme: Theme }) {
  const t = THEME[theme];
  const size = 64;
  return (
    <svg
      className="done-burst pointer-events-none absolute"
      width={size}
      height={size}
      viewBox="-32 -32 64 64"
      style={{ left: x - size / 2, top: y - size / 2, transform: `scale(${Math.max(scale, 0.5)})` }}
    >
      <circle className="done-ring" r={10} fill="none" stroke={t.done} strokeWidth={2} />
      <g className="done-badge">
        <circle r={9} fill={t.done} stroke={t.panel} strokeWidth={2} />
        <path d="M -4 0.2 L -1.2 3 L 4.2 -2.8" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

const EdgeView = memo(function EdgeView({ d, to, theme, faded }: { d: string; to: string; theme: Theme; faded: boolean }) {
  const p = drawEdge({ d, to, from: '', kind: 'row' }, theme, false)[0];
  const motion = useContext(MotionCtx)!;
  const ref = useCallback((el: SVGPathElement | null) => motion.registerEdge(to, el), [motion, to]);
  return (
    <path ref={ref} className="edge" opacity={faded ? 0.35 : 1} d={d} stroke={p.stroke} strokeWidth={p.strokeWidth} fill="none" strokeLinecap="round" />
  );
});

function InlineEditor({ node, box, vp }: { node: TaskNode; box: NodeBox; vp: Viewport }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(node.title);
  const done = useRef(false);

  // Focus before paint, so keys typed straight after Tab or Enter land in the editor
  // rather than triggering canvas shortcuts.
  useLayoutEffect(() => {
    const el = ref.current!;
    el.focus({ preventScroll: true });
    el.select();
  }, []);

  // Ride along while the card is still springing into place.
  const motion = useContext(MotionCtx)!;
  useLayoutEffect(() => motion.follow(node.id, ref.current!, 'html'), [motion, node.id]);

  const commit = (then?: 'child' | 'sibling') => {
    if (done.current) return;
    done.current = true;
    const s = useProject.getState();
    const title = value.trim();
    const fresh = s.freshId === node.id;
    useProject.setState({ editingId: null, freshId: null });
    if (fresh && !title && !then) {
      // An empty new node is discarded quietly, along with its history entry.
      const undoStack = s.undoStack.slice(0, -1);
      s.apply([{ op: 'delete', id: node.id }], { record: false, select: node.parentId });
      useProject.setState({ undoStack });
      return;
    }
    if (title !== node.title) {
      if (fresh) {
        // Fold the title into the create so one undo removes the whole thing.
        const last = s.undoStack[s.undoStack.length - 1];
        s.apply([{ op: 'update', id: node.id, patch: { title } }], { record: false });
        if (last) {
          const redo = last.redo.map((o) => (o.op === 'create' && o.node.id === node.id ? { ...o, node: { ...o.node, title } } : o));
          useProject.setState({ undoStack: [...s.undoStack.slice(0, -1), { ...last, redo }] });
        }
      } else s.apply([{ op: 'update', id: node.id, patch: { title } }]);
    }
    if (then === 'child') addChild(node.id);
    if (then === 'sibling') addSibling(node.id);
  };

  const cancel = () => {
    done.current = true;
    const s = useProject.getState();
    if (s.freshId === node.id && !node.title) {
      const undoStack = s.undoStack.slice(0, -1);
      s.apply([{ op: 'delete', id: node.id }], { record: false, select: node.parentId });
      useProject.setState({ undoStack });
    }
    useProject.setState({ editingId: null, freshId: null });
  };

  const fs = box.fontSize * vp.scale;
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        useProject.getState().setDraft(e.target.value);
      }}
      onBlur={() => commit()}
      data-inline-editor
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          if (useProject.getState().freshId === node.id && !value.trim()) cancel();
          else commit();
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          commit();
        } else if (e.key === 'Tab') {
          e.preventDefault();
          commit(e.shiftKey ? 'sibling' : 'child');
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      placeholder="Name this step…"
      rows={1}
      className="absolute resize-none overflow-hidden border-0 bg-transparent p-0 text-center leading-tight outline-none placeholder:opacity-50"
      style={{
        left: vp.x + (box.x + 10 + 2 * box.textDx) * vp.scale,
        top: vp.y + (box.y + box.textTop - 2) * vp.scale,
        width: (box.w - 20 - 2 * box.textDx) * vp.scale,
        height: Math.max(box.lines.length, value.split('\n').length) * box.lineHeight * vp.scale + 6,
        fontSize: fs,
        lineHeight: `${box.lineHeight * vp.scale}px`,
        fontWeight: box.depth === 0 ? 600 : 500,
        color: box.depth === 0 && node.shape !== 'text' ? '#ffffff' : 'var(--ink)',
      }}
    />
  );
}

function HoverCard({ node, dl, x, y, theme }: { node: TaskNode; dl: DeadlineInfo; x: number; y: number; theme: Theme }) {
  const hasDeadline = dl.level !== 'none' || (node.dueDate && node.done);
  const notes = node.notes.trim();
  const meta = Object.entries(node.meta);
  if (!hasDeadline && !notes && !meta.length && !node.startDate) return null;
  const tone = isHighlighted(dl.level) ? levelColor(dl.level, theme) : undefined;
  const left = Math.min(x + 16, window.innerWidth - 300);
  const top = Math.min(y + 18, window.innerHeight - 180);
  return (
    <div className="island pointer-events-none fixed z-50 w-72 p-3 text-sm" style={{ left, top }}>
      {hasDeadline && (
        <div className="flex gap-2">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: tone ?? 'var(--muted)' }} />
          <p className={tone ? 'font-semibold' : 'text-muted'} style={tone ? { color: tone } : undefined}>
            {dl.explanation}
          </p>
        </div>
      )}
      {node.startDate && <p className="mt-1 text-muted">Starts {node.startDate}</p>}
      {meta.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {meta.slice(0, 6).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="truncate">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {notes && <p className="mt-2 line-clamp-5 whitespace-pre-wrap text-xs text-muted">{notes}</p>}
    </div>
  );
}
