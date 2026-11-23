import bcrypt from 'bcryptjs';
import { db, schema } from '../lib/core.js';
import { DEFAULT_ROLES } from '../lib/permissions.js';

/** A new workspace with the default roles and its first administrator. */
export async function createWorkspace(opts: { name: string; slug: string; admin: { name: string; email: string; password: string } }) {
  const [t] = await db.insert(schema.tenants).values({ name: opts.name, slug: opts.slug.toLowerCase() }).returning();
  const roles = await db.insert(schema.roles).values(DEFAULT_ROLES.map((r) => ({ tenantId: t.id, key: r.key, name: r.name, description: r.description, permissions: r.permissions, isSystem: true }))).returning();
  const [u] = await db.insert(schema.users).values({ tenantId: t.id, name: opts.admin.name, email: opts.admin.email.toLowerCase(), passwordHash: await bcrypt.hash(opts.admin.password, 10) }).returning();
  await db.insert(schema.userRoles).values({ userId: u.id, roleId: roles.find((r) => r.key === 'ADMIN')!.id });
  return { tenant: t, admin: u, roles };
}
