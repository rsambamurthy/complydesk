/** Administration: users, roles, compliance rules, audit log. */
import { Router } from 'express';
import { TEMPLATES, templateName, whatsappConfigured } from '../lib/whatsapp.js';
import { messageLogFor } from '../services/messaging.js';
import bcrypt from 'bcryptjs';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, h, audit, HttpError, notFound } from '../lib/core.js';
import { requirePerm } from '../auth/session.js';
import { parse } from '../lib/parse.js';
import { settingsOf, settingsInput } from '../lib/settings.js';
import { previewFor, runWorkspace } from '../services/reminders.js';
import { workspaceRules, ruleHistoryFor, newRuleInput, ruleInput, createWorkspaceRule, saveWorkspaceRule, revertWorkspaceRule } from '../services/rules.js';

const { users, roles, userRoles, rules, auditLog, clients } = schema;
export const adminRouter = Router();
const tid = (req: any) => req.staff.tenant.id as string;

// ---- Users -------------------------------------------------------------------------------------------------
adminRouter.get('/users', requirePerm('users.manage'), h(async (req, res) => {
  // ?clientId= → only the users with access to that client (the client's Users tab).
  const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : null;
  const list = await db.select({ id: users.id, name: users.name, email: users.email, status: users.status, clientIds: users.clientIds, lastLoginAt: users.lastLoginAt, remindersOff: users.remindersOff, mobile: users.mobile, whatsappOptInAt: users.whatsappOptInAt })
    .from(users).where(and(eq(users.tenantId, tid(req)), clientId ? sql`${users.clientIds} @> ${JSON.stringify([clientId])}::jsonb` : undefined)).orderBy(users.name);
  const links = await db.select({ userId: userRoles.userId, roleId: userRoles.roleId }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(roles.tenantId, tid(req)));
  res.json(list.map((u) => ({ ...u, roleIds: links.filter((l) => l.userId === u.id).map((l) => l.roleId) })));
}));

const userInput = z.object({
  name: z.string().trim().min(2, 'Enter the name'),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(10, 'At least 10 characters').optional().or(z.literal('').transform(() => undefined)),
  roleIds: z.array(z.string()).min(1, 'Pick at least one role'),
  clientIds: z.array(z.string()).default([]),
  status: z.enum(['ACTIVE', 'DISABLED']).default('ACTIVE'),
  remindersOff: z.boolean().default(false),
  mobile: z.string().trim().nullish().transform((v) => v || null).refine((v) => !v || /^(\+?91)?[6-9]\d{9}$/.test(v.replace(/[\s-]/g, '')), 'A 10-digit Indian mobile number'),
  /** The firm has the person's consent to WhatsApp messages. */
  whatsappOptIn: z.boolean().default(false),
});

async function checkRefs(tenantId: string, roleIds: string[], clientIds: string[]) {
  const rs = await db.select().from(roles).where(eq(roles.tenantId, tenantId));
  if (roleIds.some((id) => !rs.find((r) => r.id === id))) throw new HttpError(400, 'Unknown role', { roleIds: 'Pick roles from the list' });
  const cs = await db.select({ id: clients.id }).from(clients).where(eq(clients.tenantId, tenantId));
  if (clientIds.some((id) => !cs.find((c) => c.id === id))) throw new HttpError(400, 'Unknown client', { clientIds: 'Pick clients from the list' });
  // Client roles (Client Admin / Viewer) must be limited to at least one client.
  const clientRole = rs.filter((r) => roleIds.includes(r.id)).some((r) => r.key.startsWith('CLIENT_'));
  if (clientRole && !clientIds.length) throw new HttpError(400, 'Pick the client companies this user belongs to', { clientIds: 'Required for client roles' });
}

adminRouter.post('/users', requirePerm('users.manage'), h(async (req, res) => {
  const b = parse(userInput, req.body);
  if (!b.password) throw new HttpError(400, 'Set a first password', { password: 'Required for a new user' });
  await checkRefs(tid(req), b.roleIds, b.clientIds);
  const [dupe] = await db.select({ id: users.id }).from(users).where(and(eq(users.tenantId, tid(req)), eq(users.email, b.email)));
  if (dupe) throw new HttpError(409, 'A user with this email already exists', { email: 'Already a user' });
  const [u] = await db.insert(users).values({ tenantId: tid(req), name: b.name, email: b.email, status: b.status, remindersOff: b.remindersOff, clientIds: b.clientIds, mobile: b.mobile, whatsappOptInAt: b.whatsappOptIn && b.mobile ? new Date() : null, passwordHash: await bcrypt.hash(b.password, 10), emailVerifiedAt: new Date() }).returning();
  await db.insert(userRoles).values(b.roleIds.map((roleId) => ({ userId: u.id, roleId })));
  await audit(req, 'user.create', 'user', u.id, { email: b.email, roleIds: b.roleIds });
  res.status(201).json({ id: u.id });
}));

adminRouter.patch('/users/:id', requirePerm('users.manage'), h(async (req, res) => {
  const b = parse(userInput, req.body);
  await checkRefs(tid(req), b.roleIds, b.clientIds);
  const [cur] = await db.select({ at: users.whatsappOptInAt }).from(users).where(and(eq(users.id, req.params.id), eq(users.tenantId, tid(req))));
  const optIn = b.whatsappOptIn && b.mobile ? (cur?.at ?? new Date()) : null;
  const [u] = await db.update(users).set({ name: b.name, email: b.email, status: b.status, remindersOff: b.remindersOff, clientIds: b.clientIds, mobile: b.mobile, whatsappOptInAt: optIn, ...(b.password ? { passwordHash: await bcrypt.hash(b.password, 10) } : {}) })
    .where(and(eq(users.id, req.params.id), eq(users.tenantId, tid(req)))).returning();
  if (!u) throw notFound('User not found');
  if (u.id === req.staff!.user.id && b.status === 'DISABLED') throw new HttpError(400, 'You can’t disable yourself');
  await db.delete(userRoles).where(eq(userRoles.userId, u.id));
  await db.insert(userRoles).values(b.roleIds.map((roleId) => ({ userId: u.id, roleId })));
  if (b.status === 'DISABLED') await db.delete(schema.sessions).where(eq(schema.sessions.userId, u.id));
  await audit(req, 'user.update', 'user', u.id, { ...req.body, password: undefined });
  res.json({ ok: true });
}));

/** Give or take away one client company from a client user (used from the client's Users tab). */
adminRouter.post('/users/:id/client-access', requirePerm('users.manage'), h(async (req, res) => {
  const b = parse(z.object({ clientId: z.string(), grant: z.boolean() }), req.body);
  const [u] = await db.select().from(users).where(and(eq(users.id, req.params.id), eq(users.tenantId, tid(req))));
  if (!u) throw notFound('User not found');
  await checkRefs(tid(req), [], [b.clientId]);
  const next = b.grant ? [...new Set([...u.clientIds, b.clientId])] : u.clientIds.filter((c) => c !== b.clientId);
  if (!next.length && !b.grant) {
    const rs = await db.select({ key: roles.key }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, u.id));
    if (rs.some((r) => r.key.startsWith('CLIENT_'))) throw new HttpError(400, 'This is the user’s only company. Disable the user instead (Administration → Users).');
  }
  await db.update(users).set({ clientIds: next }).where(eq(users.id, u.id));
  await audit(req, b.grant ? 'user.client.grant' : 'user.client.revoke', 'user', u.id, b);
  res.json({ ok: true });
}));

// ---- WhatsApp: set-up state, templates and the message log -----------------------------------------------------
adminRouter.get('/whatsapp', requirePerm('tenant.settings'), h(async (req, res) => res.json({
  configured: whatsappConfigured(), templates: Object.entries(TEMPLATES).map(([k, t]) => ({ key: k, name: templateName(k as any), example: t.example })),
  log: await messageLogFor(tid(req)),
})));

// ---- Workspace settings: filing workflow and reminder emails ------------------------------------------------
adminRouter.get('/settings', requirePerm('clients.view'), h(async (req, res) => res.json(settingsOf(req.staff!.tenant))));
adminRouter.put('/settings', requirePerm('tenant.settings'), h(async (req, res) => {
  const b = parse(settingsInput, req.body);
  const [t] = await db.update(schema.tenants).set({ settings: { ...req.staff!.tenant.settings, ...b } }).where(eq(schema.tenants.id, tid(req))).returning();
  await audit(req, 'settings.update', 'tenant', t.id, b);
  res.json(settingsOf(t));
}));
/** Today's digest for the signed-in user: preview, or send it to them now. */
adminRouter.get('/reminders/preview', requirePerm('clients.view'), h(async (req, res) => res.json(await previewFor(req.staff!.tenant, req.staff!.user.id))));
adminRouter.post('/reminders/send-me', requirePerm('clients.view'), h(async (req, res) => {
  const items = await previewFor(req.staff!.tenant, req.staff!.user.id);
  if (!items.length) throw new HttpError(400, 'Nothing to remind you about today.');
  try { await runWorkspace(req.staff!.tenant, undefined, { onlyUserId: req.staff!.user.id, force: true }); }
  catch (e: any) { throw new HttpError(502, `The email couldn’t be sent: ${e.response ?? e.message}`); }
  res.json({ ok: true, items: items.length, to: req.staff!.user.email });
}));

// ---- Roles -------------------------------------------------------------------------------------------------
adminRouter.get('/roles', requirePerm('users.manage'), h(async (req, res) => {
  res.json(await db.select().from(roles).where(eq(roles.tenantId, tid(req))).orderBy(roles.name));
}));

// ---- Compliance rules (the workspace's own changes; logic in services/rules.ts) ---------------------------
adminRouter.get('/rules', requirePerm('clients.view'), h(async (req, res) => res.json(await workspaceRules(tid(req)))));

adminRouter.get('/rules/:code/history', requirePerm('clients.view'), h(async (req, res) => res.json(await ruleHistoryFor(req.params.code, tid(req)))));

adminRouter.post('/rules', requirePerm('rules.manage'), h(async (req, res) => {
  const b = parse(newRuleInput, req.body);
  const r = await createWorkspaceRule(tid(req), b, req.staff!.user.email);
  await audit(req, 'rule.create', 'rule', b.code, b);
  res.status(201).json(r);
}));

adminRouter.put('/rules/:code', requirePerm('rules.manage'), h(async (req, res) => {
  const b = parse(ruleInput, req.body);
  const r = await saveWorkspaceRule(tid(req), req.params.code, b, req.staff!.user.email);
  await audit(req, 'rule.override', 'rule', req.params.code, b);
  res.json(r);
}));

adminRouter.delete('/rules/:code', requirePerm('rules.manage'), h(async (req, res) => {
  await revertWorkspaceRule(tid(req), req.params.code, req.staff!.user.email);
  await audit(req, 'rule.revert', 'rule', req.params.code);
  res.json({ ok: true });
}));

// ---- Audit -------------------------------------------------------------------------------------------------
adminRouter.get('/audit', requirePerm('audit.view'), h(async (req, res) => {
  res.json(await db.select({ a: auditLog, userName: users.name }).from(auditLog).leftJoin(users, eq(users.id, auditLog.userId))
    .where(eq(auditLog.tenantId, tid(req))).orderBy(desc(auditLog.at)).limit(300));
}));
