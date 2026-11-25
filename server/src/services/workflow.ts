/**
 * Filing workflow (maker-checker). One table of moves decides what can happen at each stage and who may do it;
 * screens show only the moves this returns. Meetings (board meeting, AGM) don't use it — they are "held".
 *
 *   TODO → DATA (collecting) → DRAFTED → REVIEW (partner) → CLIENT (client approval) → READY → FILED (SRN) → APPROVED
 *                                 ↑______ returned ________|_____________|                     ↓
 *                                 └──────────────────────────────────── RESUBMIT ←─────────────┘
 * REVIEW and CLIENT are skipped when the firm switches them off (Administration → Settings).
 */
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, HttpError } from '../lib/core.js';
import { issuesToFix } from './review.js';
import { settingsOf } from '../lib/settings.js';
import { isMeeting, STAGES, STAGE_STATUS, statusToStage, type Stage } from './stages.js';
import type { Obligation } from '../db/schema.js';
import type { StaffCtx } from '../auth/session.js';

const { obligations: o, obligationEvents: ev, tenants } = schema;

export { STAGES, STAGE_STATUS, statusToStage, type Stage };

type Who = 'work' | 'review' | 'client';
interface Move { action: string; label: string; from: Stage[]; who: Who; note?: 'required' | 'optional'; needsFiling?: boolean; danger?: boolean }

/** Every move. `to` is worked out in nextStage() because REVIEW / CLIENT may be switched off. */
export const MOVES: Move[] = [
  { action: 'start', label: 'Start collecting data', from: ['TODO'], who: 'work' },
  { action: 'drafted', label: 'Form drafted', from: ['TODO', 'DATA', 'RESUBMIT'], who: 'work' },
  { action: 'submit', label: 'Send for review', from: ['DRAFTED'], who: 'work', note: 'optional' },
  { action: 'review_ok', label: 'Approve (reviewed)', from: ['REVIEW'], who: 'review', note: 'optional' },
  { action: 'return', label: 'Return for changes', from: ['REVIEW', 'CLIENT', 'READY'], who: 'review', note: 'required', danger: true },
  { action: 'client_ok', label: 'Approve for filing', from: ['CLIENT'], who: 'client', note: 'optional' },
  { action: 'client_return', label: 'Send back with comments', from: ['CLIENT'], who: 'client', note: 'required', danger: true },
  { action: 'filed', label: 'Uploaded on MCA (enter SRN)', from: ['READY'], who: 'work', needsFiling: true },
  { action: 'approved', label: 'Approved by MCA', from: ['FILED'], who: 'work' },
  { action: 'resubmit', label: 'MCA asked for resubmission', from: ['FILED'], who: 'work', note: 'required', danger: true },
  { action: 'not_applicable', label: 'Not applicable', from: ['TODO', 'DATA', 'DRAFTED', 'RESUBMIT'], who: 'work', note: 'required', danger: true },
  { action: 'reopen', label: 'Reopen', from: ['NA'], who: 'work' },
];

function nextStage(action: string, from: Stage, s: ReturnType<typeof settingsOf>): Stage {
  const afterReview: Stage = s.requireClientApproval ? 'CLIENT' : 'READY';
  switch (action) {
    case 'start': return 'DATA';
    case 'drafted': return 'DRAFTED';
    case 'submit': return s.requireReview ? 'REVIEW' : afterReview;
    case 'review_ok': return afterReview;
    case 'return': case 'client_return': return 'DRAFTED';
    case 'client_ok': return 'READY';
    case 'filed': return 'FILED';
    case 'approved': return 'APPROVED';
    case 'resubmit': return 'RESUBMIT';
    case 'not_applicable': return 'NA';
    case 'reopen': return 'TODO';
    default: throw new HttpError(400, 'Unknown step');
  }
}

/**
 * May this person make this move on this filing? Reviewers can't approve what they prepared (maker-checker);
 * client users act only on the CLIENT stage of their own companies; firm staff may record a client's approval
 * on its behalf (with a note, e.g. "approved by email").
 */
function allowed(m: Move, ob: Obligation, staff: StaffCtx): string | null {
  const p = staff.permissions;
  const clientUser = staff.user.clientIds.length > 0;
  if (m.who === 'client') {
    if (clientUser) return p.has('compliance.client_approve') && staff.user.clientIds.includes(ob.clientId) ? null : 'Only the client’s approver can do this';
    return p.has('compliance.work') ? null : 'You can’t do this';
  }
  if (clientUser) return 'Client users can only approve or send back';
  if (m.who === 'review') {
    if (!p.has('compliance.approve')) return 'Only a reviewer (Partner / Firm Admin) can do this';
    if (m.action === 'review_ok' && ob.preparedById === staff.user.id) return 'You prepared this filing — another reviewer must approve it';
    return null;
  }
  return p.has('compliance.work') ? null : 'You can’t do this';
}

export async function settingsFor(tenantId: string) {
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  return settingsOf(t);
}

/** The moves this person can make now (for the screen), with the reason when one is blocked. */
/** Approval and filing wait until the pre-filing check has nothing to fix (firm setting, on by default). */
const GATED = ['review_ok', 'filed'];
async function checkGate(ob: Obligation, staff: StaffCtx): Promise<{ why: string; n: number } | null> {
  if (!settingsOf(staff.tenant).blockOnCheckErrors) return null;
  // A partner's "approve anyway" holds until the filing is sent back.
  const evs = await db.select({ action: ev.action }).from(ev).where(eq(ev.obligationId, ob.id)).orderBy(asc(ev.at));
  const lastOverride = evs.map((e) => e.action).lastIndexOf('override');
  const lastBack = Math.max(...['return', 'client_return', 'resubmit', 'reopen'].map((a) => evs.map((e) => e.action).lastIndexOf(a)));
  if (lastOverride >= 0 && lastOverride > lastBack) return null;
  const n = await issuesToFix(staff.tenant.id, ob.id);
  return n ? { n, why: `Fix the ${n === 1 ? 'issue' : `${n} issues`} in the pre-filing check first` } : null;
}
/** Partners / firm admins may approve over the check, with a reason. */
const canOverride = (staff: StaffCtx) => staff.permissions.has('compliance.approve') && !staff.user.clientIds.length;

export async function movesFor(ob: Obligation, staff: StaffCtx) {
  if (isMeeting(ob.form)) return [];
  const s = settingsOf(staff.tenant);
  const gate = MOVES.some((m) => GATED.includes(m.action) && m.from.includes(ob.stage as Stage)) ? await checkGate(ob, staff) : null;
  return MOVES.filter((m) => m.from.includes(ob.stage as Stage))
    .filter((m) => !(m.action === 'return' && ob.stage === 'READY' && !s.requireReview))
    .map((m) => ({ action: m.action, label: m.action === 'client_ok' && !staff.user.clientIds.length ? 'Record client’s approval' : m.label, note: m.note ?? null, needsFiling: !!m.needsFiling, danger: !!m.danger, blocked: allowed(m, ob, staff) ?? (GATED.includes(m.action) && gate && !canOverride(staff) ? gate.why : null),
      override: !allowed(m, ob, staff) && GATED.includes(m.action) && gate && canOverride(staff) ? gate.n : null }))
    .filter((m) => !(staff.user.clientIds.length && m.blocked));
}

export const moveInput = z.object({
  action: z.string(), note: z.string().trim().max(2000).nullish().transform((v) => v || null),
  srn: z.string().trim().toUpperCase().nullish().transform((v) => v || null),
  filedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  /** A partner approving over the pre-filing check (needs a note). */
  override: z.boolean().optional(),
});

export async function move(ob: Obligation, staff: StaffCtx, input: z.output<typeof moveInput>) {
  if (isMeeting(ob.form)) throw new HttpError(400, 'Meetings are marked held from the meeting itself');
  const m = MOVES.find((x) => x.action === input.action);
  if (!m) throw new HttpError(400, 'Unknown step');
  if (!m.from.includes(ob.stage as Stage)) throw new HttpError(409, 'This filing has moved on — refresh to see where it is now');
  const why = allowed(m, ob, staff);
  if (why) throw new HttpError(403, why);
  const gate = GATED.includes(m.action) ? await checkGate(ob, staff) : null;
  if (gate) {
    if (!canOverride(staff)) throw new HttpError(403, gate.why);
    if (!input.override || !input.note) throw new HttpError(400, `There ${gate.n === 1 ? 'is 1 issue' : `are ${gate.n} issues`} to fix — say why you are approving anyway`, { note: 'Required' });
  }
  if (m.note === 'required' && !input.note) throw new HttpError(400, 'Add a note saying why', { note: 'Required' });
  if (m.action === 'client_ok' && !staff.user.clientIds.length && !input.note) throw new HttpError(400, 'Note how the client approved (e.g. “by email on 24 Nov”)', { note: 'Required' });
  if (m.needsFiling) {
    if (!input.srn || !/^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{9}$/.test(input.srn)) throw new HttpError(400, 'Enter the SRN', { srn: 'An SRN has 9 letters and digits, e.g. AB1234567' });
    if (!input.filedOn) throw new HttpError(400, 'Enter the date filed', { filedOn: 'Required' });
  }
  const s = settingsOf(staff.tenant);
  const to = nextStage(m.action, ob.stage as Stage, s);
  const set: Partial<Obligation> = { stage: to, status: STAGE_STATUS[to], updatedAt: new Date() };
  if (m.action === 'drafted') set.preparedById = staff.user.id;
  if (m.action === 'submit' && !ob.preparedById) set.preparedById = staff.user.id;
  if (m.action === 'review_ok') Object.assign(set, { reviewedById: staff.user.id, reviewedAt: new Date() });
  if (m.action === 'client_ok') Object.assign(set, { clientApprovedById: staff.user.id, clientApprovedAt: new Date() });
  if (m.action === 'filed') Object.assign(set, { srn: input.srn, filedOn: input.filedOn });
  if (m.action === 'reopen' || m.action === 'resubmit') Object.assign(set, m.action === 'reopen' ? { filedOn: null } : {});
  if (m.action === 'return' || m.action === 'client_return') Object.assign(set, { reviewedById: null, reviewedAt: null, clientApprovedById: null, clientApprovedAt: null });
  // Guard against two people moving the same filing at once.
  const [next] = await db.update(o).set(set).where(and(eq(o.id, ob.id), eq(o.stage, ob.stage))).returning();
  if (!next) throw new HttpError(409, 'Someone else just moved this filing — refresh');
  if (gate) await db.insert(ev).values({ obligationId: ob.id, action: 'override', fromStage: ob.stage, toStage: ob.stage, note: `Approved despite ${gate.n} issue${gate.n === 1 ? '' : 's'} to fix: ${input.note}`, userId: staff.user.id, userName: staff.user.name });
  await db.insert(ev).values({ obligationId: ob.id, action: m.action, fromStage: ob.stage, toStage: to, note: input.note ?? (m.action === 'filed' ? `SRN ${input.srn}` : null), userId: staff.user.id, userName: staff.user.name });
  return next;
}

export async function recordEvent(obligationId: string, action: string, staff: StaffCtx | undefined, note: string | null, fromStage?: string, toStage?: string) {
  await db.insert(ev).values({ obligationId, action, note, fromStage, toStage, userId: staff?.user.id ?? null, userName: staff?.user.name ?? 'ComplyDesk' });
}

export async function history(obligationId: string) {
  return db.select().from(ev).where(eq(ev.obligationId, obligationId)).orderBy(asc(ev.at));
}
