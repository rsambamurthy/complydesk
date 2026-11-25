/**
 * WhatsApp to client users: approval requests when a filing reaches the client, document requests, and reminders
 * (approvals waiting, documents not yet received). Only when the firm switched WhatsApp on and the person opted in
 * (with a mobile number). Every message is logged in message_log. Document requests also go by email.
 */
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, HttpError, notFound } from '../lib/core.js';
import { settingsOf } from '../lib/settings.js';
import { appUrl, sendMail } from '../lib/mailer.js';
import { sendTemplate, waNumber, type TemplateKey } from '../lib/whatsapp.js';
import { addDays, todayIst } from '../compliance/dates.js';
import type { Obligation, Tenant, User } from '../db/schema.js';
import type { StaffCtx } from '../auth/session.js';
import { getClient } from './clients.js';

const { users: u, userRoles: ur, roles: r, messageLog: ml, docRequests: dr } = schema;
const fmt = (d?: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'as soon as you can');

/** Sends one WhatsApp template if allowed; never throws (a failed message must not stop the work that caused it). */
export async function whatsapp(t: Tenant, user: Pick<User, 'id' | 'mobile' | 'whatsappOptInAt'>, key: TemplateKey, params: string[], ref: string) {
  if (!settingsOf(t).whatsappEnabled || !user.whatsappOptInAt) return false;
  const to = waNumber(user.mobile);
  if (!to) return false;
  try {
    const res = await sendTemplate(to, key, params);
    await db.insert(ml).values({ tenantId: t.id, userId: user.id, to, template: key, params, status: res.status, ref, providerId: res.id ?? null });
    return true;
  } catch (e: any) {
    await db.insert(ml).values({ tenantId: t.id, userId: user.id, to, template: key, params, status: 'FAILED', error: String(e.message).slice(0, 500), ref });
    return false;
  }
}

/** A client's active users, optionally only those with a permission (e.g. approvers). */
async function clientUsers(tenantId: string, clientId: string, perm?: string) {
  const rows = await db.select({ u, perms: r.permissions }).from(u).leftJoin(ur, eq(ur.userId, u.id)).leftJoin(r, eq(r.id, ur.roleId))
    .where(and(eq(u.tenantId, tenantId), eq(u.status, 'ACTIVE'), sql`${u.clientIds} @> ${JSON.stringify([clientId])}::jsonb`));
  const by = new Map<string, { u: User; perms: string[] }>();
  for (const x of rows) { const cur = by.get(x.u.id) ?? { u: x.u, perms: [] }; cur.perms.push(...(x.perms ?? [])); by.set(x.u.id, cur); }
  return [...by.values()].filter((x) => !perm || x.perms.includes(perm)).map((x) => x.u);
}

/** A filing reached the client's approval: WhatsApp its approvers (email already comes with the daily digest). */
export async function approvalRequested(t: Tenant, ob: Obligation) {
  const c = await getClient(t.id, ob.clientId);
  for (const a of await clientUsers(t.id, ob.clientId, 'compliance.client_approve')) {
    await whatsapp(t, a, 'approval', [a.name.split(' ')[0], ob.form, c.name, appUrl(`/clients/${c.id}`)], `obligation:${ob.id}`);
  }
}

// ---- Document requests -----------------------------------------------------------------------------------------
export const docRequestInput = z.object({
  items: z.array(z.string().trim().min(2).max(200)).min(1, 'List at least one document').max(30),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal('')).transform((v) => v || null),
  note: z.string().trim().max(1000).nullish(),
  userIds: z.array(z.string()).max(20).optional(),
});

export async function createDocRequest(t: Tenant, staff: StaffCtx, clientId: string, input: z.output<typeof docRequestInput>) {
  const c = await getClient(t.id, clientId);
  let people = await clientUsers(t.id, clientId);
  if (input.userIds?.length) people = people.filter((p) => input.userIds!.includes(p.id));
  if (!people.length) throw new HttpError(400, 'This client has no users to ask — add one in the Client users tab first.');
  const [row] = await db.insert(dr).values({ tenantId: t.id, clientId, items: input.items, dueDate: input.dueDate, note: input.note ?? null, requestedBy: staff.user.id }).returning();
  const link = appUrl(`/clients/${clientId}`);
  const sentTo: { name: string; email: string; whatsapp: boolean }[] = [];
  for (const p of people) {
    const wa = await whatsapp(t, p, 'documents', [p.name.split(' ')[0], c.name, input.items.join('; '), fmt(input.dueDate), link], `docreq:${row.id}`);
    const text = [`Hello ${p.name},`, '', `${staff.user.name} of ${t.name} needs these documents for ${c.name}:`, '', ...input.items.map((i) => `  • ${i}`), '',
      ...(input.note ? [input.note, ''] : []), `Please share them by ${fmt(input.dueDate)} — upload them in ComplyDesk (the company's Documents tab): ${link}`, '', `— ${t.name}`].join('\n');
    try { await sendMail(p.email, `Documents needed for ${c.name}`, text); } catch (e) { console.error('doc request email failed', (e as Error).message); }
    sentTo.push({ name: p.name, email: p.email, whatsapp: wa });
  }
  const [saved] = await db.update(dr).set({ sentTo }).where(eq(dr.id, row.id)).returning();
  return saved;
}

export async function docRequests(tenantId: string, clientId: string) {
  return db.select({ d: dr, by: u.name }).from(dr).leftJoin(u, eq(u.id, dr.requestedBy))
    .where(and(eq(dr.tenantId, tenantId), eq(dr.clientId, clientId))).orderBy(desc(dr.createdAt)).limit(50)
    .then((rows) => rows.map((x) => ({ ...x.d, requestedByName: x.by })));
}
export async function closeDocRequest(tenantId: string, id: string, status: 'RECEIVED' | 'CANCELLED' | 'OPEN') {
  const [row] = await db.update(dr).set({ status, closedAt: status === 'OPEN' ? null : new Date() }).where(and(eq(dr.id, id), eq(dr.tenantId, tenantId))).returning();
  if (!row) throw notFound('Request not found');
  return row;
}
export const docRequestClient = async (tenantId: string, id: string) => {
  const [row] = await db.select({ clientId: dr.clientId }).from(dr).where(and(eq(dr.id, id), eq(dr.tenantId, tenantId)));
  if (!row) throw notFound('Request not found');
  return row.clientId;
};

// ---- Daily WhatsApp reminders --------------------------------------------------------------------------------------
/** Approvals waiting 2+ days and documents due within 2 days (or late) — at most once every 3 days each. */
export async function runWhatsappReminders(today = todayIst()) {
  const ts = (await db.select().from(schema.tenants).where(inArray(schema.tenants.status, ['ACTIVE', 'TRIAL']))).filter((t) => settingsOf(t).whatsappEnabled);
  let sent = 0;
  const since = new Date(Date.now() - 3 * 86_400_000);
  for (const t of ts) {
    const waiting = await db.select().from(schema.obligations).where(and(eq(schema.obligations.tenantId, t.id), eq(schema.obligations.stage, 'CLIENT'), sql`${schema.obligations.updatedAt} < now() - interval '2 days'`));
    for (const ob of waiting) {
      const [recent] = await db.select({ id: ml.id }).from(ml).where(and(eq(ml.ref, `obligation:${ob.id}`), gte(ml.createdAt, since))).limit(1);
      if (recent) continue;
      const c = await getClient(t.id, ob.clientId);
      for (const a of await clientUsers(t.id, ob.clientId, 'compliance.client_approve')) if (await whatsapp(t, a, 'reminder', [a.name.split(' ')[0], `${ob.form} for ${c.name} is waiting for your approval`, appUrl(`/clients/${c.id}`)], `obligation:${ob.id}`)) sent++;
    }
    const open = await db.select().from(dr).where(and(eq(dr.tenantId, t.id), eq(dr.status, 'OPEN'), sql`${dr.dueDate} is not null and ${dr.dueDate} <= ${addDays(today, 2)}`, sql`(${dr.lastRemindedAt} is null or ${dr.lastRemindedAt} < ${since})`));
    for (const d of open) {
      const c = await getClient(t.id, d.clientId);
      for (const p of await clientUsers(t.id, d.clientId)) if (await whatsapp(t, p, 'reminder', [p.name.split(' ')[0], `documents for ${c.name} are ${d.dueDate! < today ? 'overdue' : `due ${fmt(d.dueDate)}`}: ${d.items.join('; ')}`, appUrl(`/clients/${c.id}`)], `docreq:${d.id}`)) sent++;
      await db.update(dr).set({ lastRemindedAt: new Date() }).where(eq(dr.id, d.id));
    }
  }
  console.log(`whatsapp reminders ${today}: ${sent}`);
  return sent;
}

export async function messageLogFor(tenantId: string) {
  return db.select({ id: ml.id, to: ml.to, template: ml.template, status: ml.status, error: ml.error, ref: ml.ref, createdAt: ml.createdAt, name: u.name })
    .from(ml).leftJoin(u, eq(u.id, ml.userId)).where(eq(ml.tenantId, tenantId)).orderBy(desc(ml.createdAt)).limit(100);
}
