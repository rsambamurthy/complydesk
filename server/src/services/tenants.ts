import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
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

/**
 * First workspace on a fresh install, from environment variables (set in Railway):
 * BOOTSTRAP_WORKSPACE (sign-in code, e.g. "integrata"), BOOTSTRAP_WORKSPACE_NAME, BOOTSTRAP_ADMIN_NAME,
 * BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD. Does nothing once the workspace exists — remove the
 * password variable after the first sign-in.
 */
export async function bootstrapWorkspace(env = process.env) {
  const slug = env.BOOTSTRAP_WORKSPACE?.trim().toLowerCase();
  const email = env.BOOTSTRAP_ADMIN_EMAIL?.trim();
  const password = env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!slug || !email || !password) return;
  const [exists] = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, slug));
  if (exists) return;
  if (password.length < 10) { console.error('BOOTSTRAP_ADMIN_PASSWORD must be at least 10 characters — workspace not created'); return; }
  await createWorkspace({ name: env.BOOTSTRAP_WORKSPACE_NAME?.trim() || slug, slug, admin: { name: env.BOOTSTRAP_ADMIN_NAME?.trim() || email, email, password } });
  console.log(`Created workspace "${slug}" with admin ${email}`);
}
