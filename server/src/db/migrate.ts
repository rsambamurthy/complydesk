import { migrate as runMigrations } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema, pool } from '../lib/core.js';
import { CATALOGUE } from '../compliance/catalogue.js';
import { catalogueValues } from '../services/rules.js';

const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

export async function migrate() { await runMigrations(db, { migrationsFolder: folder }); }

/**
 * Keeps the built-in rules (tenant_id null) in step with catalogue.ts on every start: new rules are added and
 * rules still as shipped are refreshed. A rule Integrata changed in the platform console (source PLATFORM) is
 * left alone; workspace rows are never touched.
 */
export async function seedCatalogue() {
  const { rules } = schema;
  for (const r of CATALOGUE) {
    const vals = catalogueValues(r);
    const [cur] = await db.select({ id: rules.id, source: rules.source }).from(rules).where(and(isNull(rules.tenantId), eq(rules.code, r.code)));
    if (!cur) await db.insert(rules).values({ ...vals, source: 'CATALOGUE' });
    else if (cur.source === 'CATALOGUE') await db.update(rules).set({ ...vals, updatedAt: new Date() }).where(eq(rules.id, cur.id));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await migrate(); await seedCatalogue(); await pool.end(); console.log('Migrated');
}
