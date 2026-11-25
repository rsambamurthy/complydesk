/**
 * Cookie sessions for staff (same scheme as VendorGate): cookie = random token, DB keeps sha256(token).
 * `requireStaff` loads the user, roles and permissions; `requirePerm` guards routes; `clientScope` limits
 * client users to their own companies.
 */
import type { NextFunction, Request, Response } from 'express';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db, schema, env, randomToken, sha256, HttpError } from '../lib/core.js';
import type { Permission } from '../lib/permissions.js';
import type { Tenant, User } from '../db/schema.js';
import { accessState, getSettings, isPlatformAdmin, type AccessState } from '../services/platform.js';

const { sessions, tenants, users, userRoles, roles, apiTokens } = schema;
export const COOKIE = 'cd_s';
const HOURS = 12;

export interface StaffCtx {
  sessionId: string;
  tenant: Tenant;
  user: Pick<User, 'id' | 'name' | 'email' | 'clientIds'>;
  roles: { id: string; key: string; name: string }[];
  permissions: Set<Permission>;
  access: AccessState;
  platformAdmin: boolean;
}
declare global { namespace Express { interface Request { staff?: StaffCtx } } }

export async function createSession(res: Response, tenant: Tenant, userId: string) {
  const token = randomToken();
  const hours = tenant.settings.sessionHours ?? HOURS;
  await db.insert(sessions).values({ tokenHash: sha256(token), tenantId: tenant.id, userId, expiresAt: new Date(Date.now() + hours * 3600_000) });
  res.cookie(COOKIE, token, { httpOnly: true, secure: env.isProd, sameSite: 'lax', path: '/', maxAge: hours * 3600_000 });
}

export async function destroySession(res: Response, sessionId?: string) {
  if (sessionId) await db.delete(sessions).where(eq(sessions.id, sessionId));
  res.clearCookie(COOKIE, { path: '/' });
}

export async function loadStaff(req: Request): Promise<StaffCtx | null> {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  const [row] = await db.select({ s: sessions, t: tenants, u: users }).from(sessions)
    .innerJoin(tenants, eq(tenants.id, sessions.tenantId)).innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())));
  if (!row || row.u.status !== 'ACTIVE') return null;
  return staffFor(row.s.id, row.t, row.u);
}

/** The signed-in context for a user (shared by cookie sessions and extension tokens). */
export async function staffFor(sessionId: string, tenant: Tenant, u: User): Promise<StaffCtx> {
  const row = { s: { id: sessionId }, t: tenant, u };
  const rs = await db.select({ id: roles.id, key: roles.key, name: roles.name, permissions: roles.permissions })
    .from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, row.u.id));
  return {
    sessionId: row.s.id, tenant: row.t,
    user: { id: row.u.id, name: row.u.name, email: row.u.email, clientIds: row.u.clientIds },
    roles: rs.map(({ id, key, name }) => ({ id, key, name })),
    permissions: new Set(rs.flatMap((r) => r.permissions) as Permission[]),
    access: accessState(row.t, (await getSettings()).trialClientLimit),
    platformAdmin: isPlatformAdmin(row.u.email),
  };
}

export async function requireStaff(req: Request, _res: Response, next: NextFunction) {
  try {
    const s = await loadStaff(req);
    if (!s) return next(new HttpError(401, 'Please sign in'));
    // Pending / suspended workspaces can't be used at all (platform admins excepted).
    if (!s.access.ok && (s.access.state === 'PENDING_APPROVAL' || s.access.state === 'SUSPENDED') && !s.platformAdmin) return next(new HttpError(403, s.access.message));
    req.staff = s; next();
  } catch (e) { next(e); }
}

export const requirePerm = (...perms: Permission[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.staff) return next(new HttpError(401, 'Please sign in'));
  if (!perms.every((p) => req.staff!.permissions.has(p))) return next(new HttpError(403, 'You don’t have permission to do this'));
  next();
};

/** Client users see only their companies; firm staff (no client_ids) see all. Returns null for "all". */
export const clientScope = (req: Request): string[] | null => (req.staff!.user.clientIds.length ? req.staff!.user.clientIds : null);

export function assertClientVisible(req: Request, clientId: string) {
  const scope = clientScope(req);
  if (scope && !scope.includes(clientId)) throw new HttpError(404, 'Client not found');
}


/** After the trial or a lapsed subscription the workspace is read-only: reading works, changes don't. */
export function requireWritable(req: Request, _res: Response, next: NextFunction) {
  if (req.method === 'GET' || !req.staff || req.staff.access.ok || req.staff.platformAdmin) return next();
  next(new HttpError(402, (req.staff.access as any).message ?? 'This workspace is read-only'));
}

export function requirePlatformAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.staff?.platformAdmin) return next(new HttpError(403, 'Integrata platform admins only'));
  next();
}

/**
 * Browser-extension token (Authorization: Bearer cdx_…): only for /api/ext, read-only form data.
 * Created and revoked by the user in ComplyDesk; stored as sha256.
 */
export async function requireExtension(req: Request, _res: Response, next: NextFunction) {
  try {
    const m = /^Bearer (cdx_[A-Za-z0-9_-]{20,})$/.exec(req.get('authorization') ?? '');
    if (!m) return next(new HttpError(401, 'Connect the extension to ComplyDesk first'));
    const [row] = await db.select({ k: apiTokens, t: tenants, u: users }).from(apiTokens)
      .innerJoin(tenants, eq(tenants.id, apiTokens.tenantId)).innerJoin(users, eq(users.id, apiTokens.userId))
      .where(and(eq(apiTokens.tokenHash, sha256(m[1])), isNull(apiTokens.revokedAt)));
    if (!row || row.u.status !== 'ACTIVE') return next(new HttpError(401, 'This connection was removed — connect again'));
    const s = await staffFor(`token:${row.k.id}`, row.t, row.u);
    if (!s.access.ok && !s.platformAdmin) return next(new HttpError(403, (s.access as any).message ?? 'Workspace not active'));
    if (s.user.clientIds.length) return next(new HttpError(403, 'The extension is for firm staff'));
    if (!row.k.lastUsedAt || Date.now() - row.k.lastUsedAt.getTime() > 3600_000) await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.k.id));
    req.staff = s; next();
  } catch (e) { next(e); }
}
