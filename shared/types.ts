// Types shared by the server, the web client and exporters.

export const SHAPES = ['rounded', 'rect', 'ellipse', 'diamond', 'text'] as const;
export type Shape = (typeof SHAPES)[number];

/** How a node's children are arranged: spread out below it, or stacked down its right side. */
export const CHILD_LAYOUTS = ['row', 'column'] as const;
export type ChildLayout = (typeof CHILD_LAYOUTS)[number];

// stroke/fill: light theme border and tint. dark/darkStroke: dark theme. solid: filled root node.
export const PALETTE = {
  slate: { stroke: '#64748b', fill: '#f8fafc', dark: '#1d2127', darkStroke: '#94a3b8', solid: '#334155' },
  red: { stroke: '#ef4444', fill: '#fef2f2', dark: '#2a1b1d', darkStroke: '#f87171', solid: '#dc2626' },
  orange: { stroke: '#f97316', fill: '#fff7ed', dark: '#2a1f18', darkStroke: '#fb923c', solid: '#ea580c' },
  yellow: { stroke: '#eab308', fill: '#fefce8', dark: '#28251a', darkStroke: '#facc15', solid: '#ca8a04' },
  green: { stroke: '#22c55e', fill: '#f0fdf4', dark: '#17261d', darkStroke: '#4ade80', solid: '#16a34a' },
  teal: { stroke: '#14b8a6', fill: '#f0fdfa', dark: '#152624', darkStroke: '#2dd4bf', solid: '#0d9488' },
  blue: { stroke: '#3b82f6', fill: '#eff6ff', dark: '#172033', darkStroke: '#60a5fa', solid: '#2563eb' },
  violet: { stroke: '#8b5cf6', fill: '#f5f3ff', dark: '#211b33', darkStroke: '#a78bfa', solid: '#7c3aed' },
  pink: { stroke: '#ec4899', fill: '#fdf2f8', dark: '#2b1824', darkStroke: '#f472b6', solid: '#db2777' },
} as const;
export type ColorName = keyof typeof PALETTE;
export const COLOR_NAMES = Object.keys(PALETTE) as ColorName[];

export interface ProjectSettings {
  /** Deepest level below the root that nodes can be added at (root is depth 0). */
  maxDepth: number;
  /** Most children any single node may have. */
  maxChildren: number;
  /** Days before a deadline when a node starts to be highlighted. */
  warnDays: number;
}

export const DEFAULT_SETTINGS: ProjectSettings = { maxDepth: 6, maxChildren: 12, warnDays: 3 };
export const LIMITS = { maxDepth: 10, maxChildren: 30, warnDays: 60 } as const;

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  icon: string;
  color: ColorName;
  description: string;
  settings: ProjectSettings;
  archived: boolean;
  rootId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary extends Project {
  total: number;
  done: number;
  nextDue: string | null;
}

export interface TaskNode {
  id: string;
  projectId: string;
  parentId: string | null;
  /** Fractional order among siblings. */
  sort: number;
  title: string;
  notes: string;
  shape: Shape;
  color: ColorName | null;
  childLayout: ChildLayout;
  collapsed: boolean;
  done: boolean;
  doneAt: string | null;
  /** ISO date (YYYY-MM-DD). */
  startDate: string | null;
  /** ISO date (YYYY-MM-DD). */
  dueDate: string | null;
  tags: string[];
  /** Free-form key/value metadata. */
  meta: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export type NodePatch = Partial<
  Pick<
    TaskNode,
    | 'title' | 'notes' | 'shape' | 'color' | 'childLayout' | 'collapsed' | 'done'
    | 'startDate' | 'dueDate' | 'tags' | 'meta' | 'parentId' | 'sort'
  >
>;

export type Op =
  | { op: 'create'; node: Partial<TaskNode> & { parentId: string; title?: string; id?: string } }
  | { op: 'update'; id: string; patch: NodePatch }
  | { op: 'delete'; id: string };

export interface ProjectDoc {
  project: Project;
  nodes: TaskNode[];
}

/** Event pushed to connected clients over SSE when a project changes. */
export interface ChangeEvent {
  projectId: string;
  version: number;
  clientId: string | null;
  /** `key` identifies the person or agent across events (user:<id> or token:<id>). */
  actor: { kind: 'user' | 'token'; name: string; key: string };
  upserted: TaskNode[];
  deleted: string[];
  project?: Project;
  /** Human-readable description, as written to the activity log. */
  summary?: string;
  /** The card the change was mostly about, for cursors and "jump to". */
  focusId?: string | null;
}

/** Someone (a browser tab or an agent) currently looking at a project. */
export interface Presence {
  key: string;
  /** Browser tab id, or null for agents. */
  clientId: string | null;
  userId: string;
  name: string;
  kind: 'user' | 'agent';
  /** Selected card (people) or last card touched (agents). */
  nodeId: string | null;
  /** What an agent is doing, e.g. "editing" or "reading". */
  doing: string | null;
  at: number;
}

export interface ActivityEntry {
  id: number;
  actor: string;
  tokenId: string | null;
  summary: string;
  at: string;
  nodeId: string | null;
}

export interface User {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  createdAt: string;
  /** Per-user UI preferences, synced across devices. Missing keys use DEFAULT_PREFERENCES. */
  prefs: Partial<Preferences>;
}

export const ACCENTS = {
  indigo: { light: '#4f46e5', dark: '#818cf8' },
  blue: { light: '#2563eb', dark: '#60a5fa' },
  violet: { light: '#7c3aed', dark: '#a78bfa' },
  teal: { light: '#0d9488', dark: '#2dd4bf' },
  green: { light: '#16a34a', dark: '#4ade80' },
  orange: { light: '#ea580c', dark: '#fb923c' },
  pink: { light: '#db2777', dark: '#f472b6' },
  graphite: { light: '#3f3f46', dark: '#d4d4d8' },
} as const;
export type AccentName = keyof typeof ACCENTS;

export interface Preferences {
  theme: 'system' | 'light' | 'dark';
  accent: AccentName;
  /** Canvas backdrop. */
  background: 'dots' | 'grid' | 'plain';
  /** Backdrop spacing in canvas pixels at 100% zoom. */
  gridSize: number;
  /** Zoom moves between fixed steps (25%, 50%, 75%, 100%…) instead of smoothly. */
  snapZoom: boolean;
  /** View-only canvas: no adding, editing, moving or deleting. Checking off still works. */
  lockCanvas: boolean;
  doneStyle: 'fade' | 'faint' | 'solid';
  /** Burst animation when checking something off. */
  celebrate: boolean;
  /** Cards spring into place and the camera glides. Off also when the OS asks for reduced motion. */
  motion: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  accent: 'indigo',
  background: 'dots',
  gridSize: 24,
  snapZoom: false,
  lockCanvas: false,
  doneStyle: 'fade',
  celebrate: true,
  motion: true,
};

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  canWrite: boolean;
  /** null = every project the user owns. */
  projectIds: string[] | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}
