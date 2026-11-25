/** One invoice: edit while a draft, issue (numbered), print, record payments (with TDS), cancel. */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useLoad } from '../lib/hooks';
import { useSession } from '../lib/session';
import { fmtDate, money2, today } from '../lib/format';
import { RecordModal } from '../components/RecordForm';
import { InvoiceBadge } from '../components/Billing';
import { Alert, Spinner } from '../components/ui';

interface Line { id?: string; description: string; amount: string | number; taxable: boolean; obligationId?: string | null; sac?: string | null }
export interface Invoice {
  id: string; clientId: string; status: string; state: string; number: string | null; date: string; dueDate: string; notes: string | null;
  firm: Record<string, any>; billTo: Record<string, any>; placeOfSupplyName: string; gstRate: string; taxInvoice: boolean; intraState: boolean;
  taxable: string; cgst: string; sgst: string; igst: string; nonTaxable: string; total: string; balance: number; words: string;
  lines: Line[]; payments: { id: string; date: string; amount: string; tds: string; mode: string; reference: string | null }[]; cancelReason: string | null;
}
const toDraft = (i: Invoice) => ({ date: i.date, dueDate: i.dueDate, notes: i.notes ?? '', lines: i.lines.map(({ description, amount, taxable, obligationId }) => ({ description, amount, taxable, obligationId: obligationId ?? null })) });
const MODES = [{ value: 'BANK', label: 'Bank transfer' }, { value: 'UPI', label: 'UPI' }, { value: 'CHEQUE', label: 'Cheque' }, { value: 'CASH', label: 'Cash' }, { value: 'OTHER', label: 'Other' }];

export function InvoiceDetail() {
  const { id } = useParams();
  const { data, error, reload } = useLoad<Invoice>(`/billing/invoices/${id}`);
  const { can } = useSession();
  const nav = useNavigate();
  const [inv, setInv] = useState<Invoice>();
  const [draft, setDraft] = useState<{ date: string; dueDate: string; notes: string; lines: Line[] }>();
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const load = (i: Invoice) => { setInv(i); setDraft(toDraft(i)); };
  useEffect(() => { if (data) load(data); }, [data]);
  if (error) return <div className="page"><Alert kind="error">{error}</Alert></div>;
  if (!inv || !draft) return <Spinner />;
  const manage = can('billing.manage');
  const editing = inv.status === 'DRAFT' && manage;
  const dirty = editing && JSON.stringify(draft) !== JSON.stringify(toDraft(inv));
  const run = async (fn: () => Promise<Invoice | void>) => {
    setErr(undefined); setBusy(true);
    try { const r = await fn(); if (r) load(r); else reload(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const save = () => run(() => api<Invoice>(`/billing/invoices/${inv.id}`, { method: 'PUT', body: { ...draft, lines: draft.lines.map((l) => ({ ...l, amount: l.amount === '' ? 0 : l.amount })) } }));
  const setLine = (i: number, patch: Partial<Line>) => setDraft((d) => d && ({ ...d, lines: d.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) }));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="muted small"><Link to="/billing?tab=invoices">Billing</Link> › Invoice</div>
          <h1>{inv.number ?? 'Draft invoice'} <InvoiceBadge state={inv.state} /></h1>
          <p className="muted"><Link to={`/clients/${inv.clientId}`}>{inv.billTo?.name}</Link> · {fmtDate(inv.date)} · due {fmtDate(inv.dueDate)}</p>
        </div>
        <div className="head-actions">
          <a className="btn btn-secondary" href={`/billing/invoices/${inv.id}/print`} target="_blank" rel="noreferrer">{inv.status === 'DRAFT' ? 'Preview' : 'Print / PDF'}</a>
          {editing && <button className="btn btn-danger-ghost" disabled={busy} onClick={() => run(async () => { await api(`/billing/invoices/${inv.id}`, { method: 'DELETE' }); nav('/billing?tab=invoices'); })}>Delete draft</button>}
          {editing && <button className="btn btn-primary" disabled={busy || dirty} title={dirty ? 'Save your changes first' : undefined} onClick={() => run(() => api<Invoice>(`/billing/invoices/${inv.id}/issue`, { body: {} }))}>Issue invoice</button>}
          {manage && inv.status === 'ISSUED' && inv.balance > 0 && <button className="btn btn-primary" onClick={() => setPaying(true)}>Record payment</button>}
          {manage && inv.status === 'ISSUED' && !inv.payments.length && <button className="btn btn-danger-ghost" onClick={() => setCancelling(true)}>Cancel invoice</button>}
        </div>
      </div>
      {err && <Alert kind="error">{err}</Alert>}
      {inv.status === 'DRAFT' && <Alert kind="info">A draft has no number yet. <b>Issue invoice</b> gives it the next number in the series and locks it.</Alert>}
      {inv.status === 'CANCELLED' && <Alert kind="warning">Cancelled — {inv.cancelReason}</Alert>}
      {!inv.taxInvoice && <Alert kind="info">No GST: the firm has no GSTIN in Billing → Firm details.</Alert>}

      <section className="card pad">
        {editing && (
          <div className="field-grid" style={{ marginBottom: 12 }}>
            <div className="field"><label htmlFor="d">Invoice date</label><input id="d" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></div>
            <div className="field"><label htmlFor="dd">Due date</label><input id="dd" type="date" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} /></div>
          </div>
        )}
        <div className="table-wrap"><table className="table compact inv-lines">
          <thead><tr><th>#</th><th>Description</th><th>GST</th><th className="num" style={{ width: 150 }}>Amount</th>{editing && <th />}</tr></thead>
          <tbody>
            {(editing ? draft.lines : inv.lines).map((l, i) => (
              <tr key={i} style={{ cursor: 'default' }}>
                <td>{i + 1}</td>
                <td>{editing ? <input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} aria-label="Description" /> : l.description}</td>
                <td>{editing ? <label className="check-inline small"><input type="checkbox" checked={l.taxable} onChange={(e) => setLine(i, { taxable: e.target.checked })} /> {l.taxable ? 'GST' : 'No GST'}</label> : <span className="small">{l.taxable ? `${inv.gstRate}%` : 'Reimbursement'}</span>}</td>
                <td className="num">{editing ? <input inputMode="decimal" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} aria-label="Amount" style={{ textAlign: 'right' }} /> : money2(l.amount)}</td>
                {editing && <td><button className="link-btn danger small" onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, k) => k !== i) })}>Remove</button></td>}
              </tr>
            ))}
          </tbody>
        </table></div>
        {editing && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-secondary" onClick={() => setDraft({ ...draft, lines: [...draft.lines, { description: '', amount: '', taxable: true, obligationId: null }] })}>Add item</button>
            <button className="btn btn-sm btn-secondary" onClick={() => setDraft({ ...draft, lines: [...draft.lines, { description: 'Government (MCA) fees paid on your behalf', amount: '', taxable: false, obligationId: null }] })}>Add government fee</button>
          </div>
        )}
        <div className="inv-totals">
          <div><span>Taxable value</span><b>{money2(inv.taxable)}</b></div>
          {inv.intraState ? <>
            <div><span>CGST @ {Number(inv.gstRate) / 2}%</span><b>{money2(inv.cgst)}</b></div>
            <div><span>SGST @ {Number(inv.gstRate) / 2}%</span><b>{money2(inv.sgst)}</b></div>
          </> : <div><span>IGST @ {inv.gstRate}%</span><b>{money2(inv.igst)}</b></div>}
          {Number(inv.nonTaxable) > 0 && <div><span>Reimbursements (no GST)</span><b>{money2(inv.nonTaxable)}</b></div>}
          <div className="inv-total"><span>Total</span><b>{money2(inv.total)}</b></div>
          <div className="muted small" style={{ justifyContent: 'flex-end' }}>{inv.words}{dirty && ' · totals update when you save'}</div>
        </div>
        <p className="small muted">Place of supply: {inv.placeOfSupplyName || 'not known — add the client’s GSTIN or state in its Billing tab'}</p>
        {editing ? (
          <div className="field"><label htmlFor="n">Note on the invoice</label><textarea id="n" rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></div>
        ) : inv.notes && <p className="small">{inv.notes}</p>}
        {editing && <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={busy || !dirty} onClick={save}>Save changes</button>}
      </section>

      {inv.status === 'ISSUED' && (
        <section className="card pad" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Payments {inv.balance > 0 ? <span className="muted small">· {money2(inv.balance)} still due</span> : <span className="small" style={{ color: 'var(--ok)' }}>· settled</span>}</h3>
          {!inv.payments.length ? <p className="muted small">None recorded.</p> : (
            <table className="table compact"><thead><tr><th>Date</th><th>Mode</th><th>Reference</th><th className="num">Received</th><th className="num">TDS</th>{manage && <th />}</tr></thead>
              <tbody>{inv.payments.map((p) => (
                <tr key={p.id} style={{ cursor: 'default' }}><td>{fmtDate(p.date)}</td><td>{MODES.find((m) => m.value === p.mode)?.label ?? p.mode}</td><td>{p.reference ?? '—'}</td><td className="num">{money2(p.amount)}</td><td className="num">{Number(p.tds) ? money2(p.tds) : '—'}</td>
                  {manage && <td><button className="link-btn danger small" onClick={() => run(() => api<Invoice>(`/billing/payments/${p.id}`, { method: 'DELETE' }))}>Remove</button></td>}</tr>
              ))}</tbody></table>
          )}
        </section>
      )}

      {paying && (
        <RecordModal title={`Record payment — ${inv.number}`} saveLabel="Record payment" initial={{ date: today(), amount: inv.balance, tds: '', mode: 'BANK' }}
          extra={<p className="muted small" style={{ marginTop: 0 }}>If the client deducted TDS, enter it separately — it counts towards settling the invoice.</p>}
          fields={[
            { key: 'date', label: 'Received on', type: 'date', required: true },
            { key: 'amount', label: 'Amount received (₹)', type: 'number', required: true },
            { key: 'tds', label: 'TDS deducted (₹)', type: 'number' },
            { key: 'mode', label: 'Mode', type: 'select', options: MODES },
            { key: 'reference', label: 'Reference (UTR / cheque no.)', wide: true },
          ]}
          onSave={async (v) => { load(await api<Invoice>(`/billing/invoices/${inv.id}/payments`, { body: { ...v, tds: v.tds || 0 } })); }}
          onClose={() => setPaying(false)} />
      )}
      {cancelling && (
        <RecordModal title={`Cancel ${inv.number}`} saveLabel="Cancel invoice" initial={{ reason: '' }}
          extra={<p className="muted small" style={{ marginTop: 0 }}>The number stays used and the invoice is kept, marked cancelled. Its filings go back to “to be billed”. If it was already reported in your GST return, issue a credit note through your accountant.</p>}
          fields={[{ key: 'reason', label: 'Reason', required: true, wide: true }]}
          onSave={async (v) => { load(await api<Invoice>(`/billing/invoices/${inv.id}/cancel`, { body: v })); }}
          onClose={() => setCancelling(false)} />
      )}
    </div>
  );
}
