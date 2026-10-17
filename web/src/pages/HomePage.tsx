import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Archive, Plus, Settings, Upload, LogOut, Search } from 'lucide-react';
import { PALETTE, type ProjectSummary } from '@shared/types';
import { daysBetween, formatDate, todayISO } from '@shared/deadline';
import { api, auth, projectsApi } from '../lib/api';
import { useTheme } from '../lib/theme';
import { cycleTheme } from '../lib/prefs';
import { HOME_SHORTCUTS, isThemeKey, isTyping, MOD_KEY } from '../lib/shortcuts';
import { Button, IconButton, Kbd, Logo, Spinner } from '../components/ui';
import { ThemeToggle } from '../components/ThemeToggle';
import { ProjectDialog } from '../components/ProjectDialog';
import { ShortcutSheet } from '../components/ShortcutSheet';
import { useSession } from '../App';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function HomePage() {
  const { user, status, setUser } = useSession();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [help, setHelp] = useState(false);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [update, setUpdate] = useState<string | null>(null);
  useEffect(() => {
    if (!user.isAdmin) return;
    api
      .get<{ updateAvailable: boolean; latest: string | null }>('/version')
      .then((v) => setUpdate(v.updateAvailable ? v.latest : null))
      .catch(() => {});
  }, [user.isAdmin]);
  const fileRef = useRef<HTMLInputElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const [, navigate] = useLocation();

  const load = () =>
    projectsApi
      .list(showArchived)
      .then((r) => setProjects(r.projects))
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  const needle = filter.trim().toLowerCase();
  const active = useMemo(
    () => projects?.filter((p) => !p.archived && (!needle || `${p.name} ${p.description}`.toLowerCase().includes(needle))) ?? [],
    [projects, needle],
  );
  const archived = projects?.filter((p) => p.archived && (!needle || `${p.name} ${p.description}`.toLowerCase().includes(needle))) ?? [];

  // Keys are listed in lib/shortcuts.ts (HOME_SHORTCUTS), which the `?` sheet shows.
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const handled = () => e.preventDefault();
      if (isThemeKey(e)) return handled(), cycleTheme();
      if (mod && key === ',') return handled(), navigate('/settings/preferences');
      if (mod || e.altKey) return;
      if (e.key === '?') return handled(), setHelp((v) => !v);
      if (e.key === '/') return handled(), filterRef.current?.focus();
      if (e.shiftKey) return;
      if (key === 'n') return handled(), setCreating(true);
      if (key === 'u') return handled(), fileRef.current?.click();
      if (key === 'a') return handled(), setShowArchived((v) => !v);
      if (/^[1-9]$/.test(e.key)) {
        const p = activeRef.current[Number(e.key) - 1];
        if (p) return handled(), navigate(`/p/${p.id}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const importFile = async (file: File) => {
    const text = await file.text();
    const ext = file.name.toLowerCase();
    const format = ext.endsWith('.opml') ? 'opml' : ext.endsWith('.md') || ext.endsWith('.markdown') || ext.endsWith('.txt') ? 'markdown' : 'json';
    try {
      const doc = await projectsApi.import(format, text, file.name.replace(/\.[^.]+$/, ''));
      navigate(`/p/${doc.project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    }
  };

  const all = projects?.filter((p) => !p.archived) ?? [];
  const today = todayISO();
  const dueSoon = all.filter((p) => p.nextDue && daysBetween(today, p.nextDue) <= p.settings.warnDays).length;
  const openTasks = all.reduce((n, p) => n + (p.total - p.done), 0);

  return (
    <div className="hero-glow min-h-full">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Logo size={28} className="rounded-lg shadow-sm shadow-accent/30" />
          <span className="text-[15px] font-semibold tracking-tight">{status.appName}</span>
        </div>
        <div className="flex items-center gap-1">
          {update && (
            <Link href="/settings/about" className="mr-1 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent hover:brightness-95">
              Update available: v{update}
            </Link>
          )}
          <button
            onClick={() => setHelp(true)}
            className="mr-1 hidden items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted hover:bg-ink/5 hover:text-ink sm:flex"
            title="Keyboard shortcuts"
          >
            <Kbd>?</Kbd> Shortcuts
          </button>
          <ThemeToggle />
          <Link href="/settings">
            <IconButton label="Settings" shortcut={`${MOD_KEY}+,`}>
              <Settings size={17} />
            </IconButton>
          </Link>
          <IconButton
            label="Sign out"
            onClick={async () => {
              await auth.logout();
              setUser(null);
            }}
          >
            <LogOut size={17} />
          </IconButton>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <div className="mt-6 mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">
              {greeting()}, {user.name.split(' ')[0]}
            </h1>
            <p className="mt-1 text-[15px] text-muted">
              {projects === null
                ? ' '
                : all.length === 0
                  ? 'Plant your first idea and let it grow.'
                  : `${all.length} project${all.length === 1 ? '' : 's'} · ${openTasks} open task${openTasks === 1 ? '' : 's'}${dueSoon ? ` · ${dueSoon} with deadlines close` : ''}`}
            </p>
          </div>
          <div className="flex gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".json,.md,.markdown,.txt,.opml"
              hidden
              onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}
            />
            <Button onClick={() => fileRef.current?.click()} title="Import a Taproot JSON export, a Markdown checklist or OPML (U)">
              <Upload size={15} /> Import
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)} title="New project (N)">
              <Plus size={15} /> New project
              <kbd className="ml-1 rounded bg-white/20 px-1.5 text-[11px] font-medium">N</kbd>
            </Button>
          </div>
        </div>

        {error && <p className="mb-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

        {projects && projects.length > 3 && (
          <label className="card mb-5 flex h-10 max-w-sm items-center gap-2 px-3 focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15">
            <Search size={15} className="text-muted" />
            <input
              ref={filterRef}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setFilter('');
                  e.currentTarget.blur();
                } else if (e.key === 'Enter' && active[0]) navigate(`/p/${active[0].id}`);
              }}
              placeholder="Filter projects"
              className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-muted/70"
            />
            <Kbd>/</Kbd>
          </label>
        )}

        {!projects ? (
          <div className="grid place-items-center py-24">
            <Spinner />
          </div>
        ) : all.length === 0 && !showArchived ? (
          <button
            onClick={() => setCreating(true)}
            className="card group grid w-full place-items-center gap-3 border-dashed px-6 py-20 text-center transition hover:border-accent"
          >
            <Logo size={56} className="rounded-2xl opacity-90 shadow-lg shadow-accent/20 transition group-hover:scale-105" />
            <span className="mt-1 text-lg font-semibold tracking-tight">Start with one idea</span>
            <span className="max-w-sm text-sm text-muted">
              Put the big thing at the top, then branch out into the steps it takes. Check them off as you go. Press <Kbd>N</Kbd> to begin.
            </span>
          </button>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((p, i) => (
              <ProjectCard key={p.id} p={p} index={i} />
            ))}
            {!needle && (
              <button
                onClick={() => setCreating(true)}
                className="grid min-h-36 place-items-center rounded-[14px] border border-dashed border-line text-sm font-medium text-muted transition hover:border-accent hover:bg-accent-soft/50 hover:text-accent"
              >
                <span className="flex items-center gap-2">
                  <Plus size={16} /> New project
                </span>
              </button>
            )}
            {needle && active.length === 0 && <p className="text-sm text-muted">No projects match “{filter}”.</p>}
          </div>
        )}

        {projects && (
          <div className="mt-10">
            <button className="flex items-center gap-2 text-sm text-muted hover:text-ink" onClick={() => setShowArchived((v) => !v)} title="Show / hide archived (A)">
              <Archive size={14} /> {showArchived ? 'Hide archived' : 'Show archived projects'}
            </button>
            {showArchived && archived.length > 0 && (
              <div className="mt-4 grid gap-4 opacity-70 sm:grid-cols-2 lg:grid-cols-3">
                {archived.map((p) => (
                  <ProjectCard key={p.id} p={p} />
                ))}
              </div>
            )}
            {showArchived && archived.length === 0 && <p className="mt-3 text-sm text-muted">Nothing archived.</p>}
          </div>
        )}
      </main>

      <ProjectDialog
        open={creating}
        onClose={() => setCreating(false)}
        title="New project"
        onSave={async (d) => {
          const doc = await projectsApi.create(d);
          // Open straight into writing the first step.
          try {
            sessionStorage.setItem('taproot-start', doc.project.id);
          } catch {
            /* fine without it */
          }
          navigate(`/p/${doc.project.id}`);
        }}
      />
      <ShortcutSheet open={help} onClose={() => setHelp(false)} groups={HOME_SHORTCUTS} />
    </div>
  );
}

function ProjectCard({ p, index }: { p: ProjectSummary; index?: number }) {
  const { resolved } = useTheme();
  const c = PALETTE[p.color];
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  const due = p.nextDue ? daysBetween(todayISO(), p.nextDue) : null;
  const stroke = resolved === 'light' ? c.stroke : c.darkStroke;
  return (
    <Link
      href={`/p/${p.id}`}
      className="card group relative block min-h-36 overflow-hidden transition duration-200 hover:-translate-y-0.5 hover:border-ink/15 hover:shadow-xl hover:shadow-black/[0.06] focus-visible:outline-2 focus-visible:outline-accent"
    >
      <div className="flex h-full flex-col p-4">
        <div className="flex items-start gap-3">
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xl ring-1 ring-inset"
            style={{ background: resolved === 'light' ? c.fill : c.dark, ['--tw-ring-color' as string]: stroke + '40' }}
          >
            {p.icon || '🌱'}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-semibold tracking-tight">{p.name}</h3>
            <p className="line-clamp-2 text-sm text-muted">{p.description || `${p.total} task${p.total === 1 ? '' : 's'}`}</p>
          </div>
          {index !== undefined && index < 9 && (
            <kbd className="rounded-md border border-line px-1.5 text-[11px] text-muted opacity-0 transition group-hover:opacity-100" title={`Press ${index + 1} to open`}>
              {index + 1}
            </kbd>
          )}
        </div>
        <div className="mt-auto pt-4">
          <div className="mb-1.5 flex items-center justify-between text-xs text-muted">
            <span className="tabular-nums">
              {pct}% · {p.done}/{p.total} done
            </span>
            {due !== null && (
              <span
                className={`rounded-full px-2 py-0.5 ${due < 0 ? 'bg-danger/10 font-semibold text-danger' : due <= p.settings.warnDays ? 'bg-warn/10 font-semibold text-warn' : 'bg-ink/5'}`}
              >
                {due < 0 ? `${-due}d overdue` : due === 0 ? 'Due today' : `Next ${formatDate(p.nextDue!)}`}
              </span>
            )}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: stroke }} />
          </div>
        </div>
      </div>
    </Link>
  );
}
