// Every keyboard shortcut, in one place. The `?` sheet and the README are written from this list,
// so keep it in step with the key handlers in the pages.

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD_KEY = isMac ? '⌘' : 'Ctrl';
export const ALT_KEY = isMac ? '⌥' : 'Alt';

export interface Shortcut {
  keys: string[];
  label: string;
}
export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

const M = MOD_KEY;
const A = ALT_KEY;

export const PROJECT_SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Cards',
    items: [
      { keys: ['Enter'], label: 'Rename (or F2, E, double-click)' },
      { keys: ['Tab'], label: 'Add a sub-task' },
      { keys: ['⇧', 'Tab'], label: 'Add a card below' },
      { keys: ['⇧', 'Enter'], label: 'Add a card above' },
      { keys: ['X'], label: `Check off / reopen (or ${M} Enter)` },
      { keys: ['Delete'], label: 'Delete with everything below' },
      { keys: [M, 'D'], label: 'Duplicate' },
      { keys: [M, 'C'], label: 'Copy (then X cut, V paste)' },
      { keys: [M, 'Z'], label: `Undo (${M} ⇧ Z redo)` },
    ],
  },
  {
    title: 'While typing',
    items: [
      { keys: ['Enter'], label: 'Save' },
      { keys: ['⇧', 'Enter'], label: 'New line' },
      { keys: ['Tab'], label: 'Save and add a sub-task' },
      { keys: ['⇧', 'Tab'], label: 'Save and add a card below' },
      { keys: ['Esc'], label: 'Save (an empty new card is dropped)' },
    ],
  },
  {
    title: 'Details',
    items: [
      { keys: ['I'], label: 'Details panel' },
      { keys: ['N'], label: 'Write notes' },
      { keys: ['#'], label: 'Add a tag' },
      { keys: ['⇧', 'D'], label: 'Pick a due date' },
      { keys: [A, '1'], label: 'Due today' },
      { keys: [A, '2'], label: 'Due tomorrow' },
      { keys: [A, '3'], label: 'Due in a week' },
      { keys: [A, '0'], label: 'Clear the due date' },
    ],
  },
  {
    title: 'Style',
    items: [
      { keys: ['R'], label: 'Card (again for square corners)' },
      { keys: ['O'], label: 'Pill' },
      { keys: ['D'], label: 'Milestone' },
      { keys: ['T'], label: 'Text only' },
      { keys: ['1–9'], label: 'Colour (0 inherits)' },
      { keys: ['L'], label: 'Branches side by side / as a list' },
      { keys: ['C'], label: 'Collapse / expand' },
      { keys: ['⇧', 'C'], label: 'Collapse / expand everything' },
    ],
  },
  {
    title: 'Move around',
    items: [
      { keys: ['←', '↑', '→', '↓'], label: 'Select the next card' },
      { keys: [A, '↑', '↓'], label: 'Reorder' },
      { keys: [A, '←'], label: 'Move out a level' },
      { keys: [A, '→'], label: 'Move into the card above' },
      { keys: ['/'], label: `Find a card (or ${M} F)` },
      { keys: [M, 'A'], label: 'Select the central idea' },
      { keys: ['Esc'], label: 'Deselect' },
    ],
  },
  {
    title: 'View',
    items: [
      { keys: ['Space', 'drag'], label: 'Pan (or scroll)' },
      { keys: [M, '+', '−'], label: `Zoom (or ${M} scroll, pinch)` },
      { keys: [M, '0'], label: 'Zoom to 100%' },
      { keys: ['⇧', '1'], label: 'Fit everything' },
      { keys: ['⇧', '2'], label: 'Zoom to the selection' },
      { keys: ['⇧', 'L'], label: 'Lock / unlock the canvas' },
      { keys: [A, '⇧', 'D'], label: 'Switch theme' },
    ],
  },
  {
    title: 'Project',
    items: [
      { keys: ['P'], label: 'Project name, colour and limits' },
      { keys: ['H'], label: 'Activity history' },
      { keys: ['⇧', 'E'], label: 'Export' },
      { keys: [M, ','], label: 'Settings' },
      { keys: ['G'], label: 'Back to all projects' },
      { keys: ['?'], label: 'This sheet' },
    ],
  },
];

export const HOME_SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Projects',
    items: [
      { keys: ['N'], label: 'New project' },
      { keys: ['1–9'], label: 'Open a project' },
      { keys: ['/'], label: 'Filter projects' },
      { keys: ['U'], label: 'Import (JSON, Markdown, OPML)' },
      { keys: ['A'], label: 'Show / hide archived' },
    ],
  },
  {
    title: 'App',
    items: [
      { keys: [M, ','], label: 'Settings' },
      { keys: [A, '⇧', 'D'], label: 'Switch theme' },
      { keys: ['?'], label: 'This sheet' },
    ],
  },
];

export const SETTINGS_SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Settings',
    items: [
      { keys: ['Esc'], label: 'Back' },
      { keys: ['['], label: 'Previous tab' },
      { keys: [']'], label: 'Next tab' },
      { keys: [A, '⇧', 'D'], label: 'Switch theme' },
      { keys: ['?'], label: 'This sheet' },
    ],
  },
];

/** True when a key event comes from somewhere the user is typing. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t?.closest?.('input,textarea,select,[contenteditable],dialog[open]');
}

/** The theme shortcut is the same everywhere. */
export function isThemeKey(e: KeyboardEvent): boolean {
  return e.altKey && e.shiftKey && e.code === 'KeyD';
}
