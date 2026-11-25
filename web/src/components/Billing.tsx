/**
 * Billing pieces shared by the Billing page and a client's Billing tab: tiles, work to be billed, invoices, fees,
 * the firm's billing details and a client's billing details.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useLoad } from '../lib/hooks';
import { useSession } from '../lib/session';
import { fmtDate, money, money2 } from '../lib/format';
import { Fields, useRecordForm, type FieldDef } from './RecordForm';
import { Alert, Empty, Spinner } from './ui';

export interface Summary { unbilledCount: number; unbilledAmount: number; unbilledNoFee: number; outstanding: number; overdue: number; collectedThisFy: number; fyLabel: string; drafts: number; ageing: Record<string, number> }
interface Work { id: string; clientId: string; clientName: string; form: string; title: string; fyLabel: string; periodLabel: string; filedOn: string; srn: string | null; fee: number | null }
export interface InvoiceRow { id: string; clientId: string; clientName: string; number: string | null; status: string; state: string; date: string; dueDate: string; total: number; received: number; balance: number; age: string | null }
interface Fee { ruleCode: string; form: string; title: string; firmFee: number | null; clientFee?: number | null }

export const STATE_LABEL: Record<string, string> = { DRAFT: 'Draft', UNPAID: 'Unpaid', PART_PAID: 'Part paid', PAID: 'Paid', OVERDUE: 'Overdue', CANCELLED: 'Cancelled' };
export const InvoiceBadge = ({ state }: { state: string }) => <span className={`badge inv-${state.toLowerCase()}`}>{STATE_LABEL[state] ?? state}</span>;
const AGE_LABEL: Record<string, string> = { NOT_DUE: 'Not yet due', '0_30': '1–30 days', '31_60': '31–60 days', '61_90': '61–90 days', OVER_90: 'Over 90 days' };

export function BillingTiles({ s }: { s?: Summary }) {
  if (!s) return <Spinner />;
  return (
    <>
      <div className="tiles" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        <div className="card tile"><span className="tile-n">{money(s.unbilledAmount)}</span><span className="tile-l">To be billed ({s.unbilledCount} filing{s.unbilledCount === 1 ? '' : 's'})</span>{s.unbilledNoFee > 0 && <span className="tile-sub">{s.unbilledNoFee} with no fee set</span>}</div>
        <div className="card tile"><span className="tile-n">{money(s.outstanding)}</span><span className="tile-l">Outstanding</span></div>
        <div className="card tile"><span className={`tile-n ${s.overdue ? 'tile-bad' : ''}`}>{money(s.overdue)}</span><span className="tile-l">Overdue</span></div>
        <div className="card tile"><span className="tile-n">{money(s.collectedThisFy)}</span><span className="tile-l">Collected in {s.fyLabel}</span></div>
      </div>
      {s.outstanding > 0 && (
        <div className="ageing card">
          <b className="small">Outstanding by age</b>
          {Object.entries(s.ageing).map(([k, v]) => <span key={k} className={`small ${v && k !== 'NOT_DUE' ? 'overdue' : 'muted'}`}>{AGE_LABEL[k]}: <b>{money(v)}</b></span>)}
        </div>
      )}
    </>
  );
}

/** Filed work not yet on an invoice, grouped by client, with "Create invoice" per client. */
export function UnbilledWork({ clientId, onChange }: { clientId?: string; onChange?: () => void }) {
  const { data, error, reload } = useLoad<Work[]>(`/billing/unbilled${clientId ? `?clientId=${clientId}` : ''}`);
  const { can } = useSession();
  const nav = useNavigate();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState<string>();
  useEffect(() => { if (data) setPicked(new Set(data.filter((w) => w.fee !== null).map((w) => w.id))); }, [data]);
  const groups = useMemo(() => {
    const m = new Map<string, Work[]>();
    for (const w of data ?? []) m.set(w.clientId, [...(m.get(w.clientId) ?? []), w]);
    return [...m.entries()];
  }, [data]);
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const create = async (cid: string, items: Work[], retainer = false) => {
    setErr(undefined); setBusy(cid);
    try {
      const inv = await api<{ id: string }>('/billing/invoices', { body: { clientId: cid, obligationIds: items.filter((w) => picked.has(w.id)).map((w) => w.id), retainer } });
      onChange?.(); reload(); nav(`/billing/invoices/${inv.id}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(undefined); }
  };
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return <Spinner />;
  return (
    <div className="stack" style={{ gap: 14 }}>
      {err && <Alert kind="error">{err}</Alert>}
      {!groups.length && <Empty>Nothing to bill — filings marked filed appear here until they are on an invoice.{clientId && can('billing.manage') && <> <button className="link-btn" onClick={() => create(clientId, [])}>Create an invoice anyway</button></>}</Empty>}
      {groups.map(([cid, items]) => {
        const sel = items.filter((w) => picked.has(w.id));
        return (
          <div key={cid} className="unbilled-group">
            <div className="toolbar">
              {!clientId && <h3 style={{ margin: 0 }}><Link to={`/clients/${cid}`}>{items[0].clientName}</Link></h3>}
              <span className="muted small">{sel.length} of {items.length} picked · {money(sel.reduce((s, w) => s + (w.fee ?? 0), 0))}</span>
              <span className="grow" />
              {can('billing.manage') && <button className="btn btn-sm btn-primary" disabled={busy === cid || !sel.length} onClick={() => create(cid, items)}>Create invoice</button>}
            </div>
            <div className="table-wrap"><table className="table compact">
              <thead><tr><th style={{ width: 28 }} /><th>Filing</th><th>Period</th><th>Filed on</th><th>SRN</th><th className="num">Fee</th></tr></thead>
              <tbody>{items.map((w) => (
                <tr key={w.id} onClick={() => toggle(w.id)}>
                  <td><input type="checkbox" checked={picked.has(w.id)} onChange={() => toggle(w.id)} onClick={(e) => e.stopPropagation()} aria-label={`Bill ${w.form}`} /></td>
                  <td><b>{w.form}</b> <span className="muted small">{w.title}</span></td>
                  <td>{w.periodLabel || w.fyLabel}</td><td>{fmtDate(w.filedOn)}</td><td className="mono small">{w.srn ?? '—'}</td>
                  <td className="num">{w.fee === null ? <span className="muted small">no fee set</span> : money(w.fee)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </div>
        );
      })}
    </div>
  );
}

export function InvoiceTable({ clientId, open }: { clientId?: string; open?: boolean }) {
  const [filter, setFilter] = useState(open ? 'open' : '');
  const q = new URLSearchParams({ ...(clientId ? { clientId } : {}), ...(filter === 'open' ? { open: '1' } : filter ? { status: filter } : {}) }).toString();
  const { data, error } = useLoad<InvoiceRow[]>(`/billing/invoices?${q}`);
  const nav = useNavigate();
  return (
    <>
      <div className="seg" style={{ marginBottom: 10 }}>
        {[['', 'All'], ['open', 'Outstanding'], ['DRAFT', 'Drafts'], ['CANCELLED', 'Cancelled']].map(([k, l]) => <button key={k} className={`seg-btn ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {!data ? <Spinner /> : !data.length ? <Empty>No invoices.</Empty> : (
        <div className="table-wrap"><table className="table compact">
          <thead><tr><th>Invoice</th>{!clientId && <th>Client</th>}<th>Date</th><th>Due</th><th className="num">Total</th><th className="num">Received</th><th className="num">Balance</th><th>Status</th></tr></thead>
          <tbody>{data.map((i) => (
            <tr key={i.id} onClick={() => nav(`/billing/invoices/${i.id}`)}>
              <td className="mono">{i.number ?? <span className="muted">Draft</span>}</td>{!clientId && <td>{i.clientName}</td>}
              <td>{fmtDate(i.date)}</td><td>{fmtDate(i.dueDate)}</td>
              <td className="num">{money2(i.total)}</td><td className="num">{i.received ? money2(i.received) : '—'}</td><td className="num"><b>{i.balance ? money2(i.balance) : '—'}</b></td>
              <td><InvoiceBadge state={i.state} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}

/** Fees per kind of filing — the firm's, or a client's own (blank = use the firm's). */
export function FeeTable({ clientId }: { clientId?: string }) {
  const { data, error, reload } = useLoad<Fee[]>(`/billing/fees${clientId ? `?clientId=${clientId}` : ''}`);
  const { can } = useSession();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string }>();
  useEffect(() => { if (data) setVals(Object.fromEntries(data.map((f) => [f.ruleCode, String((clientId ? f.clientFee : f.firmFee) ?? '')]))); }, [data, clientId]);
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return <Spinner />;
  const changed = data.filter((f) => String((clientId ? f.clientFee : f.firmFee) ?? '') !== (vals[f.ruleCode] ?? ''));
  const save = async () => {
    setMsg(undefined);
    try { await api(`/billing/fees${clientId ? `?clientId=${clientId}` : ''}`, { method: 'PUT', body: { fees: changed.map((f) => ({ ruleCode: f.ruleCode, amount: vals[f.ruleCode] || null })) } }); reload(); setMsg({ kind: 'success', text: 'Fees saved.' }); }
    catch (e: any) { setMsg({ kind: 'error', text: e.message }); }
  };
  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>{clientId ? 'This client’s own professional fee for each kind of filing. Leave blank to use the firm’s fee.' : 'Your professional fee for each kind of filing, before GST. Filed work is billed at these amounts unless a client has its own fee.'}</p>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="table-wrap"><table className="table compact fee-table">
        <thead><tr><th>Form</th><th>Filing</th>{clientId && <th className="num">Firm’s fee</th>}<th className="num" style={{ width: 160 }}>{clientId ? 'This client’s fee (₹)' : 'Fee (₹)'}</th></tr></thead>
        <tbody>{data.map((f) => (
          <tr key={f.ruleCode} style={{ cursor: 'default' }}>
            <td><b>{f.form}</b></td><td className="small">{f.title}</td>
            {clientId && <td className="num muted">{f.firmFee === null ? '—' : money(f.firmFee)}</td>}
            <td className="num"><input inputMode="decimal" value={vals[f.ruleCode] ?? ''} disabled={!can('billing.manage')} onChange={(e) => setVals((v) => ({ ...v, [f.ruleCode]: e.target.value }))} placeholder={clientId && f.firmFee !== null ? String(f.firmFee) : ''} aria-label={`Fee for ${f.form}`} /></td>
          </tr>
        ))}</tbody>
      </table></div>
      {can('billing.manage') && <div style={{ marginTop: 10 }}><button className="btn btn-primary" disabled={!changed.length} onClick={save}>Save {changed.length ? `${changed.length} change${changed.length > 1 ? 's' : ''}` : 'fees'}</button></div>}
    </>
  );
}

function useStates() {
  return useLoad<{ code: string; name: string }[]>('/billing/states').data?.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` })) ?? [];
}

/** An inline form saved with PUT (firm details, a client's billing details). */
function InlineForm({ fields, initial, path, saveLabel, after }: { fields: FieldDef[]; initial: Record<string, any>; path: string; saveLabel: string; after?: (r: any) => void }) {
  const form = useRecordForm(initial);
  const { can } = useSession();
  const [ok, setOk] = useState(false);
  return (
    <div>
      {form.error && <Alert kind="error">{form.error}</Alert>}
      {ok && <Alert kind="success">Saved.</Alert>}
      <Fields fields={fields} form={form} />
      {can('billing.manage') && <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={form.busy} onClick={() => { setOk(false); form.submit(async (v) => { const r = await api(path, { method: 'PUT', body: v }); setOk(true); after?.(r); }); }}>{saveLabel}</button>}
    </div>
  );
}

export function FirmBillingForm() {
  const { data, error } = useLoad<Record<string, any>>('/billing/profile');
  const states = useStates();
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data || !states.length) return <Spinner />;
  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>Printed on every invoice. GST is charged only when you enter a GSTIN — the firm’s state decides CGST + SGST (same state as the client) or IGST. Confirm the SAC code and rate with your tax adviser.</p>
      <InlineForm path="/billing/profile" saveLabel="Save firm details" initial={data} fields={[
        { key: 'legalName', label: 'Name on invoices', required: true, wide: true },
        { key: 'gstin', label: 'GSTIN', placeholder: '33ABCDE1234F1Z5', help: 'Leave empty if the firm isn’t registered for GST.' },
        { key: 'pan', label: 'PAN' },
        { key: 'address', label: 'Address', type: 'textarea', wide: true, required: true },
        { key: 'stateCode', label: 'State', type: 'select', options: states, required: true },
        { key: 'sac', label: 'SAC code', placeholder: 'e.g. 998399' },
        { key: 'gstRate', label: 'GST rate (%)', type: 'number' },
        { key: 'invoicePrefix', label: 'Invoice number prefix', help: 'Up to 5 characters, e.g. INV → INV/26-27/001' },
        { key: 'dueDays', label: 'Payment due in (days)', type: 'number' },
        { key: 'billFrom', label: 'Bill work filed from', type: 'date', help: 'Filings marked filed before this date are not listed as to be billed.' },
        { key: 'bankDetails', label: 'Bank details for payment', type: 'textarea', wide: true, placeholder: 'Account name, number, IFSC, bank and branch; UPI ID' },
        { key: 'terms', label: 'Terms printed on invoices', type: 'textarea', wide: true },
      ]} />
    </>
  );
}

export function ClientBillingForm({ clientId }: { clientId: string }) {
  const { data, error } = useLoad<Record<string, any>>(`/billing/clients/${clientId}`);
  const states = useStates();
  const [pos, setPos] = useState<string>();
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data || !states.length) return <Spinner />;
  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>Place of supply: <b>{pos ?? (data.placeOfSupplyName || 'not known')}</b>{data.stateFromCin && !pos && ' (from the CIN)'}. Leave the name and address empty to use the company’s own.</p>
      <InlineForm path={`/billing/clients/${clientId}`} saveLabel="Save billing details" initial={data} after={(r) => setPos(r.placeOfSupplyName)} fields={[
        { key: 'billingName', label: 'Bill to (name)', placeholder: 'The company’s name' },
        { key: 'gstin', label: 'Client’s GSTIN' },
        { key: 'address', label: 'Billing address', type: 'textarea', wide: true, placeholder: 'The registered office' },
        { key: 'stateCode', label: 'State (if no GSTIN)', type: 'select', options: [{ value: '', label: '—' }, ...states] },
        { key: 'email', label: 'Accounts email', type: 'email' },
        { key: 'retainer', label: 'Retainer fee (₹)', type: 'number', help: 'Optional — added as a line when you create an invoice with the retainer.' },
        { key: 'retainerPeriod', label: 'Retainer per', type: 'select', options: [{ value: '', label: '—' }, { value: 'MONTHLY', label: 'Month' }, { value: 'QUARTERLY', label: 'Quarter' }, { value: 'HALF_YEARLY', label: 'Half-year' }, { value: 'YEARLY', label: 'Year' }] },
      ]} />
    </>
  );
}
