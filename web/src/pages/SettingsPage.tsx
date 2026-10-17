import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { cycleTheme } from '../lib/prefs';
import { isThemeKey, isTyping, SETTINGS_SHORTCUTS } from '../lib/shortcuts';
import { ShortcutSheet } from '../components/ShortcutSheet';
import {
  ArrowLeft, Copy, Check, Download, KeyRound, Trash2, Users, DatabaseBackup, User as UserIcon, Plus, ShieldCheck, SlidersHorizontal,
  Monitor, Sun, Moon, RotateCcw, Info, ExternalLink,
} from 'lucide-react';
import { ACCENTS, type AccentName, type ApiToken, type Preferences, type ProjectSummary, type User } from '@shared/types';
import { usePrefs } from '../lib/prefs';
import { useTheme } from '../lib/theme';
import { api, projectsApi, tokensApi } from '../lib/api';
import { Button, Dialog, Field, IconButton, Input, Kbd, Logo, Segmented, Spinner, Switch } from '../components/ui';
import { ThemeToggle } from '../components/ThemeToggle';
import { useSession } from '../App';

/** Where Esc in settings returns to: the last page you were on before opening settings. */
let returnTo = '/';
export function rememberPage(path: string) {
  if (!path.startsWith('/settings')) returnTo = path;
}
const lastPageOutsideSettings = () => returnTo;

const TABS = [
  { id: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
  { id: 'tokens', label: 'API & agents', icon: KeyRound },
  { id: 'profile', label: 'Profile & data', icon: UserIcon },
  { id: 'users', label: 'Users', icon: Users, admin: true },
  { id: 'backups', label: 'Backups', icon: DatabaseBackup, admin: true },
  { id: 'about', label: 'About & updates', icon: Info },
];

export function SettingsPage({ tab }: { tab: string }) {
  const { user } = useSession();
  const [, navigate] = useLocation();
  const [help, setHelp] = useState(false);
  const tabs = TABS.filter((t) => !t.admin || user.isAdmin);

  // Keys are listed in lib/shortcuts.ts (SETTINGS_SHORTCUTS).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (isThemeKey(e)) return e.preventDefault(), cycleTheme();
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '?') return e.preventDefault(), setHelp((v) => !v);
      if (e.key === 'Escape') return e.preventDefault(), navigate(lastPageOutsideSettings());
      if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        const i = tabs.findIndex((t) => t.id === tab);
        const next = tabs[(i + (e.key === ']' ? 1 : tabs.length - 1)) % tabs.length];
        navigate(`/settings/${next.id}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, tabs, navigate]);

  return (
    <div className="min-h-full bg-paper">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 rounded-lg px-2 py-1 hover:bg-ink/5" title="Back to projects (Esc)">
          <ArrowLeft size={16} className="text-muted" />
          <Logo size={24} className="rounded-md" />
          <span className="text-[15px] font-semibold tracking-tight">Projects</span>
        </Link>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setHelp(true)}
            className="mr-1 hidden items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted hover:bg-ink/5 hover:text-ink sm:flex"
          >
            <Kbd>?</Kbd> Shortcuts
          </button>
          <ThemeToggle />
        </div>
      </header>
      <ShortcutSheet open={help} onClose={() => setHelp(false)} groups={SETTINGS_SHORTCUTS} />
      <div className="mx-auto grid max-w-5xl gap-6 px-4 pb-16 sm:px-6 md:grid-cols-[200px_1fr]">
        <nav className="flex gap-1 overflow-x-auto md:flex-col">
          <h1 className="mb-2 hidden text-2xl font-semibold tracking-tight md:block">Settings</h1>
          {tabs.map((t) => (
            <Link
              key={t.id}
              href={`/settings/${t.id}`}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${tab === t.id ? 'bg-accent-soft text-accent' : 'text-ink/80 hover:bg-ink/5'}`}
            >
              <t.icon size={16} /> {t.label}
            </Link>
          ))}
        </nav>
        <main className="min-w-0">
          {tab === 'preferences' && <PreferencesTab />}
          {tab === 'tokens' && <TokensTab />}
          {tab === 'profile' && <ProfileTab />}
          {tab === 'users' && user.isAdmin && <UsersTab />}
          {tab === 'backups' && user.isAdmin && <BackupsTab />}
          {tab === 'about' && <AboutTab />}
        </main>
      </div>
    </div>
  );
}

function Section({ title, desc, children, action }: { title: string; desc?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="card mb-6 p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {desc && <p className="mt-0.5 max-w-prose text-sm text-muted">{desc}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function CopyBlock({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      {label && <div className="mb-1 text-xs font-semibold text-muted">{label}</div>}
      <pre className="scrollbar-thin overflow-x-auto rounded-lg bg-ink/[0.04] p-3 pr-11 font-mono text-xs leading-relaxed whitespace-pre dark:bg-black/30">{text}</pre>
      <button
        className="absolute right-2 bottom-2 grid h-7 w-7 place-items-center rounded-md bg-panel text-muted shadow-sm hover:text-ink"
        aria-label="Copy"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

// ---------- preferences ----------

function Row({ title, desc, children }: { title: string; desc?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3.5 first:pt-0 last:pb-0">
      <div className="min-w-0 max-w-md">
        <div className="text-sm font-medium">{title}</div>
        {desc && <div className="mt-0.5 text-[13px] text-muted">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

/** A small picture of each canvas backdrop, drawn with the same CSS the canvas uses. */
function BackdropTile({ kind, active, onClick }: { kind: Preferences['background']; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`group flex flex-col items-center gap-1.5 text-[13px] font-medium ${active ? 'text-accent' : 'text-muted hover:text-ink'}`}
    >
      <span
        className={`paper-${kind} block h-14 w-20 rounded-lg border transition ${active ? 'border-accent ring-3 ring-accent/20' : 'border-line group-hover:border-ink/20'}`}
        style={{ backgroundSize: '10px 10px' }}
      />
      {kind[0].toUpperCase() + kind.slice(1)}
    </button>
  );
}

function DoneTile({ kind, active, onClick, label }: { kind: Preferences['doneStyle']; active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`group flex flex-col items-center gap-1.5 text-[13px] font-medium ${active ? 'text-accent' : 'text-muted hover:text-ink'}`}
    >
      <span
        data-done={kind}
        className={`grid h-14 w-28 place-items-center rounded-lg border bg-paper transition ${active ? 'border-accent ring-3 ring-accent/20' : 'border-line group-hover:border-ink/20'}`}
      >
        <svg width="84" height="30" viewBox="0 0 84 30" className="node is-done overflow-visible">
          <rect x="0.5" y="0.5" width="83" height="29" rx="7" fill="var(--panel)" stroke="var(--line)" />
          <rect x="4" y="7" width="3" height="16" rx="1.5" fill="var(--accent)" />
          <text x="44" y="19" textAnchor="middle" fontSize="11" fontWeight="500" fill="var(--ink)" className="title">
            Ship it
          </text>
          <circle cx="82" cy="2" r="6" fill="#22c55e" stroke="var(--panel)" strokeWidth="1.5" />
          <path d="M79.4 2.1 L81.3 4 L84.6 0.4" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>
      {label}
    </button>
  );
}

function PreferencesTab() {
  const prefs = usePrefs((s) => s.prefs);
  const set = usePrefs((s) => s.set);
  const { resolved } = useTheme();
  return (
    <>
      <Section title="Appearance" desc="Saved to your account, so they follow you to other devices.">
        <div className="divide-y divide-line">
          <Row title="Theme">
            <Segmented
              label="Theme"
              value={prefs.theme}
              onChange={(v) => set('theme', v)}
              options={[
                { value: 'system', label: <><Monitor size={14} /> System</> },
                { value: 'light', label: <><Sun size={14} /> Light</> },
                { value: 'dark', label: <><Moon size={14} /> Dark</> },
              ]}
            />
          </Row>
          <Row title="Accent colour" desc="Buttons, selection and focus rings.">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(ACCENTS) as AccentName[]).map((a) => (
                <button
                  key={a}
                  type="button"
                  title={a[0].toUpperCase() + a.slice(1)}
                  aria-label={a}
                  aria-pressed={prefs.accent === a}
                  onClick={() => set('accent', a)}
                  className={`grid h-7 w-7 place-items-center rounded-full transition hover:scale-110 ${prefs.accent === a ? 'ring-2 ring-offset-2 ring-offset-panel' : ''}`}
                  style={{ background: ACCENTS[a][resolved], ['--tw-ring-color' as string]: ACCENTS[a][resolved] }}
                >
                  {prefs.accent === a && <Check size={14} className="text-white dark:text-black" strokeWidth={3} />}
                </button>
              ))}
            </div>
          </Row>
        </div>
      </Section>

      <Section title="Canvas">
        <div className="divide-y divide-line">
          <Row title="Background">
            <div className="flex gap-3">
              {(['dots', 'grid', 'plain'] as const).map((k) => (
                <BackdropTile key={k} kind={k} active={prefs.background === k} onClick={() => set('background', k)} />
              ))}
            </div>
          </Row>
          {prefs.background !== 'plain' && (
            <Row title="Grid size" desc="Spacing at 100% zoom. It scales as you zoom.">
              <Segmented
                label="Grid size"
                value={prefs.gridSize}
                onChange={(v) => set('gridSize', v)}
                options={[16, 24, 32, 48].map((n) => ({ value: n, label: `${n}px` }))}
              />
            </Row>
          )}
          <Row
            title="Snap zoom to steps"
            desc="Zoom jumps between 25%, 50%, 75%, 100% and so on instead of gliding. Easier to keep things crisp."
          >
            <Switch label="Snap zoom to steps" checked={prefs.snapZoom} onChange={(v) => set('snapZoom', v)} />
          </Row>
          <Row
            title="Lock canvas"
            desc={
              <>
                View only, so nothing gets moved or deleted by accident. Checking off still works. Toggle with <Kbd>Shift</Kbd>{' '}
                <Kbd>L</Kbd> or the lock button.
              </>
            }
          >
            <Switch label="Lock canvas" checked={prefs.lockCanvas} onChange={(v) => set('lockCanvas', v)} />
          </Row>
        </div>
      </Section>

      <Section title="Checking off">
        <div className="divide-y divide-line">
          <Row title="Done items">
            <div className="flex flex-wrap gap-3">
              <DoneTile kind="fade" label="Fade + strike" active={prefs.doneStyle === 'fade'} onClick={() => set('doneStyle', 'fade')} />
              <DoneTile kind="faint" label="Fade" active={prefs.doneStyle === 'faint'} onClick={() => set('doneStyle', 'faint')} />
              <DoneTile kind="solid" label="Tick only" active={prefs.doneStyle === 'solid'} onClick={() => set('doneStyle', 'solid')} />
            </div>
          </Row>
          <Row title="Celebration" desc="A quick burst around the tick when you check something off.">
            <Switch label="Celebration" checked={prefs.celebrate} onChange={(v) => set('celebrate', v)} />
          </Row>
          <Row
            title="Smooth motion"
            desc="Cards spring into place and nudge their neighbours aside; the view glides when it moves. Always off if your system asks for reduced motion."
          >
            <Switch label="Smooth motion" checked={prefs.motion} onChange={(v) => set('motion', v)} />
          </Row>
        </div>
      </Section>

      <button
        type="button"
        onClick={() => usePrefs.getState().reset()}
        className="flex items-center gap-1.5 text-sm text-muted hover:text-ink"
      >
        <RotateCcw size={14} /> Reset preferences to defaults
      </button>
    </>
  );
}

// ---------- tokens ----------

const EXPIRY = [
  { label: 'Never', days: 0 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '1 year', days: 365 },
];

function TokensTab() {
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ token: ApiToken; secret: string } | null>(null);
  const [editing, setEditing] = useState<ApiToken | null>(null);
  const base = window.location.origin;

  const load = () => tokensApi.list().then((r) => setTokens(r.tokens));
  useEffect(() => {
    load();
    projectsApi.list(true).then((r) => setProjects(r.projects));
  }, []);

  const names = new Map(projects.map((p) => [p.id, `${p.icon} ${p.name}`]));

  return (
    <>
      <Section
        title="API tokens"
        desc="Tokens let agents and scripts (Claude, ChatGPT, Grok, your own) read your projects over MCP or the REST API. They are read-only unless you turn on writing, and you can limit them to certain projects."
        action={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> New token
          </Button>
        }
      >
        {!tokens ? (
          <Spinner />
        ) : tokens.length === 0 ? (
          <p className="text-sm text-muted">No tokens yet. Create one, then paste it into your agent's settings.</p>
        ) : (
          <ul className="divide-y divide-line">
            {tokens.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{t.name}</span>
                    <code className="rounded bg-ink/5 px-1.5 text-xs text-muted">{t.prefix}…</code>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {t.projectIds ? t.projectIds.map((id) => names.get(id) ?? 'deleted project').join(', ') : 'All projects'}
                    {' · '}
                    {t.lastUsedAt ? `used ${new Date(t.lastUsedAt).toLocaleDateString()}` : 'never used'}
                    {t.expiresAt && ` · expires ${new Date(t.expiresAt).toLocaleDateString()}`}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <span className={t.canWrite ? 'font-semibold text-warn' : 'text-muted'}>{t.canWrite ? 'Can write' : 'Read-only'}</span>
                  <Switch
                    label={`Allow ${t.name} to write`}
                    checked={t.canWrite}
                    onChange={async (v) => {
                      const r = await tokensApi.update(t.id, { canWrite: v });
                      setTokens((ts) => ts!.map((x) => (x.id === t.id ? r.token : x)));
                    }}
                  />
                </label>
                <Button size="sm" onClick={() => setEditing(t)}>
                  Projects
                </Button>
                <IconButton
                  label={`Revoke ${t.name}`}
                  onClick={async () => {
                    if (!confirm(`Revoke “${t.name}”? Agents using it stop working immediately.`)) return;
                    await tokensApi.revoke(t.id);
                    load();
                  }}
                >
                  <Trash2 size={16} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Connecting an agent" desc="Everything an agent can do is documented for it, too.">
        <ul className="space-y-1 text-sm">
          <li>
            MCP endpoint (Streamable HTTP): <code className="rounded bg-ink/5 px-1">{base}/mcp</code>
          </li>
          <li>
            REST API: <code className="rounded bg-ink/5 px-1">{base}/api/v1</code> ·{' '}
            <a className="font-semibold text-accent" href="/api/docs" target="_blank" rel="noreferrer">
              interactive docs
            </a>{' '}
            ·{' '}
            <a className="font-semibold text-accent" href="/api/openapi.json" target="_blank" rel="noreferrer">
              OpenAPI
            </a>{' '}
            ·{' '}
            <a className="font-semibold text-accent" href="/llms.txt" target="_blank" rel="noreferrer">
              llms.txt
            </a>
          </li>
        </ul>
        <p className="mt-3 text-sm text-muted">Create a token to get copy-paste setup for Claude Code, Claude Desktop, ChatGPT, Cursor and .env files.</p>
      </Section>

      <CreateTokenDialog
        open={creating}
        onClose={() => setCreating(false)}
        projects={projects}
        onCreated={(r) => {
          setCreated(r);
          load();
        }}
      />
      <TokenSecretDialog created={created} onClose={() => setCreated(null)} base={base} />
      <TokenProjectsDialog
        token={editing}
        projects={projects}
        onClose={() => setEditing(null)}
        onSaved={(t) => setTokens((ts) => ts!.map((x) => (x.id === t.id ? t : x)))}
      />
    </>
  );
}

function ProjectPicker({ projects, value, onChange }: { projects: ProjectSummary[]; value: string[] | null; onChange: (v: string[] | null) => void }) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" checked={value === null} onChange={() => onChange(null)} /> All projects (including new ones)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" checked={value !== null} onChange={() => onChange(projects.slice(0, 1).map((p) => p.id))} disabled={!projects.length} /> Only these:
      </label>
      {value !== null && (
        <div className="ml-6 max-h-48 space-y-1 overflow-y-auto">
          {projects.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={value.includes(p.id)}
                onChange={(e) => onChange(e.target.checked ? [...value, p.id] : value.filter((x) => x !== p.id))}
              />
              {p.icon} {p.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateTokenDialog({
  open,
  onClose,
  projects,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  projects: ProjectSummary[];
  onCreated: (r: { token: ApiToken; secret: string }) => void;
}) {
  const [name, setName] = useState('');
  const [canWrite, setCanWrite] = useState(false);
  const [projectIds, setProjectIds] = useState<string[] | null>(null);
  const [days, setDays] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName('');
      setCanWrite(false);
      setProjectIds(null);
      setDays(0);
      setError(null);
    }
  }, [open]);
  return (
    <Dialog open={open} onClose={onClose} title="New API token">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const r = await tokensApi.create({
              name,
              canWrite,
              projectIds: projectIds && projectIds.length ? projectIds : null,
              expiresAt: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null,
            });
            onClose();
            onCreated(r);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed');
          }
        }}
      >
        <Field label="Name" hint="Who will use it, e.g. “Claude Desktop” or “Home agent”.">
          <Input required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="flex items-start justify-between gap-4 rounded-lg border border-line p-3">
          <div>
            <div className="font-semibold">Allow writing</div>
            <div className="text-sm text-muted">Agents can add, edit, check off and delete tasks. You can change this later.</div>
          </div>
          <Switch checked={canWrite} onChange={setCanWrite} label="Allow writing" />
        </div>
        <Field label="Projects">
          <ProjectPicker projects={projects} value={projectIds} onChange={setProjectIds} />
        </Field>
        <Field label="Expires">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-10 w-full rounded-lg border border-line bg-panel px-3">
            {EXPIRY.map((x) => (
              <option key={x.days} value={x.days}>
                {x.label}
              </option>
            ))}
          </select>
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim()}>
            Create token
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function TokenSecretDialog({ created, onClose, base }: { created: { token: ApiToken; secret: string } | null; onClose: () => void; base: string }) {
  const [tab, setTab] = useState('env');
  if (!created) return null;
  const s = created.secret;
  const snippets: Record<string, { label: string; text: string; note?: string }> = {
    env: {
      label: '.env',
      text: `TAPROOT_URL=${base}\nTAPROOT_TOKEN=${s}\nTAPROOT_MCP_URL=${base}/mcp`,
      note: 'For your own agents and scripts. Send the token as "Authorization: Bearer $TAPROOT_TOKEN".',
    },
    claudeCode: {
      label: 'Claude Code',
      text: `claude mcp add --transport http taproot ${base}/mcp \\\n  --header "Authorization: Bearer ${s}"`,
    },
    claudeDesktop: {
      label: 'Claude Desktop',
      text: JSON.stringify(
        { mcpServers: { taproot: { command: 'npx', args: ['-y', 'mcp-remote', `${base}/mcp`, '--header', `Authorization: Bearer ${s}`] } } },
        null,
        2,
      ),
      note: 'Add to claude_desktop_config.json. For claude.ai custom connectors, use the URL from the "URL only" tab.',
    },
    chatgpt: {
      label: 'ChatGPT',
      text: `${base}/mcp/t/${s}`,
      note: 'In ChatGPT: Settings → Connectors → Create (developer mode). Paste this URL and choose "No authentication". The token is part of the URL, so keep it private. Your server must be reachable over HTTPS.',
    },
    cursor: {
      label: 'Cursor / generic',
      text: JSON.stringify({ mcpServers: { taproot: { url: `${base}/mcp`, headers: { Authorization: `Bearer ${s}` } } } }, null, 2),
      note: 'Works for Cursor, Windsurf, VS Code and other clients that support remote MCP servers with headers.',
    },
    url: {
      label: 'URL only',
      text: `${base}/mcp/t/${s}`,
      note: 'For clients that accept only a URL (claude.ai connectors, Grok, others). Treat this URL like a password.',
    },
    curl: {
      label: 'curl',
      text: `curl -H "Authorization: Bearer ${s}" ${base}/api/v1/projects`,
    },
  };
  const cur = snippets[tab];
  return (
    <Dialog open onClose={onClose} title="Token created" wide>
      <div className="mb-4 flex gap-2 rounded-lg bg-warn/10 p-3 text-sm">
        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-warn" />
        <span>Copy it now. For security it is only shown once. If you lose it, revoke it and create a new one.</span>
      </div>
      <CopyBlock text={s} label={`${created.token.name} · ${created.token.canWrite ? 'read & write' : 'read-only'}`} />
      <div className="mt-5 mb-2 flex flex-wrap gap-1">
        {Object.entries(snippets).map(([id, sn]) => (
          <button key={id} onClick={() => setTab(id)} className={`rounded-md px-2.5 py-1 text-sm font-semibold ${tab === id ? 'bg-accent-soft text-accent' : 'hover:bg-ink/5'}`}>
            {sn.label}
          </button>
        ))}
      </div>
      <CopyBlock text={cur.text} />
      {cur.note && <p className="mt-2 text-sm text-muted">{cur.note}</p>}
      <div className="mt-5 flex justify-end">
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}

function TokenProjectsDialog({
  token,
  projects,
  onClose,
  onSaved,
}: {
  token: ApiToken | null;
  projects: ProjectSummary[];
  onClose: () => void;
  onSaved: (t: ApiToken) => void;
}) {
  const [value, setValue] = useState<string[] | null>(null);
  useEffect(() => setValue(token?.projectIds ?? null), [token]);
  if (!token) return null;
  return (
    <Dialog open onClose={onClose} title={`${token.name}: projects`}>
      <ProjectPicker projects={projects} value={value} onChange={setValue} />
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={async () => {
            const r = await tokensApi.update(token.id, { projectIds: value && value.length ? value : null });
            onSaved(r.token);
            onClose();
          }}
        >
          Save
        </Button>
      </div>
    </Dialog>
  );
}

// ---------- profile ----------

function ProfileTab() {
  const { user, setUser } = useSession();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <Section title="Profile">
        <form
          className="grid max-w-md gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const r = await api.patch<{ user: User }>('/me', { name, email, ...(password ? { password } : {}) });
              setUser(r.user);
              setPassword('');
              setMsg(password ? 'Saved. Other sessions were signed out.' : 'Saved.');
            } catch (err) {
              setMsg(err instanceof Error ? err.message : 'Failed');
            }
          }}
        >
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="New password" hint="Leave blank to keep your current one.">
            <Input type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          <div className="flex items-center gap-3">
            <Button variant="primary">Save</Button>
            {msg && <span className="text-sm text-muted">{msg}</span>}
          </div>
        </form>
      </Section>
      <Section
        title="Your data"
        desc="Download every project you own in one JSON file. Each project can also be exported on its own (PNG, SVG, Excalidraw, Markdown, OPML) from its Export menu."
      >
        <a href="/api/v1/export" download>
          <Button>
            <Download size={16} /> Download all projects
          </Button>
        </a>
      </Section>
    </>
  );
}

// ---------- users ----------

function UsersTab() {
  const { user: me } = useSession();
  const [users, setUsers] = useState<User[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', password: '', isAdmin: false });
  const [error, setError] = useState<string | null>(null);
  const load = () => api.get<{ users: User[] }>('/users').then((r) => setUsers(r.users));
  useEffect(() => {
    load();
  }, []);
  return (
    <Section
      title="Users"
      desc="Everyone on this server has their own private projects and tokens. Set ALLOW_SIGNUP=true to let people register themselves."
      action={
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Plus size={16} /> Add user
        </Button>
      }
    >
      {!users ? (
        <Spinner />
      ) : (
        <ul className="divide-y divide-line">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">
                  {u.name} {u.id === me.id && <span className="text-xs text-muted">(you)</span>}
                </div>
                <div className="text-sm text-muted">{u.email}</div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                Admin
                <Switch
                  label={`Admin: ${u.name}`}
                  checked={u.isAdmin}
                  onChange={async (v) => {
                    if (u.id === me.id) return;
                    await api.patch(`/users/${u.id}`, { isAdmin: v });
                    load();
                  }}
                />
              </label>
              <Button
                size="sm"
                onClick={async () => {
                  const pw = prompt(`New password for ${u.email} (8+ characters)`);
                  if (pw) await api.patch(`/users/${u.id}`, { password: pw }).catch((e) => alert(e.message));
                }}
              >
                Reset password
              </Button>
              {u.id !== me.id && (
                <IconButton
                  label={`Delete ${u.name}`}
                  onClick={async () => {
                    if (!confirm(`Delete ${u.email} and all their projects? This can’t be undone.`)) return;
                    await api.del(`/users/${u.id}`);
                    load();
                  }}
                >
                  <Trash2 size={16} />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={adding} onClose={() => setAdding(false)} title="Add user">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.post('/users', form);
              setAdding(false);
              setForm({ email: '', name: '', password: '', isAdmin: false });
              load();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Failed');
            }
          }}
        >
          <Field label="Email">
            <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Temporary password" hint="Share it with them; they can change it in Settings.">
            <Input required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isAdmin} onChange={(e) => setForm({ ...form, isAdmin: e.target.checked })} /> Admin (manages users and backups)
          </label>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end">
            <Button variant="primary">Add user</Button>
          </div>
        </form>
      </Dialog>
    </Section>
  );
}

// ---------- backups ----------

interface Backup {
  name: string;
  size: number;
  createdAt: string;
  kind: string;
}

function BackupsTab() {
  const [data, setData] = useState<{ backups: Backup[]; intervalHours: number; keep: number; dir: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.get<typeof data>('/backups').then(setData);
  useEffect(() => {
    load();
  }, []);
  return (
    <Section
      title="Backups"
      desc={
        data
          ? data.intervalHours > 0
            ? `Automatic snapshots every ${data.intervalHours}h, keeping the last ${data.keep}. Stored in ${data.dir}.`
            : `Automatic backups are off (BACKUP_INTERVAL_HOURS=0). Stored in ${data.dir}.`
          : undefined
      }
      action={
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await api.post('/backups').finally(() => setBusy(false));
            load();
          }}
        >
          <DatabaseBackup size={16} /> Back up now
        </Button>
      }
    >
      {!data ? (
        <Spinner />
      ) : data.backups.length === 0 ? (
        <p className="text-sm text-muted">No backups yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {data.backups.map((b) => (
            <li key={b.name} className="flex items-center gap-3 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{new Date(b.createdAt).toLocaleString()}</div>
                <div className="text-xs text-muted">
                  {b.kind} · {(b.size / 1024).toFixed(1)} KB
                </div>
              </div>
              <a href={`/api/v1/backups/${b.name}`} download>
                <IconButton label="Download">
                  <Download size={16} />
                </IconButton>
              </a>
              <IconButton
                label="Delete backup"
                onClick={async () => {
                  if (!confirm('Delete this backup?')) return;
                  await api.del(`/backups/${b.name}`);
                  load();
                }}
              >
                <Trash2 size={16} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer font-semibold">How to restore</summary>
        <p className="mt-2 text-muted">Stop the server, then run:</p>
        <CopyBlock text={`npm run restore -- <backup-file-name>\n# Docker:\ndocker compose run --rm taproot node dist/server/cli.js restore <backup-file-name>`} />
        <p className="mt-2 text-muted">The current database is saved as a “pre-restore” backup first. Backups are gzipped SQLite files, so any SQLite tool can open them.</p>
      </details>
    </Section>
  );
}

// ---------- about & updates ----------

export interface VersionInfo {
  version: string;
  updateCheck: boolean;
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl: string;
  releaseNotes: string | null;
}

function AboutTab() {
  const { status } = useSession();
  const [v, setV] = useState<VersionInfo | null>(null);
  useEffect(() => {
    api.get<VersionInfo>('/version').then(setV).catch(() => setV(null));
  }, []);
  return (
    <>
      <Section title={status.appName} desc="Self-hosted project canvas with an MCP server and REST API for agents.">
        {!v ? (
          <Spinner />
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-ink/[0.06] px-2 py-0.5 font-mono text-xs">v{v.version}</span>
              {v.updateAvailable ? (
                <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent">v{v.latest} is available</span>
              ) : v.latest ? (
                <span className="text-muted">You're on the latest version.</span>
              ) : (
                <span className="text-muted">{v.updateCheck ? 'Checking for updates once a day.' : 'Update checks are off (UPDATE_CHECK=false).'}</span>
              )}
              <a href={v.releaseUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 font-medium text-accent">
                Release notes <ExternalLink size={13} />
              </a>
            </div>
            {v.releaseNotes && <pre className="scrollbar-thin max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-ink/[0.04] p-3 text-xs">{v.releaseNotes}</pre>}
          </div>
        )}
      </Section>
      <Section title="Updating" desc="Your data stays in the data volume. A backup is taken automatically before any database upgrade.">
        <div className="space-y-3">
          <CopyBlock label="Docker" text={`docker compose pull\ndocker compose up -d`} />
          <CopyBlock label="Node" text={`npm run update\n# then restart the server (e.g. systemctl restart taproot)`} />
        </div>
      </Section>
    </>
  );
}
