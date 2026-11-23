import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLoad, useMeta } from '../lib/hooks';
import type { Obligation } from '../lib/types';
import { ObligationTable } from '../components/Obligations';
import { Alert, Spinner } from '../components/ui';
import { fyLabel } from '../lib/format';

const BUCKETS = [
  { key: 'overdue', label: 'Overdue' }, { key: 'week', label: 'Next 7 days' }, { key: 'month', label: 'Next 30 days' },
  { key: 'open', label: 'All open' }, { key: 'done', label: 'Done' }, { key: 'all', label: 'Everything' },
];

/** Every client's obligations in one list, filtered by bucket, form, FY and who has it. */
export function Calendar() {
  const [qs, setQs] = useSearchParams();
  const bucket = qs.get('bucket') ?? 'open';
  const set = (k: string, v: string) => { const n = new URLSearchParams(qs); if (v) n.set(k, v); else n.delete(k); setQs(n, { replace: true }); };
  const query = new URLSearchParams({ bucket, ...(qs.get('assignee') ? { assignee: qs.get('assignee')! } : {}), ...(qs.get('fy') ? { fy: qs.get('fy')! } : {}) }).toString();
  const { data, error, reload } = useLoad<Obligation[]>(`/obligations?${query}`);
  const meta = useMeta();
  const form = qs.get('form') ?? '';
  const forms = useMemo(() => [...new Set((data ?? []).map((o) => o.form))].sort(), [data]);
  const rows = (data ?? []).filter((o) => !form || o.form === form);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Compliance calendar</h1><p className="muted">Meetings and filings for every client, worked out from the compliance rules.</p></div></div>
      <div className="card filter-bar">
        <div className="seg">{BUCKETS.map((b) => <button key={b.key} className={`seg-btn ${bucket === b.key ? 'active' : ''}`} onClick={() => set('bucket', b.key)}>{b.label}</button>)}</div>
        <span className="grow" />
        <label>Form <select value={form} onChange={(e) => set('form', e.target.value)}><option value="">All</option>{forms.map((f) => <option key={f}>{f}</option>)}</select></label>
        <label>Year <select value={qs.get('fy') ?? ''} onChange={(e) => set('fy', e.target.value)}><option value="">Both</option>{meta?.fys.map((f) => <option key={f} value={f}>{fyLabel(f)}</option>)}</select></label>
        <label>With <select value={qs.get('assignee') ?? ''} onChange={(e) => set('assignee', e.target.value)}><option value="">Anyone</option><option value="me">Me</option>{meta?.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <section className="card">
        {data ? <><div className="toolbar"><span className="muted small">{rows.length} item{rows.length === 1 ? '' : 's'}</span></div><ObligationTable rows={rows} meta={meta} onChanged={reload} /></> : <Spinner />}
      </section>
    </div>
  );
}
