import type { TaskNode } from './types.js';
import type { Tree } from './tree.js';

export type DeadlineLevel = 'none' | 'upcoming' | 'soon' | 'today' | 'overdue';

export interface DeadlineInfo {
  level: DeadlineLevel;
  daysLeft: number | null;
  /** Short chip label, e.g. "in 2d", "today", "3d late". */
  label: string;
  /** Sentence shown on hover explaining why the node is highlighted. */
  explanation: string;
  /** Set when the highlight comes from a hidden or open sub-task rather than the node itself. */
  fromChild?: { id: string; title: string };
}

const DAY = 86_400_000;

export function todayISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseISODate(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
}

export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((parseISODate(toISO) - parseISODate(fromISO)) / DAY);
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const formatted = new Map<string, string>();

export function formatDate(iso: string): string {
  let s = formatted.get(iso);
  if (s === undefined) {
    s = dateFmt.format(parseISODate(iso));
    if (formatted.size > 2000) formatted.clear();
    formatted.set(iso, s);
  }
  return s;
}

const RANK: Record<DeadlineLevel, number> = { none: 0, upcoming: 1, soon: 2, today: 3, overdue: 4 };

export function ownDeadline(node: TaskNode, today: string, warnDays: number): DeadlineInfo {
  if (!node.dueDate) return { level: 'none', daysLeft: null, label: '', explanation: '' };
  const days = daysBetween(today, node.dueDate);
  const when = formatDate(node.dueDate);
  if (node.done) {
    return { level: 'none', daysLeft: days, label: when, explanation: `Was due ${when}. Done.` };
  }
  if (days < 0) {
    const n = -days;
    return {
      level: 'overdue',
      daysLeft: days,
      label: `${n}d late`,
      explanation: `Overdue: this was due ${when}, ${n} day${n === 1 ? '' : 's'} ago.`,
    };
  }
  if (days === 0) return { level: 'today', daysLeft: 0, label: 'today', explanation: `Due today (${when}).` };
  if (days <= warnDays) {
    return {
      level: 'soon',
      daysLeft: days,
      label: days === 1 ? 'tomorrow' : `in ${days}d`,
      explanation: `Due ${days === 1 ? 'tomorrow' : `in ${days} days`} (${when}). Highlighted because it is within the ${warnDays}-day warning window.`,
    };
  }
  return { level: 'upcoming', daysLeft: days, label: when, explanation: `Due ${when}, in ${days} days.` };
}

/**
 * Deadline state for a node, including pressure from open sub-tasks:
 * a node is highlighted if it, or anything still open beneath it, is close to its deadline.
 */
export function deadlineFor(tree: Tree, node: TaskNode, today: string, warnDays: number): DeadlineInfo {
  const own = ownDeadline(node, today, warnDays);
  if (node.done) return own;
  let worst: Worst = null;
  let open = 0;
  // Pre-order (visual order), so ties go to the first sub-task on screen.
  const walk = (id: string) => {
    for (const d of tree.children.get(id) ?? []) {
      if (!d.done) {
        open++;
        if (d.dueDate) worst = pickWorst(worst, d, ownDeadline(d, today, warnDays));
      }
      walk(d.id);
    }
  };
  walk(node.id);
  return combine(own, worst, open);
}

/** Deadline state for every node in one bottom-up pass (linear in tree size). */
export function allDeadlines(tree: Tree, today: string, warnDays: number): Map<string, DeadlineInfo> {
  const out = new Map<string, DeadlineInfo>();
  // Worst open descendant and open-descendant count, merged in pre-order to match deadlineFor.
  const visit = (node: TaskNode): { worst: Worst; open: number; own: DeadlineInfo } => {
    const own = ownDeadline(node, today, warnDays);
    let worst: Worst = null;
    let open = 0;
    for (const c of tree.children.get(node.id) ?? []) {
      const sub = visit(c);
      if (!c.done) {
        open += 1;
        if (c.dueDate) worst = pickWorst(worst, c, sub.own);
      }
      open += sub.open;
      if (sub.worst) worst = pickWorst(worst, sub.worst.node, sub.worst.info);
    }
    out.set(node.id, node.done ? own : combine(own, worst, open));
    // A done node's open descendants still count for its ancestors, as in deadlineFor.
    return { worst, open, own };
  };
  if (tree.root) visit(tree.root);
  return out;
}

type Worst = { info: DeadlineInfo; node: TaskNode } | null;

function pickWorst(worst: Worst, node: TaskNode, info: DeadlineInfo): Worst {
  if (RANK[info.level] < RANK.soon) return worst;
  if (!worst || RANK[info.level] > RANK[worst.info.level] || (info.daysLeft ?? 0) < (worst.info.daysLeft ?? 0)) return { info, node };
  return worst;
}

function combine(own: DeadlineInfo, worst: Worst, open: number): DeadlineInfo {
  if (!worst || RANK[worst.info.level] <= RANK[own.level]) {
    if (RANK[own.level] >= RANK.soon && open > 0) {
      return { ...own, explanation: `${own.explanation} ${open} sub-task${open === 1 ? ' is' : 's are'} still open.` };
    }
    return own;
  }
  const title = worst.node.title || 'Untitled';
  const lead =
    worst.info.level === 'overdue'
      ? `A sub-task is overdue: “${title}” was due ${formatDate(worst.node.dueDate!)}.`
      : worst.info.level === 'today'
        ? `A sub-task is due today: “${title}”.`
        : `A sub-task is due soon: “${title}” ${worst.info.label === 'tomorrow' ? 'tomorrow' : worst.info.label} (${formatDate(worst.node.dueDate!)}).`;
  return {
    level: worst.info.level,
    daysLeft: worst.info.daysLeft,
    label: own.level !== 'none' ? own.label : '',
    explanation: own.level !== 'none' ? `${own.explanation} ${lead}` : lead,
    fromChild: { id: worst.node.id, title },
  };
}

export function isHighlighted(level: DeadlineLevel): boolean {
  return level === 'soon' || level === 'today' || level === 'overdue';
}
