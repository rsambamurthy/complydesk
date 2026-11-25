/**
 * Nightly re-sync of every workspace's calendar: provisional dates, a new FY starting on 1 April and
 * director KYC cycles all move with the date even when nobody edits anything. Reminders (Sprint 5) go here too.
 */
import { db, schema } from './lib/core.js';
import { syncTenant } from './compliance/sync.js';
import { runAll as runReminders } from './services/reminders.js';
import { purgeUnused } from './services/extract.js';
import { runMonthlyReports } from './services/clientReport.js';

export async function nightly() {
  const ts = await db.select({ id: schema.tenants.id }).from(schema.tenants);
  for (const t of ts) await syncTenant(t.id);
  await purgeUnused();
}

/** Runs `fn` every day at hh:mm UTC. */
function daily(hour: number, minute: number, name: string, fn: () => Promise<unknown>) {
  const msToNext = () => { const n = new Date(); const t = new Date(n); t.setUTCHours(hour, minute, 0, 0); if (t <= n) t.setUTCDate(t.getUTCDate() + 1); return t.getTime() - n.getTime(); };
  const loop = () => setTimeout(async () => { try { await fn(); } catch (e) { console.error(`${name} failed`, e); } loop(); }, msToNext());
  loop();
}

export function startJobs() {
  daily(3, 0, 'reminder emails', () => runReminders()); // 08:30 IST, after the nightly re-sync
  daily(3, 30, 'monthly client reports', () => runMonthlyReports()); // 09:00 IST; sends only on the 1st

  const msToNext = () => { const n = new Date(); const t = new Date(n); t.setUTCHours(20, 30, 0, 0); if (t <= n) t.setUTCDate(t.getUTCDate() + 1); return t.getTime() - n.getTime(); }; // 02:00 IST
  const loop = () => setTimeout(async () => { try { await nightly(); } catch (e) { console.error('nightly sync failed', e); } loop(); }, msToNext());
  loop();
}
