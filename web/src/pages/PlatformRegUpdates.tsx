/** Integrata: draft regulatory updates (AI summary from text or a PDF), check them, publish to every firm. */
import { useState } from 'react';
import { api } from '../lib/api';
import { useLoad, useMeta } from '../lib/hooks';
import { fmtDate } from '../lib/format';
import { RecordModal } from '../components/RecordForm';
import { DropZone } from '../components/DropZone';
import { Alert, Empty, Spinner } from '../components/ui';
import { IMPACT } from './Regulatory';

interface Row { id: string; title: string; source: string | null; url: string | null; issuedOn: string | null; effectiveFrom: string | null; summary: string; actions: string | null; applies: any; forms: string[]; impact: string; status: string; publishedAt: string | null }

const toForm = (u: Partial<Row> & { actions?: any }) => ({
  ...u, actions: Array.isArray(u.actions) ? u.actions.join('\n') : u.actions ?? '',
  all: !!u.applies?.all, types: u.applies?.types ?? [], small: u.applies?.small === true ? 'yes' : u.applies?.small === false ? 'no' : '', flags: u.applies?.flags ?? [],
});
const fromForm = (v: Record<string, any>) => ({
  title: v.title, source: v.source || null, url: v.url || null, issuedOn: v.issuedOn || null, effectiveFrom: v.effectiveFrom || null, summary: v.summary, actions: v.actions || null, impact: v.impact,
  forms: v.forms ?? [], applies: v.all ? { all: true } : { types: v.types ?? [], ...(v.small ? { small: v.small === 'yes' } : {}), flags: v.flags ?? [] },
});

export function PlatformRegUpdates() {
  const { data, error, reload } = useLoad<Row[]>('/platform/reg-updates');
  const meta = useMeta();
  const rules = useLoad<{ code: string; form: string; title: string }[]>('/platform/rules').data;
  const [edit, setEdit] = useState<Record<string, any> | 'new'>();
  const [text, setText] = useState('');
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  if (error) return <div className="page"><Alert kind="error">{error}</Alert></div>;
  if (!data || !meta) return <Spinner />;
  const summarise = async () => {
    setBusy(true); setErr(undefined);
    try {
      const fd = new FormData(); if (text) fd.append('text', text); if (file) fd.append('file', file);
      const d = await api<any>('/platform/reg-updates/draft', { body: fd });
      setEdit(toForm({ ...d, applies: d.applies })); setText(''); setFile(undefined);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const publish = async (r: Row) => {
    if (!window.confirm('Publish to every firm? Firm Admins with affected clients get an email.')) return;
    try { const out = await api<{ emailed: number }>(`/platform/reg-updates/${r.id}/publish`, { body: {} }); setErr(undefined); window.alert(`Published. ${out.emailed} email(s) sent.`); reload(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="page">
      <div className="page-head"><div><h1>Regulatory updates</h1><p className="muted">Write or AI-summarise an MCA notification, check it against the source, publish. Firms see it with the clients it affects.</p></div>
        <div className="head-actions"><button className="btn btn-secondary" onClick={() => setEdit(toForm({ impact: 'MEDIUM', applies: { all: true } }))}>Write one by hand</button></div></div>
      <section className="card pad stack" style={{ gap: 10 }}>
        <h3 style={{ margin: 0 }}>Summarise a notification with AI</h3>
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the notification / circular text here — or attach the PDF below." />
        <DropZone accept="application/pdf" onFiles={(f) => setFile(f[0])}><span className="small">{file ? `📄 ${file.name}` : 'Drop the PDF here, or click to choose (optional)'}</span></DropZone>
        <div><button className="btn btn-primary" disabled={busy || (!text.trim() && !file)} onClick={summarise}>{busy ? 'Reading…' : 'Summarise'}</button></div>
        {err && <Alert kind="error">{err}</Alert>}
      </section>
      <section className="card" style={{ marginTop: 14 }}>
        {!data.length ? <Empty>No updates yet.</Empty> : (
          <table className="table compact"><thead><tr><th>Update</th><th>Impact</th><th>Effective</th><th>Status</th><th /></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.id} onClick={() => setEdit(toForm(r))}>
                <td><b>{r.title}</b><span className="muted small block">{r.source}</span></td>
                <td><span className={`badge reg-${r.impact.toLowerCase()}`}>{IMPACT[r.impact]}</span></td>
                <td>{fmtDate(r.effectiveFrom)}</td>
                <td>{r.status === 'PUBLISHED' ? `Published ${fmtDate(r.publishedAt)}` : <span className="warn-text">Draft</span>}</td>
                <td>{r.status === 'DRAFT' && <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); publish(r); }}>Publish</button>}</td>
              </tr>
            ))}</tbody></table>
        )}
      </section>
      {edit && (
        <RecordModal title={typeof edit === 'object' && edit.id ? 'Regulatory update' : 'New regulatory update'} initial={edit as Record<string, any>}
          extra={<Alert kind="info">Check every line against the notification before publishing — firms act on this.</Alert>}
          fields={[
            { key: 'title', label: 'Headline', required: true, wide: true },
            { key: 'source', label: 'Source (notification / circular no.)' }, { key: 'url', label: 'Link to the notification' },
            { key: 'issuedOn', label: 'Issued on', type: 'date' }, { key: 'effectiveFrom', label: 'Effective from', type: 'date' },
            { key: 'summary', label: 'Summary', type: 'textarea', required: true, wide: true },
            { key: 'actions', label: 'What firms should do (one per line)', type: 'textarea', wide: true },
            { key: 'impact', label: 'Impact', type: 'select', options: Object.entries(IMPACT).map(([value, label]) => ({ value, label })) },
            { key: 'all', label: 'Affects every company', type: 'checkbox', wide: true },
            { key: 'types', label: 'Company types', type: 'checks', options: [{ value: 'PRIVATE', label: 'Private limited' }, { value: 'OPC', label: 'One Person Company' }], show: (v) => !v.all },
            { key: 'small', label: 'Small companies', type: 'select', options: [{ value: '', label: 'Either' }, { value: 'yes', label: 'Small companies only' }, { value: 'no', label: 'Not small companies' }], show: (v) => !v.all },
            { key: 'flags', label: 'Only companies that', type: 'checks', options: Object.entries(meta.flags).map(([value, label]) => ({ value, label })), show: (v) => !v.all },
            { key: 'forms', label: 'Forms / rules it touches', type: 'checks', wide: true, options: (rules ?? []).map((r) => ({ value: r.code, label: `${r.form} — ${r.title}` })) },
          ]}
          onSave={async (v) => { const id = (edit as any).id; await api(id ? `/platform/reg-updates/${id}` : '/platform/reg-updates', { method: id ? 'PUT' : 'POST', body: fromForm(v) }); reload(); }}
          danger={(edit as any).id ? { label: 'Delete', onClick: async () => { await api(`/platform/reg-updates/${(edit as any).id}`, { method: 'DELETE' }); reload(); } } : undefined}
          onClose={() => setEdit(undefined)} />
      )}
    </div>
  );
}
