/**
 * Fees and billing: the firm's billing details, fees per kind of filing (firm default / client's own), work done and
 * not yet billed, invoices (draft → issued, numbered per FY; cancel), payments with TDS, and a summary with ageing.
 * Arithmetic lives in billing/calc.ts.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, HttpError, notFound } from '../lib/core.js';
import { settingsOf } from '../lib/settings.js';
import { addDays, fyStart, todayIst as todayIso, fyOf, fyLabel } from '../compliance/dates.js';
import { rulesFor } from '../compliance/sync.js';
import type { BillingProfile, ClientBilling, Tenant } from '../db/schema.js';
import { ageBucket, amountInWords, balanceOf, clientStateCode, feeFor, GSTIN_RE, GST_STATES, invoiceNumber, invoiceTotals, stateName } from '../billing/calc.js';
import { getClient } from './clients.js';

const { invoices: inv, invoiceLines: lines, payments: pay, fees, obligations: ob, clients } = schema;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date');
const optText = z.string().trim().max(2000).nullish().transform((v) => v || undefined);
const amount = z.union([z.number(), z.string()]).transform((v) => Number(String(v).replace(/[₹,\s]/g, ''))).refine((n) => Number.isFinite(n) && n >= 0, 'Enter an amount');

// ---- Firm billing details ---------------------------------------------------------------------------------------
export const profileInput = z.object({
  legalName: optText, gstin: z.string().trim().toUpperCase().nullish().transform((v) => v || undefined).refine((v) => !v || GSTIN_RE.test(v), 'GSTIN looks like 33ABCDE1234F1Z5'),
  pan: z.string().trim().toUpperCase().nullish().transform((v) => v || undefined).refine((v) => !v || /^[A-Z]{5}\d{4}[A-Z]$/.test(v), 'PAN looks like ABCDE1234F'),
  address: optText, stateCode: z.string().nullish().transform((v) => v || undefined).refine((v) => !v || !!GST_STATES[v], 'Pick the state'),
  sac: optText, gstRate: z.coerce.number().min(0).max(40).optional(),
  invoicePrefix: z.string().trim().max(5).regex(/^[A-Za-z0-9/-]*$/, 'Letters, digits, / or - (up to 5)').nullish().transform((v) => v || undefined),
  dueDays: z.coerce.number().int().min(0).max(120).optional(),
  bankDetails: optText, terms: optText,
  billFrom: dateStr.nullish().transform((v) => v || undefined),
});
export type Profile = BillingProfile & { billFrom?: string };
export const profileOf = (t: Pick<Tenant, 'settings' | 'name'>): Required<Pick<Profile, 'gstRate' | 'invoicePrefix' | 'dueDays' | 'billFrom'>> & Profile => ({
  gstRate: 18, invoicePrefix: 'INV', dueDays: 15, billFrom: fyStart(fyOf(todayIso())), legalName: t.name, ...(settingsOf(t) as any).billing,
});
export async function saveProfile(t: Tenant, input: z.output<typeof profileInput>) {
  const billing = { ...((t.settings as any).billing ?? {}), ...input };
  if (billing.gstin && billing.stateCode && billing.gstin.slice(0, 2) !== billing.stateCode) throw new HttpError(400, 'The GSTIN is for another state', { stateCode: `GSTIN is registered in ${stateName(billing.gstin.slice(0, 2))}` });
  if (billing.gstin && !billing.stateCode) billing.stateCode = billing.gstin.slice(0, 2);
  const [row] = await db.update(schema.tenants).set({ settings: { ...t.settings, billing } }).where(eq(schema.tenants.id, t.id)).returning();
  return profileOf(row);
}
/** GST is charged only when the firm has a GSTIN. */
const effectiveRate = (p: Profile) => (p.gstin ? Number(p.gstRate ?? 18) : 0);

// ---- Client billing details -------------------------------------------------------------------------------------
export const clientBillingInput = z.object({
  billingName: optText, address: optText, email: z.string().trim().email('Enter a valid email').nullish().or(z.literal('')).transform((v) => v || undefined),
  gstin: z.string().trim().toUpperCase().nullish().transform((v) => v || undefined).refine((v) => !v || GSTIN_RE.test(v), 'GSTIN looks like 33ABCDE1234F1Z5'),
  stateCode: z.string().nullish().transform((v) => v || undefined).refine((v) => !v || !!GST_STATES[v], 'Pick the state'),
  retainer: amount.nullish().or(z.literal('')).transform((v) => (v === '' || v === null || v === undefined ? undefined : Number(v))),
  retainerPeriod: z.enum(['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY']).nullish().or(z.literal('')).transform((v) => v || undefined),
});
export async function clientBilling(tenantId: string, clientId: string) {
  const c = await getClient(tenantId, clientId);
  const b = (c as any).billing as ClientBilling;
  const state = clientStateCode(b, c.cin);
  return { ...b, placeOfSupply: state, placeOfSupplyName: stateName(state), stateFromCin: !b.gstin && !b.stateCode && !!state };
}
export async function saveClientBilling(tenantId: string, clientId: string, input: z.output<typeof clientBillingInput>) {
  await getClient(tenantId, clientId);
  if (input.gstin && input.stateCode && input.gstin.slice(0, 2) !== input.stateCode) throw new HttpError(400, 'The GSTIN is for another state', { stateCode: `GSTIN is registered in ${stateName(input.gstin.slice(0, 2))}` });
  await db.update(clients).set({ billing: input as ClientBilling }).where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId)));
  return clientBilling(tenantId, clientId);
}

// ---- Fees -------------------------------------------------------------------------------------------------------
async function feeMaps(tenantId: string, clientId?: string) {
  const rows = await db.select().from(fees).where(eq(fees.tenantId, tenantId));
  const firm = new Map(rows.filter((r) => !r.clientId).map((r) => [r.ruleCode, Number(r.amount)]));
  const byClient = new Map<string, Map<string, number>>();
  for (const r of rows.filter((x) => x.clientId)) {
    if (!byClient.has(r.clientId!)) byClient.set(r.clientId!, new Map());
    byClient.get(r.clientId!)!.set(r.ruleCode, Number(r.amount));
  }
  return { firm, forClient: (id: string) => byClient.get(id) ?? new Map<string, number>(), client: clientId ? byClient.get(clientId) ?? new Map() : undefined };
}
/** Every kind of filing with the firm's fee and (for a client) the client's own fee. */
export async function feeList(tenantId: string, clientId?: string) {
  if (clientId) await getClient(tenantId, clientId);
  const [rules, maps] = await Promise.all([rulesFor(tenantId), feeMaps(tenantId, clientId)]);
  return rules.map((r) => ({ ruleCode: r.code, form: r.form, title: r.title, firmFee: maps.firm.get(r.code) ?? null, clientFee: clientId ? maps.client!.get(r.code) ?? null : undefined }))
    .sort((a, b) => a.form.localeCompare(b.form));
}
export const feesInput = z.object({ fees: z.array(z.object({ ruleCode: z.string().min(1), amount: z.union([z.number(), z.string(), z.null()]) })).max(200) });
export async function saveFees(tenantId: string, clientId: string | null, input: z.output<typeof feesInput>) {
  if (clientId) await getClient(tenantId, clientId);
  const codes = new Set((await rulesFor(tenantId)).map((r) => r.code));
  const errors: Record<string, string> = {};
  for (const f of input.fees) {
    if (!codes.has(f.ruleCode)) { errors[f.ruleCode] = 'Unknown filing'; continue; }
    const where = and(eq(fees.tenantId, tenantId), clientId ? eq(fees.clientId, clientId) : isNull(fees.clientId), eq(fees.ruleCode, f.ruleCode));
    if (f.amount === null || f.amount === '') { await db.delete(fees).where(where); continue; }
    const n = Number(String(f.amount).replace(/[₹,\s]/g, ''));
    if (!Number.isFinite(n) || n < 0) { errors[f.ruleCode] = 'Enter an amount'; continue; }
    await db.insert(fees).values({ tenantId, clientId, ruleCode: f.ruleCode, amount: String(n) })
      .onConflictDoUpdate({ target: [fees.tenantId, fees.clientId, fees.ruleCode], set: { amount: String(n), updatedAt: new Date() } });
  }
  if (Object.keys(errors).length) throw new HttpError(400, 'Some fees were not saved', errors);
  return feeList(tenantId, clientId ?? undefined);
}

// ---- Work done, not yet billed ----------------------------------------------------------------------------------
/** Filings marked filed (or approved by MCA) since the firm's "bill from" date that are on no live invoice. */
export async function unbilled(t: Tenant, clientId?: string) {
  const p = profileOf(t);
  const billed = db.select({ id: lines.obligationId }).from(lines).innerJoin(inv, eq(inv.id, lines.invoiceId)).where(and(eq(inv.tenantId, t.id), ne(inv.status, 'CANCELLED'), isNotNull(lines.obligationId)));
  const rows = await db.select({ id: ob.id, clientId: ob.clientId, clientName: clients.name, ruleCode: ob.ruleCode, form: ob.form, title: ob.title, fy: ob.fy, periodLabel: ob.periodLabel, filedOn: ob.filedOn, srn: ob.srn })
    .from(ob).innerJoin(clients, eq(clients.id, ob.clientId))
    .where(and(eq(ob.tenantId, t.id), eq(ob.status, 'FILED'), gte(ob.filedOn, p.billFrom), sql`${ob.id} not in (${billed})`, clientId ? eq(ob.clientId, clientId) : undefined))
    .orderBy(asc(clients.name), asc(ob.filedOn));
  const maps = await feeMaps(t.id);
  return rows.map((r) => ({ ...r, fyLabel: fyLabel(r.fy), fee: feeFor(r.ruleCode, maps.forClient(r.clientId), maps.firm) }));
}

// ---- Invoices ---------------------------------------------------------------------------------------------------
const describe = (o: { form: string; title: string; periodLabel: string; fy: number; srn: string | null }) =>
  `${o.form} — ${o.title}${o.periodLabel && o.periodLabel !== fyLabel(o.fy) ? `, ${o.periodLabel}` : ''} (${fyLabel(o.fy)})${o.srn ? `, SRN ${o.srn}` : ''}`;

const lineInput = z.object({
  description: z.string().trim().min(2, 'Describe the item').max(300),
  amount, taxable: z.boolean().default(true), obligationId: z.string().nullish(), sac: optText,
});
export const createInput = z.object({ clientId: z.string(), obligationIds: z.array(z.string()).max(200).default([]), lines: z.array(lineInput).max(50).default([]), retainer: z.boolean().default(false) });
export const draftInput = z.object({ date: dateStr, dueDate: dateStr, notes: optText, lines: z.array(lineInput).min(1, 'Add at least one item').max(80) });

async function snapshots(t: Tenant, clientId: string) {
  const p = profileOf(t);
  const c = await getClient(t.id, clientId);
  const b = (c as any).billing as ClientBilling;
  const pos = clientStateCode(b, c.cin);
  return {
    firm: { name: t.name, legalName: p.legalName, gstin: p.gstin, pan: p.pan, address: p.address, stateCode: p.stateCode, sac: p.sac, bankDetails: p.bankDetails, terms: p.terms },
    billTo: { name: b.billingName || c.name, cin: c.cin, gstin: b.gstin, address: b.address || c.registeredOffice || undefined, stateCode: pos ?? undefined, email: b.email || c.email || undefined },
    placeOfSupply: pos, gstRate: effectiveRate(p), profile: p,
  };
}

async function writeLines(invoiceId: string, list: z.output<typeof lineInput>[], sac?: string) {
  await db.delete(lines).where(eq(lines.invoiceId, invoiceId));
  if (list.length) await db.insert(lines).values(list.map((l, i) => ({ invoiceId, obligationId: l.obligationId ?? null, description: l.description, sac: l.sac ?? (l.taxable ? sac : undefined) ?? null, amount: String(l.amount), taxable: l.taxable, position: i })));
}
async function retotal(invoiceId: string) {
  const [i] = await db.select().from(inv).where(eq(inv.id, invoiceId));
  const ls = await db.select().from(lines).where(eq(lines.invoiceId, invoiceId));
  const tot = invoiceTotals(ls, Number(i.gstRate), i.firm?.stateCode, i.placeOfSupply);
  await db.update(inv).set({ taxable: String(tot.taxable), cgst: String(tot.cgst), sgst: String(tot.sgst), igst: String(tot.igst), nonTaxable: String(tot.nonTaxable), total: String(tot.total) }).where(eq(inv.id, invoiceId));
}

const RETAINER_LABEL = { MONTHLY: 'month', QUARTERLY: 'quarter', HALF_YEARLY: 'half-year', YEARLY: 'year' } as const;

export async function createInvoice(t: Tenant, userId: string, input: z.output<typeof createInput>) {
  const s = await snapshots(t, input.clientId);
  const work = input.obligationIds.length ? (await unbilled(t, input.clientId)).filter((o) => input.obligationIds.includes(o.id)) : [];
  if (work.length !== input.obligationIds.length) throw new HttpError(400, 'Some filings are already billed or not filed yet — refresh and try again.');
  const all: z.output<typeof lineInput>[] = work.map((o) => ({ description: describe(o), amount: o.fee ?? 0, taxable: true, obligationId: o.id }));
  const cb = (await getClient(t.id, input.clientId) as any).billing as ClientBilling;
  if (input.retainer && cb.retainer) all.unshift({ description: `Retainer for company secretarial services — ${RETAINER_LABEL[cb.retainerPeriod ?? 'MONTHLY']} of ___`, amount: cb.retainer, taxable: true });
  all.push(...input.lines);
  if (!all.length) throw new HttpError(400, 'Pick at least one filing or add an item');
  const date = todayIso();
  const [row] = await db.insert(inv).values({ tenantId: t.id, clientId: input.clientId, date, dueDate: addDays(date, s.profile.dueDays), firm: s.firm as any, billTo: s.billTo as any, placeOfSupply: s.placeOfSupply, gstRate: String(s.gstRate), createdBy: userId }).returning();
  await writeLines(row.id, all, s.profile.sac);
  await retotal(row.id);
  return invoiceDetail(t.id, row.id);
}

async function getInvoice(tenantId: string, id: string) {
  const [i] = await db.select().from(inv).where(and(eq(inv.id, id), eq(inv.tenantId, tenantId)));
  if (!i) throw notFound('Invoice not found');
  return i;
}
const assertDraft = (i: { status: string }) => { if (i.status !== 'DRAFT') throw new HttpError(400, 'Only a draft can be changed — an issued invoice can be cancelled and raised again.'); };

export async function updateDraft(t: Tenant, id: string, input: z.output<typeof draftInput>) {
  const i = await getInvoice(t.id, id); assertDraft(i);
  if (input.dueDate < input.date) throw new HttpError(400, 'Due date is before the invoice date', { dueDate: 'On or after the invoice date' });
  // A filing can only be on one live invoice.
  const obIds = input.lines.map((l) => l.obligationId).filter(Boolean) as string[];
  if (obIds.length) {
    const clash = await db.select({ id: lines.obligationId }).from(lines).innerJoin(inv, eq(inv.id, lines.invoiceId))
      .where(and(inArray(lines.obligationId, obIds), ne(inv.status, 'CANCELLED'), ne(inv.id, id)));
    if (clash.length) throw new HttpError(409, 'A filing on this invoice is already billed on another invoice.');
  }
  const s = await snapshots(t, i.clientId);
  await db.update(inv).set({ date: input.date, dueDate: input.dueDate, notes: input.notes ?? null, firm: s.firm as any, billTo: s.billTo as any, placeOfSupply: s.placeOfSupply, gstRate: String(s.gstRate) }).where(eq(inv.id, id));
  await writeLines(id, input.lines, s.profile.sac);
  await retotal(id);
  return invoiceDetail(t.id, id);
}

export async function issueInvoice(t: Tenant, id: string) {
  const i = await getInvoice(t.id, id); assertDraft(i);
  const p = profileOf(t);
  const missing = [!p.legalName && 'firm name', !p.address && 'firm address', !p.stateCode && 'firm state'].filter(Boolean);
  if (missing.length) throw new HttpError(400, `Fill in the firm's billing details first (${missing.join(', ')}) — Billing → Firm details.`);
  const ls = await db.select().from(lines).where(eq(lines.invoiceId, id));
  if (!ls.length || Number(i.total) <= 0) throw new HttpError(400, 'The invoice has no amount');
  if (ls.some((l) => Number(l.amount) <= 0)) throw new HttpError(400, 'Every item needs an amount — remove items with no fee.');
  const s = await snapshots(t, i.clientId);
  const fy = fyOf(i.date);
  // Consecutive numbers per FY: take the next one under a lock on the workspace row.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from tenants where id = ${t.id} for update`);
    const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${inv.seq}), 0)::int` }).from(inv).where(and(eq(inv.tenantId, t.id), eq(inv.fy, fy)));
    const seq = max + 1;
    await tx.update(inv).set({ status: 'ISSUED', fy, seq, number: invoiceNumber(p.invoicePrefix, fy, seq), issuedAt: new Date(), firm: s.firm as any, billTo: s.billTo as any, placeOfSupply: s.placeOfSupply, gstRate: String(s.gstRate) }).where(eq(inv.id, id));
    return seq;
  }).then(async () => { await retotal(id); return invoiceDetail(t.id, id); });
}

export async function cancelInvoice(tenantId: string, id: string, reason: string) {
  const i = await getInvoice(tenantId, id);
  if (i.status !== 'ISSUED') throw new HttpError(400, 'Only an issued invoice can be cancelled; delete a draft instead.');
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(pay).where(eq(pay.invoiceId, id));
  if (n) throw new HttpError(400, 'Remove its payments first.');
  if (!reason?.trim()) throw new HttpError(400, 'Give a reason', { reason: 'Why is it cancelled?' });
  await db.update(inv).set({ status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason.trim().slice(0, 300) }).where(eq(inv.id, id));
  return invoiceDetail(tenantId, id);
}
export async function deleteDraft(tenantId: string, id: string) {
  const i = await getInvoice(tenantId, id); assertDraft(i);
  await db.delete(inv).where(eq(inv.id, id));
  return i;
}

export const paymentInput = z.object({
  date: dateStr, amount, tds: amount.optional().default(0),
  mode: z.enum(['BANK', 'UPI', 'CHEQUE', 'CASH', 'OTHER']).default('BANK'), reference: optText,
});
export async function addPayment(tenantId: string, userId: string, invoiceId: string, input: z.output<typeof paymentInput>) {
  const i = await getInvoice(tenantId, invoiceId);
  if (i.status !== 'ISSUED') throw new HttpError(400, 'Payments can be recorded only against an issued invoice');
  if (input.amount + input.tds <= 0) throw new HttpError(400, 'Enter the amount received', { amount: 'Enter the amount received' });
  const ps = await db.select().from(pay).where(eq(pay.invoiceId, invoiceId));
  const due = balanceOf(i.total, ps);
  if (input.amount + input.tds > due + 0.009) throw new HttpError(400, `That is more than the ₹${due.toLocaleString('en-IN')} still due`, { amount: 'More than the balance' });
  await db.insert(pay).values({ tenantId, invoiceId, date: input.date, amount: String(input.amount), tds: String(input.tds), mode: input.mode, reference: input.reference ?? null, createdBy: userId });
  return invoiceDetail(tenantId, invoiceId);
}
export async function removePayment(tenantId: string, paymentId: string) {
  const [p] = await db.delete(pay).where(and(eq(pay.id, paymentId), eq(pay.tenantId, tenantId))).returning();
  if (!p) throw notFound('Payment not found');
  return invoiceDetail(tenantId, p.invoiceId);
}

export async function invoiceDetail(tenantId: string, id: string) {
  const i = await getInvoice(tenantId, id);
  const [ls, ps] = await Promise.all([
    db.select().from(lines).where(eq(lines.invoiceId, id)).orderBy(asc(lines.position)),
    db.select().from(pay).where(eq(pay.invoiceId, id)).orderBy(asc(pay.date)),
  ]);
  const balance = i.status === 'ISSUED' ? balanceOf(i.total, ps) : 0;
  const intraState = Number(i.igst) === 0;
  return {
    ...i, lines: ls, payments: ps, balance, intraState, words: amountInWords(Number(i.total)),
    placeOfSupplyName: stateName(i.placeOfSupply), taxInvoice: !!i.firm?.gstin,
    state: i.status !== 'ISSUED' ? i.status : balance <= 0 ? 'PAID' : ps.length ? 'PART_PAID' : i.dueDate < todayIso() ? 'OVERDUE' : 'UNPAID',
  };
}

/** Invoices with what's still owed. `open`: issued and not fully settled. */
export async function invoiceList(tenantId: string, opts: { clientId?: string; status?: string; open?: boolean } = {}) {
  const rows = await db.select({ i: inv, clientName: clients.name }).from(inv).innerJoin(clients, eq(clients.id, inv.clientId))
    .where(and(eq(inv.tenantId, tenantId), opts.clientId ? eq(inv.clientId, opts.clientId) : undefined, opts.status ? eq(inv.status, opts.status) : undefined))
    .orderBy(desc(inv.date), desc(inv.seq));
  const ps = rows.length ? await db.select().from(pay).where(inArray(pay.invoiceId, rows.map((r) => r.i.id))) : [];
  const today = todayIso();
  const out = rows.map(({ i, clientName }) => {
    const mine = ps.filter((p) => p.invoiceId === i.id);
    const balance = i.status === 'ISSUED' ? balanceOf(i.total, mine) : 0;
    const received = mine.reduce((s, p) => s + Number(p.amount) + Number(p.tds), 0);
    return { id: i.id, clientId: i.clientId, clientName, number: i.number, status: i.status, date: i.date, dueDate: i.dueDate, total: Number(i.total), received, balance,
      state: i.status !== 'ISSUED' ? i.status : balance <= 0 ? 'PAID' : mine.length ? 'PART_PAID' : i.dueDate < today ? 'OVERDUE' : 'UNPAID',
      age: i.status === 'ISSUED' && balance > 0 ? ageBucket(i.dueDate, today) : null };
  });
  return opts.open ? out.filter((x) => x.balance > 0) : out;
}

/** Tiles and ageing for the Billing page (or one client). */
export async function billingSummary(t: Tenant, clientId?: string) {
  const [work, list] = await Promise.all([unbilled(t, clientId), invoiceList(t.id, { clientId })]);
  const fy = fyOf(todayIso());
  const payRows = await db.select({ amount: pay.amount, tds: pay.tds, date: pay.date }).from(pay).innerJoin(inv, eq(inv.id, pay.invoiceId))
    .where(and(eq(pay.tenantId, t.id), gte(pay.date, fyStart(fy)), clientId ? eq(inv.clientId, clientId) : undefined));
  const open = list.filter((i) => i.balance > 0);
  const ageing = { NOT_DUE: 0, '0_30': 0, '31_60': 0, '61_90': 0, OVER_90: 0 } as Record<string, number>;
  for (const i of open) ageing[i.age!] += i.balance;
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    unbilledCount: work.length, unbilledAmount: r(work.reduce((s, w) => s + (w.fee ?? 0), 0)), unbilledNoFee: work.filter((w) => w.fee === null).length,
    outstanding: r(open.reduce((s, i) => s + i.balance, 0)), overdue: r(open.filter((i) => i.state === 'OVERDUE' || (i.age && i.age !== 'NOT_DUE')).reduce((s, i) => s + i.balance, 0)),
    collectedThisFy: r(payRows.reduce((s, p) => s + Number(p.amount) + Number(p.tds), 0)), fyLabel: fyLabel(fy),
    drafts: list.filter((i) => i.status === 'DRAFT').length, ageing,
  };
}
