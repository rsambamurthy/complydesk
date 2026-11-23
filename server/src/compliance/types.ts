/**
 * Shapes of a compliance rule. Rules are data (table `rules`, built-ins in catalogue.ts), so a change in the
 * law is a rule edit, not a code change. The engine (engine.ts) turns rules + a client's facts into obligations.
 */

/** Dates are counted from the financial year's start year: FY 2025 = 1 Apr 2025 – 31 Mar 2026. */
export interface FixedDate { month: number; day: number; /** Calendar year = fy + yearOffset. */ yearOffset: number }

/** Dates other deadlines hang off. AGM = AGM held for the FY (else its last permitted date); FIRST_BM = first board meeting of the FY. */
export type Anchor = 'AGM' | 'FIRST_BM' | 'INCORPORATION';

export type DueRule =
  /** A fixed calendar date, e.g. DPT-3 on 30 June after the FY. */
  | { kind: 'FIXED'; date: FixedDate }
  /** N days after an anchor; when the anchor isn't known yet, `fallback` gives a provisional date. */
  | { kind: 'AFTER_ANCHOR'; anchor: Anchor; days: number; fallback?: FixedDate | 'AGM_LAST_DATE' }
  /** Several dates in the FY (half-years, quarters): one obligation each. */
  | { kind: 'PERIODS'; periods: { label: string; date: FixedDate }[] }
  /** N days after an event the user records (appointment, allotment, charge…). */
  | { kind: 'AFTER_EVENT'; days: number }
  /** Per director: once every N financial years by a fixed date, counted from the last filing or DIN allotment. */
  | { kind: 'KYC_CYCLE'; everyYears: number; date: Omit<FixedDate, 'yearOffset'> }
  /** The AGM itself: by the last permitted date (6 months after FY end; 9 months for the first FY). */
  | { kind: 'AGM_LAST_DATE' };

/** Which clients a rule applies to. Every condition given must hold. */
export interface Applies {
  types?: string[];
  /** true = small companies only, false = not small companies. */
  small?: boolean;
  /** Client flags that must be on (e.g. msmeDues). */
  flags?: string[];
  /** Facts the engine works out: AUDITOR_TERM_ENDS (current auditor's term ends at this FY's AGM), FIRST_FY (FY of incorporation). */
  conditions?: ('AUDITOR_TERM_ENDS' | 'FIRST_FY')[];
}

export type LateFee =
  | { kind: 'PER_DAY'; amount: number; note?: string }
  | { kind: 'NOTE'; note: string };

export interface RuleDef {
  code: string;
  form: string;
  title: string;
  law?: string | null;
  frequency: 'ANNUAL' | 'HALF_YEARLY' | 'QUARTERLY' | 'PER_DIRECTOR' | 'EVENT' | 'ONE_TIME';
  applies: Applies;
  due: DueRule;
  lateFee?: LateFee | null;
  event?: string | null;
  notes?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  active?: boolean;
}
