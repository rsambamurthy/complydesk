/**
 * Pre-filing check on a filing: live checks against the client's records, plus "check the draft form" —
 * AI reads the attached draft, the server compares it with the records (services/review.ts).
 */
import { useState } from 'react';
import { api } from '../lib/api';
import { useLoad } from '../lib/hooks';
import { fmtDateTime } from '../lib/format';
import { Alert } from './ui';

type Finding = { level: 'error' | 'warn' | 'ok'; text: string; source: string };
interface Review {
  records: Finding[]; aiEnabled: boolean; checkable: { id: string; fileName: string }[];
  latest: { fileName: string | null; findings: Finding[]; userName: string | null; createdAt: string } | null;
}
const ICON = { error: ['✕', '#b42318'], warn: ['!', '#a15c00'], ok: ['✓', '#1a7f43'] } as const;

function List({ items, showOk }: { items: Finding[]; showOk: boolean }) {
  const order = { error: 0, warn: 1, ok: 2 };
  const shown = [...items].sort((a, b) => order[a.level] - order[b.level]).filter((f) => showOk || f.level !== 'ok');
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} className="small">
      {shown.map((f, i) => (
        <li key={i} style={{ display: 'flex', gap: 8, padding: '3px 0' }}>
          <span aria-label={f.level} style={{ flex: 'none', width: 18, height: 18, borderRadius: 9, background: ICON[f.level][1], color: '#fff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>{ICON[f.level][0]}</span>
          <span>{f.text}</span>
        </li>
      ))}
    </ul>
  );
}
const counts = (f: Finding[]) => ({ e: f.filter((x) => x.level === 'error').length, w: f.filter((x) => x.level === 'warn').length, o: f.filter((x) => x.level === 'ok').length });
const Summary = ({ f }: { f: Finding[] }) => { const c = counts(f); return <>{c.e > 0 && <span className="overdue">{c.e} to fix</span>}{c.e > 0 && c.w > 0 && ' · '}{c.w > 0 && <span className="warn-text">{c.w} to look at</span>}{!c.e && !c.w && <span style={{ color: '#1a7f43' }}>all clear</span>}</>; };

export function ReviewCheck({ obligationId, open: startOpen }: { obligationId: string; open: boolean }) {
  const { data, error, reload } = useLoad<Review>(`/obligations/${obligationId}/review`);
  const [open, setOpen] = useState(startOpen);
  const [showOk, setShowOk] = useState(false);
  const [file, setFile] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return null;
  const all = [...data.records, ...(data.latest?.findings ?? [])];
  const pick = file || data.checkable[0]?.id || '';
  const check = async () => {
    setBusy(true); setErr(undefined);
    try { await api(`/obligations/${obligationId}/review`, { body: { attachmentId: pick } }); reload(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="card pad" style={{ marginBottom: 12, background: 'var(--surface-2, #f6f7fb)' }}>
      <button type="button" onClick={() => setOpen(!open)} style={{ all: 'unset', cursor: 'pointer', display: 'flex', width: '100%', alignItems: 'center', gap: 8 }}>
        <strong>Pre-filing check</strong><span className="small"><Summary f={all} /></span><span className="grow" /><span className="muted small">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && <div className="stack" style={{ gap: 10, marginTop: 10 }}>
        <div><span className="muted small block" style={{ marginBottom: 4 }}>Against the client’s records</span><List items={data.records} showOk={showOk} /></div>
        <div>
          <span className="muted small block" style={{ marginBottom: 4 }}>Draft form against the records</span>
          {data.latest ? <>
            <span className="muted small block" style={{ marginBottom: 4 }}>{data.latest.fileName} · checked by {data.latest.userName ?? '—'} on {fmtDateTime(data.latest.createdAt)}</span>
            <List items={data.latest.findings} showOk={showOk} />
          </> : <span className="small muted">Not checked yet.</span>}
          {err && <Alert kind="error">{err}</Alert>}
          {data.aiEnabled && (data.checkable.length ? (
            <div className="btn-row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
              <select style={{ width: 'auto', maxWidth: 320 }} value={pick} onChange={(e) => setFile(e.target.value)} aria-label="Draft form">{data.checkable.map((f) => <option key={f.id} value={f.id}>{f.fileName}</option>)}</select>
              <button className="btn btn-sm btn-secondary" disabled={busy || !pick} onClick={check}>{busy ? 'Reading the draft…' : data.latest ? 'Check again' : 'Check the draft against records'}</button>
            </div>
          ) : <span className="small muted block" style={{ marginTop: 6 }}>Attach the filled-in form (PDF or screenshot) under Documents to check it against the records.</span>)}
        </div>
        {all.some((f) => f.level === 'ok') && <a href="#" className="small" onClick={(e) => { e.preventDefault(); setShowOk(!showOk); }}>{showOk ? 'Hide what matched' : `Show what matched (${counts(all).o})`}</a>}
      </div>}
    </div>
  );
}
