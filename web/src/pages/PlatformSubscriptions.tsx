/** Integrata platform console → Plans & payments: prices and limits, Integrata's invoice details, every payment. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useLoad } from '../lib/hooks';
import { fmtDate, money } from '../lib/format';
import { Alert, Spinner } from '../components/ui';
import { InlineForm, useStates } from '../components/Billing';

interface Plan { code: string; name: string; clients: number | null; users: number | null; price: number; active: boolean; blurb?: string }
interface Data { plans: Plan[]; seller: Record<string, string>; gateway: { enabled: boolean; mode: string | null } }
interface Payment { id: string; tenant: string; slug: string; plan: string; kind: string; invoiceNo: string; invoiceDate: string; periodFrom: string; periodTo: string; amount: number; gst: number; total: number; method: string; reference: string | null }

export function PlatformSubscriptions() {
  const { data, error, reload } = useLoad<Data>('/platform/plans');
  const payments = useLoad<Payment[]>('/platform/payments');
  const states = useStates();
  if (error) return <div className="page"><Alert kind="error">{error}</Alert></div>;
  if (!data || !states.length) return <Spinner />;
  const total = (payments.data ?? []).reduce((s, p) => s + p.total, 0);
  return (
    <div className="page stack">
      <div className="page-head"><div><h1>Plans &amp; payments</h1><p className="muted">What firms pay Integrata for ComplyDesk.</p></div></div>
      {!data.gateway.enabled
        ? <Alert kind="warning">Online payment is off: set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET on the server (Railway). Until then record payments from a firm’s row in Firms &amp; sign-up.</Alert>
        : <Alert kind="info">Online payment is on ({data.gateway.mode} mode).</Alert>}
      <PlansEditor plans={data.plans} onSaved={reload} />
      <section className="card pad stack">
        <h3 style={{ margin: 0 }}>Integrata’s invoice details</h3>
        <p className="muted small" style={{ margin: 0 }}>Printed on every subscription invoice. Without a GSTIN the invoice is a plain invoice; the state decides CGST + SGST or IGST. Confirm the SAC code with your tax adviser.</p>
        <InlineForm path="/platform/seller" saveLabel="Save invoice details" canSave initial={data.seller} fields={[
          { key: 'legalName', label: 'Legal name', required: true, wide: true },
          { key: 'gstin', label: 'GSTIN', placeholder: '33ABCDE1234F1Z5' },
          { key: 'pan', label: 'PAN' },
          { key: 'address', label: 'Address', type: 'textarea', wide: true, required: true },
          { key: 'stateCode', label: 'State', type: 'select', options: states },
          { key: 'sac', label: 'SAC code' },
          { key: 'invoicePrefix', label: 'Invoice prefix', help: 'Up to 5 characters: CDX → CDX/26-27/001' },
          { key: 'email', label: 'Email on invoices' },
        ]} />
      </section>
      <section className="card pad stack">
        <h3 style={{ margin: 0 }}>Payments{payments.data?.length ? ` · ${money(total)} received` : ''}</h3>
        {!payments.data ? <Spinner /> : !payments.data.length ? <p className="muted small" style={{ margin: 0 }}>No payments yet.</p> : (
          <div className="table-wrap"><table className="table compact"><thead><tr><th>Invoice</th><th>Firm</th><th>Plan</th><th>Period</th><th className="num">Before GST</th><th className="num">GST</th><th className="num">Total</th><th>How</th></tr></thead>
            <tbody>{payments.data.map((p) => <tr key={p.id} style={{ cursor: 'default' }}>
              <td><Link to={`/platform/payments/${p.id}/invoice`} target="_blank">{p.invoiceNo}</Link><span className="muted small block">{fmtDate(p.invoiceDate)}</span></td>
              <td>{p.tenant}<span className="muted small block mono">{p.slug}</span></td><td>{p.plan}{p.kind === 'UPGRADE' ? ' ↑' : ''}</td>
              <td className="small">{fmtDate(p.periodFrom)} – {fmtDate(p.periodTo)}</td>
              <td className="num">{money(p.amount)}</td><td className="num">{money(p.gst)}</td><td className="num"><b>{money(p.total)}</b></td>
              <td className="small">{p.method === 'ONLINE' ? 'Online' : `Recorded · ${p.reference ?? ''}`}</td></tr>)}</tbody></table></div>
        )}
      </section>
    </div>
  );
}

function PlansEditor({ plans, onSaved }: { plans: Plan[]; onSaved: () => void }) {
  const [rows, setRows] = useState(plans);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string }>();
  useEffect(() => setRows(plans), [plans]);
  const set = (i: number, k: keyof Plan, v: any) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const limit = (v: string) => (v === '' ? null : Number(v));
  return (
    <section className="card pad stack">
      <h3 style={{ margin: 0 }}>Plans</h3>
      <p className="muted small" style={{ margin: 0 }}>Yearly price per workspace, before GST. Empty limit = unlimited. A plan switched off is no longer sold; firms on it keep it until renewal.</p>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="table-wrap"><table className="table compact"><thead><tr><th>Code</th><th>Name</th><th>Clients</th><th>Team members</th><th>Price / year (₹)</th><th>Line under the name</th><th>On sale</th></tr></thead>
        <tbody>{rows.map((p, i) => <tr key={i} style={{ cursor: 'default' }}>
          <td><input value={p.code} onChange={(e) => set(i, 'code', e.target.value.toUpperCase())} style={{ width: 100 }} aria-label="Code" /></td>
          <td><input value={p.name} onChange={(e) => set(i, 'name', e.target.value)} style={{ width: 120 }} aria-label="Name" /></td>
          <td><input type="number" value={p.clients ?? ''} onChange={(e) => set(i, 'clients', limit(e.target.value))} style={{ width: 80 }} aria-label="Clients" /></td>
          <td><input type="number" value={p.users ?? ''} onChange={(e) => set(i, 'users', limit(e.target.value))} style={{ width: 80 }} aria-label="Users" /></td>
          <td><input type="number" value={p.price} onChange={(e) => set(i, 'price', Number(e.target.value))} style={{ width: 110 }} aria-label="Price" /></td>
          <td><input value={p.blurb ?? ''} onChange={(e) => set(i, 'blurb', e.target.value)} aria-label="Description" /></td>
          <td><input type="checkbox" checked={p.active} onChange={(e) => set(i, 'active', e.target.checked)} aria-label="On sale" /></td></tr>)}</tbody></table></div>
      <div className="btn-row">
        <button className="btn btn-secondary" onClick={() => setRows([...rows, { code: '', name: '', clients: null, users: null, price: 0, active: true }])}>Add a plan</button>
        <button className="btn btn-primary" onClick={async () => {
          setMsg(undefined);
          try { await api('/platform/plans', { method: 'PUT', body: rows }); setMsg({ kind: 'success', text: 'Plans saved.' }); onSaved(); }
          catch (e: any) { setMsg({ kind: 'error', text: e.message }); }
        }}>Save plans</button>
      </div>
    </section>
  );
}
