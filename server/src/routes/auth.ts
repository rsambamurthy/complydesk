import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, h, HttpError } from '../lib/core.js';
import { createSession, destroySession, loadStaff } from '../auth/session.js';
import { parse } from '../lib/parse.js';
import { PERMISSIONS } from '../lib/permissions.js';
import { accessState, isPlatformAdmin, signUp, signupInput, verifyEmail, workspaceAvailable, slugFrom, sendVerification } from '../services/platform.js';
import { mailConfigured } from '../lib/mailer.js';

const { tenants, users } = schema;
export const authRouter = Router();

authRouter.post('/login', h(async (req, res) => {
  const b = parse(z.object({ workspace: z.string().trim().toLowerCase().min(1, 'Enter your workspace'), email: z.string().trim().toLowerCase().email('Enter your email'), password: z.string().min(1, 'Enter your password') }), req.body);
  const [t] = await db.select().from(tenants).where(eq(tenants.slug, b.workspace));
  const [u] = t ? await db.select().from(users).where(and(eq(users.tenantId, t.id), eq(users.email, b.email))) : [];
  const ok = !!u?.passwordHash && u.status === 'ACTIVE' && (await bcrypt.compare(b.password, u.passwordHash));
  if (!t || !ok) throw new HttpError(401, 'Workspace, email or password is not right');
  const access = accessState(t);
  if (!isPlatformAdmin(u.email) && (access.state === 'PENDING_APPROVAL' || access.state === 'SUSPENDED')) throw new HttpError(403, (access as any).message);
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
    access: s.access, platformAdmin: s.platformAdmin,
    emailVerified: !!(await db.select({ v: users.emailVerifiedAt }).from(users).where(eq(users.id, s.user.id)))[0]?.v,
  });
}));

// ---- Self sign-up (public) ------------------------------------------------------------------------------------
/** Small in-memory limiter: a handful of sign-ups per IP per hour. */
const hits = new Map<string, number[]>();
const limited = (ip: string, max: number) => {
  const now = Date.now(); const list = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000);
  list.push(now); hits.set(ip, list); return list.length > max;
};

authRouter.get('/workspace-available', h(async (req, res) => {
  const code = String(req.query.code ?? '');
  res.json({ ...(await workspaceAvailable(code)), suggestion: req.query.name ? slugFrom(String(req.query.name)) : undefined });
}));

authRouter.post('/signup', h(async (req, res) => {
  if (limited(req.ip ?? '-', 5)) throw new HttpError(429, 'Too many sign-ups from this network. Try again in an hour.');
  const t = await signUp(parse(signupInput, req.body));
  if (t.status === 'TRIAL') {
    const [u] = await db.select().from(users).where(eq(users.tenantId, t.id));
    await createSession(res, t, u.id);
  }
  res.status(201).json({ status: t.status, workspace: t.slug, trialEndsAt: t.trialEndsAt, mailSent: mailConfigured() });
}));

authRouter.post('/verify-email', h(async (req, res) => {
  await verifyEmail(String(req.body?.token ?? ''));
  res.json({ ok: true });
}));

authRouter.post('/resend-verification', h(async (req, res) => {
  const s = await loadStaff(req);
  if (!s) throw new HttpError(401, 'Please sign in');
  await sendVerification(s.user.id, s.user.email, s.user.name, s.tenant);
  res.json({ ok: true, mailSent: mailConfigured() });
}));
