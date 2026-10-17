import { create } from 'zustand';
import { ACCENTS, DEFAULT_PREFERENCES, type Preferences, type User } from '@shared/types';
import { api } from './api';
import { setThemePref } from './theme';

// Preferences live on the user (so they follow you between devices) and are cached in
// localStorage so the first paint already uses them.

const KEY = 'taproot-prefs';
const LEGACY_KEY = 'cascade-prefs';

function readCache(): Partial<Preferences> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeCache(p: Preferences) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: preferences still apply for this session */
  }
}

function applyDocument(p: Preferences) {
  const root = document.documentElement.style;
  const a = ACCENTS[p.accent] ?? ACCENTS.indigo;
  root.setProperty('--accent-l', a.light);
  root.setProperty('--accent-d', a.dark);
}

interface PrefsState {
  prefs: Preferences;
  /** Merge the server copy in after sign-in. */
  hydrate: (user: User) => void;
  set: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  reset: () => void;
}

let saveTimer: number | undefined;
let pending: Partial<Preferences> = {};

function save(patch: Partial<Preferences>) {
  pending = { ...pending, ...patch };
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const prefs = pending;
    pending = {};
    api.patch('/me', { prefs }).catch(() => {
      /* offline: the local copy still applies and is sent with the next change */
      pending = { ...prefs, ...pending };
    });
  }, 400);
}

export const usePrefs = create<PrefsState>((set, get) => ({
  prefs: { ...DEFAULT_PREFERENCES, ...readCache() },

  hydrate(user) {
    const prefs = { ...DEFAULT_PREFERENCES, ...user.prefs };
    writeCache(prefs);
    applyDocument(prefs);
    if (user.prefs.theme) setThemePref(prefs.theme);
    set({ prefs });
  },

  set(key, value) {
    const prefs = { ...get().prefs, [key]: value };
    writeCache(prefs);
    applyDocument(prefs);
    if (key === 'theme') setThemePref(value as Preferences['theme']);
    set({ prefs });
    save({ [key]: value });
  },

  reset() {
    const prefs = { ...DEFAULT_PREFERENCES };
    writeCache(prefs);
    applyDocument(prefs);
    setThemePref(prefs.theme);
    set({ prefs });
    save(prefs);
  },
}));

applyDocument(usePrefs.getState().prefs);

const NEXT_THEME = { system: 'light', light: 'dark', dark: 'system' } as const;

/** System → light → dark → system. */
export function cycleTheme() {
  const p = usePrefs.getState();
  p.set('theme', NEXT_THEME[p.prefs.theme]);
}

export const pref = <K extends keyof Preferences>(key: K): Preferences[K] => usePrefs.getState().prefs[key];
