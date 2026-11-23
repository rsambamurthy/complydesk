/**
 * Nightly re-sync of every workspace's calendar: provisional dates, a new FY starting on 1 April and
 * director KYC cycles all move with the date even when nobody edits anything. Reminders (Sprint 5) go here too.
 */
import { db, schema } from './lib/core.js';
import { syncTenant } from './compliance/sync.js';

export async function nightly() {
  const ts = await db.select({ id: schema.tenants.id }).from(schema.tenants);
  for (const t of ts) await syncTenant(t.id);
}

export function startJobs() {
  const msToNext = () => { const n = new Date(); const t = new Date(n); t.setUTCHours(20, 30, 0, 0); if (t <= n) t.setUTCDate(t.getUTCDate() + 1); return t.getTime() - n.getTime(); }; // 02:00 IST
  const loop = () => setTimeout(async () => { try { await nightly(); } catch (e) { console.error('nightly sync failed', e); } loop(); }, msToNext());
  loop();
}
