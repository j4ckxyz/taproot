import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export type MenuEntry =
  | {
      kind?: 'item';
      label: string;
      icon?: ReactNode;
      shortcut?: string;
      onSelect: () => void;
      disabled?: boolean;
      danger?: boolean;
      /** Keep the menu open after choosing (e.g. toggles you might press twice). */
      keepOpen?: boolean;
    }
  | { kind: 'separator' }
  | { kind: 'label'; label: string }
  /** A row of small buttons (colours, shapes). */
  | { kind: 'row'; label: string; buttons: { key: string; title: string; content: ReactNode; active?: boolean; onSelect: () => void }[] };

/**
 * Right-click menu. Opens at the pointer, stays on screen, closes on Esc, a click elsewhere,
 * scrolling or choosing an item. Arrow keys and Enter work like a native menu.
 */
export function ContextMenu({ x, y, entries, onClose }: { x: number; y: number; entries: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const items = entries.map((e, i) => ({ e, i })).filter(({ e }) => (e.kind ?? 'item') === 'item' && !(e as { disabled?: boolean }).disabled);
  const [active, setActive] = useState(-1);

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, y + r.height > window.innerHeight - 8 ? Math.max(8, y - r.height) : y),
    });
    el.focus();
  }, [x, y]);

  useEffect(() => {
    const close = (e: Event) => {
      if (e.type === 'pointerdown' && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('wheel', close, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('wheel', close, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [onClose]);

  const choose = (e: MenuEntry) => {
    if ((e.kind ?? 'item') !== 'item') return;
    const item = e as Extract<MenuEntry, { onSelect: () => void; label: string; keepOpen?: boolean }>;
    if (!item.keepOpen) onClose();
    item.onSelect();
  };

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      className="menu-enter fixed z-50 min-w-60 rounded-xl border border-line bg-panel p-1 text-[13px] shadow-2xl shadow-black/20 outline-none"
      style={pos}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') return e.preventDefault(), onClose();
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const d = e.key === 'ArrowDown' ? 1 : -1;
          setActive((a) => (a + d + items.length) % items.length);
        }
        if (e.key === 'Enter' && active >= 0) {
          e.preventDefault();
          choose(items[active].e);
        }
      }}
    >
      {entries.map((e, i) => {
        const kind = e.kind ?? 'item';
        if (kind === 'separator') return <div key={i} className="mx-2 my-1 h-px bg-line" />;
        if (kind === 'label') return <div key={i} className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{(e as { label: string }).label}</div>;
        if (kind === 'row') {
          const row = e as Extract<MenuEntry, { kind: 'row' }>;
          return (
            <div key={i} className="flex items-center justify-between gap-3 px-2.5 py-1.5">
              <span className="text-muted">{row.label}</span>
              <span className="flex gap-1">
                {row.buttons.map((b) => (
                  <button
                    key={b.key}
                    title={b.title}
                    aria-label={b.title}
                    onClick={() => {
                      onClose();
                      b.onSelect();
                    }}
                    className={`grid h-6 min-w-6 place-items-center rounded-md transition hover:bg-ink/[0.07] ${b.active ? 'bg-accent-soft text-accent ring-1 ring-accent/40' : ''}`}
                  >
                    {b.content}
                  </button>
                ))}
              </span>
            </div>
          );
        }
        const item = e as Extract<MenuEntry, { onSelect: () => void; label: string }>;
        const idx = items.findIndex((x) => x.i === i);
        return (
          <button
            key={i}
            role="menuitem"
            disabled={item.disabled}
            onPointerEnter={() => setActive(idx)}
            onClick={() => choose(item)}
            className={`flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors disabled:opacity-35 ${
              idx === active && !item.disabled ? (item.danger ? 'bg-danger/10 text-danger' : 'bg-ink/[0.06]') : ''
            } ${item.danger ? 'text-danger' : ''}`}
          >
            <span className="grid w-4 place-items-center text-muted">{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            {item.shortcut && <span className="text-[11px] text-muted">{item.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}
