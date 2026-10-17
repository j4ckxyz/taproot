import { create } from 'zustand';
import type { ChangeEvent, Op, Presence, Project, ProjectDoc, TaskNode } from '@shared/types';
import { buildTree, checkPlacement, depthOf } from '@shared/tree';
import { api, ApiError, projectsApi } from './api';
import { pref } from './prefs';
import { applyLocal } from './ops';

function lockedToast(get: () => { toast: (msg: string, tone?: 'info' | 'error' | 'agent') => void }) {
  get().toast('The canvas is locked. Press Shift+L or use the lock button to edit.', 'info');
}

export const clientId = Math.random().toString(36).slice(2);

/** A stable colour per person or agent, used for cursors, pulses and avatars. */
const PRESENCE_COLORS = ['#6366f1', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6', '#22c55e', '#0ea5e9', '#eab308'];
export function presenceColor(key: string): string {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PRESENCE_COLORS[h % PRESENCE_COLORS.length];
}

export type DetailField = 'title' | 'notes' | 'tags' | 'due';

interface HistoryEntry {
  undo: Op[];
  redo: Op[];
  selection: string | null;
}

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error' | 'agent';
}

interface State {
  project: Project | null;
  nodes: Map<string, TaskNode>;
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  editingId: string | null;
  /** A just-created node: if its first edit is left empty, it's removed. */
  freshId: string | null;
  /** Unsaved text of the card being edited, so it can grow (and push neighbours) as you type. */
  draft: { id: string; title: string } | null;
  setDraft: (title: string) => void;
  /** Asks the details panel to focus one of its fields (keyboard shortcuts). */
  focusField: { field: DetailField; n: number } | null;
  /** Ids that were just checked off, to play the check animation once. */
  justDone: Set<string>;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  saving: number;
  online: boolean;
  toasts: Toast[];
  /** Other tabs, people and agents on this project right now. */
  presence: Presence[];
  /** Cards someone else just changed, to pulse briefly in their colour. */
  flashes: { id: string; color: string; n: number }[];
  /** Bumped on every change, so open activity views can refresh. */
  activityRev: number;

  load: (id: string) => Promise<void>;
  unload: () => void;
  select: (id: string | null) => void;
  edit: (id: string | null) => void;
  apply: (ops: Op[], opts?: { record?: boolean; select?: string | null }) => boolean;
  undo: () => void;
  redo: () => void;
  updateProject: (patch: Partial<Project>) => Promise<void>;
  toast: (text: string, tone?: Toast['tone']) => void;
  canAddChild: (parentId: string) => string | null;
}

let es: EventSource | null = null;
let queue: Promise<unknown> = Promise.resolve();
let toastId = 0;

export const useProject = create<State>((set, get) => ({
  project: null,
  nodes: new Map(),
  loading: false,
  error: null,
  selectedId: null,
  editingId: null,
  freshId: null,
  draft: null,
  setDraft: (title) => {
    const id = get().editingId;
    if (id) set({ draft: { id, title } });
  },
  focusField: null,
  justDone: new Set(),
  undoStack: [],
  redoStack: [],
  saving: 0,
  online: true,
  toasts: [],
  presence: [],
  flashes: [],
  activityRev: 0,

  async load(id) {
    get().unload();
    set({ loading: true, error: null });
    try {
      const doc = await projectsApi.get(id);
      setDoc(doc);
      connect(id);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false });
    }
  },

  unload() {
    const pid = get().project?.id;
    if (pid) announce(pid, null, true);
    es?.close();
    es = null;
    set({
      project: null,
      nodes: new Map(),
      selectedId: null,
      editingId: null,
      draft: null,
      undoStack: [],
      redoStack: [],
      freshId: null,
      justDone: new Set(),
      presence: [],
      flashes: [],
    });
  },

  select: (id) => set({ selectedId: id }),
  edit: (id) => {
    if (id && pref('lockCanvas')) return lockedToast(get);
    set({ editingId: id, draft: null, ...(id ? { selectedId: id } : {}) });
  },

  apply(ops, opts = {}) {
    const { project, nodes, selectedId } = get();
    if (!project || !ops.length) return false;
    // A locked canvas still allows checking things off.
    if (pref('lockCanvas') && !ops.every((o) => o.op === 'update' && Object.keys(o.patch).every((k) => k === 'done' || k === 'collapsed'))) {
      lockedToast(get);
      return false;
    }
    const { nodes: next, inverse } = applyLocal(nodes, ops, project.id);
    const justDone = new Set<string>();
    for (const op of ops) if (op.op === 'update' && op.patch.done === true) justDone.add(op.id);
    set({
      nodes: next,
      ...(justDone.size ? { justDone } : {}),
      ...(opts.select !== undefined ? { selectedId: opts.select } : {}),
    });
    // The check-off burst lasts ~650ms; afterwards the node draws its static badge again.
    if (justDone.size) setTimeout(() => get().justDone === justDone && set({ justDone: new Set() }), 700);
    if (opts.record !== false) {
      set((s) => ({
        undoStack: [...s.undoStack.slice(-199), { undo: inverse, redo: ops, selection: selectedId }],
        redoStack: [],
      }));
    }
    send(project.id, ops);
    return true;
  },

  undo() {
    const s = get();
    const entry = s.undoStack[s.undoStack.length - 1];
    if (!entry) return;
    const sel = s.selectedId;
    set({ undoStack: s.undoStack.slice(0, -1), editingId: null });
    get().apply(entry.undo, { record: false, select: entry.selection && get().nodes.has(entry.selection) ? entry.selection : sel });
    set((st) => ({ redoStack: [...st.redoStack, entry] }));
    if (get().selectedId && !get().nodes.has(get().selectedId!)) set({ selectedId: null });
  },

  redo() {
    const s = get();
    const entry = s.redoStack[s.redoStack.length - 1];
    if (!entry) return;
    set({ redoStack: s.redoStack.slice(0, -1), editingId: null });
    get().apply(entry.redo, { record: false });
    set((st) => ({ undoStack: [...st.undoStack, entry] }));
    if (get().selectedId && !get().nodes.has(get().selectedId!)) set({ selectedId: null });
  },

  async updateProject(patch) {
    const p = get().project;
    if (!p) return;
    set({ project: { ...p, ...patch, settings: { ...p.settings, ...(patch.settings ?? {}) } } });
    try {
      const res = await fetch(`/api/v1/projects/${p.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-taproot-client': '1', 'x-client-id': clientId },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json()).error?.message ?? 'Could not save project');
      const { project } = await res.json();
      set({ project });
    } catch (e) {
      get().toast(e instanceof Error ? e.message : 'Could not save project', 'error');
    }
  },

  toast(text, tone = 'info') {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, tone }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), tone === 'error' ? 6000 : 3500);
  },

  canAddChild(parentId) {
    const { project, nodes } = get();
    if (!project) return 'No project';
    return checkPlacement(buildTree(nodes.values()), project.settings, parentId);
  },
}));

function setDoc(doc: ProjectDoc) {
  useProject.setState({
    project: doc.project,
    nodes: new Map(doc.nodes.map((n) => [n.id, n])),
    loading: false,
    error: null,
  });
}

function send(projectId: string, ops: Op[]) {
  useProject.setState((s) => ({ saving: s.saving + 1 }));
  queue = queue
    .then(() => api.post<{ version: number; upserted: TaskNode[] }>(`/projects/${projectId}/ops`, { ops, clientId }))
    .then((r) => {
      const st = useProject.getState();
      const p = st.project;
      if (!p || p.id !== projectId) return;
      if (r.version > p.version) useProject.setState({ project: { ...p, version: r.version } });
      // Once nothing else is in flight, take the server's copy of what we just wrote. This repairs
      // the rare case where someone else's change arrived between our optimistic edit and its save.
      if (st.saving === 1 && r.upserted.length) {
        const nodes = new Map(st.nodes);
        let changed = false;
        for (const n of r.upserted) {
          const cur = nodes.get(n.id);
          if (cur && cur.updatedAt !== n.updatedAt) {
            nodes.set(n.id, { ...n, title: st.draft?.id === n.id ? cur.title : n.title });
            changed = true;
          }
        }
        if (changed) useProject.setState({ nodes });
      }
      useProject.setState((s) => ({ online: true, activityRev: s.activityRev + 1 }));
    })
    .catch(async (e) => {
      const st = useProject.getState();
      if (e instanceof ApiError) {
        st.toast(e.message, 'error');
      } else {
        useProject.setState({ online: false });
        st.toast('Could not reach the server. Your last change was not saved.', 'error');
      }
      // Re-sync with the server's truth.
      try {
        const doc = await projectsApi.get(projectId);
        if (useProject.getState().project?.id === projectId) {
          const sel = useProject.getState().selectedId;
          setDoc(doc);
          if (sel && !doc.nodes.some((n) => n.id === sel)) useProject.setState({ selectedId: null });
        }
      } catch {
        /* still offline */
      }
    })
    .finally(() => useProject.setState((s) => ({ saving: s.saving - 1 })));
}

let flashSeq = 0;
let heartbeat: number | undefined;
let lastSent = '';

/** Tells the server which card this tab has selected (debounced), and that the tab is still here. */
function announce(projectId: string, nodeId: string | null, leave = false) {
  const key = `${projectId}:${nodeId}:${leave}`;
  if (key === lastSent && !leave) return;
  lastSent = key;
  fetch(`/api/v1/projects/${projectId}/presence`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-taproot-client': '1' },
    body: JSON.stringify({ clientId, nodeId, leave }),
    keepalive: leave,
  }).catch(() => {
    /* presence is best effort */
  });
}

let announceTimer: number | undefined;
useProject.subscribe((s, prev) => {
  if (!s.project) return;
  if (s.selectedId !== prev.selectedId || s.project.id !== prev.project?.id) {
    window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => announce(s.project!.id, s.selectedId), 120);
  }
});
window.addEventListener('pagehide', () => {
  const p = useProject.getState().project;
  if (p) announce(p.id, null, true);
});

function connect(projectId: string) {
  window.clearInterval(heartbeat);
  lastSent = '';
  announce(projectId, useProject.getState().selectedId);
  heartbeat = window.setInterval(() => {
    const st = useProject.getState();
    if (st.project?.id !== projectId) return window.clearInterval(heartbeat);
    lastSent = '';
    announce(projectId, st.selectedId);
  }, 15_000);
  es = new EventSource(`/api/v1/projects/${projectId}/events`);
  let first = true;
  es.addEventListener('hello', async (ev) => {
    useProject.setState({ online: true });
    const { version } = JSON.parse((ev as MessageEvent).data);
    // After a reconnect, refetch if anything changed while we were away.
    if (!first && version !== useProject.getState().project?.version) {
      const doc = await projectsApi.get(projectId);
      if (useProject.getState().project?.id === projectId) setDoc(doc);
    }
    first = false;
  });
  es.addEventListener('presence', (ev) => {
    const list = JSON.parse((ev as MessageEvent).data) as Presence[];
    useProject.setState({ presence: list.filter((p) => p.clientId !== clientId) });
  });
  es.addEventListener('change', (ev) => {
    const e = JSON.parse((ev as MessageEvent).data) as ChangeEvent;
    const st = useProject.getState();
    if (!st.project || st.project.id !== e.projectId) return;
    if (e.clientId === clientId) return;
    // Pulse what changed in the colour of whoever changed it.
    const color = presenceColor(e.actor.key);
    const changed = [...new Set([...(e.focusId ? [e.focusId] : []), ...e.upserted.map((n) => n.id)])].slice(0, 12);
    const flashes = changed.map((id) => ({ id, color, n: ++flashSeq }));
    useProject.setState((s) => ({ flashes: [...s.flashes.filter((f) => !changed.includes(f.id)), ...flashes], activityRev: s.activityRev + 1 }));
    setTimeout(() => useProject.setState((s) => ({ flashes: s.flashes.filter((f) => !flashes.includes(f)) })), 1600);
    const nodes = new Map(st.nodes);
    for (const n of e.upserted) nodes.set(n.id, n);
    for (const id of e.deleted) nodes.delete(id);
    useProject.setState({
      nodes,
      project: e.project ?? { ...st.project, version: e.version },
      ...(st.selectedId && e.deleted.includes(st.selectedId) ? { selectedId: null } : {}),
      ...(st.editingId && e.deleted.includes(st.editingId) ? { editingId: null, draft: null } : {}),
    });
    if (e.actor.kind === 'token' && e.summary) st.toast(`${e.actor.name}: ${e.summary}`, 'agent');
  });
  es.onerror = () => useProject.setState({ online: false });
}

export function useDepth(id: string | null): number {
  const nodes = useProject((s) => s.nodes);
  if (!id) return 0;
  return depthOf(buildTree(nodes.values()), id);
}
