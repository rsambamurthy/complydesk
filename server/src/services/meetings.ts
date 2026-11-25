/**
 * Meetings: schedule → agenda → notice → attendance → held → outcomes → minutes. Everything that touches the
 * compliance calendar goes through services/obligations.ts (addEvent, updateObligation, removeManual), so a
 * meeting marked held ticks off its calendar item and feeds the AGM / first-board-meeting dates, and a passed
 * resolution puts its filing (DIR-12, MGT-14, PAS-3…) on the calendar dated the meeting day.
 */
import { DESIGNATION_LABEL } from '../lib/validators.js';
import { and, asc, desc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, HttpError, notFound } from '../lib/core.js';
import { fyLabel, fyOf, daysBetween, todayIso } from '../compliance/dates.js';
import { isDirector } from '../compliance/engine.js';
import { AGENDA_TEMPLATES, templateByKey, type MeetingType } from '../meetings/templates.js';
import { fill, gapCheck, minutesCheck, noticeCheck, quorumCheck, type Check } from '../meetings/checks.js';
import { addEvent, removeManual, updateObligation } from './obligations.js';
import { getClient } from './clients.js';
import type { Meeting, MeetingItem, Person } from '../db/schema.js';

const { meetings: m, meetingItems: mi, meetingAttendance: ma, people, clients, obligations: o } = schema;
const TYPE_NAME: Record<MeetingType, string> = { BOARD: 'Board Meeting', AGM: 'Annual General Meeting', EGM: 'Extraordinary General Meeting' };
const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`;

// ---- Validation -------------------------------------------------------------------------------------------
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date');
const opt = z.string().trim().nullish().transform((v) => v || null);
export const meetingInput = z.object({
  clientId: z.string().min(1, 'Pick the company'),
  type: z.enum(['BOARD', 'AGM', 'EGM']),
  date: dateStr,
  time: opt, mode: z.enum(['PHYSICAL', 'VIDEO', 'HYBRID']).default('PHYSICAL'), venue: opt, videoLink: opt,
  title: opt,
  /** AGM: the FY whose accounts it adopts (default: the FY before the meeting date). */
  fy: z.coerce.number().int().min(2000).max(2100).nullish(),
});
export const meetingPatch = z.object({
  title: z.string().trim().min(3).optional(), date: dateStr.optional(), time: opt.optional(), mode: z.enum(['PHYSICAL', 'VIDEO', 'HYBRID']).optional(),
  venue: opt.optional(), videoLink: opt.optional(), shorterNotice: z.boolean().optional(), chairpersonId: opt.optional(),
  membersPresent: z.coerce.number().int().min(0).max(100000).nullish(),
  notes: z.string().max(20000).nullish(),
});
export const itemInput = z.object({ templateKey: opt, title: opt, text: opt, personId: opt, resolutionType: z.enum(['NONE', 'BOARD', 'ORDINARY', 'SPECIAL']).optional(), filings: z.array(z.string()).max(6).optional(), explanatory: z.string().max(8000).nullish() })
  .refine((v) => v.templateKey || v.title, { message: 'Pick an item or type a title', path: ['title'] });
export const itemPatch = z.object({
  title: z.string().trim().min(2).optional(), text: z.string().nullish(), personId: opt.optional(),
  resolutionType: z.enum(['NONE', 'BOARD', 'ORDINARY', 'SPECIAL']).optional(),
  filings: z.array(z.string()).optional(),
  outcome: z.enum(['PENDING', 'PASSED', 'NOT_PASSED', 'NOTED', 'DEFERRED']).optional(),
  notes: z.string().max(8000).nullish(), explanatory: z.string().max(8000).nullish(),
});
export const attendanceInput = z.array(z.object({ personId: z.string(), status: z.enum(['PRESENT', 'VIDEO', 'LEAVE', 'ABSENT']) }));

// ---- Reading ----------------------------------------------------------------------------------------------
export type View = 'upcoming' | 'minutes' | 'held' | 'all';
export async function listMeetings(tenantId: string, f: { clientId?: string; clientIds?: string[] | null; view?: View }) {
  const today = todayIso();
  const view = f.view ?? 'upcoming';
  return db.select({ m, clientName: clients.name, cin: clients.cin, items: sql<number>`(select count(*)::int from meeting_items i where i.meeting_id = ${m.id})` })
    .from(m).innerJoin(clients, eq(clients.id, m.clientId))
    .where(and(eq(m.tenantId, tenantId),
      f.clientId ? eq(m.clientId, f.clientId) : undefined,
      f.clientIds ? inArray(m.clientId, f.clientIds.length ? f.clientIds : ['-']) : undefined,
      view === 'upcoming' ? and(inArray(m.status, ['SCHEDULED', 'NOTICE_SENT']), gte(m.date, sql`${today}::date - 30`)) : undefined,
      view === 'minutes' ? eq(m.status, 'HELD') : undefined,
      view === 'held' ? inArray(m.status, ['HELD', 'MINUTES_SIGNED']) : undefined))
    .orderBy(view === 'upcoming' ? asc(m.date) : desc(m.date)).limit(500);
}

export async function getMeeting(tenantId: string, id: string) {
  const [x] = await db.select().from(m).where(and(eq(m.id, id), eq(m.tenantId, tenantId)));
  if (!x) throw notFound('Meeting not found');
  return x;
}

/** Directors in office on the meeting date. */
const inOffice = (p: Person, onDate: string) => isDirector(p.designation) && (!p.appointedOn || p.appointedOn <= onDate) && (!p.ceasedOn || p.ceasedOn > onDate);

export async function meetingDetail(tenantId: string, id: string) {
  const meeting = await getMeeting(tenantId, id);
  const client = await getClient(tenantId, meeting.clientId);
  const [items, att, ppl, prev] = await Promise.all([
    db.select().from(mi).where(eq(mi.meetingId, id)).orderBy(asc(mi.seq)),
    db.select().from(ma).where(eq(ma.meetingId, id)),
    db.select().from(people).where(eq(people.clientId, meeting.clientId)).orderBy(people.name),
    db.select({ d: sql<string>`coalesce(${m.heldOn}, ${m.date})` }).from(m)
      .where(and(eq(m.clientId, meeting.clientId), eq(m.type, 'BOARD'), inArray(m.status, ['HELD', 'MINUTES_SIGNED']), ne(m.id, id), lt(sql`coalesce(${m.heldOn}, ${m.date})`, meeting.heldOn ?? meeting.date)))
      .orderBy(desc(sql`coalesce(${m.heldOn}, ${m.date})`)).limit(1),
  ]);
  const onDate = meeting.heldOn ?? meeting.date;
  const directors = ppl.filter((p) => inOffice(p, onDate));
  const attendance = directors.map((p) => ({ personId: p.id, name: p.name, designation: p.designation, din: p.din, status: att.find((a) => a.personId === p.id)?.status ?? null }));
  const present = attendance.filter((a) => a.status === 'PRESENT' || a.status === 'VIDEO').length;
  const type = meeting.type as MeetingType;
  const checks: Check[] = [];
  if (meeting.status === 'SCHEDULED' || meeting.status === 'NOTICE_SENT' || meeting.noticeSentOn) checks.push(noticeCheck(type, meeting.date, meeting.noticeSentOn, meeting.shorterNotice));
  if (att.length || meeting.membersPresent != null || meeting.heldOn) checks.push(quorumCheck(type, directors.length, present, meeting.membersPresent));
  if (type === 'BOARD') { const g = gapCheck(onDate, prev[0]?.d ?? null, client.smallCompany || client.companyType === 'OPC'); if (g) checks.push(g); }
  const mc = minutesCheck(meeting.heldOn, meeting.minutesSignedOn, todayIso()); if (mc) checks.push(mc);
  const createdIds = items.flatMap((i) => i.createdObligationIds);
  const created = createdIds.length ? await db.select({ id: o.id, form: o.form, dueDate: o.dueDate, status: o.status }).from(o).where(inArray(o.id, createdIds)) : [];
  return {
    meeting, client: { id: client.id, name: client.name, cin: client.cin, registeredOffice: client.registeredOffice, companyType: client.companyType },
    items: items.map((i) => ({ ...i, created: created.filter((c) => i.createdObligationIds.includes(c.id)) })),
    attendance, people: ppl.map((p) => ({ id: p.id, name: p.name, designation: p.designation })), checks,
    templates: AGENDA_TEMPLATES.filter((t) => t.for.includes(type)).map(({ key, title, resolutionType, person, filings, completes }) => ({ key, title, resolutionType, person: !!person, filings: filings ?? [], completes: completes ?? [] })),
  };
}

// ---- Writing ----------------------------------------------------------------------------------------------
export async function createMeeting(tenantId: string, input: z.output<typeof meetingInput>, by: string) {
  const client = await getClient(tenantId, input.clientId);
  const type = input.type as MeetingType;
  const fy = input.fy ?? (type === 'AGM' ? fyOf(input.date) - 1 : fyOf(input.date));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(m).where(and(eq(m.clientId, client.id), eq(m.type, type), eq(m.fy, fy), ne(m.status, 'CANCELLED')));
  const title = input.title ?? (type === 'AGM' ? `${TYPE_NAME.AGM} — ${fyLabel(fy)}` : `${ordinal(n + 1)} ${TYPE_NAME[type]} — ${fyLabel(fy)}`);
  const [x] = await db.insert(m).values({ tenantId, clientId: client.id, type, fy, title, date: input.date, time: input.time, mode: input.mode, venue: input.venue ?? client.registeredOffice, videoLink: input.videoLink, createdBy: by }).returning();
  // Standard items; the first board meeting of the FY also takes the directors' MBP-1 / DIR-8 disclosures.
  const keys = AGENDA_TEMPLATES.filter((t) => t.standard && t.for.includes(type)).map((t) => t.key);
  if (type === 'BOARD' && n === 0) keys.push('MBP1');
  for (const k of keys) await addItem(tenantId, x.id, { templateKey: k, title: null, text: null, personId: null });
  return x;
}

export async function updateMeeting(tenantId: string, id: string, patch: z.output<typeof meetingPatch>) {
  const cur = await getMeeting(tenantId, id);
  if (cur.status === 'MINUTES_SIGNED' && (patch.date || patch.membersPresent !== undefined)) throw new HttpError(400, 'Minutes are signed: the meeting can’t be changed.');
  if (patch.chairpersonId) await assertPerson(cur.clientId, patch.chairpersonId);
  const [x] = await db.update(m).set(patch).where(eq(m.id, id)).returning();
  return x;
}

async function assertPerson(clientId: string, personId: string) {
  const [p] = await db.select().from(people).where(and(eq(people.id, personId), eq(people.clientId, clientId)));
  if (!p) throw new HttpError(400, 'Pick a director or KMP of this company', { personId: 'Not of this company' });
  return p;
}

/** Filings an item puts on the calendar must be event-based rules. */
async function assertEventFilings(filings: string[]) {
  const events = new Set((await db.select({ code: schema.rules.code, due: schema.rules.due }).from(schema.rules)).filter((r) => (r.due as any).kind === 'AFTER_EVENT').map((r) => r.code));
  if (filings.some((f) => !events.has(f))) throw new HttpError(400, 'Pick event-based filings only', { filings: 'Unknown filing' });
}

export async function addItem(tenantId: string, meetingId: string, input: z.output<typeof itemInput>) {
  const meeting = await getMeeting(tenantId, meetingId);
  if (input.filings?.length) await assertEventFilings(input.filings);
  const client = await getClient(tenantId, meeting.clientId);
  const t = input.templateKey ? templateByKey(input.templateKey) : undefined;
  if (input.templateKey && !t) throw new HttpError(400, 'Unknown agenda item');
  if (t?.person && !input.personId) throw new HttpError(400, 'Pick the director or KMP this is about', { personId: 'Required' });
  const person = input.personId ? await assertPerson(meeting.clientId, input.personId) : null;
  const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${mi.seq}), 0)::int` }).from(mi).where(eq(mi.meetingId, meetingId));
  const vars = { company: client.name, person: person?.name, designation: person ? DESIGNATION_LABEL[person.designation] ?? 'Director' : null, date: meeting.date, fy: fyLabel(meeting.fy) };
  const [x] = await db.insert(mi).values({
    meetingId, seq: n + 1, templateKey: t?.key ?? null,
    title: input.title ?? (t ? t.title + (person ? ` — ${person.name}` : '') : 'Item'),
    resolutionType: input.resolutionType ?? t?.resolutionType ?? 'NONE',
    text: input.text ?? (t ? fill(t.text, vars) : null), personId: person?.id ?? null,
    filings: t?.filings ?? input.filings ?? [], completes: t?.completes ?? [], explanatory: input.explanatory ?? null,
  }).returning();
  return x;
}

async function getItem(tenantId: string, itemId: string) {
  const [row] = await db.select({ i: mi, meeting: m }).from(mi).innerJoin(m, eq(m.id, mi.meetingId)).where(and(eq(mi.id, itemId), eq(m.tenantId, tenantId)));
  if (!row) throw notFound('Agenda item not found');
  return row;
}

export async function updateItem(tenantId: string, itemId: string, patch: z.output<typeof itemPatch>) {
  const { i, meeting } = await getItem(tenantId, itemId);
  if (meeting.status === 'MINUTES_SIGNED' && (patch.outcome || patch.filings)) throw new HttpError(400, 'Minutes are signed: outcomes can’t be changed.');
  if (patch.personId) await assertPerson(meeting.clientId, patch.personId);
  if (patch.filings) await assertEventFilings(patch.filings);
  const [x] = await db.update(mi).set(patch).where(eq(mi.id, itemId)).returning();
  if (meeting.heldOn && (patch.outcome || patch.filings || patch.personId !== undefined)) await applyOutcome(tenantId, meeting, x);
  return x;
}

export async function moveItem(tenantId: string, itemId: string, dir: -1 | 1) {
  const { i, meeting } = await getItem(tenantId, itemId);
  const list = await db.select().from(mi).where(eq(mi.meetingId, meeting.id)).orderBy(asc(mi.seq));
  const at = list.findIndex((x) => x.id === i.id), to = at + dir;
  if (to < 0 || to >= list.length) return;
  await db.update(mi).set({ seq: list[to].seq }).where(eq(mi.id, i.id));
  await db.update(mi).set({ seq: i.seq }).where(eq(mi.id, list[to].id));
}

export async function removeItem(tenantId: string, itemId: string) {
  const { i, meeting } = await getItem(tenantId, itemId);
  if (meeting.status === 'MINUTES_SIGNED') throw new HttpError(400, 'Minutes are signed: items can’t be removed.');
  await undoCreated(tenantId, i, true);
  await db.delete(mi).where(eq(mi.id, itemId));
}

export async function setAttendance(tenantId: string, meetingId: string, rows: z.output<typeof attendanceInput>) {
  const meeting = await getMeeting(tenantId, meetingId);
  for (const r of rows) {
    await assertPerson(meeting.clientId, r.personId);
    await db.insert(ma).values({ meetingId, ...r }).onConflictDoUpdate({ target: [ma.meetingId, ma.personId], set: { status: r.status } });
  }
}

export async function markNoticeSent(tenantId: string, id: string, on: string, shorterNotice?: boolean) {
  const cur = await getMeeting(tenantId, id);
  if (on > cur.date) throw new HttpError(400, 'Notice can’t be sent after the meeting', { noticeSentOn: 'After the meeting date' });
  const [x] = await db.update(m).set({ noticeSentOn: on, status: cur.status === 'SCHEDULED' ? 'NOTICE_SENT' : cur.status, ...(shorterNotice !== undefined ? { shorterNotice } : {}) }).where(eq(m.id, id)).returning();
  return x;
}

/** Held: ticks off the calendar item (board meeting for the period / AGM) and applies every recorded outcome. */
export async function markHeld(tenantId: string, id: string, heldOn: string) {
  const cur = await getMeeting(tenantId, id);
  if (cur.status === 'CANCELLED') throw new HttpError(400, 'This meeting was cancelled');
  if (heldOn > todayIso()) throw new HttpError(400, 'A meeting can’t be held in the future', { heldOn: 'In the future' });
  let [x] = await db.update(m).set({ heldOn, status: cur.status === 'MINUTES_SIGNED' ? cur.status : 'HELD' }).where(eq(m.id, id)).returning();
  const ob = await calendarItemFor(x);
  if (ob) {
    await updateObligation(tenantId, ob.id, { status: 'FILED', filedOn: heldOn, notes: `Held: ${x.title}` });
    [x] = await db.update(m).set({ obligationId: ob.id }).where(eq(m.id, id)).returning();
  }
  for (const i of await db.select().from(mi).where(eq(mi.meetingId, id))) await applyOutcome(tenantId, x, i);
  return x;
}

/** The calendar item a held meeting satisfies: the AGM of its FY, or the open board meeting for the period it falls in. */
async function calendarItemFor(meeting: Meeting) {
  if (meeting.obligationId) return (await db.select().from(o).where(eq(o.id, meeting.obligationId)))[0];
  if (meeting.type === 'AGM') return (await db.select().from(o).where(and(eq(o.clientId, meeting.clientId), eq(o.ruleCode, 'AGM'), eq(o.fy, meeting.fy), eq(o.stale, false))))[0];
  if (meeting.type !== 'BOARD') return undefined;
  const open = await db.select().from(o).where(and(eq(o.clientId, meeting.clientId), eq(o.form, 'Board meeting'), eq(o.stale, false), ne(o.status, 'FILED'), gte(o.dueDate, meeting.heldOn!))).orderBy(asc(o.dueDate));
  // The period's item: due within a quarter (or half-year) of the meeting; the "first board meeting" item always counts.
  return open.find((x) => x.ruleCode === 'BM_FIRST') ?? open.find((x) => daysBetween(meeting.heldOn!, x.dueDate) <= (x.ruleCode === 'BM_HALF_YEARLY' ? 183 : 92));
}

/**
 * Puts a passed item's filings on the calendar (dated the meeting day) and ticks off what it completes;
 * when an outcome is changed back, removes filings it created that nobody has started.
 */
async function applyOutcome(tenantId: string, meeting: Meeting, item: MeetingItem) {
  if (!meeting.heldOn) return;
  const done = item.outcome === 'PASSED' || item.outcome === 'NOTED';
  if (!done) return undoCreated(tenantId, item, false);
  const person = item.personId ? (await db.select().from(people).where(eq(people.id, item.personId)))[0] : null;
  const ids = [...item.createdObligationIds];
  const existing = ids.length ? await db.select().from(o).where(inArray(o.id, ids)) : [];
  for (const code of item.filings) {
    if (existing.some((e) => e.ruleCode === code)) continue;
    try {
      const ob = await addEvent(tenantId, meeting.clientId, { ruleCode: code, eventDate: meeting.heldOn, label: `${item.title} (${meeting.title})`.slice(0, 180), personId: person?.id ?? null });
      ids.push(ob.id);
    } catch (e) { if (!(e instanceof HttpError && e.status === 409)) throw e; }
  }
  // Filings removed from the item since: take them off if untouched.
  for (const e of existing.filter((x) => !item.filings.includes(x.ruleCode))) {
    if (e.status === 'OPEN' && !e.srn) { await removeManual(tenantId, e.id); ids.splice(ids.indexOf(e.id), 1); }
  }
  for (const code of item.completes) {
    const [ob] = await db.select().from(o).where(and(eq(o.clientId, meeting.clientId), eq(o.ruleCode, code), eq(o.fy, meeting.fy), eq(o.stale, false)));
    if (ob && ob.status !== 'FILED') await updateObligation(tenantId, ob.id, { status: 'FILED', filedOn: meeting.heldOn, notes: `Taken on record: ${meeting.title}` });
  }
  await db.update(mi).set({ createdObligationIds: ids }).where(eq(mi.id, item.id));
}

/** Removes filings this item created that are still untouched (open, no SRN). Started ones stay. */
async function undoCreated(tenantId: string, item: MeetingItem, all: boolean) {
  if (!item.createdObligationIds.length) return;
  const rows = await db.select().from(o).where(inArray(o.id, item.createdObligationIds));
  const keep: string[] = [];
  for (const r of rows) { if (r.status === 'OPEN' && !r.srn) await removeManual(tenantId, r.id); else keep.push(r.id); }
  if (!all) await db.update(mi).set({ createdObligationIds: keep }).where(eq(mi.id, item.id));
}

// ---- Minutes ----------------------------------------------------------------------------------------------
/** The closing line of an item in the minutes. */
function outcomeLine(outcome: string, resolutionType: string, board: boolean) {
  if (outcome === 'PASSED') return resolutionType === 'SPECIAL' ? 'The resolution was passed as a special resolution.'
    : resolutionType === 'ORDINARY' ? 'The resolution was passed as an ordinary resolution.'
    : resolutionType === 'BOARD' ? 'The resolution was passed unanimously.' : 'Approved.';
  if (outcome === 'NOT_PASSED') return 'The resolution was not passed.';
  if (outcome === 'NOTED') return board ? 'The Board noted the same.' : 'The members noted the same.';
  if (outcome === 'DEFERRED') return 'The item was deferred to a later meeting.';
  return '';
}

/** A first draft of the minutes from the meeting, attendance and agenda outcomes — the CS edits it. */
export async function draftMinutes(tenantId: string, id: string) {
  const d = await meetingDetail(tenantId, id);
  const { meeting: x, client } = d;
  const when = x.heldOn ?? x.date;
  const present = d.attendance.filter((a) => a.status === 'PRESENT' || a.status === 'VIDEO');
  const leave = d.attendance.filter((a) => a.status === 'LEAVE');
  const chair = d.people.find((p) => p.id === x.chairpersonId)?.name ?? present[0]?.name ?? '___';
  const lines = [
    `MINUTES OF THE ${x.title.toUpperCase()} OF ${client.name.toUpperCase()} (CIN ${client.cin})`,
    `held on ${when}${x.time ? ` at ${x.time}` : ''} ${x.mode === 'VIDEO' ? 'through video conferencing' : `at ${x.venue ?? client.registeredOffice ?? '___'}`}${x.mode === 'HYBRID' ? ' and through video conferencing' : ''}.`,
    '',
    'PRESENT:',
    ...present.map((p) => `  ${p.name}${p.status === 'VIDEO' ? ' (through video conferencing)' : ''}`),
    ...(x.type !== 'BOARD' && x.membersPresent != null ? [`  Members present in person: ${x.membersPresent}`] : []),
    ...(leave.length ? ['', 'LEAVE OF ABSENCE:', ...leave.map((p) => `  ${p.name}`)] : []),
    '', `CHAIRPERSON: ${chair}`, '',
  ];
  d.items.forEach((i, n) => {
    lines.push(`${n + 1}. ${i.title.toUpperCase()}`);
    if (i.text) lines.push(i.text);
    const close = outcomeLine(i.outcome, i.resolutionType, x.type === 'BOARD');
    if (close) lines.push(close);
    lines.push('');
  });
  lines.push('There being no other business, the meeting concluded with a vote of thanks to the Chair.', '', '', `Chairperson: ${chair}`, 'Date of signing: ___', 'Place: ___');
  return lines.join('\n');
}

export async function saveMinutes(tenantId: string, id: string, text: string) {
  const cur = await getMeeting(tenantId, id);
  if (cur.status === 'MINUTES_SIGNED') throw new HttpError(400, 'Minutes are already signed.');
  const [x] = await db.update(m).set({ minutes: text }).where(eq(m.id, id)).returning();
  return x;
}

export async function signMinutes(tenantId: string, id: string, on: string) {
  const cur = await getMeeting(tenantId, id);
  if (!cur.heldOn) throw new HttpError(400, 'Mark the meeting held first.');
  if (!cur.minutes?.trim()) throw new HttpError(400, 'Write or generate the minutes first.');
  if (on < cur.heldOn) throw new HttpError(400, 'Minutes can’t be signed before the meeting', { signedOn: 'Before the meeting' });
  const [x] = await db.update(m).set({ minutesSignedOn: on, status: 'MINUTES_SIGNED' }).where(eq(m.id, id)).returning();
  return x;
}

export async function cancelMeeting(tenantId: string, id: string) {
  const cur = await getMeeting(tenantId, id);
  if (cur.heldOn) throw new HttpError(400, 'A meeting already held can’t be cancelled.');
  const [x] = await db.update(m).set({ status: 'CANCELLED' }).where(eq(m.id, id)).returning();
  return x;
}
