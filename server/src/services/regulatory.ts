/**
 * Regulatory updates: Integrata drafts (AI summary of pasted text or a PDF), checks and publishes them; every firm sees
 * them with the clients they affect, marks them reviewed, and Firm Admins get an email when one is published.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, HttpError, notFound } from '../lib/core.js';
import { aiMode, callTool } from '../lib/ai.js';
import { appUrl, sendMail } from '../lib/mailer.js';
import { FLAGS } from '../lib/validators.js';
import { CATALOGUE } from '../compliance/catalogue.js';
import { affects, describeApplies } from '../regulatory/match.js';
import { REG_RULES, REG_TOOL, mockRegDraft, type RegDraft } from '../regulatory/draft.js';
import type { Tenant } from '../db/schema.js';

const { regUpdates: ru, regReviews: rr, clients: c } = schema;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal('')).transform((v) => v || null);
const CODES = new Set(CATALOGUE.map((r) => r.code));
export const updateInput = z.object({
  title: z.string().trim().min(5, 'Give it a headline').max(200), source: z.string().trim().max(200).nullish(), url: z.string().trim().url('Enter a link').nullish().or(z.literal('')).transform((v) => v || null),
  issuedOn: dateStr, effectiveFrom: dateStr, summary: z.string().trim().min(20, 'Write a summary').max(4000), actions: z.string().trim().max(4000).nullish(),
  applies: z.object({ all: z.boolean().optional(), types: z.array(z.enum(['PRIVATE', 'OPC'])).optional(), small: z.boolean().nullish().transform((v) => v ?? undefined), flags: z.array(z.enum(Object.keys(FLAGS) as [string, ...string[]])).optional() }).default({}),
  forms: z.array(z.string()).max(20).default([]).transform((f) => f.filter((x) => CODES.has(x))),
  impact: z.enum(['HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
});
const flagLabel = (f: string) => (FLAGS as Record<string, string>)[f] ?? f;
const formNames = (codes: string[]) => [...new Set(codes.map((k) => CATALOGUE.find((r) => r.code === k)?.form ?? k))];

// ---- Integrata ------------------------------------------------------------------------------------------------
export async function draftFromDocument(input: { text?: string; file?: { buffer: Buffer; mimetype: string } }) {
  if (!input.text?.trim() && !input.file) throw new HttpError(400, 'Paste the text or attach the PDF');
  if (!aiMode()) throw new HttpError(400, 'The AI key isn’t set up — write the summary by hand.');
  const formsList = CATALOGUE.map((r) => `${r.code}: ${r.form} — ${r.title}`).join('\n');
  if (aiMode() === 'mock') return { ...mockRegDraft(input.text ?? 'Uploaded notification'), model: 'mock' };
  const content: any[] = [];
  if (input.file) {
    if (input.file.mimetype !== 'application/pdf') throw new HttpError(400, 'Attach a PDF');
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: input.file.buffer.toString('base64') } });
  }
  content.push({ type: 'text', text: `${input.text ? `<document>\n${input.text.slice(0, 60000)}\n</document>\n\n` : ''}Rule codes you may use in "forms":\n${formsList}\n\nFlags you may use: ${Object.keys(FLAGS).join(', ')}\n\nSummarise it and call record_update.` });
  const r = await callTool<RegDraft>({ system: [{ text: REG_RULES }], tool: REG_TOOL, maxTokens: 2500, messages: [{ role: 'user', content }] });
  return { ...r.input, forms: (r.input.forms ?? []).filter((f) => CODES.has(f)), model: r.model };
}

export const listAll = () => db.select().from(ru).orderBy(desc(ru.createdAt)).limit(200);
export async function saveUpdate(id: string | null, input: z.output<typeof updateInput>, by: string) {
  if (id) {
    const [row] = await db.update(ru).set(input).where(eq(ru.id, id)).returning();
    if (!row) throw notFound('Update not found');
    return row;
  }
  const [row] = await db.insert(ru).values({ ...input, createdBy: by }).returning();
  return row;
}
export async function removeUpdate(id: string) { await db.delete(ru).where(eq(ru.id, id)); }

/** Publish: visible to every firm; Firm Admins of firms with affected clients get one email. */
export async function publishUpdate(id: string) {
  const [u] = await db.update(ru).set({ status: 'PUBLISHED', publishedAt: new Date() }).where(and(eq(ru.id, id), eq(ru.status, 'DRAFT'))).returning();
  if (!u) throw new HttpError(400, 'Already published (or not found)');
  const ts = await db.select().from(schema.tenants).where(inArray(schema.tenants.status, ['ACTIVE', 'TRIAL']));
  let emailed = 0;
  for (const t of ts) {
    const hit = (await clientsOf(t.id)).filter((x) => affects(u.applies, x));
    if (!hit.length) continue;
    const admins = await db.select({ email: schema.users.email, name: schema.users.name }).from(schema.users)
      .innerJoin(schema.userRoles, eq(schema.userRoles.userId, schema.users.id)).innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
      .where(and(eq(schema.users.tenantId, t.id), eq(schema.users.status, 'ACTIVE'), eq(schema.roles.key, 'ADMIN')));
    for (const a of admins) {
      const text = [`Hello ${a.name},`, '', `A regulatory update affects ${hit.length} of your clients:`, '', u.title, '', u.summary, '',
        ...(u.actions ? ['What to do:', ...u.actions.split('\n').map((l) => `  • ${l}`), ''] : []),
        `Affected: ${hit.slice(0, 10).map((x) => x.name).join(', ')}${hit.length > 10 ? ` and ${hit.length - 10} more` : ''}`, '', `Open in ComplyDesk: ${appUrl('/regulatory')}`, '', '— ComplyDesk by Integrata'].join('\n');
      try { await sendMail(a.email, `Regulatory update: ${u.title}`, text); emailed++; } catch (e) { console.error('reg update email failed', (e as Error).message); }
    }
  }
  return { update: u, emailed };
}

// ---- A firm ----------------------------------------------------------------------------------------------------
const clientsOf = (tenantId: string) => db.select({ id: c.id, name: c.name, cin: c.cin, companyType: c.companyType, smallCompany: c.smallCompany, flags: c.flags })
  .from(c).where(and(eq(c.tenantId, tenantId), eq(c.status, 'ACTIVE')));

export async function firmUpdates(t: Tenant, scope?: string[] | null) {
  const [ups, reviews, cs] = await Promise.all([
    db.select().from(ru).where(eq(ru.status, 'PUBLISHED')).orderBy(desc(ru.publishedAt)).limit(100),
    db.select({ r: rr, by: schema.users.name }).from(rr).leftJoin(schema.users, eq(schema.users.id, rr.userId)).where(eq(rr.tenantId, t.id)),
    clientsOf(t.id),
  ]);
  const visible = scope ? cs.filter((x) => scope.includes(x.id)) : cs;
  return ups.map((u) => {
    const hit = visible.filter((x) => affects(u.applies, x));
    const rv = reviews.find((x) => x.r.updateId === u.id);
    return {
      ...u, whom: describeApplies(u.applies, flagLabel), formNames: formNames(u.forms),
      affected: hit.map((x) => ({ id: x.id, name: x.name, cin: x.cin })),
      reviewed: rv ? { at: rv.r.at, by: rv.by, note: rv.r.note } : null,
    };
  });
}
export async function unreviewedCount(t: Tenant) {
  return (await firmUpdates(t)).filter((u) => !u.reviewed && u.affected.length).length;
}
export async function markReviewed(tenantId: string, userId: string, updateId: string, note?: string | null) {
  const [u] = await db.select({ id: ru.id }).from(ru).where(and(eq(ru.id, updateId), eq(ru.status, 'PUBLISHED')));
  if (!u) throw notFound('Update not found');
  await db.insert(rr).values({ tenantId, updateId, userId, note: note ?? null }).onConflictDoUpdate({ target: [rr.tenantId, rr.updateId], set: { userId, note: note ?? null, at: new Date() } });
}
export async function unmarkReviewed(tenantId: string, updateId: string) { await db.delete(rr).where(and(eq(rr.tenantId, tenantId), eq(rr.updateId, updateId))); }
