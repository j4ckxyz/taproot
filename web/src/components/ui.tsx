import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { PALETTE, COLOR_NAMES, type ColorName } from '@shared/types';
import { useTheme } from '../lib/theme';

export function Button({
  variant = 'default',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'md' }) {
  const v = {
    default: 'border border-line bg-panel shadow-xs hover:bg-ink/[0.03]',
    primary: 'bg-accent text-white shadow-sm shadow-accent/20 hover:brightness-110 dark:text-[#111214]',
    ghost: 'hover:bg-ink/5',
    danger: 'border border-danger/30 text-danger hover:bg-danger/10',
  }[variant];
  const s = size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-9 px-3.5 text-sm';
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${v} ${s} ${className}`}
    />
  );
}

export function IconButton({
  label,
  active,
  className = '',
  children,
  shortcut,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; shortcut?: string }) {
  return (
    <button
      {...props}
      aria-label={label}
      title={shortcut ? `${label} — ${shortcut}` : label}
      className={`grid h-8 w-8 place-items-center rounded-lg transition disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-accent ${
        active ? 'bg-accent-soft text-accent' : 'text-ink/70 hover:bg-ink/[0.06] hover:text-ink'
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function Input({ className = '', ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      {...props}
      className={`h-9 ${/(^|\s)w-/.test(className) ? '' : 'w-full'} rounded-lg border border-line bg-panel px-3 text-sm shadow-xs outline-none transition placeholder:text-muted/70 focus:border-accent focus:ring-3 focus:ring-accent/15 ${className}`}
    />
  );
}

export function Textarea({ className = '', ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm shadow-xs outline-none transition placeholder:text-muted/70 focus:border-accent focus:ring-3 focus:ring-accent/15 ${className}`}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? 'bg-accent' : 'bg-ink/15'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${checked ? 'left-4.5' : 'left-0.5'}`} />
    </button>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // showModal() focuses the first focusable element (the close button); prefer the first field.
      (d.querySelector<HTMLElement>('[data-autofocus]') ?? d.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), textarea, select'))?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      onKeyDown={(e) => e.stopPropagation()}
      className={`m-auto w-[calc(100%-32px)] ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-2xl border border-line bg-panel p-0 text-ink shadow-2xl backdrop:bg-black/40 backdrop:backdrop-blur-sm`}
    >
      {open && (
        <div className="p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            <IconButton label="Close" onClick={onClose}>
              <X size={18} />
            </IconButton>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function Swatches({
  value,
  onChange,
  allowNone,
  noneLabel = 'Inherit',
}: {
  value: ColorName | null;
  onChange: (c: ColorName | null) => void;
  allowNone?: boolean;
  noneLabel?: string;
}) {
  const { resolved } = useTheme();
  return (
    <div className="flex flex-wrap gap-1.5">
      {allowNone && (
        <button
          type="button"
          title={noneLabel}
          aria-label={noneLabel}
          onClick={() => onChange(null)}
          className={`h-6 w-6 rounded-full border-2 border-dashed border-ink/20 ${value === null ? 'ring-2 ring-accent ring-offset-2 ring-offset-panel' : ''}`}
        />
      )}
      {COLOR_NAMES.map((c, i) => (
        <button
          type="button"
          key={c}
          title={`${c} (${i + 1})`}
          aria-label={c}
          onClick={() => onChange(c)}
          className={`h-6 w-6 rounded-full transition hover:scale-110 ${value === c ? 'ring-2 ring-accent ring-offset-2 ring-offset-panel' : ''}`}
          style={{ background: resolved === 'light' ? PALETTE[c].stroke : PALETTE[c].darkStroke }}
        />
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-line bg-paper px-1.5 py-0.5 font-sans text-[11px] font-medium text-muted shadow-xs">{children}</kbd>;
}

export function Spinner() {
  return <div className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-accent" />;
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';

/** A row of mutually exclusive options, like a native segmented control. */
export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-ink/[0.06] p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition ${
            value === o.value ? 'bg-panel text-ink shadow-sm' : 'text-muted hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Taproot mark: a sprout above the soil line and a root running deep, with side roots.
 * One idea at the top, the work flowing down and branching out. Tinted with the accent colour.
 */
export function Logo({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="taproot-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'color-mix(in srgb, var(--accent) 78%, white)' }} />
          <stop offset="1" style={{ stopColor: 'color-mix(in srgb, var(--accent) 85%, black)' }} />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#taproot-logo)" />
      <g fill="#fff">
        <path d="M16 12c-.2-2.6-2.1-4.6-5-4.8.1 2.8 2.1 4.7 5 4.8Z" />
        <path d="M16 12c.2-3.2 2.4-5.6 5.8-5.8-.1 3.3-2.5 5.6-5.8 5.8Z" />
        <path d="M14.5 13h3l-1.15 13.1a.35.35 0 0 1-.7 0Z" />
      </g>
      <path d="M7.5 13h17" stroke="#fff" strokeWidth={2} strokeLinecap="round" opacity={0.55} />
      <g fill="none" stroke="#fff" strokeWidth={1.4} strokeLinecap="round" opacity={0.9}>
        <path d="M15.7 16.4c-.6 1.4-2.2 2.1-4.6 2.3" />
        <path d="M16.3 19.4c.6 1.2 2.1 1.8 4.4 1.9" />
        <path d="M15.8 22.6c-.4.9-1.4 1.3-2.8 1.5" />
      </g>
    </svg>
  );
}
