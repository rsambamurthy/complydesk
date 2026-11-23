/**
 * Cookie sessions for staff (same scheme as VendorGate): cookie = random token, DB keeps sha256(token).
 * `requireStaff` loads the user, roles and permissions; `requirePerm` guards routes; `clientScope` limits
 * client users to their own companies.
 */
import type { NextFunction, Request, Response } from 'express';
import { and, eq, gt } from 'drizzle-orm';
import { db, schema, env, randomToken, sha256, HttpError } from '../lib/core.js';
import type { Permission } from '../lib/permissions.js';
import type { Tenant, User } from '../db/schema.js';

const { sessions, tenants, users, userRoles, roles } = schema;
export const COOKIE = 'cd_s';
const HOURS = 12;

export interface StaffCtx {
  sessionId: string;
  tenant: Tenant;
  user: Pick<User, 'id' | 'name' | 'email' | 'clientIds'>;
  roles: { id: string; key: string; name: string }[];
  permissions: Set<Permission>;
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
  const rs = await db.select({ id: roles.id, key: roles.key, name: roles.name, permissions: roles.permissions })
    .from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, row.u.id));
  return {
    sessionId: row.s.id, tenant: row.t,
    user: { id: row.u.id, name: row.u.name, email: row.u.email, clientIds: row.u.clientIds },
    roles: rs.map(({ id, key, name }) => ({ id, key, name })),
    permissions: new Set(rs.flatMap((r) => r.permissions) as Permission[]),
  };
}

export async function requireStaff(req: Request, _res: Response, next: NextFunction) {
  try {
    const s = await loadStaff(req);
    if (!s) return next(new HttpError(401, 'Please sign in'));
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

