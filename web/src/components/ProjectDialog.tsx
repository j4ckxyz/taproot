import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, LIMITS, PALETTE, type ColorName, type Project, type ProjectSettings } from '@shared/types';
import { Button, Dialog, Field, Input, Swatches, Textarea } from './ui';

const ICONS = ['🌊', '🚀', '🏡', '📚', '🎨', '🛠️', '🌱', '💼', '🎯', '🧪', '✍️', '🎵', '🏃', '💡', '🗺️', '⛰️'];

export interface ProjectDraft {
  name: string;
  icon: string;
  color: ColorName;
  description: string;
  settings: ProjectSettings;
}

export function ProjectDialog({
  open,
  onClose,
  initial,
  onSave,
  onDelete,
  title,
}: {
  open: boolean;
  onClose: () => void;
  initial?: Project | null;
  onSave: (d: ProjectDraft) => Promise<void> | void;
  onDelete?: () => void;
  title: string;
}) {
  const [d, setD] = useState<ProjectDraft>(blank());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isNew = !initial;
  const [customise, setCustomise] = useState(false);
  /** Once you pick an icon or colour yourself, the name stops choosing them for you. */
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setD(
        initial
          ? { name: initial.name, icon: initial.icon, color: initial.color, description: initial.description, settings: initial.settings }
          : blank(),
      );
      setError(null);
      setCustomise(false);
      setTouched(false);
    }
  }, [open, initial]);

  const set = <K extends keyof ProjectDraft>(k: K, v: ProjectDraft[K]) => setD((p) => ({ ...p, [k]: v }));
  const setS = (k: keyof ProjectSettings, v: number) => setD((p) => ({ ...p, settings: { ...p.settings, [k]: v } }));

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave(d);
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save');
          } finally {
            setBusy(false);
          }
        }}
      >
        {isNew ? (
          <Input
            required
            autoFocus
            data-autofocus
            value={d.name}
            onChange={(e) => {
              const name = e.target.value;
              setD((p) => ({ ...p, name, ...(touched ? {} : guessLook(name)) }));
            }}
            placeholder="What’s the big idea? e.g. Geography NEA"
            className="h-12 text-base"
            aria-label="Project name"
          />
        ) : (
          <Field label="Name">
            <Input required autoFocus data-autofocus value={d.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
        )}
        {isNew && !customise && (
          <div className="flex items-center justify-between text-sm text-muted">
            <button type="button" onClick={() => setCustomise(true)} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-ink/5 hover:text-ink">
              <span className="text-lg leading-none">{d.icon}</span>
              <span className="h-3 w-3 rounded-full" style={{ background: PALETTE[d.color].stroke }} />
              Customise
            </button>
            <span>You can change everything later.</span>
          </div>
        )}
        {(!isNew || customise) && (
          <>
            <Field label="Icon">
              <div className="flex flex-wrap items-center gap-1">
                <Input
                  value={d.icon}
                  onChange={(e) => {
                    setTouched(true);
                    set('icon', e.target.value);
                  }}
                  className="mr-1 w-14 text-center text-lg"
                  maxLength={8}
                  aria-label="Icon (any emoji)"
                />
                {ICONS.map((i) => (
                  <button
                    type="button"
                    key={i}
                    onClick={() => {
                      setTouched(true);
                      set('icon', i);
                    }}
                    className={`h-8 w-8 rounded-md text-lg hover:bg-ink/5 ${d.icon === i ? 'bg-accent-soft' : ''}`}
                  >
                    {i}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Colour">
              <Swatches
                value={d.color}
                onChange={(c) => {
                  if (!c) return;
                  setTouched(true);
                  set('color', c);
                }}
              />
            </Field>
            <Field label="Description" hint="Optional. Agents see this too, so it's a good place for context.">
              <Textarea rows={2} value={d.description} onChange={(e) => set('description', e.target.value)} />
            </Field>
            <details className="rounded-lg border border-line px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium">Limits</summary>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <Field label="Depth" hint={`Levels below the idea (max ${LIMITS.maxDepth})`}>
                  <Input type="number" min={1} max={LIMITS.maxDepth} value={d.settings.maxDepth} onChange={(e) => setS('maxDepth', Number(e.target.value))} />
                </Field>
                <Field label="Branches" hint={`Per card (max ${LIMITS.maxChildren})`}>
                  <Input type="number" min={1} max={LIMITS.maxChildren} value={d.settings.maxChildren} onChange={(e) => setS('maxChildren', Number(e.target.value))} />
                </Field>
                <Field label="Warn" hint="Days before a deadline">
                  <Input type="number" min={0} max={LIMITS.warnDays} value={d.settings.warnDays} onChange={(e) => setS('warnDays', Number(e.target.value))} />
                </Field>
              </div>
            </details>
          </>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex items-center justify-between gap-2 pt-1">
          {onDelete ? (
            <Button type="button" variant="danger" size="sm" onClick={onDelete}>
              Delete project
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={busy || !d.name.trim()}>
              {isNew ? 'Create project' : 'Save'}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

function blank(): ProjectDraft {
  return { name: '', icon: '🌱', color: 'green', description: '', settings: { ...DEFAULT_SETTINGS } };
}

// A first guess at an icon from the project's name, so a new project needs nothing but a name.
const ICON_HINTS: [RegExp, string][] = [
  [/web|site|app|launch|ship|release|product/i, '🚀'],
  [/house|home|move|renovat|garden/i, '🏡'],
  [/book|read|study|exam|course|essay|nea|thesis|school|uni|revision|geograph|history|science/i, '📚'],
  [/design|brand|art|paint|draw/i, '🎨'],
  [/build|fix|repair|refactor|migrat|setup/i, '🛠️'],
  [/grow|social|follower|audience|blue ?sky|twitter|newsletter|market/i, '🌱'],
  [/job|career|work|business|client|sales/i, '💼'],
  [/goal|habit|plan|okr|quarter/i, '🎯'],
  [/research|experiment|test|lab/i, '🧪'],
  [/write|blog|novel|story|post|article/i, '✍️'],
  [/music|song|album|band/i, '🎵'],
  [/run|fitness|train|marathon|gym|health/i, '🏃'],
  [/idea|startup|invent/i, '💡'],
  [/trip|travel|holiday|journey/i, '🗺️'],
  [/climb|hike|mountain|adventure/i, '⛰️'],
];
const LOOK_COLORS: ColorName[] = ['blue', 'violet', 'teal', 'green', 'orange', 'pink', 'red', 'yellow'];

function guessLook(name: string): Pick<ProjectDraft, 'icon' | 'color'> {
  const icon = ICON_HINTS.find(([re]) => re.test(name))?.[1] ?? '🌱';
  let h = 0;
  for (const ch of name.trim().toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { icon, color: LOOK_COLORS[h % LOOK_COLORS.length] };
}
