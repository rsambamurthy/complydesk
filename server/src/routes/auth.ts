import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, h, HttpError } from '../lib/core.js';
import { createSession, destroySession, loadStaff } from '../auth/session.js';
import { parse } from '../lib/parse.js';
import { PERMISSIONS } from '../lib/permissions.js';

const { tenants, users } = schema;
export const authRouter = Router();

authRouter.post('/login', h(async (req, res) => {
  const b = parse(z.object({ workspace: z.string().trim().toLowerCase().min(1, 'Enter your workspace'), email: z.string().trim().toLowerCase().email('Enter your email'), password: z.string().min(1, 'Enter your password') }), req.body);
  const [t] = await db.select().from(tenants).where(eq(tenants.slug, b.workspace));
  const [u] = t ? await db.select().from(users).where(and(eq(users.tenantId, t.id), eq(users.email, b.email))) : [];
  const ok = !!u?.passwordHash && u.status === 'ACTIVE' && (await bcrypt.compare(b.password, u.passwordHash));
  if (!t || !ok) throw new HttpError(401, 'Workspace, email or password is not right');
  await createSession(res, t, u.id);
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
  res.json({ ok: true });
}));

authRouter.post('/logout', h(async (req, res) => {
  const s = await loadStaff(req);
  await destroySession(res, s?.sessionId);
  res.json({ ok: true });
}));

authRouter.get('/me', h(async (req, res) => {
  const s = await loadStaff(req);
  if (!s) throw new HttpError(401, 'Please sign in');
  res.json({
    tenant: { id: s.tenant.id, name: s.tenant.name, slug: s.tenant.slug },
    user: s.user, roles: s.roles, permissions: [...s.permissions], permissionLabels: PERMISSIONS,
  });
}));
