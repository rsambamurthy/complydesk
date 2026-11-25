/** Team workload: open work per person, reviews waiting, stuck filings, done and hours in the period; hours per client. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useLoad } from '../lib/hooks';
import { money, today } from '../lib/format';
import { ClientPicker } from '../components/ClientPicker';
import { Alert, Empty, Modal, Spinner } from '../components/ui';

interface W {
  from: string; to: string;
  people: { id: string; name: string; roles: string[]; reviewer: boolean; open: number; overdue: number; week: number; stuck: number; toReview: number; done: number; hours: number }[];
  totals: { open: number; overdue: number; unassigned: number; unassignedOverdue: number; review: number; stuck: number; hours: number; done: number };
  clients: { clientId: string; name: string; hours: number; people: Record<string, number>; billed: number; perHour: number | null }[];
}
const PERIOD = [['month', 'This month'], ['last', 'Last month'], ['fy', 'This FY']] as const;

export function Team() {
  const [period, setPeriod] = useState<string>('month');
  const { data, error, reload } = useLoad<W>(`/team/workload?period=${period}`);
  const [logging, setLogging] = useState(false);
  if (error) return <div className="page"><Alert kind="error">{error}</Alert></div>;
  const max = Math.max(1, ...(data?.people ?? []).map((p) => p.open));
  return (
    <div className="page">
      <div className="page-head"><div><h1>Team</h1><p className="muted">Who has what, what’s stuck, and where the time goes.</p></div>
        <div className="head-actions"><button className="btn btn-primary" onClick={() => setLogging(true)}>Log time</button></div></div>
      <div className="seg" style={{ marginBottom: 14 }}>{PERIOD.map(([k, l]) => <button key={k} className={`seg-btn ${period === k ? 'active' : ''}`} onClick={() => setPeriod(k)}>{l}</button>)}</div>
      {!data ? <Spinner /> : <>
        <div className="tiles" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
          <div className="card tile"><span className="tile-n">{data.totals.open}</span><span className="tile-l">Open filings & meetings</span></div>
          <div className="card tile"><span className={`tile-n ${data.totals.unassigned ? 'tile-warn' : ''}`}>{data.totals.unassigned}</span><span className="tile-l">Not assigned to anyone</span>{data.totals.unassignedOverdue > 0 && <span className="tile-sub overdue">{data.totals.unassignedOverdue} overdue</span>}</div>
          <div className="card tile"><span className="tile-n">{data.totals.review}</span><span className="tile-l">Waiting for review</span></div>
          <div className="card tile"><span className={`tile-n ${data.totals.stuck ? 'tile-bad' : ''}`}>{data.totals.stuck}</span><span className="tile-l">Stuck (no move in 14 days)</span></div>
          <div className="card tile"><span className="tile-n">{data.totals.hours}</span><span className="tile-l">Hours logged · {data.totals.done} filed</span></div>
        </div>
        <section className="card">
          <div className="toolbar"><h3>People</h3></div>
          {!data.people.length ? <Empty>No team members.</Empty> : (
            <div className="table-wrap"><table className="table compact">
              <thead><tr><th>Person</th><th style={{ width: '28%' }}>Open (assigned)</th><th className="num">Overdue</th><th className="num">Due in 7 days</th><th className="num">Stuck</th><th className="num">To review</th><th className="num">Filed</th><th className="num">Hours</th></tr></thead>
              <tbody>{data.people.map((p) => (
                <tr key={p.id} style={{ cursor: 'default' }}>
                  <td><b>{p.name}</b><span className="muted small block">{p.roles.join(', ')}</span></td>
                  <td><Link to={`/calendar?bucket=open&assignee=${p.id}`} className="load-bar" title="Open their list"><span style={{ width: `${(p.open / max) * 100}%` }} /><b>{p.open}</b></Link></td>
                  <td className={`num ${p.overdue ? 'overdue' : ''}`}>{p.overdue || '—'}</td>
                  <td className="num">{p.week || '—'}</td>
                  <td className={`num ${p.stuck ? 'warn-text' : ''}`}>{p.stuck || '—'}</td>
                  <td className="num">{p.reviewer ? p.toReview || '—' : ''}</td>
                  <td className="num">{p.done || '—'}</td>
                  <td className="num">{p.hours || '—'}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <p className="muted small pad" style={{ margin: 0 }}>“Filed” counts filings this person marked uploaded on MCA or approved in the period. “Stuck”: being worked on, no step in 14 days.</p>
        </section>
        <section className="card" style={{ marginTop: 16 }}>
          <div className="toolbar"><h3>Time by client</h3></div>
          {!data.clients.length ? <Empty>No time logged in this period — log it from a filing (Time spent) or with Log time above.</Empty> : (
            <div className="table-wrap"><table className="table compact">
              <thead><tr><th>Client</th><th className="num">Hours</th><th>Who</th><th className="num">Invoiced in the period</th><th className="num">₹ per hour</th></tr></thead>
              <tbody>{data.clients.map((c) => (
                <tr key={c.clientId} style={{ cursor: 'default' }}>
                  <td><Link to={`/clients/${c.clientId}`}>{c.name}</Link></td><td className="num"><b>{c.hours}</b></td>
                  <td className="small">{Object.entries(c.people).map(([n, h]) => `${n} ${h}`).join(' · ')}</td>
                  <td className="num">{c.billed ? money(c.billed) : '—'}</td><td className="num">{c.perHour ? money(c.perHour) : '—'}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      </>}
      {logging && <LogTime onClose={() => setLogging(false)} onSaved={() => { setLogging(false); reload(); }} />}
    </div>
  );
}

function LogTime({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [client, setClient] = useState<string[]>([]);
  const [date, setDate] = useState(today());
  const [h, setH] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string>();
  const save = async () => {
    setErr(undefined);
    try { await api('/team/time', { body: { clientId: client[0], date, hours: h, note } }); onSaved(); }
    catch (e: any) { setErr(e.details ? Object.values(e.details).join(' ') : e.message); }
  };
  return (
    <Modal title="Log time" onClose={onClose} footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!client.length || !h} onClick={save}>Log time</button></>}>
      {err && <Alert kind="error">{err}</Alert>}
      <div className="field-grid">
        <div className="field field-wide"><label>Client</label><ClientPicker value={client} onChange={(v) => setClient(v.slice(-1))} /></div>
        <div className="field"><label htmlFor="ld">Date</label><input id="ld" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label htmlFor="lh">Hours</label><input id="lh" inputMode="decimal" value={h} onChange={(e) => setH(e.target.value)} placeholder="e.g. 1.5" /></div>
        <div className="field field-wide"><label htmlFor="ln">What you did</label><input id="ln" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
    </Modal>
  );
}
