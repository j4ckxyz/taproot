import {
  ArrowDown, ArrowUp, CalendarCheck, CalendarDays, CalendarPlus, CalendarX, Check, ChevronsDownUp, ClipboardPaste, Copy, CopyPlus,
  CornerDownRight, CornerLeftUp, Hash, Keyboard, ListTree, Lock, LockOpen, Maximize, NotebookPen, Pencil, Plus, Rows3, Columns3,
  Scissors, Search, Trash2, Undo2, ZoomIn, RotateCcw,
} from 'lucide-react';
import { COLOR_NAMES, type Shape } from '@shared/types';
import { nodeColors, type Theme } from '@shared/render';
import type { MenuEntry } from '../components/ContextMenu';
import type { CanvasHandle, MenuKind } from '../components/Canvas';
import { useProject, type DetailField } from './projectStore';
import { usePrefs } from './prefs';
import {
  addChild, addSibling, copy, cut, duplicate, indent, moveAmongSiblings, paste, removeNode, setColor, setDue, setShape, toggleCollapse,
  toggleCollapseAll, toggleDone, toggleLayout,
} from './commands';
import { ALT_KEY, MOD_KEY } from './shortcuts';

interface Ctx {
  rename: (id: string) => void;
  details: (field: DetailField) => void;
  find: () => void;
  help: () => void;
  canvas: CanvasHandle | null;
  locked: boolean;
  theme: Theme;
}

const SHAPES: { shape: Shape; title: string; icon: React.ReactNode }[] = [
  { shape: 'rounded', title: 'Card (R)', icon: <ShapeGlyph d={<><rect x="1.5" y="3" width="13" height="10" rx="2.5" /><path d="M4 6v4" /></>} /> },
  { shape: 'ellipse', title: 'Pill (O)', icon: <ShapeGlyph d={<rect x="1" y="4" width="14" height="8" rx="4" />} /> },
  { shape: 'diamond', title: 'Milestone (D)', icon: <ShapeGlyph d={<><rect x="1.5" y="3" width="13" height="10" rx="2.5" /><path d="M5 5.6 7.4 8 5 10.4 2.6 8Z" fill="currentColor" /></>} /> },
  { shape: 'text', title: 'Text only (T)', icon: <span className="text-[12px] font-bold">T</span> },
];

function ShapeGlyph({ d }: { d: React.ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      {d}
    </svg>
  );
}

function colorRow(id: string, theme: Theme): MenuEntry {
  const node = useProject.getState().nodes.get(id);
  return {
    kind: 'row',
    label: 'Colour',
    buttons: [
      {
        key: 'none',
        title: 'Inherit the branch colour (0)',
        active: node?.color === null,
        onSelect: () => setColor(id, null),
        content: <span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-dashed border-ink/40" />,
      },
      ...COLOR_NAMES.map((c, i) => ({
        key: c,
        title: `${c[0].toUpperCase()}${c.slice(1)} (${i + 1})`,
        active: node?.color === c,
        onSelect: () => setColor(id, c),
        content: <span className="h-3.5 w-3.5 rounded-full" style={{ background: nodeColors(c, theme).stroke }} />,
      })),
    ],
  };
}

function shapeRow(id: string): MenuEntry {
  const node = useProject.getState().nodes.get(id);
  return {
    kind: 'row',
    label: 'Shape',
    buttons: SHAPES.map((s) => ({
      key: s.shape,
      title: s.title,
      active: node?.shape === s.shape || (s.shape === 'rounded' && node?.shape === 'rect'),
      onSelect: () => setShape(id, s.shape),
      content: s.icon,
    })),
  };
}

function dueEntries(id: string, ctx: Ctx): MenuEntry[] {
  const node = useProject.getState().nodes.get(id);
  return [
    { label: 'Due today', icon: <CalendarCheck size={14} />, shortcut: `${ALT_KEY}1`, onSelect: () => setDue(id, 0) },
    { label: 'Due tomorrow', icon: <CalendarDays size={14} />, shortcut: `${ALT_KEY}2`, onSelect: () => setDue(id, 1) },
    { label: 'Due in a week', icon: <CalendarPlus size={14} />, shortcut: `${ALT_KEY}3`, onSelect: () => setDue(id, 7) },
    { label: 'Pick a date…', icon: <CalendarDays size={14} />, shortcut: '⇧D', onSelect: () => ctx.details('due') },
    ...(node?.dueDate ? [{ label: 'Clear due date', icon: <CalendarX size={14} />, shortcut: `${ALT_KEY}0`, onSelect: () => setDue(id, null) } as MenuEntry] : []),
  ];
}

/** Every action, grouped the way you'd look for it. Shortcuts are listed alongside. */
export function menuEntries(kind: MenuKind, id: string | null, ctx: Ctx): MenuEntry[] {
  const s = useProject.getState();
  if (kind === 'due' && id) return dueEntries(id, ctx);
  if (kind === 'color' && id) return [colorRow(id, ctx.theme)];
  if (kind === 'shape' && id) return [shapeRow(id)];

  const node = id ? s.nodes.get(id) : undefined;
  if (kind === 'paper' || !node || !id) {
    const target = s.selectedId ?? s.project?.rootId ?? '';
    return [
      { label: 'Add a branch', icon: <Plus size={14} />, shortcut: 'Tab', onSelect: () => addChild(s.project?.rootId ?? target), disabled: ctx.locked },
      { label: 'Paste', icon: <ClipboardPaste size={14} />, shortcut: `${MOD_KEY}V`, onSelect: () => paste(s.project?.rootId ?? target), disabled: ctx.locked },
      { kind: 'separator' },
      { label: 'Find a card…', icon: <Search size={14} />, shortcut: '/', onSelect: ctx.find },
      { label: 'Fit everything', icon: <Maximize size={14} />, shortcut: '⇧1', onSelect: () => ctx.canvas?.fit() },
      { label: 'Zoom to 100%', icon: <ZoomIn size={14} />, shortcut: `${MOD_KEY}0`, onSelect: () => ctx.canvas?.zoomTo(1) },
      { label: 'Collapse / expand everything', icon: <ChevronsDownUp size={14} />, shortcut: '⇧C', onSelect: toggleCollapseAll },
      { kind: 'separator' },
      { label: 'Undo', icon: <Undo2 size={14} />, shortcut: `${MOD_KEY}Z`, onSelect: () => s.undo(), disabled: !s.undoStack.length },
      { label: 'Redo', icon: <RotateCcw size={14} className="-scale-x-100" />, shortcut: `${MOD_KEY}⇧Z`, onSelect: () => s.redo(), disabled: !s.redoStack.length },
      {
        label: ctx.locked ? 'Unlock canvas' : 'Lock canvas',
        icon: ctx.locked ? <LockOpen size={14} /> : <Lock size={14} />,
        shortcut: '⇧L',
        onSelect: () => usePrefs.getState().set('lockCanvas', !ctx.locked),
      },
      { label: 'Keyboard shortcuts', icon: <Keyboard size={14} />, shortcut: '?', onSelect: ctx.help },
    ];
  }

  const isRoot = node.parentId === null;
  const hasKids = [...s.nodes.values()].some((n) => n.parentId === id);
  const L = ctx.locked;
  return [
    { label: 'Rename', icon: <Pencil size={14} />, shortcut: 'Enter', onSelect: () => ctx.rename(id), disabled: L },
    ...(!isRoot ? [{ label: node.done ? 'Reopen' : 'Mark as done', icon: <Check size={14} />, shortcut: 'X', onSelect: () => toggleDone(id) } as MenuEntry] : []),
    { kind: 'separator' },
    { label: 'Add a sub-task', icon: <CornerDownRight size={14} />, shortcut: 'Tab', onSelect: () => addChild(id), disabled: L },
    ...(!isRoot
      ? ([
          { label: 'Add a card below', icon: <ArrowDown size={14} />, shortcut: '⇧Tab', onSelect: () => addSibling(id), disabled: L },
          { label: 'Add a card above', icon: <ArrowUp size={14} />, shortcut: '⇧Enter', onSelect: () => addSibling(id, true), disabled: L },
        ] as MenuEntry[])
      : []),
    { kind: 'separator' },
    ...(L ? [] : [colorRow(id, ctx.theme), shapeRow(id), { kind: 'separator' } as MenuEntry]),
    ...(L ? [] : dueEntries(id, ctx).slice(0, 3)),
    { label: 'Notes…', icon: <NotebookPen size={14} />, shortcut: 'N', onSelect: () => ctx.details('notes'), disabled: L },
    { label: 'Add a tag…', icon: <Hash size={14} />, shortcut: '#', onSelect: () => ctx.details('tags'), disabled: L },
    { kind: 'separator' },
    {
      label: node.childLayout === 'row' ? 'Show sub-tasks as a list' : 'Spread sub-tasks out',
      icon: node.childLayout === 'row' ? <Rows3 size={14} /> : <Columns3 size={14} />,
      shortcut: 'L',
      onSelect: () => toggleLayout(id),
      disabled: L,
    },
    ...(hasKids ? [{ label: node.collapsed ? 'Expand' : 'Collapse', icon: <ListTree size={14} />, shortcut: 'C', onSelect: () => toggleCollapse(id) } as MenuEntry] : []),
    ...(!isRoot && !L
      ? ([
          { kind: 'separator' },
          { label: 'Move up', icon: <ArrowUp size={14} />, shortcut: `${ALT_KEY}↑`, onSelect: () => moveAmongSiblings(id, -1) },
          { label: 'Move down', icon: <ArrowDown size={14} />, shortcut: `${ALT_KEY}↓`, onSelect: () => moveAmongSiblings(id, 1) },
          { label: 'Move out a level', icon: <CornerLeftUp size={14} />, shortcut: `${ALT_KEY}←`, onSelect: () => indent(id, 'out') },
        ] as MenuEntry[])
      : []),
    { kind: 'separator' },
    ...(!isRoot ? [{ label: 'Duplicate', icon: <CopyPlus size={14} />, shortcut: `${MOD_KEY}D`, onSelect: () => duplicate(id), disabled: L } as MenuEntry] : []),
    { label: 'Copy', icon: <Copy size={14} />, shortcut: `${MOD_KEY}C`, onSelect: () => copy(id) },
    ...(!isRoot ? [{ label: 'Cut', icon: <Scissors size={14} />, shortcut: `${MOD_KEY}X`, onSelect: () => cut(id), disabled: L } as MenuEntry] : []),
    { label: 'Paste inside', icon: <ClipboardPaste size={14} />, shortcut: `${MOD_KEY}V`, onSelect: () => paste(id), disabled: L },
    ...(!isRoot
      ? ([{ kind: 'separator' }, { label: 'Delete', icon: <Trash2 size={14} />, shortcut: '⌫', onSelect: () => removeNode(id), danger: true, disabled: L }] as MenuEntry[])
      : []),
  ];
}
