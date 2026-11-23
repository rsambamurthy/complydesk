/** Date helpers on plain 'YYYY-MM-DD' strings (no time zones: statutory dates are calendar dates). */
import type { FixedDate } from './types.js';

export const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const toUtc = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromUtc = (t: number) => { const d = new Date(t); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); };

export const addDays = (s: string, n: number) => fromUtc(toUtc(s) + n * 86_400_000);
export const daysBetween = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
export const todayIso = () => new Date().toISOString().slice(0, 10);

/** Financial year (start year) a date falls in: 2026-02-10 → 2025 (FY 2025-26). */
export const fyOf = (s: string) => { const [y, m] = s.split('-').map(Number); return m >= 4 ? y : y - 1; };
export const fyLabel = (fy: number) => `FY ${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
export const fyStart = (fy: number) => iso(fy, 4, 1);
export const fyEnd = (fy: number) => iso(fy + 1, 3, 31);

export const fixed = (fy: number, f: FixedDate) => iso(fy + f.yearOffset, f.month, f.day);

/**
 * The company's first financial year (s.2(41)): the FY of incorporation, except that a company incorporated
 * on or after 1 January may close its first FY on 31 March of the following year.
 */
export function firstFy(incorporationDate: string | null | undefined) {
  if (!incorporationDate) return null;
  const [, m] = incorporationDate.split('-').map(Number);
  const f = fyOf(incorporationDate);
  return m >= 1 && m <= 3 ? f + 1 : f;
}

/** Last date for the AGM of an FY (s.96): 6 months after FY end (30 Sep); 9 months (31 Dec) for the first FY. */
export const agmLastDate = (fy: number, isFirstFy: boolean) => (isFirstFy ? iso(fy + 1, 12, 31) : iso(fy + 1, 9, 30));
