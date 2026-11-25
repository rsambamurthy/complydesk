/** Help: the manual's sections, search, and the assistant (with a per-user daily limit and a log of questions). */
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db, schema, HttpError, notFound } from '../lib/core.js';
import type { StaffCtx } from '../auth/session.js';
import { manual, searchManual, sectionForPage, suggestionsFor } from '../help/manual.js';
import { askManual, assistantMode, type Turn } from '../help/assistant.js';

const q = schema.helpQuestions;
export const helpDailyLimit = () => Number(process.env.HELP_DAILY_LIMIT) || 60;

export function helpIndex(page?: string | null) {
  const m = manual();
  return {
    title: m.title,
    mode: assistantMode(),
    sections: m.sections.map(({ id, title, level, parent }) => ({ id, title, level, parent })),
    pageSection: sectionForPage(m, page)?.id ?? null,
    suggestions: suggestionsFor(page),
  };
}

export function helpSection(id: string) {
  const m = manual();
  const s = m.sections.find((x) => x.id === id);
  if (!s) throw notFound('No such help section');
  const children = m.sections.filter((x) => x.parent === s.id);
  return { ...s, children };
}

export const helpSearch = (query: string) => searchManual(manual(), query, 8);

export async function askHelp(staff: StaffCtx, input: { question: string; page?: string | null; history?: Turn[] }) {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(q).where(and(eq(q.userId, staff.user.id), gte(q.createdAt, today)));
  if (n >= helpDailyLimit()) throw new HttpError(429, `You've asked ${n} questions today — the daily limit. The Help pages and search still work.`);
  let out;
  try {
    out = await askManual({ question: input.question, page: input.page, history: input.history, roles: staff.roles.map((r) => r.name) });
  } catch (e) {
    console.error('help assistant failed', e);
    throw new HttpError(502, 'The assistant couldn’t answer just now. Try again, or search the Help pages.');
  }
  const [row] = await db.insert(q).values({
    tenantId: staff.tenant.id, userId: staff.user.id, page: input.page ?? null, question: input.question,
    answer: out.answer, sections: out.sections, covered: out.covered, model: out.model, inputTokens: out.inputTokens, outputTokens: out.outputTokens,
  }).returning({ id: q.id });
  const m = manual();
  return { id: row.id, answer: out.answer, covered: out.covered, mode: out.model === 'search' ? 'search' : 'ai',
    sections: out.sections.map((id) => ({ id, title: m.sections.find((s) => s.id === id)!.title })) };
}

export async function rateAnswer(staff: StaffCtx, id: string, helpful: boolean) {
  const r = await db.update(q).set({ helpful }).where(and(eq(q.id, id), eq(q.userId, staff.user.id))).returning({ id: q.id });
  if (!r.length) throw notFound('Question not found');
}

/** For Integrata: recent questions across firms — what the manual misses. */
export async function recentQuestions(opts: { onlyGaps?: boolean; limit?: number } = {}) {
  const where = opts.onlyGaps ? sql`${q.covered} = false or ${q.helpful} = false` : undefined;
  return db.select({ id: q.id, createdAt: q.createdAt, page: q.page, question: q.question, answer: q.answer, covered: q.covered, helpful: q.helpful, tenant: schema.tenants.name })
    .from(q).leftJoin(schema.tenants, eq(schema.tenants.id, q.tenantId)).where(where).orderBy(desc(q.createdAt)).limit(opts.limit ?? 100);
}
