import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePref } from '../lib/theme';
import { usePrefs } from '../lib/prefs';

const NEXT: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<ThemePref, string> = { system: 'Theme: follow system', light: 'Theme: light', dark: 'Theme: dark' };

/** Cycles system → light → dark; the choice is saved to your account. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { pref } = useTheme();
  const Icon = pref === 'system' ? Monitor : pref === 'light' ? Sun : Moon;
  return (
    <button
      onClick={() => usePrefs.getState().set('theme', NEXT[pref])}
      title={`${LABEL[pref]} (click to change)`}
      aria-label={LABEL[pref]}
      className={`grid h-8 w-8 place-items-center rounded-lg text-ink/70 transition hover:bg-ink/[0.06] hover:text-ink ${className}`}
    >
      <Icon size={17} />
    </button>
  );
}
