/**
 * Reviewer check of a filing: live checks against the client's records, and (on request) the draft form read by AI
 * and compared with the records in code. Results of draft checks are kept; the latest is shown on the filing.
 */
import { and, count, desc, eq, lt, isNotNull, notInArray } from 'drizzle-orm';
import { db, schema, HttpError, notFound } from '../lib/core.js';
import type { StaffCtx } from '../auth/session.js';
import { storage } from '../lib/storage.js';
import { todayIso } from '../compliance/dates.js';
import { recordChecks, compareDraft, tally, type Ctx, type Finding } from '../review/checks.js';
import { READABLE, readDocument } from '../extract/reader.js';
import { normalise } from '../extract/normalise.js';
import { assertDailyLimit, extractEnabled } from './extract.js';
import { clientDetail } from './clients.js';
import { getObligation } from './obligations.js';
import { isMeeting } from './stages.js';
import { formPack, hasPack } from './eforms.js';

const { obligations: o, attachments: a, filingChecks: fc, obligationEvents, extractions } = schema;

async function contextFor(tenantId: string, obligationId: string): Promise<Ctx> {
  const ob = await getObligation(tenantId, obligationId);
  if (isMeeting(ob.form)) throw new HttpError(400, 'Meetings aren’t checked here');
  const d = await clientDetail(tenantId, ob.clientId);
  const today = todayIso();
  const [{ held }] = await db.select({ held: count() }).from(o).where(and(eq(o.clientId, ob.clientId), eq(o.fy, ob.fy), eq(o.form, 'Board meeting'), eq(o.status, 'FILED')));
  const kyc = await db.select({ personId: o.personId }).from(o).where(and(eq(o.clientId, ob.clientId), eq(o.ruleCode, 'DIR3KYC'), isNotNull(o.personId), notInArray(o.status, ['FILED', 'NOT_APPLICABLE']), lt(o.dueDate, today)));
  const [{ files }] = await db.select({ files: count() }).from(a).where(and(eq(a.entity, 'obligation'), eq(a.entityId, ob.id)));
  return {
    today,
    ob: { ruleCode: ob.ruleCode, form: ob.form, fy: ob.fy, dueDate: ob.dueDate, eventDate: ob.eventDate, personId: ob.personId, status: ob.status },
    client: { ...d.client, flags: d.client.flags ?? {} },
    people: d.people, shareholders: d.shareholders, auditors: d.auditors,
    agmDate: d.years.find((y) => y.fy === ob.fy)?.agmDate ?? null,
    boardMeetingsHeld: Number(held), kycOverdue: kyc.map((k) => k.personId!), attachments: Number(files),
  };
}

/** What the filing dialog shows: live record checks, the latest draft check, files that can be checked. */
export async function reviewFor(tenantId: string, obligationId: string) {
  const ctx = await contextFor(tenantId, obligationId);
  const [latest] = await db.select().from(fc).where(and(eq(fc.obligationId, obligationId), eq(fc.tenantId, tenantId))).orderBy(desc(fc.createdAt)).limit(1);
  const files = await db.select({ id: a.id, fileName: a.fileName, contentType: a.contentType }).from(a).where(and(eq(a.tenantId, tenantId), eq(a.entity, 'obligation'), eq(a.entityId, obligationId))).orderBy(desc(a.createdAt));
  const records = recordChecks(ctx);
  if (hasPack(ctx.ob.ruleCode)) {
    const p = (await formPack(tenantId, obligationId)).progress;
    records.push(p.missing.length
      ? { level: 'warn', source: 'records', text: `MCA form data: ${p.missing.length} of ${p.total} fields still empty (${p.missing.slice(0, 3).join(', ')}${p.missing.length > 3 ? '…' : ''}).` }
      : { level: 'ok', source: 'records', text: `MCA form data complete (${p.total} fields).` });
  }
  return { records, latest: latest ?? null, checkable: files.filter((f) => READABLE[f.contentType]), aiEnabled: extractEnabled() };
}

export async function checkDraft(staff: StaffCtx, obligationId: string, attachmentId: string) {
  const tenantId = staff.tenant.id;
  if (!extractEnabled()) throw new HttpError(503, 'Reading documents isn’t switched on yet — ask Integrata to add the AI key.');
  const ctx = await contextFor(tenantId, obligationId);
  const [file] = await db.select().from(a).where(and(eq(a.id, attachmentId), eq(a.tenantId, tenantId), eq(a.entity, 'obligation'), eq(a.entityId, obligationId)));
  if (!file) throw notFound('Pick a file attached to this filing');
  if (!READABLE[file.contentType]) throw new HttpError(400, 'Only a PDF or an image of the form can be checked');
  await assertDailyLimit(tenantId);
  const buf = await (await storage()).read(file.storageKey);
  // Counted against the daily limit; storageKey stays null so the purge never touches the attachment.
  const [row] = await db.insert(extractions).values({ tenantId, userId: staff.user.id, docType: 'DRAFT_FORM', clientId: file.clientId, obligationId, fileName: file.fileName, contentType: file.contentType, size: file.size, status: 'CHECKED' }).returning();
  let findings: Finding[];
  try {
    const out = await readDocument('DRAFT_FORM', buf, file.contentType);
    const read = normalise('DRAFT_FORM', out.raw, { clientCin: ctx.client.cin, obligationForm: ctx.ob.form });
    findings = [...read.warnings.map((w) => ({ level: 'warn' as const, text: w, source: 'draft' as const })), ...compareDraft(read.values, ctx)];
    await db.update(extractions).set({ result: read as any, model: out.model, inputTokens: out.inputTokens ?? null, outputTokens: out.outputTokens ?? null }).where(eq(extractions.id, row.id));
  } catch (e: any) {
    console.error('draft check failed', e?.message ?? e);
    await db.update(extractions).set({ status: 'FAILED', error: String(e?.message ?? e).slice(0, 500) }).where(eq(extractions.id, row.id));
    throw new HttpError(502, 'Couldn’t read the draft form. Try a clearer PDF of the filled-in form.');
  }
  const [saved] = await db.insert(fc).values({ tenantId, obligationId, attachmentId, fileName: file.fileName, findings, userId: staff.user.id, userName: staff.user.name }).returning();
  const t = tally(findings);
  await db.insert(obligationEvents).values({ obligationId, action: 'checked', note: `${file.fileName}: ${t.errors} to fix, ${t.warnings} to look at`, userId: staff.user.id, userName: staff.user.name });
  return saved;
}

/** Things to fix now: record checks plus the latest draft check. Used to hold back approval and filing. */
export async function issuesToFix(tenantId: string, obligationId: string) {
  const r = await reviewFor(tenantId, obligationId);
  return tally([...r.records, ...((r.latest?.findings ?? []) as Finding[])]).errors;
}
