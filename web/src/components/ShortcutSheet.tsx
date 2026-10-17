import { useEffect } from 'react';
import type { ShortcutGroup } from '../lib/shortcuts';

/**
 * Keyboard cheat sheet. `?` opens it; Esc, `?` again or a click anywhere closes it.
 * It sits above everything and swallows the closing click so nothing underneath reacts.
 */
export function ShortcutSheet({ open, onClose, groups }: { open: boolean; onClose: () => void; groups: ShortcutGroup[] }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      className="sheet-enter fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-[2px]"
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="scrollbar-thin max-h-full w-full max-w-4xl overflow-y-auto rounded-2xl border border-line bg-panel p-5 shadow-2xl sm:p-6">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-tight">Keyboard shortcuts</h2>
          <span className="text-xs text-muted">Esc or click anywhere to close</span>
        </div>
        <div className="columns-1 gap-8 sm:columns-2 lg:columns-3">
          {groups.map((g) => (
            <section key={g.title} className="mb-5 break-inside-avoid">
              <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">{g.title}</h3>
              <ul className="space-y-1.5">
                {g.items.map((s) => (
                  <li key={s.label} className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="text-ink/85">{s.label}</span>
                    <span className="flex shrink-0 gap-1">
                      {s.keys.map((k) => (
                        <kbd
                          key={k}
                          className="min-w-[22px] rounded-md border border-line bg-paper px-1.5 py-0.5 text-center font-sans text-[11px] font-medium text-muted shadow-[0_1px_0_var(--line)]"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
