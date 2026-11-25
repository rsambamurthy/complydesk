/**
 * Team workload: open work per person (assigned, overdue, due soon, stuck), reviews waiting, done this month,
 * hours logged; time spent per client with the fees billed (effective rate); and time entries.
 */
import { and, desc, eq, gte, inArray, lte, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, HttpError, notFound } from '../lib/core.js';
import { addDays, todayIst } from '../compliance/dates.js';
import type { Tenant } from '../db/schema.js';
import type { StaffCtx } from '../auth/session.js';
import { getClient } from './clients.js';
import { getObligation } from './obligations.js';

const { users: u, userRoles: ur, roles: r, obligations: o, obligationEvents: ev, timeEntries: te, clients: c, invoices: inv } = schema;
const DONE = ['FILED', 'NOT_APPLICABLE'];
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Firm staff (not client users), active, with whether they can review. */
async function staffOf(tenantId: string) {
  const rows = await db.select({ id: u.id, name: u.name, email: u.email, perms: r.permissions, roleName: r.name }).from(u).leftJoin(ur, eq(ur.userId, u.id)).leftJoin(r, eq(r.id, ur.roleId))
    .where(and(eq(u.tenantId, tenantId), eq(u.status, 'ACTIVE'), sql`jsonb_array_length(${u.clientIds}) = 0`));
  const by = new Map<string, { id: string; name: string; email: string; roles: string[]; reviewer: boolean }>();
  for (const x of rows) {
    const cur = by.get(x.id) ?? { id: x.id, name: x.name, email: x.email, roles: [], reviewer: false };
    if (x.roleName) cur.roles.push(x.roleName);
    if ((x.perms ?? []).includes('compliance.approve')) cur.reviewer = true;
    by.set(x.id, cur);
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const monthStart = (d: string) => `${d.slice(0, 7)}-01`;

export async function teamWorkload(t: Tenant, from: string, to: string) {
  const today = todayIst();
  const staff = await staffOf(t.id);
  const open = await db.select({ id: o.id, assigneeId: o.assigneeId, dueDate: o.dueDate, stage: o.stage, preparedById: o.preparedById, clientId: o.clientId, form: o.form })
    .from(o).innerJoin(c, eq(c.id, o.clientId))
    .where(and(eq(o.tenantId, t.id), eq(o.stale, false), eq(c.status, 'ACTIVE'), notInArray(o.status, DONE)));
  // Last time each open filing moved (stuck = no move for 14 days while being worked on).
  const lastMove = new Map((open.length ? await db.select({ id: ev.obligationId, at: sql<string>`max(${ev.at})` }).from(ev).where(inArray(ev.obligationId, open.map((x) => x.id))).groupBy(ev.obligationId) : []).map((x) => [x.id, x.at]));
  const stuckBefore = Date.now() - 14 * 86_400_000;
  const isStuck = (x: (typeof open)[number]) => ['DATA', 'DRAFTED', 'RESUBMIT'].includes(x.stage) && lastMove.get(x.id) && new Date(lastMove.get(x.id)!).getTime() < stuckBefore;
  const done = await db.select({ userId: ev.userId, n: sql<number>`count(*)::int` }).from(ev).innerJoin(o, eq(o.id, ev.obligationId))
    .where(and(eq(o.tenantId, t.id), inArray(ev.action, ['filed', 'approved']), gte(ev.at, new Date(`${from}T00:00:00+05:30`)), lte(ev.at, new Date(`${to}T23:59:59+05:30`)))).groupBy(ev.userId);
  const hours = await db.select({ userId: te.userId, m: sql<number>`sum(${te.minutes})::int` }).from(te).where(and(eq(te.tenantId, t.id), gte(te.date, from), lte(te.date, to))).groupBy(te.userId);
  const review = open.filter((x) => x.stage === 'REVIEW');
  const people = staff.map((p) => {
    const mine = open.filter((x) => x.assigneeId === p.id);
    return {
      ...p,
      open: mine.length, overdue: mine.filter((x) => x.dueDate < today).length, week: mine.filter((x) => x.dueDate >= today && x.dueDate <= addDays(today, 7)).length,
      stuck: mine.filter(isStuck).length,
      toReview: p.reviewer ? review.filter((x) => x.preparedById !== p.id).length : 0,
      done: done.find((d) => d.userId === p.id)?.n ?? 0,
      hours: r1((hours.find((h) => h.userId === p.id)?.m ?? 0) / 60),
    };
  });
  const unassigned = open.filter((x) => !x.assigneeId);
  return {
    from, to, people,
    totals: { open: open.length, overdue: open.filter((x) => x.dueDate < today).length, unassigned: unassigned.length, unassignedOverdue: unassigned.filter((x) => x.dueDate < today).length, review: review.length, stuck: open.filter(isStuck).length,
      hours: r1(hours.reduce((s, h) => s + h.m, 0) / 60), done: done.reduce((s, d) => s + d.n, 0) },
  };
}

/** Hours per client in the period, who spent them, and fees invoiced in the period (taxable value) → ₹ per hour. */
export async function hoursByClient(t: Tenant, from: string, to: string) {
  const rows = await db.select({ clientId: te.clientId, name: c.name, userName: u.name, m: sql<number>`sum(${te.minutes})::int` })
    .from(te).innerJoin(c, eq(c.id, te.clientId)).innerJoin(u, eq(u.id, te.userId))
    .where(and(eq(te.tenantId, t.id), gte(te.date, from), lte(te.date, to))).groupBy(te.clientId, c.name, u.name);
  const billed = await db.select({ clientId: inv.clientId, amt: sql<number>`sum(${inv.taxable})::float` }).from(inv)
    .where(and(eq(inv.tenantId, t.id), eq(inv.status, 'ISSUED'), gte(inv.date, from), lte(inv.date, to))).groupBy(inv.clientId);
  const by = new Map<string, { clientId: string; name: string; minutes: number; people: Record<string, number> }>();
  for (const x of rows) {
    const cur = by.get(x.clientId) ?? { clientId: x.clientId, name: x.name, minutes: 0, people: {} };
    cur.minutes += x.m; cur.people[x.userName] = r1((cur.people[x.userName] ?? 0) + x.m / 60);
    by.set(x.clientId, cur);
  }
  return [...by.values()].map((x) => {
    const fees = billed.find((b) => b.clientId === x.clientId)?.amt ?? 0;
    const h = x.minutes / 60;
    return { clientId: x.clientId, name: x.name, hours: r1(h), people: x.people, billed: Math.round(fees), perHour: fees && h ? Math.round(fees / h) : null };
  }).sort((a, b) => b.hours - a.hours);
}

// ---- Time entries ---------------------------------------------------------------------------------------------
export const timeInput = z.object({
  clientId: z.string().optional(), obligationId: z.string().nullish(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date'),
  minutes: z.coerce.number().int().min(5, 'At least 5 minutes').max(16 * 60, 'Up to 16 hours a day').optional(),
  hours: z.coerce.number().min(0.1).max(16).optional(),
  note: z.string().trim().max(500).nullish(),
}).refine((v) => v.minutes || v.hours, { message: 'Enter the time spent', path: ['hours'] });

export async function addTime(staff: StaffCtx, input: z.output<typeof timeInput>) {
  if (staff.user.clientIds.length) throw new HttpError(403, 'Time is logged by the firm’s team');
  let clientId = input.clientId;
  if (input.obligationId) { const ob = await getObligation(staff.tenant.id, input.obligationId); clientId = ob.clientId; }
  if (!clientId) throw new HttpError(400, 'Pick the client', { clientId: 'Required' });
  await getClient(staff.tenant.id, clientId);
  if (input.date > addDays(todayIst(), 1)) throw new HttpError(400, 'That date is in the future', { date: 'Not in the future' });
  const minutes = input.minutes ?? Math.round((input.hours ?? 0) * 60);
  const [row] = await db.insert(te).values({ tenantId: staff.tenant.id, userId: staff.user.id, clientId, obligationId: input.obligationId ?? null, date: input.date, minutes, note: input.note ?? null }).returning();
  return row;
}

export async function timeList(tenantId: string, f: { clientId?: string; obligationId?: string; userId?: string; from?: string; to?: string }) {
  return db.select({ id: te.id, date: te.date, minutes: te.minutes, note: te.note, userId: te.userId, userName: u.name, clientId: te.clientId, clientName: c.name, obligationId: te.obligationId, form: o.form })
    .from(te).innerJoin(u, eq(u.id, te.userId)).innerJoin(c, eq(c.id, te.clientId)).leftJoin(o, eq(o.id, te.obligationId))
    .where(and(eq(te.tenantId, tenantId), f.clientId ? eq(te.clientId, f.clientId) : undefined, f.obligationId ? eq(te.obligationId, f.obligationId) : undefined,
      f.userId ? eq(te.userId, f.userId) : undefined, f.from ? gte(te.date, f.from) : undefined, f.to ? lte(te.date, f.to) : undefined))
    .orderBy(desc(te.date), desc(te.createdAt)).limit(300);
}

/** Your own entries; a Firm Admin / Partner (team.view) can remove anyone's. */
export async function removeTime(staff: StaffCtx, id: string) {
  const [row] = await db.select().from(te).where(and(eq(te.id, id), eq(te.tenantId, staff.tenant.id)));
  if (!row) throw notFound('Entry not found');
  if (row.userId !== staff.user.id && !staff.permissions.has('team.view')) throw new HttpError(403, 'You can remove only your own time');
  await db.delete(te).where(eq(te.id, id));
}
