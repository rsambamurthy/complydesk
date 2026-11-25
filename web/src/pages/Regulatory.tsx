/** Regulatory updates published by Integrata, with the clients each one affects; mark them reviewed. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useLoad } from '../lib/hooks';
import { useSession } from '../lib/session';
import { fmtDate } from '../lib/format';
import { Alert, Empty, Spinner } from '../components/ui';

export interface RegUpdate {
  id: string; title: string; source: string | null; url: string | null; issuedOn: string | null; effectiveFrom: string | null; summary: string; actions: string | null;
  impact: 'HIGH' | 'MEDIUM' | 'LOW'; whom: string; formNames: string[]; affected: { id: string; name: string; cin: string }[];
  reviewed: { at: string; by: string | null; note: string | null } | null; publishedAt: string;
}
export const IMPACT: Record<string, string> = { HIGH: 'High impact', MEDIUM: 'Medium', LOW: 'For information' };

export function Regulatory() {
  const { data, error, reload } = useLoad<RegUpdate[]>('/regulatory');
  const { can } = useSession();
  const [filter, setFilter] = useState<'todo' | 'all'>('todo');
  const [err, setErr] = useState<string>();
  if (error) return <div className="page"><Alert kind="error">{error}</Alert></div>;
  if (!data) return <Spinner />;
  const rows = filter === 'todo' ? data.filter((u) => !u.reviewed && u.affected.length) : data;
  const review = async (u: RegUpdate, undo = false) => {
    setErr(undefined);
    try {
      if (undo) await api(`/regulatory/${u.id}/review`, { method: 'DELETE' });
      else { const note = window.prompt('Note for your team (optional) — e.g. what you changed', '') ; if (note === null) return; await api(`/regulatory/${u.id}/review`, { body: { note } }); }
      reload();
    } catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="page">
      <div className="page-head"><div><h1>Regulatory updates</h1><p className="muted">Changes in company law and MCA procedure, summarised by Integrata, with the clients each one affects. Always read the notification itself before acting.</p></div></div>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button className={`seg-btn ${filter === 'todo' ? 'active' : ''}`} onClick={() => setFilter('todo')}>To review ({data.filter((u) => !u.reviewed && u.affected.length).length})</button>
        <button className={`seg-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All ({data.length})</button>
      </div>
      {err && <Alert kind="error">{err}</Alert>}
      {!rows.length && <Empty>{filter === 'todo' ? 'Nothing to review — you’re up to date.' : 'No updates yet.'}</Empty>}
      <div className="stack" style={{ gap: 14 }}>
        {rows.map((u) => (
          <section key={u.id} className={`card pad reg-card impact-${u.impact.toLowerCase()}`}>
            <div className="toolbar" style={{ padding: 0, alignItems: 'flex-start' }}>
              <div>
                <span className={`badge reg-${u.impact.toLowerCase()}`}>{IMPACT[u.impact]}</span>
                <h3 style={{ margin: '6px 0 2px' }}>{u.title}</h3>
                <div className="muted small">{[u.source, u.issuedOn && `issued ${fmtDate(u.issuedOn)}`, u.effectiveFrom && `effective ${fmtDate(u.effectiveFrom)}`].filter(Boolean).join(' · ')}{u.url && <> · <a href={u.url} target="_blank" rel="noreferrer">Read the notification</a></>}</div>
              </div>
              <span className="grow" />
              {u.reviewed
                ? <span className="small ok-text" title={u.reviewed.note ?? ''}>✓ Reviewed {fmtDate(u.reviewed.at)}{u.reviewed.by ? ` by ${u.reviewed.by}` : ''}{can('compliance.work') && <> · <button className="link-btn small" onClick={() => review(u, true)}>undo</button></>}</span>
                : can('compliance.work') && <button className="btn btn-sm btn-primary" onClick={() => review(u)}>Mark reviewed</button>}
            </div>
            <p style={{ margin: '10px 0' }}>{u.summary}</p>
            {u.actions && <><b className="small">What to do</b><ul className="small" style={{ margin: '4px 0 10px', paddingInlineStart: 18 }}>{u.actions.split('\n').filter(Boolean).map((a) => <li key={a}>{a}</li>)}</ul></>}
            <div className="small muted">Applies to: {u.whom}{u.formNames.length ? ` · Forms: ${u.formNames.join(', ')}` : ''}</div>
            <div className="reg-clients">
              <b className="small">{u.affected.length ? `Your clients affected (${u.affected.length})` : 'None of your clients is affected'}</b>
              {u.affected.slice(0, 30).map((c) => <Link key={c.id} to={`/clients/${c.id}`} className="chip">{c.name}</Link>)}
              {u.affected.length > 30 && <span className="small muted">and {u.affected.length - 30} more</span>}
            </div>
            {u.reviewed?.note && <p className="small" style={{ marginBottom: 0 }}><b>Team note:</b> {u.reviewed.note}</p>}
          </section>
        ))}
      </div>
    </div>
  );
}

/** Dashboard banner when updates affecting the firm's clients are waiting for review. */
export function RegBanner() {
  const n = useLoad<{ unreviewed: number }>('/regulatory/count').data?.unreviewed ?? 0;
  if (!n) return null;
  return <div className="action-bar"><span><b>{n} regulatory update{n > 1 ? 's' : ''}</b> affect{n > 1 ? '' : 's'} your clients and {n > 1 ? 'are' : 'is'} waiting for review.</span><Link className="btn btn-sm btn-primary" to="/regulatory">Review</Link></div>;
}
