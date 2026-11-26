/**
 * Subscription payments end to end (PAYMENTS_DRIVER=mock): quotes, billing details, online checkout + confirm,
 * idempotency, the Razorpay webhook, an upgrade recorded by Integrata, invoices and plan limits.
 * Needs the API running with PAYMENTS_DRIVER=mock, PLATFORM_ADMINS=admin@demo.in and a fresh seed.
 * Run: npx tsx scripts/smoke-subscription.ts
 */
import { createHmac } from 'node:crypto';
const BASE = process.env.BASE ?? 'http://localhost:4000/api';
class Agent {
  cookie = '';
  async call(path: string, opts: { method?: string; body?: any; expect?: number; headers?: Record<string, string>; rawBody?: string } = {}) {
    const r = await fetch(BASE + path, {
      method: opts.method ?? (opts.body || opts.rawBody ? 'POST' : 'GET'),
      headers: { ...(opts.rawBody ? {} : { 'X-Requested-With': 'fetch' }), cookie: this.cookie, ...(opts.body || opts.rawBody ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers ?? {}) },
      body: opts.rawBody ?? (opts.body ? JSON.stringify(opts.body) : undefined),
    });
    const set = r.headers.get('set-cookie'); if (set) this.cookie = set.split(';')[0];
    const data: any = await r.json().catch(() => ({}));
    if (opts.expect ? r.status !== opts.expect : !r.ok) throw new Error(`${opts.method ?? 'GET'} ${path} → ${r.status} ${JSON.stringify(data)}`);
    return data;
  }
}
const ok = (c: unknown, m: string) => { if (!c) throw new Error('FAILED: ' + m); console.log('✓', m); };
const login = async (email: string) => { const a = new Agent(); await a.call('/auth/login', { body: { workspace: 'demo', email, password: 'Demo@12345' } }); return a; };
const admin = await login('admin@demo.in');
const exec = await login('karthik@demo.in');
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const plan = (s: any, code: string) => s.plans.find((p: any) => p.code === code);

await exec.call('/subscription', { expect: 403 });
ok(true, 'plan & payment is for the firm admin');
let s = await admin.call('/subscription');
ok(s.gateway.enabled && s.gateway.mode === 'mock', 'payments run on the mock driver');
ok(plan(s, 'PRACTICE').quote.kind === 'NEW' && plan(s, 'PRACTICE').quote.from === today, 'no paid period → a year from today');
ok(plan(s, 'PRACTICE').quote.total === 35400, `₹30,000 + 18% GST = ${plan(s, 'PRACTICE').quote.total}`);

await admin.call('/subscription/checkout', { body: { plan: 'PRACTICE' }, expect: 400 });
ok(true, 'billing address needed before paying');
await admin.call('/subscription/billing-details', { method: 'PUT', body: { gstin: '33AABCD1234E1Z5', billingAddress: '12 Anna Salai, Chennai 600002', billingState: '29' }, expect: 400 });
ok(true, 'state must match the GSTIN');
s = await admin.call('/subscription/billing-details', { method: 'PUT', body: { gstin: '33AABCD1234E1Z5', billingAddress: '12 Anna Salai, Chennai 600002', billingState: '33' } });
ok(s.billing.stateCode === '33', 'billing details saved');

// Integrata's GSTIN in Karnataka → IGST for a Tamil Nadu firm
const plat = await admin.call('/platform/plans');
await admin.call('/platform/seller', { method: 'PUT', body: { ...plat.seller, legalName: 'Integratatech.ai Pvt Ltd', gstin: '29AAFCI1234K1Z2', address: 'Bengaluru', stateCode: '29', invoicePrefix: 'CDX' } });

// Online payment: checkout → (Razorpay) → confirm
const c1 = await admin.call('/subscription/checkout', { body: { plan: 'PRACTICE' } });
ok(c1.orderId.startsWith('order_mock_') && c1.amount === 3540000, 'order created for ₹35,400 (in paise)');
const sig = await admin.call('/subscription/mock-pay', { body: { orderId: c1.orderId } });
await admin.call('/subscription/confirm', { body: { ...sig, signature: 'f'.repeat(64) }, expect: 400 });
ok(true, 'a wrong signature is refused');
const p1 = await admin.call('/subscription/confirm', { body: sig });
const fy = Number(today.slice(5, 7)) >= 4 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
const fyl = `${String(fy % 100).padStart(2, '0')}-${String((fy + 1) % 100).padStart(2, '0')}`;
ok(p1.invoiceNo === `CDX/${fyl}/001`, `paid → invoice ${p1.invoiceNo}`);
ok((await admin.call('/subscription/confirm', { body: sig })).invoiceNo === p1.invoiceNo, 'confirming twice changes nothing');
s = await admin.call('/subscription');
const end1 = s.workspace.paidUntil;
ok(s.workspace.status === 'ACTIVE' && s.workspace.plan === 'PRACTICE' && end1 > today, `Practice plan, paid to ${end1}`);
ok(s.limits.clients === 100 && s.limits.users === 20, 'Practice limits apply');
const inv = await admin.call(`/subscription/invoices/${p1.id}`);
ok(inv.taxInvoice && !inv.intraState && Number(inv.igst) === 5400 && inv.billTo.gstin === '33AABCD1234E1Z5', 'tax invoice: IGST ₹5,400 to the firm’s GSTIN');
ok(inv.lines[0].description.includes('Practice') && inv.words.toLowerCase().includes('thirty five thousand'), 'invoice line and amount in words');
await exec.call(`/subscription/invoices/${'0'.repeat(8)}`, { expect: 404 });

// Renewal paid through the webhook only (browser closed)
const r = plan(s, 'PRACTICE').quote;
ok(r.kind === 'RENEW' && r.from > end1, `renewal starts after ${end1}`);
const c2 = await admin.call('/subscription/checkout', { body: { plan: 'PRACTICE' } });
const hook = JSON.stringify({ event: 'order.paid', payload: { payment: { entity: { id: 'pay_hook_1', order_id: c2.orderId, amount: c2.amount } } } });
await new Agent().call('/razorpay/webhook', { rawBody: hook, headers: { 'x-razorpay-signature': 'bad' }, expect: 400 });
ok(true, 'webhook with a bad signature refused');
await new Agent().call('/razorpay/webhook', { rawBody: hook, headers: { 'x-razorpay-signature': createHmac('sha256', 'mock_webhook').update(hook).digest('hex') } });
s = await admin.call('/subscription');
ok(s.workspace.paidUntil > end1 && s.payments.length === 2, `webhook marked it paid; now paid to ${s.workspace.paidUntil}`);

// Upgrade recorded by Integrata (bank transfer)
const up = plan(s, 'FIRM').quote;
ok(up.kind === 'UPGRADE' && up.to === s.workspace.paidUntil && up.amount < 75000 * 2, `upgrade: ₹${up.amount} for the days left`);
ok(!plan(s, 'STARTER').quote.ok, 'a smaller plan waits for renewal');
const t = (await admin.call('/platform/tenants')).find((x: any) => x.slug === 'demo');
const p3 = await admin.call(`/platform/tenants/${t.id}/payments`, { body: { plan: 'FIRM', reference: 'UTR123456789', paidOn: today } });
ok(p3.invoiceNo === `CDX/${fyl}/003` && p3.kind === 'UPGRADE', `recorded by Integrata → ${p3.invoiceNo}`);
s = await admin.call('/subscription');
ok(s.workspace.plan === 'FIRM' && s.limits.users === 40, 'now on the Firm plan');
ok((await admin.call('/platform/payments')).length === 3, 'platform sees every payment');
ok((await admin.call(`/platform/payments/${p3.id}`)).number === p3.invoiceNo, 'platform opens the invoice');

// Plan limits: cut the Firm plan's team size to what is in use, then add one more user
const plans = (await admin.call('/platform/plans')).plans;
await admin.call('/platform/plans', { method: 'PUT', body: plans.map((p: any) => (p.code === 'FIRM' ? { ...p, users: s.usage.users } : p)) });
const roles = await admin.call('/admin/roles');
const err = await admin.call('/admin/users', { body: { name: 'One Too Many', email: 'extra@demo.in', password: 'Extra@12345', roleIds: [roles[0].id], clientIds: [], status: 'ACTIVE' }, expect: 402 });
ok(err.error.includes('team members'), 'a user beyond the plan is refused');
await admin.call('/platform/plans', { method: 'PUT', body: plans });
await admin.call('/admin/users', { body: { name: 'One More', email: 'extra@demo.in', password: 'Extra@12345', roleIds: [roles[0].id], clientIds: [], status: 'ACTIVE' }, expect: 201 });
ok(true, 'and allowed once the plan covers it');
console.log('\nsubscription smoke passed');
