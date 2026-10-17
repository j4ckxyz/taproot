import { useEffect, useMemo, useState, useRef } from 'react';
import { CalendarClock, Check, Columns3, Plus, Rows3, Trash2, X } from 'lucide-react';
import type { ChildLayout, Shape, TaskNode } from '@shared/types';
import { buildTree } from '@shared/tree';
import { deadlineFor, isHighlighted, todayISO } from '@shared/deadline';
import { levelColor } from '@shared/render';
import { useProject } from '../lib/projectStore';
import { patchNode, removeNode, setColor, toggleDone } from '../lib/commands';
import { useTheme } from '../lib/theme';
import { Button, Field, IconButton, Input, Swatches, Textarea } from './ui';

const SHAPES: { id: Shape; label: string; key: string }[] = [
  { id: 'rounded', label: 'Card', key: 'R' },
  { id: 'rect', label: 'Square card', key: 'R R' },
  { id: 'ellipse', label: 'Pill', key: 'O' },
  { id: 'diamond', label: 'Milestone', key: 'D' },
  { id: 'text', label: 'Text', key: 'T' },
];

function ShapeIcon({ shape }: { shape: Shape }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 };
  return (
    <svg width="22" height="16" viewBox="0 0 22 16">
      {shape === 'rounded' && (
        <>
          <rect x="2" y="2" width="18" height="12" rx="3" {...p} />
          <path d="M5 5.5 V10.5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
        </>
      )}
      {shape === 'rect' && <rect x="2" y="2" width="18" height="12" rx="0.5" {...p} />}
      {shape === 'ellipse' && <rect x="1.5" y="2.5" width="19" height="11" rx="5.5" {...p} />}
      {shape === 'diamond' && (
        <>
          <rect x="2" y="2" width="18" height="12" rx="3" {...p} />
          <path d="M7 5 L10 8 L7 11 L4 8 Z" fill="currentColor" />
        </>
      )}
      {shape === 'text' && (
        <text x="11" y="13" textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor">
          T
        </text>
      )}
    </svg>
  );
}

/**
 * Debounced text field that writes a single undo step when you stop typing. Anything still
 * pending is written when the field goes away (e.g. you select another card mid-sentence).
 */
function useDraft(value: string, commit: (v: string) => void) {
  const [draft, setDraft] = useState(value);
  const latest = useRef({ draft, value, commit });
  latest.current = { draft, value, commit };
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (draft === value) return;
    const t = setTimeout(() => commit(draft), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  useEffect(
    () => () => {
      const l = latest.current;
      if (l.draft !== l.value) l.commit(l.draft);
    },
    [],
  );
  return [draft, setDraft, () => draft !== value && commit(draft)] as const;
}

export function Inspector({ onClose }: { onClose: () => void }) {
  const id = useProject((s) => s.selectedId);
  const node = useProject((s) => (s.selectedId ? s.nodes.get(s.selectedId) : undefined));
  if (!id || !node) {
    return (
      <Panel onClose={onClose}>
        <p className="text-sm text-muted">Select something on the canvas to see its details, dates and metadata.</p>
      </Panel>
    );
  }
  return (
    <Panel onClose={onClose}>
      <NodeDetails key={id} node={node} />
    </Panel>
  );
}

function Panel({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <aside
      className="island scrollbar-thin absolute top-16 right-3 bottom-3 z-20 w-[min(340px,calc(100%-24px))] overflow-y-auto p-4"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold tracking-wide text-muted uppercase">Details</h2>
        <IconButton label="Close details" shortcut="I" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
      {children}
    </aside>
  );
}

function NodeDetails({ node }: { node: TaskNode }) {
  const project = useProject((s) => s.project)!;
  const nodes = useProject((s) => s.nodes);
  const { resolved } = useTheme();
  const isRoot = node.parentId === null;
  const [title, setTitle, flushTitle] = useDraft(node.title, (v) => patchNode(node.id, { title: v }));
  const [notes, setNotes, flushNotes] = useDraft(node.notes, (v) => patchNode(node.id, { notes: v }));
  const [tagInput, setTagInput] = useState('');
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const tagRef = useRef<HTMLInputElement>(null);
  const dueRef = useRef<HTMLInputElement>(null);
  const focusField = useProject((s) => s.focusField);
  useEffect(() => {
    if (!focusField) return;
    const el = { title: titleRef, notes: notesRef, tags: tagRef, due: dueRef }[focusField.field].current;
    el?.focus();
    if (el instanceof HTMLTextAreaElement) el.setSelectionRange(el.value.length, el.value.length);
    if (focusField.field === 'due' && el instanceof HTMLInputElement) el.showPicker?.();
  }, [focusField]);
  const [metaKey, setMetaKey] = useState('');
  const [metaVal, setMetaVal] = useState('');

  const dl = useMemo(() => deadlineFor(buildTree(nodes.values()), node, todayISO(), project.settings.warnDays), [nodes, node, project.settings.warnDays]);
  const hl = isHighlighted(dl.level);

  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, '');
    if (t && !node.tags.includes(t)) patchNode(node.id, { tags: [...node.tags, t] });
    setTagInput('');
  };

  const addMeta = () => {
    const k = metaKey.trim();
    if (!k) return;
    patchNode(node.id, { meta: { ...node.meta, [k]: metaVal } });
    setMetaKey('');
    setMetaVal('');
  };

  return (
    <div className="space-y-5">
      {(hl || dl.level === 'overdue') && (
        <div className="rounded-lg border-l-4 px-3 py-2 text-sm" style={{ borderColor: levelColor(dl.level, resolved), background: `color-mix(in srgb, ${levelColor(dl.level, resolved)} 12%, transparent)` }}>
          {dl.explanation}
        </div>
      )}

      <div className="flex items-start gap-2">
        {!isRoot && (
          <button
            onClick={() => toggleDone(node.id)}
            title="Done (X)"
            aria-label={node.done ? 'Mark as not done' : 'Mark as done'}
            className={`mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-md border-2 transition ${node.done ? 'border-accent bg-accent text-white dark:text-[#18191b]' : 'border-line hover:border-accent'}`}
          >
            {node.done && <Check size={16} strokeWidth={3} />}
          </button>
        )}
        <Textarea
          ref={titleRef}
          rows={2}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={flushTitle}
          className="text-[15px] font-medium leading-snug"
          placeholder="Untitled"
          aria-label="Title"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Due">
          <Input ref={dueRef} type="date" value={node.dueDate ?? ''} onChange={(e) => patchNode(node.id, { dueDate: e.target.value || null })} />
        </Field>
        <Field label="Start">
          <Input type="date" value={node.startDate ?? ''} onChange={(e) => patchNode(node.id, { startDate: e.target.value || null })} />
        </Field>
      </div>
      {node.dueDate && (
        <div className="-mt-3 flex items-center gap-2 text-xs text-muted">
          <CalendarClock size={13} /> {dl.explanation || 'Due ' + node.dueDate}
        </div>
      )}

      <Field label="Tags">
        <div className="flex flex-wrap gap-1.5">
          {node.tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-sm text-accent">
              #{t}
              <button aria-label={`Remove ${t}`} onClick={() => patchNode(node.id, { tags: node.tags.filter((x) => x !== t) })}>
                <X size={12} />
              </button>
            </span>
          ))}
          <input
            ref={tagRef}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addTag();
              }
            }}
            onBlur={addTag}
            placeholder="add tag…"
            className="min-w-20 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/70"
          />
        </div>
      </Field>

      <Field label="Notes">
        <Textarea ref={notesRef} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={flushNotes} placeholder="Context, links, thoughts…" />
      </Field>

      <div>
        <span className="mb-1.5 block text-sm font-semibold">Metadata</span>
        <div className="space-y-1.5">
          {Object.entries(node.meta).map(([k, v]) => (
            <div key={k} className="flex items-center gap-1.5">
              <span className="w-24 shrink-0 truncate text-sm text-muted" title={k}>
                {k}
              </span>
              <Input
                className="h-8 min-w-0 text-sm"
                defaultValue={v}
                onBlur={(e) => e.target.value !== v && patchNode(node.id, { meta: { ...node.meta, [k]: e.target.value } })}
              />
              <IconButton
                label={`Remove ${k}`}
                onClick={() => {
                  const { [k]: _, ...rest } = node.meta;
                  patchNode(node.id, { meta: rest });
                }}
              >
                <Trash2 size={14} />
              </IconButton>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <Input className="h-8 w-24 min-w-0 shrink-0 text-sm" placeholder="key" value={metaKey} onChange={(e) => setMetaKey(e.target.value)} />
            <Input
              className="h-8 min-w-0 text-sm"
              placeholder="value"
              value={metaVal}
              onChange={(e) => setMetaVal(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addMeta()}
            />
            <IconButton label="Add metadata" onClick={addMeta} disabled={!metaKey.trim()}>
              <Plus size={16} />
            </IconButton>
          </div>
        </div>
      </div>

      <Field label="Shape">
        <div className="flex gap-1">
          {SHAPES.map((s) => (
            <IconButton key={s.id} label={s.label} shortcut={s.key} active={node.shape === s.id} onClick={() => patchNode(node.id, { shape: s.id })}>
              <ShapeIcon shape={s.id} />
            </IconButton>
          ))}
        </div>
      </Field>

      <Field label="Colour" hint={isRoot ? 'The central idea uses the project colour unless you pick one.' : 'Sub-tasks inherit their branch colour. Keys 1–9, 0 to inherit.'}>
        <Swatches value={node.color} onChange={(c) => setColor(node.id, c)} allowNone />
      </Field>

      <Field label="Branches spread">
        <div className="flex gap-1">
          {(
            [
              ['row', 'Out, side by side', Columns3],
              ['column', 'Down, as a list', Rows3],
            ] as [ChildLayout, string, typeof Rows3][]
          ).map(([v, label, Icon]) => (
            <Button key={v} size="sm" variant={node.childLayout === v ? 'primary' : 'default'} onClick={() => patchNode(node.id, { childLayout: v })} title={`${label} (L)`}>
              <Icon size={15} /> {label}
            </Button>
          ))}
        </div>
      </Field>

      {!isRoot && (
        <div className="border-t border-line pt-4">
          <Button variant="danger" size="sm" onClick={() => removeNode(node.id)}>
            <Trash2 size={14} /> Delete with everything below
          </Button>
        </div>
      )}
      {node.doneAt && <p className="text-xs text-muted">Done {new Date(node.doneAt).toLocaleString()}</p>}
    </div>
  );
}
