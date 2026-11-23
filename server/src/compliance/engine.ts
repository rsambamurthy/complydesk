/**
 * The compliance engine: pure functions, no database. Given a client's facts, the anchor dates of a financial
 * year and the rules, it lists what is due and when. sync.ts stores the result; tests in tests/engine.test.ts.
 */
import type { RuleDef, LateFee } from './types.js';
import { addDays, agmLastDate, daysBetween, firstFy, fixed, fyOf, iso } from './dates.js';

export interface EngineClient { companyType: string; smallCompany: boolean; incorporationDate: string | null; flags: Record<string, boolean> }
export interface EnginePerson { id: string; name: string; designation: string; dinAllottedOn: string | null; kycLastFiledFy: number | null; ceasedOn: string | null }
export interface YearFacts { agmDate?: string | null; firstBoardMeetingDate?: string | null }
export interface EngineInput {
  client: EngineClient;
  people: EnginePerson[];
  /** FY whose AGM ends the current auditor's term. */
  auditorTermToFy?: number | null;
  year: YearFacts;
  rules: RuleDef[];
  fy: number;
}
export interface Generated {
  ruleCode: string; form: string; title: string; fy: number;
  key: string; periodLabel: string; personId: string | null;
  dueDate: string; provisional: boolean;
}

export const isDirector = (designation: string) => designation.includes('DIRECTOR');

/** Why a rule does or doesn't apply to this client in this FY (also used to explain it on screen). */
export function applies(rule: RuleDef, input: Omit<EngineInput, 'rules' | 'people' | 'year'>): boolean {
  const { client, fy } = input;
  const a = rule.applies ?? {};
  if (rule.active === false) return false;
  if (a.types?.length && !a.types.includes(client.companyType)) return false;
  if (a.small !== undefined && a.small !== client.smallCompany) return false;
  if (a.flags?.some((f) => !client.flags?.[f])) return false;
  for (const c of a.conditions ?? []) {
    if (c === 'FIRST_FY' && firstFy(client.incorporationDate) !== fy) return false;
    if (c === 'AUDITOR_TERM_ENDS' && input.auditorTermToFy !== fy) return false;
  }
  return true;
}

const inForce = (rule: RuleDef, due: string) => (!rule.effectiveFrom || due >= rule.effectiveFrom) && (!rule.effectiveTo || due <= rule.effectiveTo);

/** Everything the client must do for one financial year. */
export function obligationsFor(input: EngineInput): Generated[] {
  const { client, fy, year } = input;
  const first = firstFy(client.incorporationDate);
  if (first !== null && fy < first) return []; // the company didn't exist yet
  const isFirst = first === fy;
  const agmLast = agmLastDate(fy, isFirst);
  const out: Generated[] = [];
  const push = (r: RuleDef, g: Omit<Generated, 'ruleCode' | 'form' | 'title' | 'fy'>) => {
    // Before incorporation nothing is due; rules not in force on the due date are skipped.
    if (client.incorporationDate && g.dueDate < client.incorporationDate) return;
    if (!inForce(r, g.dueDate)) return;
    out.push({ ruleCode: r.code, form: r.form, title: r.title, fy, ...g });
  };

  for (const r of input.rules) {
    if (!applies(r, input)) continue;
    const base = { key: `${r.code}:${fy}`, periodLabel: '', personId: null };
    const d = r.due;
    switch (d.kind) {
      case 'FIXED': push(r, { ...base, dueDate: fixed(fy, d.date), provisional: false }); break;
      case 'AGM_LAST_DATE': push(r, { ...base, dueDate: agmLast, provisional: false }); break;
      case 'PERIODS':
        d.periods.forEach((p, i) => push(r, { ...base, key: `${r.code}:${fy}:${i + 1}`, periodLabel: p.label, dueDate: fixed(fy, p.date), provisional: false }));
        break;
      case 'AFTER_ANCHOR': {
        if (d.anchor === 'INCORPORATION') {
          if (client.incorporationDate) push(r, { ...base, dueDate: addDays(client.incorporationDate, d.days), provisional: false });
          break;
        }
        const anchor = d.anchor === 'AGM' ? year.agmDate : year.firstBoardMeetingDate;
        if (anchor) { push(r, { ...base, dueDate: addDays(anchor, d.days), provisional: false }); break; }
        if (!d.fallback) break;
        const fb = d.fallback === 'AGM_LAST_DATE' ? addDays(agmLast, d.days) : fixed(fy, d.fallback);
        push(r, { ...base, dueDate: fb, provisional: true });
        break;
      }
      case 'KYC_CYCLE':
        for (const p of input.people) {
          if (!isDirector(p.designation)) continue;
          const due = nextKycFy(p, d.everyYears, fy);
          if (due !== fy) continue;
          const dueDate = iso(fy, d.date.month, d.date.day);
          if (p.ceasedOn && p.ceasedOn < dueDate) continue;
          push(r, { key: `${r.code}:${fy}:${p.id}`, periodLabel: p.name, personId: p.id, dueDate, provisional: false });
        }
        break;
      case 'AFTER_EVENT': break; // recorded by hand or from a meeting, see eventObligation()
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/**
 * The FY (on or after `from`) in which a director's next DIR-3 KYC falls. Counted from the FY of the last
 * filing (+N), else from the FY of DIN allotment (+N+1, the first full cycle after holding the DIN on 31 March).
 * null when neither is known.
 */
export function nextKycFy(p: Pick<EnginePerson, 'dinAllottedOn' | 'kycLastFiledFy'>, every: number, from: number): number | null {
  let next = p.kycLastFiledFy != null ? p.kycLastFiledFy + every : p.dinAllottedOn ? fyOf(p.dinAllottedOn) + every + 1 : null;
  if (next === null) return null;
  while (next < from) next += every;
  return next;
}

/** An obligation started by an event (appointment, allotment, charge…). */
export function eventObligation(rule: RuleDef, eventDate: string, label: string, personId: string | null = null): Generated {
  if (rule.due.kind !== 'AFTER_EVENT') throw new Error(`${rule.code} is not an event rule`);
  const dueDate = addDays(eventDate, rule.due.days);
  return {
    ruleCode: rule.code, form: rule.form, title: rule.title, fy: fyOf(eventDate),
    key: `${rule.code}:${eventDate}:${personId ?? label}`.slice(0, 200), periodLabel: label, personId, dueDate, provisional: false,
  };
}

/** Estimated additional fee for filing late (only when the rule gives a per-day amount). */
export function lateFeeEstimate(fee: LateFee | null | undefined, dueDate: string, onDate: string): number | null {
  if (!fee || fee.kind !== 'PER_DAY') return null;
  const days = daysBetween(dueDate, onDate);
  return days > 0 ? days * fee.amount : 0;
}
