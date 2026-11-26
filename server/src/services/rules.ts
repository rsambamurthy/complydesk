/**
 * Compliance rules: the one place rules are validated, changed and recorded — for Integrata (the built-in
 * rules every firm starts from) and for a workspace (its own changes and its own rules).
 *
 * Layers, lowest first (sync.ts rulesFor): catalogue.ts as shipped → Integrata's edits / new rules (platform) →
 * a workspace's own edits / new rules. A workspace change to a rule always wins for that workspace.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, HttpError, notFound } from '../lib/core.js';
import { FLAGS, COMPANY_TYPES } from '../lib/validators.js';
import { CATALOGUE } from '../compliance/catalogue.js';
import { syncTenant } from '../compliance/sync.js';
import type { DueRule, RuleDef } from '../compliance/types.js';
import type { Rule } from '../db/schema.js';

const { rules, ruleHistory, tenants } = schema;

// ---- Validation (shared by the platform console and the workspace screens) ----------------------------------
const fixedDate = z.object({ month: z.coerce.number().int().min(1).max(12), day: z.coerce.number().int().min(1).max(31), yearOffset: z.coerce.number().int().min(0).max(1) })
  .refine((d) => d.day <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][d.month - 1], 'That day doesn’t exist in that month');
const days = z.coerce.number().int().min(0, 'Days can’t be negative').max(400, 'At most 400 days');

export const dueInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('FIXED'), date: fixedDate }),
  z.object({ kind: z.literal('AGM_LAST_DATE') }),
  z.object({ kind: z.literal('AFTER_ANCHOR'), anchor: z.enum(['AGM', 'FIRST_BM', 'INCORPORATION']), days, fallback: z.union([fixedDate, z.literal('AGM_LAST_DATE')]).optional() }),
  z.object({ kind: z.literal('PERIODS'), periods: z.array(z.object({ label: z.string().trim().min(1, 'Name the period'), date: fixedDate })).min(1, 'Add at least one period').max(12) }),
  z.object({ kind: z.literal('AFTER_EVENT'), days }),
  z.object({ kind: z.literal('KYC_CYCLE'), everyYears: z.coerce.number().int().min(1).max(10), date: z.object({ month: z.coerce.number().int().min(1).max(12), day: z.coerce.number().int().min(1).max(31) }) }),
]);

export const ruleInput = z.object({
  form: z.string().trim().min(2, 'Enter the form or meeting, e.g. AOC-4').max(40),
  title: z.string().trim().min(2, 'Describe it in a few words').max(120),
  law: z.string().trim().max(120).nullish().transform((v) => v || null),
  applies: z.object({
    types: z.array(z.enum(COMPANY_TYPES)).optional(),
    small: z.boolean().optional(),
    flags: z.array(z.enum(Object.keys(FLAGS) as [string, ...string[]])).optional(),
    notFlags: z.array(z.enum(Object.keys(FLAGS) as [string, ...string[]])).optional(),
    conditions: z.array(z.enum(['AUDITOR_TERM_ENDS', 'FIRST_FY'])).optional(),
  }).default({}),
  due: dueInput,
  lateFee: z.union([
    z.object({ kind: z.literal('PER_DAY'), amount: z.coerce.number().min(0).max(100000), note: z.string().optional() }),
    z.object({ kind: z.literal('NOTE'), note: z.string().trim().min(1) }),
  ]).nullish().transform((v) => v ?? null),
  event: z.string().trim().max(120).nullish().transform((v) => v || null),
  notes: z.string().trim().max(2000).nullish().transform((v) => v || null),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal('').transform(() => null)).transform((v) => v || null),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal('').transform(() => null)).transform((v) => v || null),
  active: z.boolean().default(true),
}).superRefine((r, ctx) => {
  if (r.effectiveFrom && r.effectiveTo && r.effectiveTo < r.effectiveFrom) ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'Ends before it starts' });
  if (r.due.kind === 'AFTER_EVENT' && !r.event) ctx.addIssue({ code: 'custom', path: ['event'], message: 'Name the event that starts the clock' });
  // Empty lists mean "no condition".
  for (const k of ['types', 'flags', 'conditions'] as const) if (r.applies[k]?.length === 0) delete r.applies[k];
});
export type RuleIn = z.output<typeof ruleInput>;

const CODE_RE = /^[A-Z][A-Z0-9_]{1,29}$/;
export const newRuleInput = z.object({ code: z.string().trim().toUpperCase().regex(CODE_RE, 'Capital letters, digits and _ (e.g. GST_ANNUAL)') }).and(ruleInput);

/** How often a rule produces obligations follows from its kind of due date (not entered separately). */
export function frequencyFor(due: DueRule, applies: RuleDef['applies'] = {}): RuleDef['frequency'] {
  switch (due.kind) {
    case 'AFTER_EVENT': return 'EVENT';
    case 'KYC_CYCLE': return 'PER_DIRECTOR';
    case 'PERIODS': return due.periods.length === 4 ? 'QUARTERLY' : due.periods.length === 2 ? 'HALF_YEARLY' : 'ANNUAL';
    case 'AFTER_ANCHOR': return due.anchor === 'INCORPORATION' || applies.conditions?.includes('FIRST_FY') ? 'ONE_TIME' : 'ANNUAL';
    default: return 'ANNUAL';
  }
}

const snapshot = (r: Rule | undefined | null) => (r ? (({ id: _i, tenantId: _t, updatedAt: _u, ...rest }) => rest)(r) : null);
const values = (r: RuleIn) => ({ ...r, frequency: frequencyFor(r.due as DueRule, r.applies) });

async function record(tenantId: string | null, code: string, action: string, by: string, before: Rule | null | undefined, after: Rule | null | undefined) {
  await db.insert(ruleHistory).values({ tenantId, code, action, by, before: snapshot(before), after: snapshot(after) });
}

const platformRow = async (code: string) => (await db.select().from(rules).where(and(isNull(rules.tenantId), eq(rules.code, code))))[0];
const workspaceRow = async (tenantId: string, code: string) => (await db.select().from(rules).where(and(eq(rules.tenantId, tenantId), eq(rules.code, code))))[0];
const inCatalogue = (code: string) => CATALOGUE.find((r) => r.code === code);

/** Re-sync every workspace after an Integrata change (in the background: it can take a while). */
function syncAllLater() {
  db.select({ id: tenants.id }).from(tenants).then(async (ts) => { for (const t of ts) await syncTenant(t.id); })
    .catch((e) => console.error('re-sync after rule change failed:', e));
}

// ---- Integrata (platform) -------------------------------------------------------------------------------
export async function platformRules() {
  const base = await db.select().from(rules).where(isNull(rules.tenantId)).orderBy(rules.form, rules.code);
  const overrides = await db.select({ code: rules.code, n: sql<number>`count(*)::int` }).from(rules).where(sql`${rules.tenantId} is not null`).groupBy(rules.code);
  return base.map((r) => ({
    ...r, inCatalogue: !!inCatalogue(r.code), catalogue: inCatalogue(r.code) ?? null,
    firmsChanged: overrides.find((o) => o.code === r.code)?.n ?? 0,
  }));
}

export async function savePlatformRule(code: string, input: RuleIn, by: string) {
  const cur = await platformRow(code);
  if (!cur) throw notFound('Rule not found');
  const [next] = await db.update(rules).set({ ...values(input), source: 'PLATFORM', updatedBy: by, updatedAt: new Date() }).where(eq(rules.id, cur.id)).returning();
  await record(null, code, 'update', by, cur, next);
  syncAllLater();
  return next;
}

export async function createPlatformRule(input: RuleIn & { code: string }, by: string) {
  if (await platformRow(input.code)) throw new HttpError(409, 'A rule with this code already exists', { code: 'Already used' });
  const [next] = await db.insert(rules).values({ ...values(input), code: input.code, tenantId: null, source: 'PLATFORM', updatedBy: by }).returning();
  await record(null, input.code, 'create', by, null, next);
  syncAllLater();
  return next;
}

/** Back to the rule as shipped (catalogue.ts); a rule Integrata added itself is removed instead. */
export async function resetPlatformRule(code: string, by: string) {
  const cur = await platformRow(code);
  if (!cur) throw notFound('Rule not found');
  const shipped = inCatalogue(code);
  if (shipped) {
    const [next] = await db.update(rules).set({ ...catalogueValues(shipped), source: 'CATALOGUE', updatedBy: by, updatedAt: new Date() }).where(eq(rules.id, cur.id)).returning();
    await record(null, code, 'revert', by, cur, next);
  } else {
    const used = await db.select({ id: rules.id }).from(rules).where(and(eq(rules.code, code), sql`${rules.tenantId} is not null`));
    if (used.length) throw new HttpError(400, `${used.length} firm(s) have their own version of this rule. Switch it off instead of deleting it.`);
    await db.delete(rules).where(eq(rules.id, cur.id));
    await record(null, code, 'delete', by, cur, null);
  }
  syncAllLater();
}

export const catalogueValues = (r: RuleDef) => ({
  code: r.code, form: r.form, title: r.title, law: r.law ?? null, frequency: r.frequency, applies: r.applies, due: r.due, lateFee: r.lateFee ?? null,
  event: r.event ?? null, notes: r.notes ?? null, effectiveFrom: r.effectiveFrom ?? null, effectiveTo: r.effectiveTo ?? null, active: r.active ?? true,
});

// ---- Workspace -------------------------------------------------------------------------------------------
export async function workspaceRules(tenantId: string) {
  const base = await db.select().from(rules).where(isNull(rules.tenantId));
  const own = await db.select().from(rules).where(eq(rules.tenantId, tenantId));
  const list = base.map((b) => { const o = own.find((x) => x.code === b.code); return { ...(o ?? b), builtIn: b, origin: o ? 'CHANGED' : b.source === 'PLATFORM' ? 'INTEGRATA' : 'BUILT_IN' }; });
  for (const o of own.filter((x) => !base.find((b) => b.code === x.code))) list.push({ ...o, builtIn: null as any, origin: 'OWN' });
  return list.sort((a, b) => a.form.localeCompare(b.form) || a.code.localeCompare(b.code));
}

/** The workspace's own version of a built-in rule, or an edit to one of its own rules. */
export async function saveWorkspaceRule(tenantId: string, code: string, input: RuleIn, by: string) {
  const base = await platformRow(code);
  const cur = await workspaceRow(tenantId, code);
  if (!base && !cur) throw notFound('Rule not found');
  const vals = { ...values(input), source: 'WORKSPACE', updatedBy: by, updatedAt: new Date() };
  const [next] = cur
    ? await db.update(rules).set(vals).where(eq(rules.id, cur.id)).returning()
    : await db.insert(rules).values({ ...vals, code, tenantId }).returning();
  await record(tenantId, code, cur ? 'update' : 'create', by, cur ?? base, next);
  await syncTenant(tenantId);
  return next;
}

export async function createWorkspaceRule(tenantId: string, input: RuleIn & { code: string }, by: string) {
  if ((await platformRow(input.code)) || (await workspaceRow(tenantId, input.code))) throw new HttpError(409, 'A rule with this code already exists', { code: 'Already used' });
  const [next] = await db.insert(rules).values({ ...values(input), code: input.code, tenantId, source: 'WORKSPACE', updatedBy: by }).returning();
  await record(tenantId, input.code, 'create', by, null, next);
  await syncTenant(tenantId);
  return next;
}

/** Drop the workspace's version: back to Integrata's rule, or remove the workspace's own rule. */
export async function revertWorkspaceRule(tenantId: string, code: string, by: string) {
  const cur = await workspaceRow(tenantId, code);
  if (!cur) throw notFound('Nothing to undo for this rule');
  await db.delete(rules).where(eq(rules.id, cur.id));
  const base = await platformRow(code);
  await record(tenantId, code, base ? 'revert' : 'delete', by, cur, base ?? null);
  await syncTenant(tenantId);
}

/** History of a rule as a workspace sees it: Integrata's changes and its own. */
export async function ruleHistoryFor(code: string, tenantId: string | null) {
  return db.select().from(ruleHistory)
    .where(and(eq(ruleHistory.code, code), tenantId ? sql`(${ruleHistory.tenantId} is null or ${ruleHistory.tenantId} = ${tenantId})` : isNull(ruleHistory.tenantId)))
    .orderBy(desc(ruleHistory.at)).limit(100);
}
