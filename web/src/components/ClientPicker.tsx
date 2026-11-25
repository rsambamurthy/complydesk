/**
 * Pick one or many client companies by typing part of the name or CIN — works the same for 5 clients or 5,000.
 * Picked companies show as chips; the server returns at most 20 matches per search.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

interface Opt { id: string; name: string; cin: string }

export function ClientPicker({ value, onChange, placeholder = 'Type a company name or CIN…', autoFocus }: {
  value: string[]; onChange: (ids: string[]) => void; placeholder?: string; autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Opt[]>([]);
  const [names, setNames] = useState<Record<string, Opt>>({});
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  // Names of companies already picked (e.g. when editing a user).
  useEffect(() => {
    const missing = value.filter((id) => !names[id]);
    if (!missing.length) return;
    api<Opt[]>(`/clients/lookup?ids=${missing.join(',')}`).then((r) => setNames((n) => ({ ...n, ...Object.fromEntries(r.map((o) => [o.id, o])) }))).catch(() => {});
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => api<Opt[]>(`/clients/lookup?q=${encodeURIComponent(q)}`).then((r) => { setResults(r); setActive(0); }).catch(() => setResults([])), 200);
    return () => clearTimeout(t);
  }, [q, open]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const toggle = (o: Opt) => {
    setNames((n) => ({ ...n, [o.id]: o }));
    onChange(value.includes(o.id) ? value.filter((x) => x !== o.id) : [...value, o.id]);
  };

  return (
    <div ref={box} style={{ position: 'relative' }}>
      {value.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {value.map((id) => (
            <span key={id} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {names[id]?.name ?? '…'}
              <button type="button" className="icon-btn" style={{ padding: 0, lineHeight: 1 }} aria-label={`Remove ${names[id]?.name ?? ''}`} onClick={() => onChange(value.filter((x) => x !== id))}>✕</button>
            </span>
          ))}
        </div>
      )}
      <input
        value={q} placeholder={placeholder} autoFocus={autoFocus} role="combobox" aria-expanded={open} aria-autocomplete="list"
        onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter' && results[active]) { e.preventDefault(); toggle(results[active]); }
          else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
        }}
      />
      {open && (
        <ul role="listbox" className="card" style={{ position: 'absolute', zIndex: 20, insetInline: 0, marginTop: 4, maxHeight: 260, overflowY: 'auto', listStyle: 'none', padding: 4, boxShadow: '0 8px 24px rgba(0,0,0,.12)' }}>
          {results.length === 0 ? <li className="muted small" style={{ padding: 8 }}>{q ? 'No company matches.' : 'Start typing to search.'}</li> : results.map((o, i) => (
            <li key={o.id} role="option" aria-selected={value.includes(o.id)} onMouseDown={(e) => { e.preventDefault(); toggle(o); }} onMouseEnter={() => setActive(i)}
              style={{ padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: i === active ? 'var(--surface-2, #f1f3f8)' : undefined, display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-start", textAlign: "start" }}>
              <input type="checkbox" readOnly checked={value.includes(o.id)} tabIndex={-1} style={{ width: 16, height: 16, flex: "none", margin: 0 }} />
              <span>{o.name}<span className="muted small block mono">{o.cin}</span></span>
            </li>
          ))}
          {results.length === 20 && <li className="muted small" style={{ padding: 8 }}>Showing the first 20 — type more to narrow down.</li>}
        </ul>
      )}
    </div>
  );
}
