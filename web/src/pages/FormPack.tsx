/**
 * MCA form data for one filing: every field of the V3 form in order, filled from the records, with what's
 * missing, copy buttons for the portal, tables ready for MCA's Excel templates, and the attachments list.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useLoad } from '../lib/hooks';
import { fmtDate } from '../lib/format';
import { useSession } from '../lib/session';
import { Alert, Spinner } from '../components/ui';

interface Field { key: string; label: string; value: string | null; source: 'records' | 'client' | 'filing'; missing: boolean; optional: boolean; help?: string; fixAt?: string; input?: { scope: string; type?: string; options?: string[] } }
interface Table { key: string; title: string; columns: string[]; rows: (string | number | null)[][]; empty: string }
interface Pack {
  obligation: { id: string; form: string; fyLabel: string; dueDate: string; periodLabel: string | null; clientId: string; clientName: string };
  form: string; title: string; note?: string;
  parts: { title: string; fields: Field[]; tables: Table[] }[];
  attachments: { name: string; why?: string }[];
  progress: { filled: number; total: number; missing: string[] };
}
const SOURCE = { records: ['From records', 'badge-approved'], client: ['Client profile', 'badge-invited'], filing: ['This filing', 'badge-under_review'] } as const;
const FIX: Record<string, string> = { details: 'Edit details', directors: 'Directors & KMP', shareholders: 'Shareholders', auditor: 'Auditor', year: 'AGM date' };

function Copy({ text }: { text: string | null }) {
  const [done, setDone] = useState(false);
  if (!text) return null;
  return <button className="btn btn-sm btn-secondary" style={{ minWidth: 64 }} onClick={async () => { await navigator.clipboard?.writeText(text).catch(() => {}); setDone(true); setTimeout(() => setDone(false), 1200); }}>{done ? 'Copied' : 'Copy'}</button>;
}

export function FormPack() {
  const { id } = useParams();
  const { data, error } = useLoad<Pack>(`/obligations/${id}/form`);
  const [pack, setPack] = useState<Pack>();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [saved, setSaved] = useState(false);
  const { can } = useSession();
  useEffect(() => { if (data) setPack(data); }, [data]);
  if (error) return <div className="page"><Alert kind="error">{error}</Alert></div>;
  if (!pack) return <Spinner />;
  const p = pack; const ob = p.obligation;
  const editable = can('compliance.work');
  const dirty = Object.keys(edits).length > 0;
  const save = async () => {
    setBusy(true); setErr(undefined);
    try { setPack(await api<Pack>(`/obligations/${ob.id}/form`, { method: 'PUT', body: { values: edits } })); setEdits({}); setSaved(true); setTimeout(() => setSaved(false), 2000); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const pct = p.progress.total ? Math.round((p.progress.filled / p.progress.total) * 100) : 100;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{p.form} — {p.title}</h1>
          <p className="muted"><Link to={`/clients/${ob.clientId}`}>{ob.clientName}</Link> · {ob.fyLabel}{ob.periodLabel && ` · ${ob.periodLabel}`} · due {fmtDate(ob.dueDate)}</p>
        </div>
        <div className="head-actions">
          <a className="btn btn-secondary" href={`/api/obligations/${ob.id}/form.xlsx`}>Download Excel</a>
          <button className="btn btn-secondary" onClick={() => window.print()}>Print</button>
          {editable && <button className="btn btn-primary" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : saved ? 'Saved' : 'Save values'}</button>}
        </div>
      </div>
      {err && <Alert kind="error">{err}</Alert>}
      <section className="card pad" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <strong>{p.progress.filled} of {p.progress.total} fields ready</strong>
          <div style={{ flex: 1, minWidth: 200, height: 8, background: '#e6e9f0', borderRadius: 4 }}><div style={{ width: `${pct}%`, height: 8, borderRadius: 4, background: pct === 100 ? '#1a7f43' : '#2f6fde' }} /></div>
          {p.progress.missing.length > 0 && <span className="small overdue">{p.progress.missing.length} still empty</span>}
        </div>
        <p className="muted small" style={{ margin: '8px 0 0' }}>Open the form on the MCA V3 portal, enter the CIN (it pre-fills the registration details), then copy the values below in order. Values typed here are kept: client-profile ones are reused every year.{p.note && <> {p.note}</>}</p>
      </section>

      {p.parts.map((part) => (
        <section key={part.title} className="card" style={{ marginBottom: 14 }}>
          <div className="toolbar"><h3>{part.title}</h3></div>
          {part.fields.length > 0 && <div className="table-wrap"><table className="table compact">
            <tbody>{part.fields.map((f) => {
              const v = edits[f.key] ?? f.value ?? '';
              const set = (x: string) => setEdits({ ...edits, [f.key]: x });
              return (
                <tr key={f.key} style={f.missing && !(f.key in edits && edits[f.key]) ? { background: '#fff6f5' } : undefined}>
                  <td style={{ width: '38%' }}><strong className="small">{f.label}</strong>{f.optional && <span className="muted small"> (optional)</span>}{f.help && <span className="muted small block">{f.help}</span>}</td>
                  <td>
                    {f.input && editable ? (
                      f.input.type === 'select'
                        ? <select value={v} onChange={(e) => set(e.target.value)} className={f.missing && !v ? 'needs-check' : ''}><option value="">—</option>{f.input.options!.map((o) => <option key={o}>{o}</option>)}</select>
                        : <input type={f.input.type === 'number' ? 'number' : f.input.type === 'date' ? 'date' : 'text'} value={v} onChange={(e) => set(e.target.value)} className={f.missing && !v ? 'needs-check' : ''} placeholder={f.missing ? 'Enter' : ''} />
                    ) : f.value ? <span className="mono">{f.value}</span> : f.missing ? <span className="overdue small">Not in the records{f.fixAt && <> — <Link to={`/clients/${ob.clientId}`}>{FIX[f.fixAt]}</Link></>}</span> : <span className="muted">—</span>}
                  </td>
                  <td style={{ width: 120 }}><span className={`badge sm ${SOURCE[f.source][1]}`}>{SOURCE[f.source][0]}</span></td>
                  <td style={{ width: 86 }}><Copy text={v || null} /></td>
                </tr>
              );
            })}</tbody>
          </table></div>}
          {part.tables.map((t) => (
            <div key={t.key} style={{ padding: '6px 16px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0' }}><strong className="small">{t.title}</strong><span className="grow" />
                {t.rows.length > 0 && <Copy text={[t.columns, ...t.rows].map((r) => r.map((x) => x ?? '').join('\t')).join('\n')} />}</div>
              {t.rows.length === 0 ? <p className="muted small" style={{ margin: 0 }}>{t.empty}</p> : (
                <div className="table-wrap"><table className="table compact">
                  <thead><tr>{t.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>{t.rows.map((r, i) => <tr key={i}>{r.map((x, j) => <td key={j} className={typeof x === 'number' ? 'num' : ''}>{x === null ? <span className="muted">—</span> : typeof x === 'number' ? x.toLocaleString('en-IN') : x}</td>)}</tr>)}</tbody>
                </table></div>
              )}
            </div>
          ))}
        </section>
      ))}

      <section className="card pad">
        <h3 style={{ marginTop: 0 }}>Attachments to upload on MCA</h3>
        <ul style={{ margin: 0, paddingInlineStart: 18 }}>{p.attachments.map((a) => <li key={a.name} className="small" style={{ padding: '2px 0' }}>{a.name}{a.why && <span className="muted"> — {a.why}</span>}</li>)}</ul>
      </section>
    </div>
  );
}
