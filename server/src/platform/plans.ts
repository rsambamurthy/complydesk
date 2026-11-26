/**
 * ComplyDesk's own subscription plans and what a payment buys — pure. Plans are data (Integrata edits them in the
 * platform console; DEFAULT_PLANS until then). A quote says what kind of payment it is (new, renewal, upgrade), the
 * period it covers and the amount with GST (billing/calc.ts). Tested in tests/plans.test.ts.
 */
import { invoiceTotals } from '../billing/calc.js';

export interface Plan { code: string; name: string; clients: number | null; users: number | null; price: number; active: boolean; blurb?: string }
export interface Seller { legalName: string; gstin: string; address: string; stateCode: string; pan?: string; sac?: string; invoicePrefix?: string; email?: string }

/** Suggested launch pricing (per workspace per year, excluding GST). Client-portal users are free and not counted. */
export const DEFAULT_PLANS: Plan[] = [
  { code: 'STARTER', name: 'Starter', clients: 25, users: 5, price: 12000, active: true, blurb: 'A small practice' },
  { code: 'PRACTICE', name: 'Practice', clients: 100, users: 20, price: 30000, active: true, blurb: 'Most CS firms' },
  { code: 'FIRM', name: 'Firm', clients: 300, users: 40, price: 75000, active: true, blurb: 'Larger firms' },
];
export const DEFAULT_SELLER: Seller = { legalName: 'Integratatech.ai Pvt Ltd', gstin: '', address: '', stateCode: '', invoicePrefix: 'CDX', email: 'info@integratatech.ai' };
export const GST_RATE = 18;

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(Date.parse(`${s}T00:00:00Z`) + n * DAY));
/** One year from `from`, inclusive: 2026-11-26 → 2027-11-25. */
export function yearEnd(from: string) {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return iso(new Date(d.getTime() - DAY));
}
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

export interface Current { plan: string | null; paidUntil: string | null; clients: number; users: number }
export type Quote =
  | { ok: true; kind: 'NEW' | 'RENEW' | 'UPGRADE'; plan: Plan; from: string; to: string; amount: number; note: string }
  | { ok: false; plan: Plan; reason: string };

/**
 * What paying for `plan` today buys.
 * - No paid period running (trial, lapsed): a year from today.
 * - Same plan, or a cheaper one within 30 days of the end: a year from the day after the current end.
 * - A dearer plan while a period runs: the difference for the days left (same end date).
 * - A cheaper plan with more than 30 days left: not now. A plan smaller than what's in use: never.
 */
export function quote(plan: Plan, cur: Current, plans: Plan[], today: string): Quote {
  if (!plan.active) return { ok: false, plan, reason: 'This plan is no longer offered.' };
  if (plan.clients !== null && cur.clients > plan.clients) return { ok: false, plan, reason: `You have ${cur.clients} client companies; ${plan.name} covers ${plan.clients}.` };
  if (plan.users !== null && cur.users > plan.users) return { ok: false, plan, reason: `You have ${cur.users} team members; ${plan.name} covers ${plan.users}.` };
  const running = !!cur.paidUntil && cur.paidUntil >= today;
  if (!running) return { ok: true, kind: cur.plan ? 'RENEW' : 'NEW', plan, from: today, to: yearEnd(today), amount: plan.price, note: 'One year from today' };
  const old = plans.find((p) => p.code === cur.plan) ?? null;
  const left = daysBetween(today, cur.paidUntil!) + 1;
  if (old && plan.code !== old.code && plan.price > old.price) {
    const amount = Math.max(1, Math.round(((plan.price - old.price) * left) / 365));
    return { ok: true, kind: 'UPGRADE', plan, from: today, to: cur.paidUntil!, amount, note: `Difference for the ${left} days left` };
  }
  if (old && plan.code !== old.code && left > 30) return { ok: false, plan, reason: `Move to a smaller plan at renewal (within 30 days of ${cur.paidUntil}).` };
  const from = addDays(cur.paidUntil!, 1);
  return { ok: true, kind: 'RENEW', plan, from, to: yearEnd(from), amount: plan.price, note: 'Renewal' };
}

/** GST on a subscription: CGST + SGST when Integrata and the firm are in the same state, else IGST. */
export function withGst(amount: number, sellerState?: string | null, buyerState?: string | null) {
  const t = invoiceTotals([{ amount, taxable: true }], GST_RATE, sellerState || null, buyerState || null);
  return { amount: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, total: t.total };
}

/** Limits of a workspace: its plan's, the trial limit while on trial, none for workspaces activated before plans. */
export function limitsFor(t: { status: string; plan: string | null }, plans: Plan[], trialClientLimit: number | null) {
  if (t.status === 'TRIAL') return { clients: trialClientLimit, users: null as number | null };
  const p = plans.find((x) => x.code === t.plan);
  return { clients: p?.clients ?? null, users: p?.users ?? null };
}

/** Days before the end on which the renewal reminder goes out (and the day after it lapses). */
export const RENEWAL_REMINDER_DAYS = [30, 7, 1, -1];
