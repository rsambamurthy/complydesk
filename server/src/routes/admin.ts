/** Administration: users, roles, compliance rules, audit log. */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, h, audit, HttpError, notFound } from '../lib/core.js';
import { requirePerm } from '../auth/session.js';
import { parse } from '../lib/parse.js';
import { syncTenant } from '../compliance/sync.js';

const { users, roles, userRoles, rules, auditLog, clients } = schema;
export const adminRouter = Router();
const tid = (req: any) => req.staff.tenant.id as string;

// ---- Users -------------------------------------------------------------------------------------------------
adminRouter.get('/users', requirePerm('users.manage'), h(async (req, res) => {
  const list = await db.select({ id: users.id, name: users.name, email: users.email, status: users.status, clientIds: users.clientIds, lastLoginAt: users.lastLoginAt })
    .from(users).where(eq(users.tenantId, tid(req))).orderBy(users.name);
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
  const [u] = await db.insert(users).values({ tenantId: tid(req), name: b.name, email: b.email, status: b.status, clientIds: b.clientIds, passwordHash: await bcrypt.hash(b.password, 10), emailVerifiedAt: new Date() }).returning();
  await db.insert(userRoles).values(b.roleIds.map((roleId) => ({ userId: u.id, roleId })));
  await audit(req, 'user.create', 'user', u.id, { email: b.email, roleIds: b.roleIds });
  res.status(201).json({ id: u.id });
}));

adminRouter.patch('/users/:id', requirePerm('users.manage'), h(async (req, res) => {
  const b = parse(userInput, req.body);
  await checkRefs(tid(req), b.roleIds, b.clientIds);
  const [u] = await db.update(users).set({ name: b.name, email: b.email, status: b.status, clientIds: b.clientIds, ...(b.password ? { passwordHash: await bcrypt.hash(b.password, 10) } : {}) })
    .where(and(eq(users.id, req.params.id), eq(users.tenantId, tid(req)))).returning();
  if (!u) throw notFound('User not found');
  if (u.id === req.staff!.user.id && b.status === 'DISABLED') throw new HttpError(400, 'You can’t disable yourself');
  await db.delete(userRoles).where(eq(userRoles.userId, u.id));
  await db.insert(userRoles).values(b.roleIds.map((roleId) => ({ userId: u.id, roleId })));
  if (b.status === 'DISABLED') await db.delete(schema.sessions).where(eq(schema.sessions.userId, u.id));
  await audit(req, 'user.update', 'user', u.id, { ...req.body, password: undefined });
  res.json({ ok: true });
}));

// ---- Roles -------------------------------------------------------------------------------------------------
adminRouter.get('/roles', requirePerm('users.manage'), h(async (req, res) => {
  res.json(await db.select().from(roles).where(eq(roles.tenantId, tid(req))).orderBy(roles.name));
}));

// ---- Compliance rules ------------------------------------------------------------------------------------
adminRouter.get('/rules', requirePerm('clients.view'), h(async (req, res) => {
  const builtIn = await db.select().from(rules).where(isNull(rules.tenantId)).orderBy(rules.code);
  const own = await db.select().from(rules).where(eq(rules.tenantId, tid(req)));
  res.json(builtIn.map((b) => { const o = own.find((x) => x.code === b.code); return { ...(o ?? b), builtIn: b, overridden: !!o }; }));
}));

const fixedDate = z.object({ month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31), yearOffset: z.number().int().min(-1).max(2) });
const ruleEdit = z.object({
  title: z.string().trim().min(2),
  active: z.boolean(),
  notes: z.string().nullish(),
  effectiveFrom: z.string().nullish().transform((v) => v || null),
  effectiveTo: z.string().nullish().transform((v) => v || null),
  due: z.union([
    z.object({ kind: z.literal('FIXED'), date: fixedDate }),
    z.object({ kind: z.literal('AFTER_ANCHOR'), anchor: z.enum(['AGM', 'FIRST_BM', 'INCORPORATION']), days: z.number().int().min(0).max(400), fallback: z.union([fixedDate, z.literal('AGM_LAST_DATE')]).optional() }),
    z.object({ kind: z.literal('PERIODS'), periods: z.array(z.object({ label: z.string(), date: fixedDate })).min(1) }),
    z.object({ kind: z.literal('AFTER_EVENT'), days: z.number().int().min(0).max(400) }),
    z.object({ kind: z.literal('KYC_CYCLE'), everyYears: z.number().int().min(1).max(10), date: fixedDate.omit({ yearOffset: true }) }),
    z.object({ kind: z.literal('AGM_LAST_DATE') }),
  ]),
  lateFee: z.union([z.object({ kind: z.literal('PER_DAY'), amount: z.number().min(0), note: z.string().optional() }), z.object({ kind: z.literal('NOTE'), note: z.string() })]).nullish(),
});

/** Saves the workspace's own version of a rule (the built-in stays as it is) and re-syncs every client. */
adminRouter.put('/rules/:code', requirePerm('rules.manage'), h(async (req, res) => {
  const b = parse(ruleEdit, req.body);
  const [base] = await db.select().from(rules).where(and(isNull(rules.tenantId), eq(rules.code, req.params.code)));
  if (!base) throw notFound('Rule not found');
  if (base.due.kind !== b.due.kind) throw new HttpError(400, 'The kind of due date can’t be changed');
  const { id: _id, tenantId: _t, ...copy } = base;
  await db.insert(rules).values({ ...copy, ...b, tenantId: tid(req), updatedAt: new Date() })
    .onConflictDoUpdate({ target: [rules.tenantId, rules.code], set: { ...b, updatedAt: new Date() } });
  const n = await syncTenant(tid(req));
  await audit(req, 'rule.override', 'rule', req.params.code, b);
  res.json({ ok: true, clientsUpdated: n });
}));

adminRouter.delete('/rules/:code', requirePerm('rules.manage'), h(async (req, res) => {
  await db.delete(rules).where(and(eq(rules.tenantId, tid(req)), eq(rules.code, req.params.code)));
  const n = await syncTenant(tid(req));
  await audit(req, 'rule.revert', 'rule', req.params.code);
  res.json({ ok: true, clientsUpdated: n });
}));

// ---- Audit -------------------------------------------------------------------------------------------------
adminRouter.get('/audit', requirePerm('audit.view'), h(async (req, res) => {
  res.json(await db.select({ a: auditLog, userName: users.name }).from(auditLog).leftJoin(users, eq(users.id, auditLog.userId))
    .where(eq(auditLog.tenantId, tid(req))).orderBy(desc(auditLog.at)).limit(300));
}));
