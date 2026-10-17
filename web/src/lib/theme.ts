import { useEffect, useSyncExternalStore } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'taproot-theme';
const LEGACY_KEY = 'cascade-theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

let pref = readPref();

function apply() {
  const dark = pref === 'dark' || (pref === 'system' && media.matches);
  document.documentElement.classList.toggle('dark', dark);
  listeners.forEach((l) => l());
}

media.addEventListener('change', apply);

export function setThemePref(p: ThemePref) {
  pref = p;
  try {
    localStorage.removeItem(LEGACY_KEY);
    if (p === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, p);
  } catch {
    /* storage unavailable: still applies for this session */
  }
  apply();
}

export function cycleTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  // From system, flip to the opposite of what's showing; then alternate; long-press-free way back to system lives in the menu.
  setThemePref(isDark ? 'light' : 'dark');
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useTheme(): { pref: ThemePref; resolved: 'light' | 'dark' } {
  const resolved = useSyncExternalStore(subscribe, () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
  const p = useSyncExternalStore(subscribe, () => pref);
  return { pref: p, resolved };
}

export function useApplyTheme() {
  useEffect(() => apply(), []);
}
