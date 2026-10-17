import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { TaskNode } from '@shared/types';
import { useProject } from '../lib/projectStore';

/** `/` palette: type to find a card, Enter selects it and the view glides there. */
export function FindCard({ onClose, onPick }: { onClose: () => void; onPick: (id: string) => void }) {
  const nodes = useProject((s) => s.nodes);
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);

  const results = useMemo(() => {
    const path = (n: TaskNode) => {
      const parts: string[] = [];
      for (let p = n.parentId ? nodes.get(n.parentId) : undefined; p && p.parentId; p = p.parentId ? nodes.get(p.parentId) : undefined) {
        parts.unshift(p.title || 'Untitled');
      }
      return parts.join(' › ');
    };
    const needle = q.trim().toLowerCase();
    const all = [...nodes.values()];
    const hits = needle
      ? all
          .map((n) => ({ n, at: (n.title || 'untitled').toLowerCase().indexOf(needle), tag: n.tags.some((t) => t.toLowerCase().includes(needle)) }))
          .filter((h) => h.at >= 0 || h.tag)
          .sort((a, b) => (a.at < 0 ? 99 : a.at) - (b.at < 0 ? 99 : b.at) || Number(a.n.done) - Number(b.n.done))
          .map((h) => h.n)
      : all.filter((n) => !n.done && n.parentId);
    return hits.slice(0, 8).map((n) => ({ n, path: path(n) }));
  }, [nodes, q]);

  const pick = (id: string | undefined) => {
    if (id) onPick(id);
    onClose();
  };

  return (
    <div className="sheet-enter fixed inset-0 z-50 flex justify-center bg-black/20 px-4 pt-[14vh]" onPointerDown={onClose}>
      <div className="h-fit w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl" onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search size={16} className="text-muted" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setI(0);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setI((x) => Math.min(results.length - 1, x + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setI((x) => Math.max(0, x - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                pick(results[i]?.n.id);
              }
            }}
            placeholder="Find a card by name or #tag…"
            className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted/70"
          />
        </div>
        {results.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted">No cards match.</p>
        ) : (
          <ul className="max-h-80 overflow-y-auto p-1.5">
            {results.map(({ n, path }, k) => (
              <li key={n.id}>
                <button
                  onPointerEnter={() => setI(k)}
                  onClick={() => pick(n.id)}
                  className={`flex w-full flex-col items-start rounded-lg px-3 py-2 text-left ${k === i ? 'bg-accent-soft' : ''}`}
                >
                  <span className={`text-sm font-medium ${n.done ? 'text-muted line-through' : ''}`}>{n.title || 'Untitled'}</span>
                  {path && <span className="truncate text-xs text-muted">{path}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
