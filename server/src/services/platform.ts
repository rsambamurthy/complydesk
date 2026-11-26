/**
 * Integrata platform level: self sign-up, trial and access state, platform settings, and the console's
 * view of every workspace. Same model as Quayly (trial → active → suspended), adapted to Drizzle.
 */
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, HttpError, randomToken, sha256 } from '../lib/core.js';
import { createWorkspace } from './tenants.js';
import { sendMail, appUrl } from '../lib/mailer.js';
import type { Tenant } from '../db/schema.js';

const { tenants, platformSettings, users, clients, authTokens, platformEvents } = schema;
const DAY = 86_400_000;

export async function getSettings() {
  const [s] = await db.select().from(platformSettings).where(eq(platformSettings.id, 'default'));
  if (s) return s;
  const [created] = await db.insert(platformSettings).values({ id: 'default' }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(platformSettings).where(eq(platformSettings.id, 'default')))[0];
}

export const settingsInput = z.object({
  requireApproval: z.boolean(),
  trialDays: z.coerce.number().int().min(1).max(365),
  trialClientLimit: z.coerce.number().int().min(1).max(10000).nullable(),
});
export async function updateSettings(input: z.output<typeof settingsInput>) {
  await getSettings();
  const [s] = await db.update(platformSettings).set({ ...input, updatedAt: new Date() }).where(eq(platformSettings.id, 'default')).returning();
  return s;
}

export type AccessState =
  | { ok: true; state: 'ACTIVE' }
  | { ok: true; state: 'TRIAL'; daysLeft: number; clientLimit: number | null }
  | { ok: false; state: 'TRIAL_ENDED' | 'PAYMENT_DUE' | 'SUSPENDED' | 'PENDING_APPROVAL'; message: string };

/** What a workspace may do right now. Read-only when not ok (except pending/suspended, which can't sign in). */
export function accessState(t: Pick<Tenant, 'status' | 'trialEndsAt' | 'paidUntil'>, clientLimit: number | null = null, now = Date.now()): AccessState {
  switch (t.status) {
    case 'PENDING_APPROVAL': return { ok: false, state: 'PENDING_APPROVAL', message: 'Your workspace is waiting for approval by Integrata. We’ll email you as soon as it’s open.' };
    case 'SUSPENDED': return { ok: false, state: 'SUSPENDED', message: 'This workspace is suspended. Contact Integrata at info@integratatech.ai.' };
    case 'TRIAL': {
      const end = t.trialEndsAt?.getTime() ?? 0;
      if (end > now) return { ok: true, state: 'TRIAL', daysLeft: Math.ceil((end - now) / DAY), clientLimit };
      return { ok: false, state: 'TRIAL_ENDED', message: 'Your free trial has ended. Your data is safe and read-only — subscribe under Administration → Plan & payment.' };
    }
    default:
      if (t.paidUntil && t.paidUntil.getTime() + 7 * DAY < now) return { ok: false, state: 'PAYMENT_DUE', message: 'Your subscription has lapsed. Your data is read-only until it is renewed under Administration → Plan & payment.' };
      return { ok: true, state: 'ACTIVE' };
  }
}

/** Client and user limits (trial and plans) live in services/subscription.ts. */

// ---- Sign-up --------------------------------------------------------------------------------------------
const RESERVED = ['admin', 'platform', 'api', 'www', 'app', 'login', 'signup', 'support', 'integrata', 'demo'];
export const workspaceCode = z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9-]{2,29}$/, '3–30 letters, digits or hyphens, starting with a letter')
  .refine((s) => !RESERVED.includes(s), 'This code is reserved');

export const signupInput = z.object({
  firmName: z.string().trim().min(3, 'Enter the firm’s name'),
  workspace: workspaceCode,
  icsiNumber: z.string().trim().max(30).nullish().transform((v) => v || null),
  city: z.string().trim().min(2, 'Enter the city'),
  gstin: z.string().trim().toUpperCase().nullish().transform((v) => v || null)
    .refine((v) => !v || /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v), 'GSTIN looks like 33ABCDE1234F1Z5'),
  adminName: z.string().trim().min(2, 'Enter your name'),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  mobile: z.string().trim().regex(/^(\+91)?[6-9]\d{9}$/, 'A 10-digit Indian mobile number'),
  password: z.string().min(10, 'At least 10 characters'),
  accept: z.literal(true, { errorMap: () => ({ message: 'Please accept the terms' }) }),
});

export const slugFrom = (name: string) => name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/^[^a-z]+/, '') || 'firm';

export async function workspaceAvailable(code: string) {
  const ok = workspaceCode.safeParse(code);
  if (!ok.success) return { available: false, reason: ok.error.issues[0].message };
  const [t] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, ok.data));
  return t ? { available: false, reason: 'Already taken' } : { available: true };
}

export async function signUp(input: z.output<typeof signupInput>) {
  const avail = await workspaceAvailable(input.workspace);
  if (!avail.available) throw new HttpError(409, 'Choose another workspace code', { workspace: avail.reason });
  const settings = await getSettings();
  const { tenant, admin } = await createWorkspace({ name: input.firmName, slug: input.workspace, admin: { name: input.adminName, email: input.email, password: input.password } });
  const status = settings.requireApproval ? 'PENDING_APPROVAL' : 'TRIAL';
  const [t] = await db.update(tenants).set({
    status, trialEndsAt: status === 'TRIAL' ? new Date(Date.now() + settings.trialDays * DAY) : null,
    icsiNumber: input.icsiNumber, city: input.city, gstin: input.gstin, contactEmail: input.email, contactMobile: input.mobile, source: 'SIGNUP',
  }).where(eq(tenants.id, tenant.id)).returning();
  // A self sign-up must confirm its email (workspaces and users created by an admin count as confirmed).
  await db.update(users).set({ mobile: input.mobile, emailVerifiedAt: null }).where(eq(users.id, admin.id));
  await event(t.id, 'signup', input.email, { status, requireApproval: settings.requireApproval });
  await sendVerification(admin.id, admin.email, admin.name, t).catch((e) => console.error('verification mail failed:', e.message));
  if (settings.requireApproval) await notifyPlatform(`New sign-up awaiting approval: ${t.name}`, `${t.name} (${t.slug}), ${input.city}\n${input.adminName} · ${input.email} · ${input.mobile}\nApprove it in the platform console: ${appUrl('/platform')}`);
  return t;
}

async function event(tenantId: string | null, type: string, by: string | null, data: unknown) {
  await db.insert(platformEvents).values({ tenantId, type, by, data: data as any });
}

// ---- Email verification ------------------------------------------------------------------------------------
export async function sendVerification(userId: string, email: string, name: string, t: Pick<Tenant, 'name' | 'slug'>) {
  const token = randomToken();
  await db.insert(authTokens).values({ tokenHash: sha256(token), purpose: 'verify', userId, expiresAt: new Date(Date.now() + 7 * DAY) });
  const link = appUrl(`/verify-email?token=${token}`);
  await sendMail(email, 'Confirm your email for ComplyDesk',
    `Hello ${name},\n\nThank you for signing up ${t.name} on ComplyDesk.\nPlease confirm your email: ${link}\n\nSign in with workspace code “${t.slug}”.\n\n— Integrata`);
}

export async function verifyEmail(token: string) {
  const [row] = await db.select().from(authTokens).where(and(eq(authTokens.tokenHash, sha256(token)), eq(authTokens.purpose, 'verify'), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())));
  if (!row) throw new HttpError(400, 'This link has expired or was already used.');
  await db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, row.id));
  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, row.userId));
}

// ---- Platform console ---------------------------------------------------------------------------------------
/** Platform admins: users whose email is in PLATFORM_ADMINS (comma-separated), signed in to any workspace. */
export const isPlatformAdmin = (email: string) =>
  (process.env.PLATFORM_ADMINS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());

export async function tenantList() {
  const rows = await db.select({
    t: tenants,
    clients: sql<number>`(select count(*)::int from clients c where c.tenant_id = tenants.id and c.status = 'ACTIVE')`,
    users: sql<number>`(select count(*)::int from users u where u.tenant_id = tenants.id and u.status = 'ACTIVE')`,
    lastLogin: sql<string | null>`(select max(u.last_login_at) from users u where u.tenant_id = tenants.id)`,
    admin: sql<string | null>`(select u.email from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id where u.tenant_id = tenants.id and r.key = 'ADMIN' order by u.created_at limit 1)`,
    verified: sql<boolean>`exists(select 1 from users u where u.tenant_id = tenants.id and u.email_verified_at is not null)`,
  }).from(tenants).orderBy(sql`${tenants.createdAt} desc`);
  const { trialClientLimit } = await getSettings();
  return rows.map(({ t, ...x }) => ({ ...t, ...x, access: accessState(t, trialClientLimit) }));
}

export const tenantAction = z.object({
  action: z.enum(['approve', 'suspend', 'reactivate', 'extend_trial', 'activate', 'notes']),
  days: z.coerce.number().int().min(1).max(365).optional(),
  months: z.coerce.number().int().min(1).max(36).optional(),
  notes: z.string().optional(),
});

export async function applyTenantAction(id: string, a: z.output<typeof tenantAction>, by: string) {
  const [t] = await db.select().from(tenants).where(eq(tenants.id, id));
  if (!t) throw new HttpError(404, 'Workspace not found');
  const settings = await getSettings();
  const patch: Partial<Tenant> = {};
  const fromNow = (ms: number, base?: Date | null) => new Date(Math.max(Date.now(), base?.getTime() ?? 0) + ms);
  switch (a.action) {
    case 'approve':
      if (t.status !== 'PENDING_APPROVAL') throw new HttpError(400, 'Only workspaces waiting for approval can be approved');
      Object.assign(patch, { status: 'TRIAL', trialEndsAt: fromNow(settings.trialDays * DAY) });
      break;
    case 'suspend': patch.status = 'SUSPENDED'; break;
    case 'reactivate': patch.status = t.paidUntil ? 'ACTIVE' : 'TRIAL'; if (!t.paidUntil && (!t.trialEndsAt || t.trialEndsAt.getTime() < Date.now())) patch.trialEndsAt = fromNow(7 * DAY); break;
    case 'extend_trial': Object.assign(patch, { status: 'TRIAL', trialEndsAt: fromNow((a.days ?? 15) * DAY, t.trialEndsAt) }); break;
    case 'activate': Object.assign(patch, { status: 'ACTIVE', paidUntil: fromNow((a.months ?? 12) * 30 * DAY, t.paidUntil) }); break;
    case 'notes': patch.platformNotes = a.notes ?? null; break;
  }
  const [next] = await db.update(tenants).set(patch).where(eq(tenants.id, id)).returning();
  if (['suspend', 'approve', 'reactivate'].includes(a.action) && patch.status === 'SUSPENDED') await db.delete(schema.sessions).where(eq(schema.sessions.tenantId, id));
  await event(id, a.action, by, a);
  if (a.action === 'approve' && t.contactEmail) {
    await sendMail(t.contactEmail, 'Your ComplyDesk workspace is open',
      `Your workspace for ${t.name} is approved. Your ${settings.trialDays}-day free trial starts today.\n\nSign in: ${appUrl('/login')}\nWorkspace code: ${t.slug}\n\n— Integrata`).catch((e) => console.error('approval mail failed:', e.message));
  }
  return next;
}

export async function platformEventsList() {
  return db.select({ e: platformEvents, tenant: tenants.name }).from(platformEvents).leftJoin(tenants, eq(tenants.id, platformEvents.tenantId)).orderBy(sql`${platformEvents.at} desc`).limit(200);
}

async function notifyPlatform(subject: string, body: string) {
  for (const to of (process.env.PLATFORM_ADMINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)) await sendMail(to, subject, body).catch((e) => console.error('platform mail failed:', e.message));
}

