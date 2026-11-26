/**
 * Administration → Plan & payment: the firm's ComplyDesk plan, usage against its limits, paying online (Razorpay
 * Checkout) and Integrata's tax invoices. Works while the workspace is read-only — that is how it gets renewed.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useLoad } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { fmtDate, money, num } from '../../lib/format';
import { Alert, Modal, Spinner } from '../../components/ui';
import { InlineForm } from '../../components/Billing';

type Quote = { ok: true; kind: 'NEW' | 'RENEW' | 'UPGRADE'; from: string; to: string; amount: number; note: string; cgst: number; sgst: number; igst: number; total: number } | { ok: false; reason: string };
interface PlanRow { code: string; name: string; clients: number | null; users: number | null; price: number; blurb?: string; current: boolean; quote: Quote }
interface Summary {
  workspace: { name: string; status: string; plan: string | null; planName: string | null; paidUntil: string | null; trialEndsAt: string | null };
  usage: { clients: number; users: number }; limits: { clients: number | null; users: number | null };
  plans: PlanRow[]; gstRate: number; billing: { gstin: string | null; address: string | null; stateCode: string | null };
  gateway: { enabled: boolean; mode: 'mock' | 'test' | 'live' | null };
  payments: { id: string; plan: string; kind: string; periodFrom: string; periodTo: string; total: number; method: string; invoiceNo: string; invoiceDate: string }[];
  states: { code: string; name: string }[];
}
interface Checkout { key: string; mode: string; orderId: string; amount: number; currency: string; description: string; prefill: Record<string, string>; firm: string }

const KIND = { NEW: 'Subscribe', RENEW: 'Renew', UPGRADE: 'Upgrade' } as const;

/** Razorpay's Standard Checkout script, loaded once when first needed. */
function loadCheckout(): Promise<any> {
  const w = window as any;
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => ok(w.Razorpay); s.onerror = () => fail(new Error('Couldn’t load the payment window. Check your connection and try again.'));
    document.head.appendChild(s);
  });
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="small"><b>{label}</b> · {num(used)}{limit ? ` of ${num(limit)}` : ' (no limit)'}</div>
      {limit && <div className="meter-track"><span className={`meter-fill ${pct >= 100 ? 'full' : pct >= 85 ? 'near' : ''}`} style={{ width: `${pct}%` }} /></div>}
    </div>
  );
}

export function Subscription() {
  const { data, error, reload } = useLoad<Summary>('/subscription');
  const { refresh, can } = useSession();
  const [busy, setBusy] = useState<string>();
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string }>();
  const [mockPay, setMockPay] = useState<Checkout>();
  if (error) return <div className="page"><Alert kind="error">{error}</Alert></div>;
  if (!data) return <Spinner />;
  const w = data.workspace;
  const billingReady = !!(data.billing.address && data.billing.stateCode);

  async function confirm(c: { orderId: string; paymentId: string; signature: string }) {
    const p = await api('/subscription/confirm', { body: c });
    setMsg({ kind: 'success', text: `Payment received — thank you. Tax invoice ${p.invoiceNo} is below; a receipt is on its way by email.` });
    await Promise.all([reload(), refresh()]);
  }

  async function pay(plan: PlanRow) {
    setBusy(plan.code); setMsg(undefined);
    try {
      const c = await api<Checkout>('/subscription/checkout', { body: { plan: plan.code } });
      if (c.mode === 'mock') { setMockPay(c); return; }
      const Razorpay = await loadCheckout();
      new Razorpay({
        key: c.key, order_id: c.orderId, amount: c.amount, currency: c.currency, name: 'ComplyDesk', description: c.description, prefill: c.prefill,
        notes: { firm: c.firm }, theme: { color: '#5b2a86' },
        handler: (r: any) => confirm({ orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature })
          .catch((e) => setMsg({ kind: 'error', text: e.message })),
        modal: { ondismiss: () => setMsg({ kind: 'info', text: 'Payment window closed — nothing was charged.' }) },
      }).open();
    } catch (e: any) { setMsg({ kind: 'error', text: e.message }); } finally { setBusy(undefined); }
  }

  return (
    <div className="page stack">
      <div className="page-head"><h1>Plan &amp; payment</h1></div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <section className="card pad stack">
        <div>
          {w.status === 'TRIAL' && <><b>Free trial</b>{w.trialEndsAt && <> · ends {fmtDate(w.trialEndsAt)}</>}</>}
          {w.status === 'ACTIVE' && <><b>{w.planName ? `${w.planName} plan` : 'Subscribed'}</b>{w.paidUntil && <> · paid up to {fmtDate(w.paidUntil)}</>}</>}
          {w.status !== 'TRIAL' && w.status !== 'ACTIVE' && <b>{w.status.replace('_', ' ').toLowerCase()}</b>}
        </div>
        <div className="meters" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Meter label="Client companies" used={data.usage.clients} limit={data.limits.clients} />
          <Meter label="Team members" used={data.usage.users} limit={data.limits.users} />
        </div>
        <p className="muted small" style={{ margin: 0 }}>Client-portal users (your clients’ directors) are free and not counted.</p>
      </section>

      {!data.gateway.enabled && <Alert kind="info">Online payment is being switched on. Until then write to <a href="mailto:info@integratatech.ai">info@integratatech.ai</a> — we’ll send bank details and record your payment here.</Alert>}
      {data.gateway.mode === 'test' && <Alert kind="warning">Razorpay is in test mode: use Razorpay’s test cards; no real money moves.</Alert>}
      {data.gateway.mode === 'mock' && <Alert kind="warning">Payments are simulated on this server (development).</Alert>}
      {data.gateway.enabled && !billingReady && <Alert kind="warning">Add your billing address and state below before paying — they go on the tax invoice.</Alert>}

      <div className="plan-grid">
        {data.plans.map((p) => (
          <section key={p.code} className={`card pad stack plan-card ${p.current ? 'current' : ''}`}>
            <div><h3 style={{ margin: 0 }}>{p.name}{p.current && <span className="badge plan-standard" style={{ marginLeft: 8 }}>Your plan</span>}</h3>{p.blurb && <div className="muted small">{p.blurb}</div>}</div>
            <div className="plan-price">{money(p.price)}<span className="muted small"> / year + GST</span></div>
            <ul className="small plan-limits">
              <li>{p.clients ? `Up to ${num(p.clients)} client companies` : 'Unlimited client companies'}</li>
              <li>{p.users ? `Up to ${num(p.users)} team members` : 'Unlimited team members'}</li>
              <li>Every feature, AI reading and the MCA form filler</li>
            </ul>
            <div className="grow" />
            {p.quote.ok ? (
              <>
                <div className="small muted">{p.quote.note}: {fmtDate(p.quote.from)} – {fmtDate(p.quote.to)}<br />
                  {money(p.quote.amount)} + GST {money(p.quote.cgst + p.quote.sgst + p.quote.igst)} = <b>{money(p.quote.total)}</b></div>
                {can('tenant.settings') && <button className="btn btn-primary" disabled={!data.gateway.enabled || !billingReady || !!busy} onClick={() => pay(p)}>
                  {busy === p.code ? 'Opening…' : `${KIND[p.quote.kind]} — pay ${money(p.quote.total)}`}</button>}
              </>
            ) : <div className="small muted">{p.quote.reason}</div>}
          </section>
        ))}
      </div>

      <section className="card pad stack">
        <h3 style={{ margin: 0 }}>Details for our invoice</h3>
        <p className="muted small" style={{ margin: 0 }}>Integrata’s tax invoice to {w.name}. Enter your GSTIN to claim input tax credit; the state decides CGST + SGST or IGST.</p>
        <InlineForm path="/subscription/billing-details" saveLabel="Save" canSave={can('tenant.settings')} after={() => reload()}
          initial={{ gstin: data.billing.gstin ?? '', billingAddress: data.billing.address ?? '', billingState: data.billing.stateCode ?? '' }}
          fields={[
            { key: 'gstin', label: 'GSTIN', placeholder: '33ABCDE1234F1Z5', help: 'Leave empty if the firm isn’t registered for GST.' },
            { key: 'billingState', label: 'State', type: 'select', required: true, options: data.states.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` })) },
            { key: 'billingAddress', label: 'Billing address', type: 'textarea', wide: true, required: true },
          ]} />
      </section>

      <section className="card pad stack">
        <h3 style={{ margin: 0 }}>Payments and invoices</h3>
        {!data.payments.length ? <p className="muted small" style={{ margin: 0 }}>No payments yet.</p> : (
          <table className="table compact"><thead><tr><th>Invoice</th><th>Date</th><th>Plan</th><th>Period</th><th style={{ textAlign: 'right' }}>Amount</th><th>Paid</th></tr></thead>
            <tbody>{data.payments.map((p) => <tr key={p.id} style={{ cursor: 'default' }}>
              <td><Link to={`/admin/subscription/invoice/${p.id}`} target="_blank">{p.invoiceNo}</Link></td><td>{fmtDate(p.invoiceDate)}</td>
              <td>{data.plans.find((x) => x.code === p.plan)?.name ?? p.plan}{p.kind === 'UPGRADE' ? ' (upgrade)' : ''}</td>
              <td className="small">{fmtDate(p.periodFrom)} – {fmtDate(p.periodTo)}</td><td style={{ textAlign: 'right' }}>{money(p.total)}</td>
              <td className="small">{p.method === 'ONLINE' ? 'Online' : 'Bank transfer'}</td></tr>)}</tbody></table>
        )}
      </section>

      {mockPay && (
        <Modal title="Simulated payment" onClose={() => setMockPay(undefined)} footer={<>
          <button className="btn btn-secondary" onClick={() => setMockPay(undefined)}>Cancel</button>
          <button className="btn btn-primary" onClick={async () => {
            try { const sig = await api('/subscription/mock-pay', { body: { orderId: mockPay.orderId } }); setMockPay(undefined); await confirm(sig); }
            catch (e: any) { setMsg({ kind: 'error', text: e.message }); setMockPay(undefined); }
          }}>Pay {money(mockPay.amount / 100)}</button></>}>
          <p>{mockPay.description}</p><p className="muted small">Development server: no payment gateway is called.</p>
        </Modal>
      )}
    </div>
  );
}
