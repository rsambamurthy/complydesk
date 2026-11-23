/**
 * Stores what the engine works out. Run whenever a client's facts change (client, people, auditor, AGM date,
 * rules) and nightly. Status, SRN, filed date, assignee and notes are never touched; dates are recomputed
 * until an obligation is filed; obligations the engine no longer produces are marked stale unless work started.
 */
import { and, eq, isNull, or } from 'drizzle-orm';
import { db, schema } from '../lib/core.js';
import { obligationsFor, type Generated } from './engine.js';
import { fyOf, todayIso } from './dates.js';
import type { RuleDef } from './types.js';
import type { Rule } from '../db/schema.js';

const { rules, clients, people, auditors, clientYears, obligations } = schema;

const toDef = (r: Rule): RuleDef => ({ ...r, frequency: r.frequency as RuleDef['frequency'] });

/** The rules in force for a workspace: built-ins, replaced by the workspace's own rule with the same code. */
export async function rulesFor(tenantId: string): Promise<RuleDef[]> {
  const rows = await db.select().from(rules).where(or(isNull(rules.tenantId), eq(rules.tenantId, tenantId)));
  const byCode = new Map<string, Rule>();
  for (const r of rows.filter((r) => !r.tenantId)) byCode.set(r.code, r);
  for (const r of rows.filter((r) => r.tenantId)) byCode.set(r.code, r);
  return [...byCode.values()].map(toDef);
}

/** FYs kept on the calendar: last FY (its annual filings fall due this year) and the current one. */
export const activeFys = (today = todayIso()) => { const f = fyOf(today); return [f - 1, f]; };

export async function syncClient(tenantId: string, clientId: string, ruleList?: RuleDef[]) {
  const [client] = await db.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId)));
  if (!client) return { created: 0, updated: 0, stale: 0 };
  const rs = ruleList ?? await rulesFor(tenantId);
  const ppl = await db.select().from(people).where(eq(people.clientId, clientId));
  const [aud] = await db.select().from(auditors).where(and(eq(auditors.clientId, clientId), eq(auditors.current, true)));
  const years = await db.select().from(clientYears).where(eq(clientYears.clientId, clientId));

  const generated: Generated[] = client.status === 'ACTIVE' ? activeFys().flatMap((fy) => {
    const y = years.find((x) => x.fy === fy);
    return obligationsFor({
      client: { companyType: client.companyType, smallCompany: client.smallCompany, incorporationDate: client.incorporationDate, flags: client.flags },
      people: ppl, auditorTermToFy: aud?.termToFy ?? null,
      year: { agmDate: y?.agmDate, firstBoardMeetingDate: y?.firstBoardMeetingDate },
      rules: rs, fy,
    });
  }) : [];

  const existing = await db.select().from(obligations).where(and(eq(obligations.clientId, clientId), eq(obligations.source, 'AUTO')));
  const have = new Map(existing.map((o) => [o.key, o]));
  let created = 0, updated = 0, stale = 0;
  for (const g of generated) {
    const o = have.get(g.key);
    if (!o) {
      await db.insert(obligations).values({ tenantId, clientId, ...g, source: 'AUTO' }).onConflictDoNothing();
      created++;
    } else {
      have.delete(g.key);
      const changed = o.dueDate !== g.dueDate || o.provisional !== g.provisional || o.title !== g.title || o.form !== g.form || o.periodLabel !== g.periodLabel || o.stale;
      if (changed && o.status !== 'FILED') {
        await db.update(obligations).set({ dueDate: g.dueDate, provisional: g.provisional, title: g.title, form: g.form, periodLabel: g.periodLabel, stale: false, updatedAt: new Date() }).where(eq(obligations.id, o.id));
        updated++;
      }
    }
  }
  // No longer produced: hide if untouched; keep if someone already worked on it. Older FYs simply drop off the active window.
  const fys = new Set(activeFys());
  for (const o of have.values()) {
    if (!fys.has(o.fy) || o.stale) continue;
    if (o.status === 'OPEN' && !o.srn && !o.notes) {
      await db.update(obligations).set({ stale: true, updatedAt: new Date() }).where(eq(obligations.id, o.id));
      stale++;
    }
  }
  return { created, updated, stale };
}

export async function syncTenant(tenantId: string) {
  const rs = await rulesFor(tenantId);
  const list = await db.select({ id: clients.id }).from(clients).where(eq(clients.tenantId, tenantId));
  for (const c of list) await syncClient(tenantId, c.id, rs);
  return list.length;
}
