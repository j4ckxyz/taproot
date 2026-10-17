import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  ArrowLeft, Check, CircleHelp, Download, History, Maximize, Minus, PanelRight, Plus, Redo2, Undo2, Columns3, Rows3, Archive, Pencil,
  Lock, LockOpen, Settings, Search, Bot,
} from 'lucide-react';
import { usePrefs } from '../lib/prefs';
import { COLOR_NAMES, type Shape } from '@shared/types';
import { presenceColor, useProject, type DetailField } from '../lib/projectStore';
import type { ActivityEntry } from '@shared/types';
import {
  addChild, addSibling, copy, cut, duplicate, indent, moveAmongSiblings, navigate, paste, removeNode, setColor, setShape,
  toggleCollapse, toggleDone, toggleLayout, setDue, toggleCollapseAll, focusDetail,
} from '../lib/commands';
import { isThemeKey, isTyping, PROJECT_SHORTCUTS } from '../lib/shortcuts';
import { cycleTheme } from '../lib/prefs';
import { exportUrl, projectsApi } from '../lib/api';
import { buildScene } from '@shared/render';
import { useTheme } from '../lib/theme';
import { Canvas, type CanvasHandle, type MenuKind, type Viewport } from '../components/Canvas';
import { Inspector } from '../components/Inspector';
import { ProjectDialog } from '../components/ProjectDialog';
import { ShortcutSheet } from '../components/ShortcutSheet';
import { FindCard } from '../components/FindCard';
import { IconButton, Spinner, Dialog, MOD, Kbd } from '../components/ui';
import { ContextMenu } from '../components/ContextMenu';
import { menuEntries } from '../lib/menus';
import { ThemeToggle } from '../components/ThemeToggle';

const SHAPE_KEYS: Record<string, Shape> = { r: 'rounded', o: 'ellipse', d: 'diamond', t: 'text' };

/** Toolbar buttons shouldn't take keyboard focus, or Space (pan) would press them again. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

export function ProjectPage({ id }: { id: string }) {
  const load = useProject((s) => s.load);
  const unload = useProject((s) => s.unload);
  const project = useProject((s) => s.project);
  const loading = useProject((s) => s.loading);
  const error = useProject((s) => s.error);
  const selectedId = useProject((s) => s.selectedId);
  const selected = useProject((s) => (s.selectedId ? s.nodes.get(s.selectedId) : undefined));
  const canUndo = useProject((s) => s.undoStack.length > 0);
  const canRedo = useProject((s) => s.redoStack.length > 0);
  const saving = useProject((s) => s.saving);
  const online = useProject((s) => s.online);
  const toasts = useProject((s) => s.toasts);
  const locked = usePrefs((s) => s.prefs.lockCanvas);
  const { resolved } = useTheme();
  const [, go] = useLocation();

  const canvas = useRef<CanvasHandle | null>(null);
  const [vp, setVp] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  // The details panel starts closed (less to take in); its open state is remembered.
  const [inspector, setInspectorState] = useState(() => {
    try {
      return localStorage.getItem('taproot-details') === 'open';
    } catch {
      return false;
    }
  });
  const setInspector = useCallback((v: boolean | ((p: boolean) => boolean)) => {
    setInspectorState((p) => {
      const next = typeof v === 'function' ? v(p) : v;
      try {
        localStorage.setItem('taproot-details', next ? 'open' : 'closed');
      } catch {
        /* not remembered */
      }
      return next;
    });
  }, []);
  const [menu, setMenu] = useState<{ x: number; y: number; kind: MenuKind; id: string | null } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const openDetails = useCallback(
    (field: DetailField) => {
      setInspector(true);
      requestAnimationFrame(() => focusDetail(field));
    },
    [setInspector],
  );
  const [help, setHelp] = useState(false);
  const [editProject, setEditProject] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [find, setFind] = useState(false);
  const nodesCount = useProject((s) => s.nodes.size - 1);

  useEffect(() => {
    load(id);
    return () => unload();
  }, [id, load, unload]);

  useEffect(() => {
    if (project) document.title = `${project.icon} ${project.name}`;
  }, [project]);

  // A brand-new project opens with its first step ready to type.
  const projectId = project?.id;
  useEffect(() => {
    if (!projectId) return;
    let start: string | null = null;
    try {
      start = sessionStorage.getItem('taproot-start');
      if (start === projectId) sessionStorage.removeItem('taproot-start');
    } catch {
      /* ignore */
    }
    const s = useProject.getState();
    if (start === projectId && s.nodes.size === 1) setTimeout(() => addChild(s.project!.rootId), 250);
  }, [projectId]);

  const onViewport = useCallback((v: Viewport) => setVp(v), []);
  const closeHelp = useCallback(() => setHelp(false), []);

  // ---------- keyboard ----------
  // Every shortcut here is listed in lib/shortcuts.ts, which the `?` sheet shows.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const s = useProject.getState();
      if (!s.project) return;
      const mod = e.metaKey || e.ctrlKey;
      const plain = !mod && !e.altKey;
      const sel = s.selectedId;
      const key = e.key.toLowerCase();
      const layout = () => buildScene({ project: s.project!, nodes: [...s.nodes.values()] }).layout;
      const handled = () => e.preventDefault();
      const details = (field: DetailField) => {
        if (!sel) return;
        setInspector(true);
        // Let the panel mount before asking it to focus.
        requestAnimationFrame(() => focusDetail(field));
      };

      // Anywhere, with or without a selection.
      if (isThemeKey(e)) return handled(), cycleTheme();
      if (mod && key === 'z') return handled(), e.shiftKey ? s.redo() : s.undo();
      if (mod && key === 'y') return handled(), s.redo();
      if (mod && (key === '=' || key === '+')) return handled(), canvas.current?.zoomBy(1.2);
      if (mod && key === '-') return handled(), canvas.current?.zoomBy(1 / 1.2);
      if (mod && key === '0') return handled(), canvas.current?.zoomTo(1);
      if (mod && key === ',') return handled(), go('/settings/preferences');
      if (mod && key === 'f') return handled(), setFind(true);
      if (mod && key === 'a') return handled(), s.select(s.project.rootId);
      if (e.shiftKey && e.code === 'Digit1' && !mod) return handled(), canvas.current?.fit();
      if (e.shiftKey && e.code === 'Digit2' && !mod) return handled(), sel && canvas.current?.focus(sel);
      if (e.key === '?') return handled(), setHelp((v) => !v);
      if (e.key === '/' && plain) return handled(), setFind(true);
      if (plain && e.shiftKey && key === 'l') {
        handled();
        const next = !usePrefs.getState().prefs.lockCanvas;
        usePrefs.getState().set('lockCanvas', next);
        if (next) s.edit(null);
        return s.toast(next ? 'Canvas locked: view only. Checking off still works.' : 'Canvas unlocked.');
      }
      if (plain && e.shiftKey && key === 'e') return handled(), setExportOpen(true);
      if (plain && e.shiftKey && key === 'c') return handled(), toggleCollapseAll();
      if (plain && !e.shiftKey) {
        if (key === 'i') return handled(), setInspector((v) => !v);
        if (key === 'p') return handled(), setEditProject(true);
        if (key === 'h') return handled(), setActivityOpen(true);
        if (key === 'g') return handled(), go('/');
      }
      if (e.key === 'Escape') return s.select(null);
      if (e.key === 'Tab') {
        handled();
        if (e.shiftKey && sel) return addSibling(sel);
        return addChild(sel ?? s.project.rootId);
      }

      // Everything else needs a selected card.
      if (!sel) {
        if (e.key.startsWith('Arrow') || e.key === 'Enter') {
          handled();
          s.select(s.project.rootId);
        }
        return;
      }
      if (mod && e.key === 'Enter') return handled(), toggleDone(sel);
      if (e.key === 'Enter') return handled(), e.shiftKey ? addSibling(sel, true) : s.edit(sel);
      if (e.key === 'F2' || (plain && !e.shiftKey && key === 'e')) return handled(), s.edit(sel);
      if (e.key === 'Delete' || e.key === 'Backspace') return handled(), removeNode(sel);
      if (mod && key === 'd') return handled(), duplicate(sel);
      if (mod && key === 'c') return handled(), copy(sel);
      if (mod && key === 'x') return handled(), cut(sel);
      if (mod && key === 'v') return handled(), paste(sel);
      if (e.altKey && e.key === 'ArrowUp') return handled(), moveAmongSiblings(sel, -1);
      if (e.altKey && e.key === 'ArrowDown') return handled(), moveAmongSiblings(sel, 1);
      if (e.altKey && e.key === 'ArrowLeft') return handled(), indent(sel, 'out');
      if (e.altKey && e.key === 'ArrowRight') return handled(), indent(sel, 'in');
      // Alt+digit: Option changes e.key on a Mac, so match the physical key.
      if (e.altKey && !mod && /^Digit[0-3]$/.test(e.code)) {
        handled();
        return setDue(sel, ({ Digit0: null, Digit1: 0, Digit2: 1, Digit3: 7 } as Record<string, number | null>)[e.code]);
      }
      if (e.key.startsWith('Arrow')) {
        handled();
        const dir = e.key.slice(5).toLowerCase() as 'up' | 'down' | 'left' | 'right';
        const next = navigate(layout(), sel, dir);
        if (next) s.select(next);
        return;
      }
      if (!plain) return;
      if (e.key === '#') return handled(), details('tags');
      if (e.shiftKey) {
        if (key === 'd') return handled(), details('due');
        return;
      }
      if (key === 'x') return handled(), toggleDone(sel);
      if (key === 'n') return handled(), details('notes');
      if (SHAPE_KEYS[key]) return handled(), setShape(sel, SHAPE_KEYS[key]);
      if (key === 'l') return handled(), toggleLayout(sel);
      if (key === 'c' || key === '.') return handled(), toggleCollapse(sel);
      if (/^[0-9]$/.test(e.key)) {
        handled();
        const n = Number(e.key);
        return setColor(sel, n === 0 ? null : (COLOR_NAMES[n - 1] ?? null));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, setInspector]);

  if (error) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <p className="text-lg font-semibold tracking-tight">Couldn’t open this project</p>
          <p className="mt-1 text-muted">{error}</p>
          <Link href="/" className="mt-4 inline-block font-semibold text-accent">
            Back to projects
          </Link>
        </div>
      </div>
    );
  }
  if (loading || !project) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-hidden">
      <Canvas
        handleRef={canvas}
        onViewport={onViewport}
        rightInset={inspector ? 356 : 0}
        onMenu={(x, y, kind, nid) => setMenu({ x, y, kind, id: nid })}
        onDetails={openDetails}
      />
      {menu && (
        <ContextMenu
          key={`${menu.x},${menu.y},${menu.kind}`}
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          entries={menuEntries(menu.kind, menu.id, {
            rename: (nid) => useProject.getState().edit(nid),
            details: openDetails,
            find: () => setFind(true),
            help: () => setHelp(true),
            canvas: canvas.current,
            locked,
            theme: resolved,
          })}
        />
      )}

      {/* Top-left: project */}
      <div className="island absolute top-3 left-3 z-20 flex max-w-[calc(100%-24px)] items-center gap-1 p-1 sm:max-w-[45%]">
        <Link href="/">
          <IconButton label="All projects" shortcut="G">
            <ArrowLeft size={18} />
          </IconButton>
        </Link>
        <button
          onClick={() => setEditProject(true)}
          className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 hover:bg-ink/5"
          title="Project name, colour and limits (P)"
        >
          <span className="text-xl">{project.icon}</span>
          <span className="truncate text-[15px] font-semibold tracking-tight">{project.name}</span>
          <Pencil size={13} className="shrink-0 text-muted" />
        </button>
        <PresenceAvatars
          onJump={(nid) => {
            useProject.getState().select(nid);
            canvas.current?.focus(nid);
          }}
        />
        <span
          className={`ml-1 mr-2 hidden h-2 w-2 shrink-0 rounded-full sm:block ${!online ? 'bg-danger' : saving ? 'animate-pulse bg-warn' : 'bg-green-500'}`}
          title={!online ? 'Offline: changes are not being saved' : saving ? 'Saving…' : 'All changes saved'}
        />
      </div>

      {/* Top-centre: the few things you reach for most. Card actions live on the card itself. */}
      <div className="island absolute top-3 left-1/2 z-10 hidden -translate-x-1/2 items-center gap-0.5 p-1 md:flex" onMouseDown={keepFocus}>
        <button
          onClick={() => addChild(selectedId ?? project.rootId)}
          title={selected ? 'Add a sub-task to the selected card (Tab)' : 'Add a branch to the idea (Tab)'}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-white shadow-sm shadow-accent/30 transition hover:brightness-110 dark:text-[#111214]"
        >
          <Plus size={15} strokeWidth={2.5} /> Add
        </button>
        <button
          onClick={() => setFind(true)}
          title={`Find a card (/ or ${MOD}+F)`}
          className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13px] text-muted transition hover:bg-ink/[0.06] hover:text-ink"
        >
          <Search size={15} /> Find <Kbd>/</Kbd>
        </button>
        <div className="mx-1 h-5 w-px bg-line" />
        <IconButton label={locked ? 'Unlock canvas' : 'Lock canvas (view only)'} shortcut="Shift+L" active={locked} onClick={() => usePrefs.getState().set('lockCanvas', !locked)}>
          {locked ? <Lock size={16} /> : <LockOpen size={16} />}
        </IconButton>
      </div>

      {/* Top-right */}
      <div className="island absolute top-3 right-3 z-20 flex items-center gap-0.5 p-1" onMouseDown={keepFocus}>
        <IconButton label="Activity" shortcut="H" onClick={() => setActivityOpen(true)}>
          <History size={18} />
        </IconButton>
        <IconButton label="Export" shortcut="Shift+E" onClick={() => setExportOpen(true)}>
          <Download size={18} />
        </IconButton>
        <ThemeToggle />
        <Link href="/settings/preferences">
          <IconButton label="Settings" shortcut={`${MOD}+,`}>
            <Settings size={17} />
          </IconButton>
        </Link>
        <IconButton label="Keyboard shortcuts" shortcut="?" onClick={() => setHelp(true)}>
          <CircleHelp size={18} />
        </IconButton>
        <IconButton label="Details panel" shortcut="I" active={inspector} onClick={() => setInspector((v) => !v)}>
          <PanelRight size={18} />
        </IconButton>
      </div>

      {inspector && <Inspector onClose={() => setInspector(false)} />}

      {/* Bottom-left: zoom + history, like Excalidraw */}
      <div className="absolute bottom-3 left-3 z-10 flex gap-2" onMouseDown={keepFocus}>
        <div className="island flex items-center p-1">
          <IconButton label="Zoom out" shortcut={`${MOD}+-`} onClick={() => canvas.current?.zoomBy(1 / 1.2)}>
            <Minus size={16} />
          </IconButton>
          <button className="w-14 text-center text-sm tabular-nums hover:text-accent" title={`Reset zoom (${MOD}+0)`} onClick={() => canvas.current?.zoomTo(1)}>
            {Math.round(vp.scale * 100)}%
          </button>
          <IconButton label="Zoom in" shortcut={`${MOD}+=`} onClick={() => canvas.current?.zoomBy(1.2)}>
            <Plus size={16} />
          </IconButton>
          <IconButton label="Fit to screen" shortcut="Shift+1" onClick={() => canvas.current?.fit()}>
            <Maximize size={15} />
          </IconButton>
        </div>
        <div className="island flex items-center p-1">
          <IconButton label="Undo" shortcut={`${MOD}+Z`} disabled={!canUndo} onClick={() => useProject.getState().undo()}>
            <Undo2 size={16} />
          </IconButton>
          <IconButton label="Redo" shortcut={`${MOD}+Shift+Z`} disabled={!canRedo} onClick={() => useProject.getState().redo()}>
            <Redo2 size={16} />
          </IconButton>
        </div>
      </div>

      {nodesCount === 0 && (
        <div className="pointer-events-none absolute bottom-20 left-1/2 z-10 -translate-x-1/2 text-center">
          <p className="text-sm text-muted">
            Click <b>Add</b> or press <b>Tab</b> to start · click a card again to rename it · right-click for everything
          </p>
          <p className="text-sm text-muted/80">Press ? for every shortcut</p>
        </div>
      )}

      {/* Toasts */}
      <div className="pointer-events-none absolute bottom-16 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`island toast-enter px-4 py-2 text-sm ${t.tone === 'error' ? 'border-danger/50 text-danger' : t.tone === 'agent' ? 'border-accent/50' : ''}`}
          >
            {t.tone === 'agent' && <span className="mr-1">🤖</span>}
            {t.text}
          </div>
        ))}
      </div>

      <ShortcutSheet open={help} onClose={closeHelp} groups={PROJECT_SHORTCUTS} />
      {find && (
        <FindCard
          onClose={() => setFind(false)}
          onPick={(nid) => {
            useProject.getState().select(nid);
            canvas.current?.focus(nid);
          }}
        />
      )}
      <ProjectDialog
        open={editProject}
        onClose={() => setEditProject(false)}
        title="Project"
        initial={project}
        onSave={(d) => useProject.getState().updateProject(d)}
        onDelete={async () => {
          if (!confirm(`Delete “${project.name}” and everything in it? This can’t be undone (backups aside).`)) return;
          await projectsApi.remove(project.id);
          go('/');
        }}
      />
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} projectId={project.id} theme={resolved} archived={project.archived} />
      <ActivityDialog
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
        projectId={project.id}
        onJump={(nid) => {
          useProject.getState().select(nid);
          canvas.current?.focus(nid);
        }}
      />
    </div>
  );
}

function MiniShape({ shape }: { shape: Shape }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 };
  return (
    <svg width="20" height="16" viewBox="0 0 20 16">
      {shape === 'rounded' && (
        <>
          <rect x="1.5" y="3" width="17" height="10" rx="2.5" {...p} />
          <path d="M4.5 6 V10" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
        </>
      )}
      {shape === 'ellipse' && <rect x="1.5" y="3.5" width="17" height="9" rx="4.5" {...p} />}
      {shape === 'diamond' && (
        <>
          <rect x="1.5" y="3" width="17" height="10" rx="2.5" {...p} />
          <path d="M6 5.5 L8.5 8 L6 10.5 L3.5 8 Z" fill="currentColor" />
        </>
      )}
      {shape === 'text' && (
        <text x="10" y="13" textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor">
          A
        </text>
      )}
    </svg>
  );
}

const FORMATS = [
  { id: 'png', label: 'PNG image', desc: 'Picture of the canvas.' },
  { id: 'svg', label: 'SVG', desc: 'Scalable vector drawing.' },
  { id: 'excalidraw', label: 'Excalidraw', desc: 'Opens and stays editable at excalidraw.com.' },
  { id: 'markdown', label: 'Markdown checklist', desc: 'Obsidian, Notion, GitHub, any notes app.' },
  { id: 'opml', label: 'OPML outline', desc: 'MindNode, XMind, OmniOutliner, Workflowy.' },
  { id: 'mermaid', label: 'Mermaid flowchart', desc: 'GitHub, GitLab, Notion, Obsidian and docs sites render it.' },
  { id: 'json', label: 'Taproot JSON', desc: 'Everything, for backups or importing elsewhere.' },
];

function ExportDialog({ open, onClose, projectId, theme, archived }: { open: boolean; onClose: () => void; projectId: string; theme: string; archived: boolean }) {
  return (
    <Dialog open={open} onClose={onClose} title="Export">
      <div className="grid gap-2">
        {FORMATS.map((f) => (
          <a key={f.id} href={exportUrl(projectId, f.id, theme)} className="flex items-center justify-between rounded-lg border border-line px-3 py-2.5 transition hover:border-accent" download>
            <span>
              <span className="block font-semibold">{f.label}</span>
              <span className="text-sm text-muted">{f.desc}</span>
            </span>
            <Download size={16} className="text-muted" />
          </a>
        ))}
      </div>
      <button
        className="mt-4 flex items-center gap-2 text-sm text-muted hover:text-ink"
        onClick={async () => {
          await useProject.getState().updateProject({ archived: !archived });
          onClose();
        }}
      >
        <Archive size={14} /> {archived ? 'Unarchive project' : 'Archive project (hide from the list, keep everything)'}
      </button>
    </Dialog>
  );
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Who changed what, live. Click an entry to jump to the card. */
function ActivityDialog({ open, onClose, projectId, onJump }: { open: boolean; onClose: () => void; projectId: string; onJump: (id: string) => void }) {
  const [items, setItems] = useState<ActivityEntry[] | null>(null);
  const rev = useProject((s) => s.activityRev);
  const nodes = useProject((s) => s.nodes);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => projectsApi.activity(projectId).then((r) => setItems(r.activity)).catch(() => setItems([])), items ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, rev]);
  return (
    <Dialog open={open} onClose={onClose} title="Activity">
      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <p className="text-muted">Nothing yet.</p>
      ) : (
        <ul className="scrollbar-thin -mx-2 max-h-[60vh] space-y-0.5 overflow-y-auto">
          {items.map((a) => {
            const canJump = !!a.nodeId && nodes.has(a.nodeId);
            const name = a.actor.replace(/ \(API\)$/, '');
            return (
              <li key={a.id}>
                <button
                  disabled={!canJump}
                  onClick={() => {
                    onClose();
                    onJump(a.nodeId!);
                  }}
                  className="flex w-full gap-3 rounded-lg px-2 py-2 text-left text-sm transition enabled:hover:bg-ink/[0.05]"
                >
                  <span
                    className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
                    style={{ background: presenceColor(a.tokenId ? `token:${a.tokenId}` : `user:${name}`) }}
                  >
                    {a.tokenId ? <Bot size={13} /> : name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{name}</span>
                    {a.tokenId && <span className="ml-1.5 rounded bg-accent-soft px-1 py-px text-[10px] font-semibold text-accent uppercase">agent</span>}{' '}
                    <span className="text-ink/80">{a.summary}</span>
                    <span className="block text-xs text-muted">{timeAgo(a.at)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}

/** Who else is here: other tabs, people and agents. Click one to jump to the card they're on. */
function PresenceAvatars({ onJump }: { onJump: (id: string) => void }) {
  const presence = useProject((s) => s.presence);
  const nodes = useProject((s) => s.nodes);
  if (!presence.length) return null;
  const shown = presence.slice(0, 4);
  return (
    <div className="ml-1 flex items-center -space-x-1.5">
      {shown.map((p) => {
        const on = p.nodeId ? nodes.get(p.nodeId) : null;
        const what = p.kind === 'agent' ? `${p.doing ?? 'active'}${on ? ` on “${on.title || 'Untitled'}”` : ''}` : on ? `on “${on.title || 'Untitled'}”` : 'viewing';
        return (
          <button
            key={p.key}
            onClick={() => p.nodeId && nodes.has(p.nodeId) && onJump(p.nodeId)}
            title={`${p.name}${p.kind === 'agent' ? ' (agent)' : ''}: ${what}`}
            className="presence-avatar grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold text-white ring-2 ring-[var(--panel)] transition hover:z-10 hover:scale-110"
            style={{ background: presenceColor(p.key) }}
          >
            {p.kind === 'agent' ? <Bot size={13} /> : p.name.slice(0, 1).toUpperCase()}
          </button>
        );
      })}
      {presence.length > shown.length && (
        <span className="grid h-6 min-w-6 place-items-center rounded-full bg-ink/10 px-1 text-[10px] font-semibold ring-2 ring-[var(--panel)]">+{presence.length - shown.length}</span>
      )}
    </div>
  );
}
