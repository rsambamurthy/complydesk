/**
 * AI drafting for meetings: minutes from the meeting record and the CS's notes, an agenda item / resolution from a
 * plain description, and an explanatory statement for an existing item. Every answer is checked in code
 * (meetings/drafting.ts) and comes back as a draft — nothing is saved until the CS saves it.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import { db, schema, HttpError } from '../lib/core.js';
import { aiMode, callTool } from '../lib/ai.js';
import { DESIGNATION_LABEL } from '../lib/validators.js';
import { fyLabel } from '../compliance/dates.js';
import { rulesFor } from '../compliance/sync.js';
import { meetingDetail } from './meetings.js';
import {
  MINUTES_RULES, MINUTES_TOOL, RESOLUTION_RULES, RESOLUTION_TOOL, cleanDraft, minutesMessage, mockMinutes, mockResolution, resolutionMessage, verifyMinutes,
  type DraftItem, type MinutesFacts, type ResolutionFacts,
} from '../meetings/drafting.js';

const { aiDrafts: ad, people } = schema;
export const draftingEnabled = () => aiMode() !== null;
export const draftDailyLimit = () => Number(process.env.AI_DRAFT_DAILY_LIMIT) || 100;

async function assertLimit(tenantId: string) {
  if (!draftingEnabled()) throw new HttpError(400, 'AI drafting is off until Integrata sets up the AI key. You can still draft from the agenda.');
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(ad).where(and(eq(ad.tenantId, tenantId), gte(ad.createdAt, today)));
  if (n >= draftDailyLimit()) throw new HttpError(429, `Your workspace has used today's ${draftDailyLimit()} AI drafts. Try again tomorrow.`);
}
async function log(tenantId: string, userId: string, kind: string, meetingId: string, itemId: string | null, input: unknown, output: unknown, r: { model: string; inputTokens?: number; outputTokens?: number }) {
  await db.insert(ad).values({ tenantId, userId, kind, meetingId, itemId, input: input as any, output: output as any, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens });
}

/** The meeting as facts for the model — and for checking its answer. */
export async function minutesFacts(tenantId: string, meetingId: string, notes?: string | null): Promise<MinutesFacts> {
  const d = await meetingDetail(tenantId, meetingId);
  const x = d.meeting;
  const by = (s: string) => d.attendance.filter((a) => a.status === s).map((a) => a.name);
  const quorum = d.checks.find((c) => c.key === 'quorum');
  return {
    company: d.client.name, cin: d.client.cin, registeredOffice: d.client.registeredOffice,
    meeting: { type: x.type as MinutesFacts['meeting']['type'], title: x.title, date: x.heldOn ?? x.date, time: x.time, mode: x.mode, venue: x.venue, fy: fyLabel(x.fy) },
    chair: d.people.find((p) => p.id === x.chairpersonId)?.name ?? null,
    present: by('PRESENT'), byVideo: by('VIDEO'), leave: by('LEAVE'), absent: by('ABSENT'),
    membersPresent: x.membersPresent, quorumMet: quorum ? quorum.ok : null,
    items: d.items.map((i, k) => ({ n: k + 1, title: i.title, resolutionType: i.resolutionType, text: i.text, outcome: i.outcome, notes: i.notes })),
    notes: notes ?? x.notes ?? null,
  };
}

export async function draftMinutesAi(tenantId: string, userId: string, meetingId: string, notes?: string | null) {
  const d = await meetingDetail(tenantId, meetingId);
  if (!d.meeting.heldOn) throw new HttpError(400, 'Mark the meeting held (with attendance and outcomes) first.');
  if (d.meeting.status === 'MINUTES_SIGNED') throw new HttpError(400, 'Minutes are already signed.');
  await assertLimit(tenantId);
  if (notes !== undefined) await db.update(schema.meetings).set({ notes: notes || null }).where(eq(schema.meetings.id, meetingId));
  const f = await minutesFacts(tenantId, meetingId, notes);
  let out: { minutes: string; assumptions: string[] }; let meta = { model: 'mock' } as { model: string; inputTokens?: number; outputTokens?: number };
  if (aiMode() === 'mock') out = mockMinutes(f);
  else {
    const r = await callTool<{ minutes: string; assumptions: string[] }>({ system: [{ text: MINUTES_RULES }], tool: MINUTES_TOOL, maxTokens: 6000, messages: [{ role: 'user', content: minutesMessage(f) }] });
    out = { minutes: String(r.input.minutes ?? '').trim(), assumptions: (r.input.assumptions ?? []).map(String) }; meta = r;
  }
  const issues = verifyMinutes(f, out.minutes);
  await log(tenantId, userId, 'MINUTES', meetingId, null, { notes: f.notes }, { ...out, issues }, meta);
  return { text: out.minutes, assumptions: out.assumptions, issues, model: meta.model };
}

async function resolutionFacts(tenantId: string, meetingId: string, description: string): Promise<ResolutionFacts> {
  const d = await meetingDetail(tenantId, meetingId);
  const ppl = await db.select().from(people).where(eq(people.clientId, d.client.id));
  const onDate = d.meeting.heldOn ?? d.meeting.date;
  const rules = await rulesFor(tenantId);
  return {
    company: d.client.name, cin: d.client.cin, meetingType: d.meeting.type as ResolutionFacts['meetingType'], meetingDate: onDate,
    people: ppl.filter((p) => !p.ceasedOn || p.ceasedOn >= onDate).map((p) => ({ name: p.name, designation: DESIGNATION_LABEL[p.designation] ?? p.designation, din: p.din })),
    description,
    filings: rules.filter((r) => r.due.kind === 'AFTER_EVENT' && (r as any).active !== false).map((r) => ({ code: r.code, form: r.form, title: r.title })),
  };
}

/** An agenda item drafted from a description, e.g. "allot 5,000 equity shares at ₹100 to Anita Rao on private placement". */
export async function draftItemAi(tenantId: string, userId: string, meetingId: string, description: string) {
  if (description.trim().length < 8) throw new HttpError(400, 'Describe the item in a sentence or two', { description: 'Describe the item' });
  await assertLimit(tenantId);
  const f = await resolutionFacts(tenantId, meetingId, description.trim().slice(0, 2000));
  let raw: Partial<DraftItem>; let meta = { model: 'mock' } as { model: string; inputTokens?: number; outputTokens?: number };
  if (aiMode() === 'mock') raw = mockResolution(f);
  else { const r = await callTool<DraftItem>({ system: [{ text: RESOLUTION_RULES }], tool: RESOLUTION_TOOL, maxTokens: 3000, messages: [{ role: 'user', content: resolutionMessage(f) }] }); raw = r.input; meta = r; }
  const out = cleanDraft(f, raw);
  await log(tenantId, userId, 'RESOLUTION', meetingId, null, { description }, out, meta);
  return { ...out, model: meta.model };
}

/** An explanatory statement (Sec 102) for an item already on a general meeting's agenda. */
export async function draftExplanatoryAi(tenantId: string, userId: string, itemId: string) {
  const [row] = await db.select({ i: schema.meetingItems, m: schema.meetings }).from(schema.meetingItems).innerJoin(schema.meetings, eq(schema.meetings.id, schema.meetingItems.meetingId))
    .where(and(eq(schema.meetingItems.id, itemId), eq(schema.meetings.tenantId, tenantId)));
  if (!row) throw new HttpError(404, 'Agenda item not found');
  if (row.m.type === 'BOARD') throw new HttpError(400, 'Explanatory statements are for general meetings.');
  await assertLimit(tenantId);
  const f = await resolutionFacts(tenantId, row.m.id, `Write the explanatory statement for this ${row.i.resolutionType.toLowerCase()} resolution, keeping the resolution as it is.\nTitle: ${row.i.title}\nResolution: ${row.i.text ?? ''}`);
  let raw: Partial<DraftItem>; let meta = { model: 'mock' } as { model: string; inputTokens?: number; outputTokens?: number };
  if (aiMode() === 'mock') raw = mockResolution(f);
  else { const r = await callTool<DraftItem>({ system: [{ text: RESOLUTION_RULES }], tool: RESOLUTION_TOOL, maxTokens: 2500, messages: [{ role: 'user', content: resolutionMessage(f) }] }); raw = r.input; meta = r; }
  const out = cleanDraft(f, raw);
  await log(tenantId, userId, 'EXPLANATORY', row.m.id, itemId, { itemId }, { explanatory: out.explanatory }, meta);
  return { explanatory: out.explanatory, issues: out.issues.filter((x) => !/Blanks/.test(x.text) || /___/.test(out.explanatory)), model: meta.model };
}
