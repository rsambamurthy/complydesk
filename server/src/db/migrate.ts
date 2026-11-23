import { migrate as runMigrations } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema, pool } from '../lib/core.js';
import { CATALOGUE } from '../compliance/catalogue.js';

const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

export async function migrate() { await runMigrations(db, { migrationsFolder: folder }); }

/** Keeps the built-in rules (tenant_id null) equal to catalogue.ts. Workspace overrides are never touched. */
export async function seedCatalogue() {
  const { rules } = schema;
  for (const r of CATALOGUE) {
    const vals = { code: r.code, form: r.form, title: r.title, law: r.law ?? null, frequency: r.frequency, applies: r.applies, due: r.due, lateFee: r.lateFee ?? null, event: r.event ?? null, notes: r.notes ?? null, effectiveFrom: r.effectiveFrom ?? null, effectiveTo: r.effectiveTo ?? null, active: r.active ?? true };
    const [cur] = await db.select({ id: rules.id }).from(rules).where(and(isNull(rules.tenantId), eq(rules.code, r.code)));
    if (cur) await db.update(rules).set({ ...vals, updatedAt: new Date() }).where(eq(rules.id, cur.id));
    else await db.insert(rules).values(vals);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await migrate(); await seedCatalogue(); await pool.end(); console.log('Migrated');
}
