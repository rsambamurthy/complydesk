/**
 * A firm's ComplyDesk subscription: plan, what it can buy today, paying online (Razorpay) or by hand (Integrata),
 * Integrata's tax invoice, plan limits and renewal reminders. Plans and pricing are data (platform/plans.ts +
 * platform settings). Documented in docs/subscription.md; smoke scripts/smoke-subscription.ts.
 */
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, HttpError } from '../lib/core.js';
import { sendMail, appUrl } from '../lib/mailer.js';
import { DEFAULT_PLANS, DEFAULT_SELLER, GST_RATE, RENEWAL_REMINDER_DAYS, daysBetween, limitsFor, quote, withGst, type Plan, type Seller } from '../platform/plans.js';
import { amountInWords, GST_STATES, GSTIN_RE, invoiceFy, invoiceNumber, stateName } from '../billing/calc.js';
import { createOrder, gatewayEnabled, gatewayMode, paymentSignatureOk, publicKey } from '../lib/razorpay.js';
import { getSettings } from './platform.js';
import type { SubscriptionPayment, Tenant } from '../db/schema.js';

const { tenants, users, clients, subscriptionPayments, platformSettings, platformEvents } = schema;

const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
/** paidUntil is stored as the end of that day in India. */
const endOfDayIst = (d: string) => new Date(`${d}T23:59:59+05:30`);
const istDate = (t: Date | null) => (t ? new Date(t.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) : null);
const n = (v: unknown) => Number(v ?? 0);

// ---- Plans and Integrata's invoice details (platform console) ----------------------------------------------
export async function plansAndSeller() {
  const s = await getSettings();
  return { plans: (s.plans?.length ? s.plans : DEFAULT_PLANS) as Plan[], seller: { ...DEFAULT_SELLER, ...(s.seller ?? {}) } as Seller };
}

export const plansInput = z.array(z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,19}$/, 'Letters, digits, _'),
  name: z.string().trim().min(2),
  clients: z.coerce.number().int().min(1).nullable(),
  users: z.coerce.number().int().min(1).nullable(),
  price: z.coerce.number().min(1),
  active: z.boolean(),
  blurb: z.string().trim().max(80).optional(),
})).min(1).refine((ps) => new Set(ps.map((p) => p.code)).size === ps.length, 'Plan codes must be different');

export const sellerInput = z.object({
  legalName: z.string().trim().min(3),
  gstin: z.string().trim().toUpperCase().refine((v) => !v || GSTIN_RE.test(v), 'GSTIN looks like 33ABCDE1234F1Z5'),
  address: z.string().trim(),
  stateCode: z.string().trim().refine((v) => !v || v in GST_STATES, 'Pick a state'),
  pan: z.string().trim().toUpperCase().optional(),
  sac: z.string().trim().optional(),
  invoicePrefix: z.string().trim().refine((v) => !v || /^[A-Za-z0-9]{1,5}$/.test(v), 'Up to 5 letters or digits').optional(),
  email: z.string().trim().email().optional().or(z.literal('')),
}).transform((s) => ({ ...s, stateCode: s.stateCode || (s.gstin ? s.gstin.slice(0, 2) : '') }));

export async function savePlans(plans: z.output<typeof plansInput>) {
  await getSettings();
  await db.update(platformSettings).set({ plans, updatedAt: new Date() }).where(eq(platformSettings.id, 'default'));
  return plansAndSeller();
}
export async function saveSeller(seller: z.output<typeof sellerInput>) {
  await getSettings();
  await db.update(platformSettings).set({ seller, updatedAt: new Date() }).where(eq(platformSettings.id, 'default'));
  return plansAndSeller();
}

// ---- Usage and limits --------------------------------------------------------------------------------------
export async function usage(tenantId: string) {
  const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(clients).where(and(eq(clients.tenantId, tenantId), eq(clients.status, 'ACTIVE')));
  const [{ u }] = await db.select({ u: sql<number>`count(*)::int` }).from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.status, 'ACTIVE'), sql`jsonb_array_length(${users.clientIds}) = 0`));
  return { clients: c, users: u };
}

async function tenantLimits(t: Pick<Tenant, 'status' | 'plan'>) {
  const [{ plans }, s] = await Promise.all([plansAndSeller(), getSettings()]);
  return limitsFor(t, plans, s.trialClientLimit);
}

/** Adding client companies: the trial limit while on trial, the plan's limit once subscribed. */
export async function assertClientCapacity(tenantId: string, adding = 1) {
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!t) return;
  const lim = await tenantLimits(t);
  if (!lim.clients) return;
  const { clients: have } = await usage(tenantId);
  if (have + adding <= lim.clients) return;
  throw new HttpError(402, t.status === 'TRIAL'
    ? `The free trial covers up to ${lim.clients} client companies (you have ${have}). Subscribe under Administration → Plan & payment to add more.`
    : `Your plan covers ${lim.clients} client companies (you have ${have}). Move to a bigger plan under Administration → Plan & payment.`);
}

/** Adding (or re-activating) firm users: the plan's user limit. Client-portal users are free. */
export async function assertUserCapacity(tenantId: string, adding = 1) {
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!t) return;
  const lim = await tenantLimits(t);
  if (!lim.users) return;
  const { users: have } = await usage(tenantId);
  if (have + adding > lim.users) throw new HttpError(402, `Your plan covers ${lim.users} team members (you have ${have}). Move to a bigger plan under Administration → Plan & payment.`);
}

// ---- What the firm sees -------------------------------------------------------------------------------------
const current = (t: Tenant, use: { clients: number; users: number }) => ({ plan: t.plan, paidUntil: t.status === 'ACTIVE' ? istDate(t.paidUntil) : null, ...use });

export async function summary(tenantId: string) {
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!t) throw new HttpError(404, 'Workspace not found');
  const [{ plans, seller }, use, payments] = await Promise.all([
    plansAndSeller(), usage(tenantId),
    db.select().from(subscriptionPayments).where(and(eq(subscriptionPayments.tenantId, tenantId), eq(subscriptionPayments.status, 'PAID'))).orderBy(desc(subscriptionPayments.paidAt)),
  ]);
  const today = todayIst();
  const cur = current(t, use);
  const shown = plans.filter((p) => p.active || p.code === t.plan);
  return {
    workspace: { name: t.name, status: t.status, plan: t.plan, planName: plans.find((p) => p.code === t.plan)?.name ?? null, paidUntil: istDate(t.paidUntil), trialEndsAt: istDate(t.trialEndsAt) },
    usage: use, limits: await tenantLimits(t),
    plans: shown.map((p) => {
      const q = quote(p, cur, plans, today);
      return { ...p, current: p.code === t.plan, quote: q.ok ? { ...q, ...withGst(q.amount, seller.stateCode, buyerState(t)) } : q };
    }),
    gstRate: GST_RATE,
    billing: { name: t.name, gstin: t.gstin, address: t.billingAddress, stateCode: buyerState(t), city: t.city },
    gateway: { enabled: gatewayEnabled(), mode: gatewayEnabled() ? gatewayMode() : null },
    payments: payments.map(paymentRow),
    states: Object.entries(GST_STATES).map(([code, name]) => ({ code, name })),
  };
}
const buyerState = (t: Pick<Tenant, 'billingState' | 'gstin'>) => t.billingState || (t.gstin ? t.gstin.slice(0, 2) : null);
const paymentRow = (p: SubscriptionPayment) => ({ id: p.id, plan: p.plan, kind: p.kind, periodFrom: p.periodFrom, periodTo: p.periodTo, total: n(p.total), method: p.method, invoiceNo: p.invoiceNo, invoiceDate: p.invoiceDate, paidAt: p.paidAt, reference: p.reference });

export const billingDetailsInput = z.object({
  gstin: z.string().trim().toUpperCase().nullish().transform((v) => v || null).refine((v) => !v || GSTIN_RE.test(v), 'GSTIN looks like 33ABCDE1234F1Z5'),
  billingAddress: z.string().trim().min(5, 'Enter the address for the invoice'),
  billingState: z.string().trim().refine((v) => v in GST_STATES, 'Pick the state'),
});
export async function saveBillingDetails(tenantId: string, b: z.output<typeof billingDetailsInput>) {
  if (b.gstin && b.gstin.slice(0, 2) !== b.billingState) throw new HttpError(400, 'The state doesn’t match the GSTIN', { billingState: `GSTIN is registered in ${stateName(b.gstin.slice(0, 2))}` });
  await db.update(tenants).set(b).where(eq(tenants.id, tenantId));
}

// ---- Paying ------------------------------------------------------------------------------------------------
async function priced(t: Tenant, planCode: string) {
  const { plans, seller } = await plansAndSeller();
  const plan = plans.find((p) => p.code === planCode);
  if (!plan) throw new HttpError(404, 'No such plan');
  const q = quote(plan, current(t, await usage(t.id)), plans, todayIst());
  if (!q.ok) throw new HttpError(400, q.reason);
  return { q, seller, tax: withGst(q.amount, seller.stateCode, buyerState(t)) };
}
const buyerOf = (t: Tenant) => ({ name: t.name, gstin: t.gstin, address: t.billingAddress, state: buyerState(t), email: t.contactEmail });

export async function startCheckout(tenantId: string, planCode: string, by: { email: string; name: string }) {
  if (!gatewayEnabled()) throw new HttpError(400, 'Online payment isn’t switched on yet — write to info@integratatech.ai and we’ll send payment details.');
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!t.billingAddress || !buyerState(t)) throw new HttpError(400, 'Add your billing address and state first (they go on the tax invoice).');
  const { q, tax } = await priced(t, planCode);
  const order = await createOrder(tax.total, `cdx-${t.slug}-${Date.now().toString(36)}`, { workspace: t.slug, plan: q.plan.code, kind: q.kind });
  await db.insert(subscriptionPayments).values({
    tenantId, plan: q.plan.code, kind: q.kind, periodFrom: q.from, periodTo: q.to, amount: String(tax.amount), cgst: String(tax.cgst), sgst: String(tax.sgst), igst: String(tax.igst), total: String(tax.total),
    method: 'ONLINE', status: 'CREATED', orderId: order.id, buyer: buyerOf(t), createdBy: by.email,
  });
  return { key: publicKey(), mode: gatewayMode(), orderId: order.id, amount: order.amount, currency: order.currency, description: `${q.plan.name} plan · ${q.from} to ${q.to}`, prefill: { name: by.name, email: by.email, contact: t.contactMobile ?? '' }, firm: t.name };
}

export const confirmInput = z.object({ orderId: z.string().min(5), paymentId: z.string().min(5), signature: z.string().min(10) });
export async function confirmCheckout(tenantId: string, c: z.output<typeof confirmInput>) {
  if (!paymentSignatureOk(c.orderId, c.paymentId, c.signature)) throw new HttpError(400, 'This payment could not be verified. If money was taken, it will be matched automatically or refunded — write to info@integratatech.ai.');
  const [p] = await db.select().from(subscriptionPayments).where(and(eq(subscriptionPayments.orderId, c.orderId), eq(subscriptionPayments.tenantId, tenantId)));
  if (!p) throw new HttpError(404, 'Order not found');
  return paymentRow(await markPaid(p.id, { paymentId: c.paymentId }));
}

/** Razorpay webhook (order.paid / payment.captured): the backstop when the browser closes before confirming. */
export async function handleWebhook(body: any) {
  const pay = body?.payload?.payment?.entity;
  if (!['order.paid', 'payment.captured'].includes(body?.event) || !pay?.order_id) return { ignored: true };
  const [p] = await db.select().from(subscriptionPayments).where(eq(subscriptionPayments.orderId, pay.order_id));
  if (!p) return { ignored: true };
  if (Math.round(n(p.total) * 100) !== Number(pay.amount)) { console.error(`webhook amount mismatch for ${pay.order_id}`); return { ignored: true }; }
  await markPaid(p.id, { paymentId: pay.id });
  return { ok: true };
}

/**
 * One place a payment becomes real (idempotent): number the invoice, extend the workspace, email the receipt.
 * A renewal paid after another payment already moved the end date starts after the new end.
 */
async function markPaid(id: string, x: { paymentId?: string; reference?: string; paidOn?: string; by?: string }) {
  const done = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('subscription_invoice'))`);
    const [p] = await tx.select().from(subscriptionPayments).where(eq(subscriptionPayments.id, id)).for('update');
    if (p.status === 'PAID') return { p, fresh: false };
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, p.tenantId)).for('update');
    let { periodFrom, periodTo } = p;
    const end = t.status === 'ACTIVE' ? istDate(t.paidUntil) : null;
    if (p.kind !== 'UPGRADE' && end && end >= periodFrom) {
      const len = daysBetween(periodFrom, periodTo);
      periodFrom = new Date(Date.parse(`${end}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      periodTo = new Date(Date.parse(`${periodFrom}T00:00:00Z`) + len * 86_400_000).toISOString().slice(0, 10);
    }
    const invoiceDate = x.paidOn ?? todayIst();
    const fy = invoiceFy(invoiceDate);
    const { seller } = await plansAndSeller();
    const prefix = seller.invoicePrefix || 'CDX';
    const [{ k }] = await tx.select({ k: sql<number>`count(*)::int` }).from(subscriptionPayments).where(and(isNotNull(subscriptionPayments.invoiceNo), sql`${subscriptionPayments.invoiceNo} like ${invoiceNumber(prefix, fy, 0).replace(/000$/, '%')}`));
    const [paid] = await tx.update(subscriptionPayments).set({
      status: 'PAID', paymentId: x.paymentId ?? p.paymentId, reference: x.reference ?? p.reference, periodFrom, periodTo,
      invoiceNo: invoiceNumber(prefix, fy, k + 1), invoiceDate, paidAt: new Date(),
    }).where(eq(subscriptionPayments.id, id)).returning();
    const newEnd = end && end > periodTo ? end : periodTo;
    await tx.update(tenants).set({ status: 'ACTIVE', plan: p.plan, paidUntil: endOfDayIst(newEnd), trialEndsAt: null }).where(eq(tenants.id, t.id));
    await tx.insert(platformEvents).values({ tenantId: t.id, type: 'payment', by: x.by ?? p.createdBy, data: { invoiceNo: paid.invoiceNo, plan: p.plan, total: n(p.total), method: p.method, until: newEnd } as any });
    return { p: paid, fresh: true, t, newEnd };
  });
  if (done.fresh) await receipt(done.p, done.t!, done.newEnd!).catch((e) => console.error('receipt mail failed:', e.message));
  return done.p;
}

async function receipt(p: SubscriptionPayment, t: Tenant, until: string) {
  const to = new Set([t.contactEmail, p.createdBy].filter((e): e is string => !!e && e.includes('@')));
  const { plans } = await plansAndSeller();
  const name = plans.find((x) => x.code === p.plan)?.name ?? p.plan;
  for (const email of to) await sendMail(email, `ComplyDesk payment received — ${p.invoiceNo}`,
    `Thank you. We have received ₹${n(p.total).toLocaleString('en-IN')} for the ${name} plan of ${t.name}.\n\nYour subscription runs to ${until}.\nTax invoice ${p.invoiceNo}: ${appUrl(`/admin/subscription/invoice/${p.id}`)}\n\n— Integrata`);
}

// ---- Integrata records a payment made by bank transfer / cheque ---------------------------------------------
export const offlineInput = z.object({
  plan: z.string().min(2),
  reference: z.string().trim().min(3, 'UTR, cheque number or note'),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.coerce.number().min(0).optional(),
});
export async function recordOffline(tenantId: string, o: z.output<typeof offlineInput>, by: string) {
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!t) throw new HttpError(404, 'Workspace not found');
  const { q, seller } = await priced(t, o.plan);
  const tax = withGst(o.amount ?? q.amount, seller.stateCode, buyerState(t));
  const [row] = await db.insert(subscriptionPayments).values({
    tenantId, plan: q.plan.code, kind: q.kind, periodFrom: q.from, periodTo: q.to, amount: String(tax.amount), cgst: String(tax.cgst), sgst: String(tax.sgst), igst: String(tax.igst), total: String(tax.total),
    method: 'OFFLINE', status: 'CREATED', reference: o.reference, buyer: buyerOf(t), createdBy: by,
  }).returning();
  return paymentRow(await markPaid(row.id, { reference: o.reference, paidOn: o.paidOn, by }));
}

export async function allPayments() {
  const rows = await db.select({ p: subscriptionPayments, tenant: tenants.name, slug: tenants.slug }).from(subscriptionPayments)
    .innerJoin(tenants, eq(tenants.id, subscriptionPayments.tenantId)).where(eq(subscriptionPayments.status, 'PAID')).orderBy(desc(subscriptionPayments.paidAt)).limit(500);
  return rows.map((r) => ({ ...paymentRow(r.p), tenant: r.tenant, slug: r.slug, amount: n(r.p.amount), gst: n(r.p.cgst) + n(r.p.sgst) + n(r.p.igst) }));
}

/**
 * Integrata's tax invoice for a payment (tenantId null = platform admin), in the same shape as a firm's own invoice
 * (services/billing.ts) so one print page (web InvoicePrint) renders both.
 */
export async function invoice(id: string, tenantId: string | null) {
  const [p] = await db.select().from(subscriptionPayments).where(eq(subscriptionPayments.id, id));
  if (!p || p.status !== 'PAID' || (tenantId && p.tenantId !== tenantId)) throw new HttpError(404, 'Invoice not found');
  const { plans, seller } = await plansAndSeller();
  const plan = plans.find((x) => x.code === p.plan);
  const b = p.buyer;
  const dmy = (d: string) => d.split('-').reverse().join('/');
  const kind = p.kind === 'UPGRADE' ? 'upgrade (difference for the remaining period)' : 'annual subscription';
  return {
    id: p.id, status: 'PAID', number: p.invoiceNo, date: p.invoiceDate, dueDate: p.invoiceDate, notes: null,
    paidNote: `Paid${p.paidAt ? ` on ${dmy(istDate(p.paidAt)!)}` : ''} · ${p.method === 'ONLINE' ? `online${p.paymentId ? ` (${p.paymentId})` : ''}` : p.reference ?? 'by transfer'}`,
    firm: { legalName: seller.legalName, address: seller.address, gstin: seller.gstin, pan: seller.pan },
    billTo: { name: b.name, address: b.address, gstin: b.gstin },
    placeOfSupplyName: stateName(b.state), gstRate: String(GST_RATE), taxInvoice: !!seller.gstin, intraState: n(p.igst) === 0,
    taxable: p.amount, cgst: p.cgst, sgst: p.sgst, igst: p.igst, nonTaxable: '0', total: p.total, words: amountInWords(n(p.total)),
    lines: [{ description: `ComplyDesk ${plan?.name ?? p.plan} plan — ${kind}, ${dmy(p.periodFrom)} to ${dmy(p.periodTo)}`, amount: p.amount, taxable: true, sac: seller.sac || '' }],
  };
}

// ---- Renewal reminders (daily job) --------------------------------------------------------------------------
export async function runRenewalReminders(today = todayIst()) {
  const ts = await db.select().from(tenants).where(and(eq(tenants.status, 'ACTIVE'), isNotNull(tenants.paidUntil)));
  let sent = 0;
  for (const t of ts) {
    const end = istDate(t.paidUntil)!;
    const left = daysBetween(today, end);
    if (!RENEWAL_REMINDER_DAYS.includes(left) || !t.contactEmail) continue;
    const text = left >= 0
      ? `Your ComplyDesk subscription for ${t.name} ends on ${end} (${left === 0 ? 'today' : `${left} day${left === 1 ? '' : 's'} left`}).\nRenew in a minute: ${appUrl('/admin/subscription')}\n\n— Integrata`
      : `Your ComplyDesk subscription for ${t.name} ended on ${end}. Everything keeps working for 7 days; after that the workspace becomes read-only until it is renewed.\nRenew: ${appUrl('/admin/subscription')}\n\n— Integrata`;
    await sendMail(t.contactEmail, left >= 0 ? 'Your ComplyDesk subscription is due for renewal' : 'Your ComplyDesk subscription has ended', text).catch((e) => console.error('renewal mail failed:', e.message));
    await db.insert(platformEvents).values({ tenantId: t.id, type: 'renewal_reminder', by: null, data: { left, end } as any });
    sent++;
  }
  return sent;
}
