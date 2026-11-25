/** A client's compliance report: printable (A4), and emailed to the client from here. */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useLoad } from '../lib/hooks';
import { useSession } from '../lib/session';
import { fmtDate, fmtDateTime, money } from '../lib/format';
import { Alert, Spinner } from '../components/ui';

interface Item { id: string; form: string; title: string; period: string; dueDate: string; filedOn?: string | null; srn?: string | null; lateFee?: number | null; lateFeeNote?: string | null; provisional?: boolean }
interface Report {
  asOf: string; fyLabel: string; status: 'ON_TRACK' | 'DUE_SOON' | 'ATTENTION';
  firm: { name: string; address: string | null }; client: { id: string; name: string; cin: string };
  counts: { overdue: number; upcoming: number; waiting: number; done: number; fyDone: number; fyTotal: number; exposure: number };
  overdue: Item[]; upcoming: Item[]; waiting: Item[]; done: Item[]; dsc: { name: string; dscExpiry: string; expired: boolean }[];
  recipients: string[]; log: { id: string; period: string | null; sentTo: string[]; sentAt: string; by: string | null }[];
}
const STATUS = { ON_TRACK: ['On track', 'ok'], DUE_SOON: ['Due soon', 'warn'], ATTENTION: ['Needs attention', 'bad'] } as const;

function Section({ title, rows, cols, tone }: { title: string; rows: Item[]; cols: (i: Item) => React.ReactNode[]; tone?: string }) {
  if (!rows.length) return null;
  return (
    <>
      <h3 className={`rep-h ${tone ?? ''}`}>{title} ({rows.length})</h3>
      <table className="rep-table"><tbody>{rows.map((i) => <tr key={i.id}>{cols(i).map((c, k) => <td key={k}>{c}</td>)}</tr>)}</tbody></table>
    </>
  );
}
const what = (i: Item) => <><b>{i.form}</b> {i.title}{i.period && <span className="muted"> · {i.period}</span>}</>;

export function ClientReport() {
  const { id } = useParams();
  const { data: r, error, reload } = useLoad<Report>(`/clients/${id}/report`);
  const { can, me } = useSession();
  const [to, setTo] = useState<string>();
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string }>();
  const [busy, setBusy] = useState(false);
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!r) return <Spinner />;
  const staff = !me?.user.clientIds.length;
  const send = async () => {
    setBusy(true); setMsg(undefined);
    try { const out = await api<{ to: string[] }>(`/clients/${id}/report/send`, { body: { to: to ?? r.recipients.join(', ') } }); setMsg({ kind: 'success', text: `Sent to ${out.to.join(', ')}.` }); reload(); }
    catch (e: any) { setMsg({ kind: 'error', text: e.message }); } finally { setBusy(false); }
  };
  const [label, tone] = STATUS[r.status];
  return (
    <div className="rep">
      <style>{'html, body { background: #fff } @page { size: A4; margin: 14mm } @media print { .no-print { display: none !important } }'}</style>
      <div className="no-print rep-actions">
        <button className="btn btn-secondary btn-sm" onClick={() => window.print()}>Print / save as PDF</button>
        {staff && can('compliance.work') && (
          <div className="rep-send card pad">
            <b>Email this report to the client</b>
            <input value={to ?? r.recipients.join(', ')} onChange={(e) => setTo(e.target.value)} placeholder="name@company.com, …" aria-label="Send to" />
            {!r.recipients.length && to === undefined && <span className="small muted">No address on file — type one, or add the client’s email in its Billing details.</span>}
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={send}>Send now</button>
            {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
            {!!r.log.length && <div className="small muted">Last sent {fmtDateTime(r.log[0].sentAt)} to {r.log[0].sentTo.join(', ')}{r.log[0].period ? ' (monthly)' : r.log[0].by ? ` by ${r.log[0].by}` : ''}</div>}
          </div>
        )}
      </div>
      <div className="rep-head">
        <div className="muted small">{r.firm.name}</div>
        <h1>{r.client.name}</h1>
        <div className="muted">CIN {r.client.cin} · Compliance status as on {fmtDate(r.asOf)}</div>
        <span className={`rep-status ${tone}`}>{label}</span>
      </div>
      <div className="rep-tiles">
        <div><b className={r.counts.overdue ? 'bad' : ''}>{r.counts.overdue}</b><span>Overdue{r.counts.exposure ? ` · late fees ~${money(r.counts.exposure)}` : ''}</span></div>
        <div><b>{r.counts.waiting}</b><span>Waiting for your approval</span></div>
        <div><b>{r.counts.upcoming}</b><span>Due in the next 60 days</span></div>
        <div><b>{r.counts.fyDone}/{r.counts.fyTotal}</b><span>Done ({r.fyLabel} and last year’s annual filings)</span></div>
      </div>
      <Section title="Overdue" tone="bad" rows={r.overdue} cols={(i) => [what(i), `was due ${fmtDate(i.dueDate)}`, i.lateFee ? `late fee ~${money(i.lateFee)}` : i.lateFeeNote ?? '']} />
      <Section title="Waiting for your approval" tone="warn" rows={r.waiting} cols={(i) => [what(i), `due ${fmtDate(i.dueDate)}`, '']} />
      <Section title="Coming up in the next 60 days" rows={r.upcoming} cols={(i) => [what(i), `due ${fmtDate(i.dueDate)}${i.provisional ? ' (est.)' : ''}`, '']} />
      <Section title="Done recently" tone="ok" rows={r.done} cols={(i) => [what(i), `filed ${fmtDate(i.filedOn)}`, i.srn ? `SRN ${i.srn}` : '']} />
      {!!r.dsc.length && <><h3 className="rep-h warn">Digital signatures (DSC) to renew</h3><ul>{r.dsc.map((d) => <li key={d.name}>{d.name} — {d.expired ? 'expired' : 'expires'} {fmtDate(d.dscExpiry)}</li>)}</ul></>}
      {!r.overdue.length && !r.upcoming.length && !r.waiting.length && !r.done.length && <p>Nothing due in the next 60 days.</p>}
      <p className="small muted" style={{ marginTop: 24 }}>Late fees are estimates. Dates marked “est.” depend on a date not yet recorded (usually the AGM). Prepared by {r.firm.name} with ComplyDesk.</p>
    </div>
  );
}
