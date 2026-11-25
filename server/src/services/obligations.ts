/**
 * Reading and updating obligations. Buckets (overdue / due this week / this month) are defined once here and
 * used by the dashboard, the calendar and a client's compliance tab.
 */
import { and, asc, eq, gte, inArray, lt, lte, notInArray, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { db, schema, HttpError, notFound } from '../lib/core.js';
import type { obligationPatch, eventInput } from '../lib/validators.js';
import { addDays, todayIso } from '../compliance/dates.js';
import { eventObligation, lateFeeEstimate } from '../compliance/engine.js';
import { rulesFor } from '../compliance/sync.js';
import { getClient, setYear } from './clients.js';
import { statusToStage } from './stages.js';
export { isMeeting } from './stages.js';
import { schema as S } from '../lib/core.js';

const { obligations: o, clients, people, users } = schema;
const DONE = ['FILED', 'NOT_APPLICABLE'];

export type Bucket = 'overdue' | 'week' | 'month' | 'open' | 'done' | 'all' | 'review' | 'client';

/** The filter each bucket means, as of `today`. */
export function bucketWhere(b: Bucket, today = todayIso()): SQL | undefined {
  switch (b) {
    case 'overdue': return and(notInArray(o.status, DONE), lt(o.dueDate, today));
    case 'week': return and(notInArray(o.status, DONE), gte(o.dueDate, today), lte(o.dueDate, addDays(today, 7)));
    case 'month': return and(notInArray(o.status, DONE), gte(o.dueDate, today), lte(o.dueDate, addDays(today, 30)));
    case 'open': return notInArray(o.status, DONE);
    case 'done': return inArray(o.status, DONE);
    case 'review': return eq(o.stage, 'REVIEW');
    case 'client': return eq(o.stage, 'CLIENT');
    default: return undefined;
  }
}

export interface ListFilter { bucket?: Bucket; clientId?: string; clientIds?: string[] | null; assigneeId?: string; form?: string; fy?: number }

export async function listObligations(tenantId: string, f: ListFilter) {
  const where = and(
    eq(o.tenantId, tenantId), eq(o.stale, false), eq(clients.status, 'ACTIVE'),
    bucketWhere(f.bucket ?? 'all'),
    f.clientId ? eq(o.clientId, f.clientId) : undefined,
    f.clientIds ? inArray(o.clientId, f.clientIds.length ? f.clientIds : ['-']) : undefined,
    f.assigneeId ? eq(o.assigneeId, f.assigneeId) : undefined,
    f.form ? eq(o.form, f.form) : undefined,
    f.fy ? eq(o.fy, f.fy) : undefined,
  );
  const rows = await db.select({ o, clientName: clients.name, cin: clients.cin, personName: people.name, assigneeName: users.name })
    .from(o).innerJoin(clients, eq(clients.id, o.clientId))
    .leftJoin(people, eq(people.id, o.personId)).leftJoin(users, eq(users.id, o.assigneeId))
    .where(where).orderBy(asc(o.dueDate), asc(clients.name)).limit(1000);
  const rules = new Map((await rulesFor(tenantId)).map((r) => [r.code, r]));
  const today = todayIso();
  return rows.map(({ o: x, ...rest }) => {
    const rule = rules.get(x.ruleCode);
    const late = DONE.includes(x.status) ? (x.filedOn ? lateFeeEstimate(rule?.lateFee, x.dueDate, x.filedOn) : null) : lateFeeEstimate(rule?.lateFee, x.dueDate, today);
    return { ...x, ...rest, lateFee: late, lateFeeNote: rule?.lateFee?.note ?? null, law: rule?.law ?? null, ruleNotes: rule?.notes ?? null };
  });
}

/** Counts per bucket — whole workspace, one client, or one person's work. */
export async function summary(tenantId: string, f: Omit<ListFilter, 'bucket'> = {}) {
  const base = and(eq(o.tenantId, tenantId), eq(o.stale, false), eq(clients.status, 'ACTIVE'),
    f.clientId ? eq(o.clientId, f.clientId) : undefined,
    f.clientIds ? inArray(o.clientId, f.clientIds.length ? f.clientIds : ['-']) : undefined,
    f.assigneeId ? eq(o.assigneeId, f.assigneeId) : undefined);
  const count = async (b: Bucket) => (await db.select({ n: sql<number>`count(*)::int` }).from(o).innerJoin(clients, eq(clients.id, o.clientId)).where(and(base, bucketWhere(b))))[0].n;
  const [overdue, week, month, open, done, review, client] = await Promise.all((['overdue', 'week', 'month', 'open', 'done', 'review', 'client'] as Bucket[]).map(count));
  return { overdue, week, month, open, done, review, client };
}

/** Per client: overdue and due within 30 days (dashboard table, client list). */
export async function perClient(tenantId: string, clientIds?: string[] | null) {
  const today = todayIso(), in30 = addDays(today, 30);
  return db.select({
    clientId: o.clientId,
    overdue: sql<number>`count(*) filter (where ${o.dueDate} < ${today})::int`,
    due30: sql<number>`count(*) filter (where ${o.dueDate} >= ${today} and ${o.dueDate} <= ${in30})::int`,
    nextDue: sql<string | null>`min(${o.dueDate}) filter (where ${o.dueDate} >= ${today})`,
  }).from(o).where(and(eq(o.tenantId, tenantId), eq(o.stale, false), notInArray(o.status, DONE),
    clientIds ? inArray(o.clientId, clientIds.length ? clientIds : ['-']) : undefined)).groupBy(o.clientId);
}

export async function getObligation(tenantId: string, id: string) {
  const [x] = await db.select().from(o).where(and(eq(o.id, id), eq(o.tenantId, tenantId)));
  if (!x) throw notFound('Obligation not found');
  return x;
}

export async function updateObligation(tenantId: string, id: string, patch: z.output<typeof obligationPatch>) {
  const cur = await getObligation(tenantId, id);
  if (patch.assigneeId) {
    const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, patch.assigneeId), eq(users.tenantId, tenantId)));
    if (!u) throw new HttpError(400, 'Unknown user', { assigneeId: 'Pick a user' });
  }
  // Only hand-added (event) obligations may have their due date moved; generated ones follow the rules.
  if (patch.dueDate && cur.source !== 'MANUAL') delete patch.dueDate;
  const next = { ...patch, ...(patch.status && patch.status !== 'FILED' ? { filedOn: null } : {}), ...(patch.status ? { stage: statusToStage(patch.status, cur.stage) } : {}) };
  const [x] = await db.update(o).set({ ...next, updatedAt: new Date() }).where(eq(o.id, id)).returning();
  await feedAnchors(tenantId, x);
  return x;
}

/**
 * Meetings feed the dates other deadlines hang off: an AGM marked held sets that FY's AGM date (AOC-4, MGT-7,
 * ADT-1 follow); the earliest board meeting held in an FY is its first board meeting (MBP-1 / DIR-8 follow).
 */
async function feedAnchors(tenantId: string, x: typeof o.$inferSelect) {
  const held = x.status === 'FILED' ? x.filedOn : null;
  if (x.ruleCode === 'AGM') return setYear(tenantId, x.clientId, x.fy, { agmDate: held });
  if (x.form !== 'Board meeting') return;
  const meetings = await db.select({ filedOn: o.filedOn, fy: o.fy }).from(o)
    .where(and(eq(o.clientId, x.clientId), eq(o.form, 'Board meeting'), eq(o.status, 'FILED')));
  // A meeting's held date decides its FY (the "first meeting after incorporation" can sit in a later FY's quarter).
  const inFy = meetings.map((m) => m.filedOn).filter((d): d is string => !!d && d >= `${x.fy}-04-01` && d <= `${x.fy + 1}-03-31`).sort();
  const [year] = await db.select().from(S.clientYears).where(and(eq(S.clientYears.clientId, x.clientId), eq(S.clientYears.fy, x.fy)));
  if ((year?.firstBoardMeetingDate ?? null) !== (inFy[0] ?? null)) await setYear(tenantId, x.clientId, x.fy, { firstBoardMeetingDate: inFy[0] ?? null });
}

export async function addEvent(tenantId: string, clientId: string, input: z.output<typeof eventInput>) {
  await getClient(tenantId, clientId);
  const rule = (await rulesFor(tenantId)).find((r) => r.code === input.ruleCode && r.due.kind === 'AFTER_EVENT');
  if (!rule) throw new HttpError(400, 'Pick an event-based filing', { ruleCode: 'Pick a filing' });
  if (input.personId) {
    const [p] = await db.select({ id: people.id }).from(people).where(and(eq(people.id, input.personId), eq(people.clientId, clientId)));
    if (!p) throw new HttpError(400, 'Unknown person', { personId: 'Pick a person of this client' });
  }
  const g = eventObligation(rule, input.eventDate, input.label, input.personId ?? null);
  const [dupe] = await db.select({ id: o.id }).from(o).where(and(eq(o.clientId, clientId), eq(o.key, g.key)));
  if (dupe) throw new HttpError(409, 'This event is already on the calendar');
  const [x] = await db.insert(o).values({ tenantId, clientId, ...g, eventDate: input.eventDate, source: 'MANUAL' }).returning();
  return x;
}

export async function removeManual(tenantId: string, id: string) {
  const x = await getObligation(tenantId, id);
  if (x.source !== 'MANUAL') throw new HttpError(400, 'Only event-based filings added by hand can be removed; mark others “Not applicable”.');
  await db.delete(o).where(eq(o.id, id));
}

