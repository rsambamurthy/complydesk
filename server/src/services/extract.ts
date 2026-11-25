/**
 * Reading documents into forms: upload → read (AI) → a person reviews → apply through the normal services.
 * Nothing is written to the client master or a filing until `apply` / `attach`, and every write goes through
 * services/clients.ts with the shared validators, exactly as if typed.
 */
import { and, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, schema, HttpError, notFound } from '../lib/core.js';
import type { StaffCtx } from '../auth/session.js';
import { storage } from '../lib/storage.js';
import { auditorInput, clientInput, personInput, shareholderInput, fieldErrors } from '../lib/validators.js';
import { DOC_TYPES, type DocType } from '../extract/doctypes.js';
import { normalise, nameMatch } from '../extract/normalise.js';
import { READABLE, readDocument, readCertificate, readerName } from '../extract/reader.js';
import { getClient, createClient, updateClient, peopleSvc, shareholdersSvc, auditorsSvc, setYear } from './clients.js';
import { syncClient } from '../compliance/sync.js';

const { extractions: x, attachments, obligations, people, shareholders, auditors } = schema;
export const dailyLimit = () => Number(process.env.EXTRACT_DAILY_LIMIT) || 200;
export const extractEnabled = () => readerName() !== null;

/** Context that sharpens the checks: the client's CIN, the filing's form. */
async function contextFor(tenantId: string, clientId?: string | null, obligationId?: string | null) {
  if (obligationId) {
    const [o] = await db.select().from(obligations).where(and(eq(obligations.id, obligationId), eq(obligations.tenantId, tenantId)));
    if (!o) throw notFound('Filing not found');
    const c = await getClient(tenantId, o.clientId);
    return { clientId: c.id, obligationId: o.id, ctx: { clientCin: c.cin, obligationForm: o.form } };
  }
  if (clientId) { const c = await getClient(tenantId, clientId); return { clientId: c.id, obligationId: null, ctx: { clientCin: c.cin } }; }
  return { clientId: null, obligationId: null, ctx: {} };
}

export async function readUpload(staff: StaffCtx, input: { docType: DocType; file: { buffer: Buffer; mimetype: string; originalname: string; size: number }; clientId?: string | null; obligationId?: string | null }) {
  if (!extractEnabled()) throw new HttpError(503, 'Reading documents isn’t switched on yet — ask Integrata to add the AI key.');
  if (!READABLE[input.file.mimetype]) throw new HttpError(400, 'Use a PDF or an image (PNG, JPG)');
  const tenantId = staff.tenant.id;
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(x).where(and(eq(x.tenantId, tenantId), gte(x.createdAt, today)));
  if (n >= dailyLimit()) throw new HttpError(429, `Your workspace has read ${n} documents today — the daily limit. Try again tomorrow.`);
  const { clientId, obligationId, ctx } = await contextFor(tenantId, input.clientId, input.obligationId);

  const ext = input.file.mimetype === 'application/pdf' ? 'pdf' : input.file.mimetype.split('/')[1];
  const key = `${tenantId}/extract/${randomUUID()}.${ext}`;
  await (await storage()).put(key, input.file.buffer, input.file.mimetype);
  const fileName = input.file.originalname.replace(/[^\w.\- ()&]+/g, '_').slice(0, 150) || `document.${ext}`;
  const [row] = await db.insert(x).values({ tenantId, userId: staff.user.id, docType: input.docType, clientId, obligationId, fileName, contentType: input.file.mimetype, size: input.file.size, storageKey: key, status: 'READ' }).returning();
  try {
    const out = await readDocument(input.docType, input.file.buffer, input.file.mimetype);
    const read = normalise(input.docType, out.raw, ctx);
    await db.update(x).set({ result: read as any, model: out.model, inputTokens: out.inputTokens ?? null, outputTokens: out.outputTokens ?? null }).where(eq(x.id, row.id));
    return { id: row.id, docType: input.docType, fileName, ...read };
  } catch (e: any) {
    console.error('document read failed', e?.message ?? e);
    await db.update(x).set({ status: 'FAILED', error: String(e?.message ?? e).slice(0, 500) }).where(eq(x.id, row.id));
    throw new HttpError(502, 'Couldn’t read this document. Try a clearer copy, or type the details in.');
  }
}

async function getRead(tenantId: string, id: string) {
  const [row] = await db.select().from(x).where(and(eq(x.id, id), eq(x.tenantId, tenantId)));
  if (!row) throw notFound('Document not found');
  if (row.status === 'FAILED') throw new HttpError(400, 'This document wasn’t read');
  if (row.status === 'APPLIED' || row.status === 'ATTACHED') throw new HttpError(409, 'This document has already been used');
  return row;
}

/** Keeps the read document as a file on the client (or filing) it filled in. */
async function attachTo(staff: StaffCtx, row: typeof x.$inferSelect, entity: 'client' | 'obligation', entityId: string, clientId: string, status: 'APPLIED' | 'ATTACHED') {
  if (row.storageKey) await db.insert(attachments).values({ tenantId: row.tenantId, clientId, entity, entityId, fileName: row.fileName, contentType: row.contentType, size: row.size, storageKey: row.storageKey, uploadedById: staff.user.id, uploadedByName: staff.user.name });
  await db.update(x).set({ status, clientId }).where(eq(x.id, row.id));
}

/** Validates every row first (so nothing is half-saved); errors come back as { "directors.1.din": "…" }. */
function check<T extends z.ZodTypeAny>(schemaOf: T, value: unknown, prefix: string, errs: Record<string, string>): z.output<T> | null {
  const r = schemaOf.safeParse(value);
  if (r.success) return r.data;
  for (const [k, v] of Object.entries(fieldErrors(r.error))) errs[`${prefix}.${k}`] = v;
  return null;
}
const fail = (errs: Record<string, string>) => { if (Object.keys(errs).length) throw new HttpError(400, 'Please check the highlighted fields', errs); };
const rows = (v: unknown) => (Array.isArray(v) ? v : []) as Record<string, any>[];
const keep = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ''));

/** Adds directors / KMP not already on file (same DIN, or same name when there's no DIN). */
async function addPeople(tenantId: string, clientId: string, list: z.output<typeof personInput>[]) {
  const have = await db.select().from(people).where(eq(people.clientId, clientId));
  let added = 0;
  for (const p of list) {
    if (have.some((h) => (p.din && h.din === p.din) || (!p.din && nameMatch(h.name, p.name) >= 0.99))) continue;
    await peopleSvc.add(tenantId, clientId, p, { sync: false }); added++;
  }
  return added;
}

export async function applyRead(staff: StaffCtx, id: string, body: Record<string, any>) {
  const tenantId = staff.tenant.id;
  const row = await getRead(tenantId, id);
  const docType = row.docType as DocType;
  const errs: Record<string, string> = {};
  const clientId: string | null = body.clientId ?? row.clientId;
  if (clientId) await getClient(tenantId, clientId);

  switch (docType) {
    case 'MCA_MASTER':
    case 'INCORPORATION': {
      const directors = rows(body.directors).map((d, i) => check(personInput, d, `directors.${i}`, errs));
      if (clientId) {
        const changes = check(clientInput.innerType().partial(), keep(body.client ?? {}), 'client', errs);
        fail(errs);
        if (changes && Object.keys(changes).length) await updateClient(tenantId, clientId, changes);
        const added = await addPeople(tenantId, clientId, directors as any);
        await syncClient(tenantId, clientId);
        await attachTo(staff, row, 'client', clientId, clientId, 'APPLIED');
        return { clientId, added };
      }
      const client = check(clientInput, { ...body.client, ownerId: body.client?.ownerId ?? null }, 'client', errs);
      fail(errs);
      const c = await createClient(tenantId, client!, { sync: false });
      const added = await addPeople(tenantId, c.id, directors as any);
      await syncClient(tenantId, c.id);
      await attachTo(staff, row, 'client', c.id, c.id, 'APPLIED');
      return { clientId: c.id, added, created: true };
    }
    case 'MGT7': {
      if (!clientId) throw new HttpError(400, 'Which client is this for?');
      const holders = rows(body.shareholders).map((s, i) => check(shareholderInput, s, `shareholders.${i}`, errs));
      const directors = rows(body.directors).map((d, i) => check(personInput, d, `directors.${i}`, errs));
      const auditor = body.auditor ? check(auditorInput, { current: true, ...body.auditor }, 'auditor', errs) : null;
      const fy = Number(body.fy);
      if (body.agmDate && !(fy >= 2000 && fy <= 2100)) errs.fy = 'Which financial year is this return for?';
      fail(errs);
      if (body.replaceShareholders && holders.length) await db.delete(shareholders).where(and(eq(shareholders.clientId, clientId), eq(shareholders.tenantId, tenantId)));
      for (const s of holders) await shareholdersSvc.add(tenantId, clientId, s!, { sync: false });
      const added = await addPeople(tenantId, clientId, directors as any);
      if (auditor) {
        const have = await db.select().from(auditors).where(eq(auditors.clientId, clientId));
        if (!have.some((a) => (auditor.frn && a.frn === auditor.frn) || nameMatch(a.firmName, auditor.firmName) >= 0.75)) await auditorsSvc.add(tenantId, clientId, auditor, { sync: false });
      }
      if (body.agmDate) await setYear(tenantId, clientId, fy, { agmDate: body.agmDate });
      await syncClient(tenantId, clientId);
      await attachTo(staff, row, 'client', clientId, clientId, 'APPLIED');
      return { clientId, added, shareholders: holders.length };
    }
    case 'FINANCIALS': {
      if (!clientId) throw new HttpError(400, 'Which client is this for?');
      const c = await getClient(tenantId, clientId);
      const changes = check(clientInput.innerType().partial(), keep({ paidUpCapital: body.paidUpCapital, smallCompany: typeof body.smallCompany === 'boolean' ? body.smallCompany : undefined, flags: body.flags ? { ...c.flags, ...body.flags } : undefined }), 'client', errs);
      fail(errs);
      if (Object.keys(changes!).length) await updateClient(tenantId, clientId, changes!);
      await attachTo(staff, row, 'client', clientId, clientId, 'APPLIED');
      return { clientId };
    }
    case 'AUDITOR': {
      if (!clientId) throw new HttpError(400, 'Which client is this for?');
      const a = check(auditorInput, body.auditor, 'auditor', errs);
      fail(errs);
      if (a!.current) await db.update(auditors).set({ current: false }).where(and(eq(auditors.clientId, clientId), eq(auditors.tenantId, tenantId)));
      await auditorsSvc.add(tenantId, clientId, a!);
      await attachTo(staff, row, 'client', clientId, clientId, 'APPLIED');
      return { clientId };
    }
    case 'SRN_CHALLAN':
      throw new HttpError(400, 'A challan is attached to its filing, not applied');
  }
}

/** Keeps the document on a filing (the challan) — the SRN / dates are then used in the filing's own step. */
export async function attachRead(staff: StaffCtx, id: string, obligationId: string) {
  const row = await getRead(staff.tenant.id, id);
  const { clientId } = await contextFor(staff.tenant.id, null, obligationId);
  await attachTo(staff, row, 'obligation', obligationId, clientId!, 'ATTACHED');
  return { ok: true };
}

/** DSC certificate files: holder + expiry, matched to the client's directors. No AI, nothing stored. */
export async function readDscFiles(tenantId: string, clientId: string, files: { buffer: Buffer; originalname: string }[]) {
  await getClient(tenantId, clientId);
  const list = await db.select({ id: people.id, name: people.name, dscExpiry: people.dscExpiry }).from(people).where(and(eq(people.clientId, clientId), sql`${people.ceasedOn} is null`));
  return files.map((f) => {
    try {
      const c = readCertificate(f.buffer);
      const best = list.map((p) => ({ p, score: nameMatch(p.name, c.holder ?? '') })).sort((a, b) => b.score - a.score)[0];
      return { file: f.originalname, ...c, personId: best && best.score >= 0.5 ? best.p.id : null, currentExpiry: best && best.score >= 0.5 ? best.p.dscExpiry : null };
    } catch (e: any) { return { file: f.originalname, error: e.message as string }; }
  });
}

export async function applyDsc(tenantId: string, clientId: string, updates: { personId: string; dscExpiry: string }[]) {
  await getClient(tenantId, clientId);
  const ids = updates.map((u) => u.personId);
  const mine = ids.length ? await db.select({ id: people.id }).from(people).where(and(eq(people.clientId, clientId), inArray(people.id, ids))) : [];
  if (mine.length !== new Set(ids).size) throw new HttpError(400, 'Pick directors of this client');
  for (const u of updates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(u.dscExpiry)) throw new HttpError(400, 'Expiry date missing');
    await db.update(people).set({ dscExpiry: u.dscExpiry }).where(eq(people.id, u.personId));
  }
  await syncClient(tenantId, clientId);
  return { updated: updates.length };
}

/** Nightly: drops files of documents read but never used (after 3 days). */
export async function purgeUnused() {
  const cutoff = new Date(Date.now() - 3 * 86400_000);
  const old = await db.select({ id: x.id, key: x.storageKey }).from(x).where(and(inArray(x.status, ['READ', 'FAILED']), isNotNull(x.storageKey), lt(x.createdAt, cutoff)));
  const st = await storage();
  for (const o of old) { await st.remove(o.key!).catch(() => {}); await db.update(x).set({ storageKey: null }).where(eq(x.id, o.id)); }
  return old.length;
}

export const docTypeList = () => Object.entries(DOC_TYPES).map(([key, d]) => ({ key, label: d.label, hint: d.hint, perm: d.perm }));
