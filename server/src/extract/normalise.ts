/**
 * Pure: turns what the model read into the app's field shapes, and says what a person should check.
 * Field rules come from lib/validators.ts (the same ones the forms and the Excel import use).
 */
import { CIN_RE, DIN_RE, PAN_RE, DESIGNATIONS, clientInput, personInput, shareholderInput, auditorInput } from '../lib/validators.js';
import type { DocType } from './doctypes.js';

type Any = Record<string, any>;
export interface Context { clientCin?: string | null; obligationForm?: string | null }
export interface Read { values: Any; /** field path → what to check */ check: Record<string, string>; warnings: string[] }

/** Small company (s.2(85)) limits since 1 Dec 2025 (G.S.R. 880(E)): paid-up ≤ ₹10 crore and turnover ≤ ₹100 crore. */
export const SMALL_LIMITS = { paidUp: 10_00_00_000, turnover: 100_00_00_000 };

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** YYYY-MM-DD from the common ways dates are written on Indian documents; null if it can't be read safely. */
export function toDate(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const t = v.trim();
  const ok = (y: number, m: number, d: number) => {
    const x = new Date(Date.UTC(y, m - 1, d));
    return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d && y > 1900 && y < 2200 ? x.toISOString().slice(0, 10) : null;
  };
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return ok(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/); // Indian order: day first
  if (m) return ok(+m[3], +m[2], +m[1]);
  m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s\-/]+([A-Za-z]{3,})[\s\-/,]+(\d{4})$/);
  if (m && MONTHS.includes(m[2].slice(0, 3).toLowerCase())) return ok(+m[3], MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, +m[1]);
  return null;
}

/** Whole rupees as a string, or null. */
export function toMoney(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const x = typeof v === 'number' ? v : Number(String(v).replace(/[₹,\s]|rs\.?|inr/gi, ''));
  return Number.isFinite(x) && x >= 0 ? String(Math.round(x)) : null;
}

const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ') : null);
const upper = (v: unknown) => clean(v)?.toUpperCase().replace(/\s/g, '') ?? null;
const fyOf = (v: unknown) => { const x = Number(v); return Number.isInteger(x) && x >= 2000 && x <= 2100 ? x : null; };

export function companyType(cin: string | null) {
  if (!cin) return null;
  return cin.includes('OPC') ? 'OPC' : cin.includes('PTC') ? 'PRIVATE' : null;
}

/** "Additional Director" → DIRECTOR, "Company Secretary" → CS … (the app's designation list). */
export function toDesignation(v: unknown): (typeof DESIGNATIONS)[number] {
  const t = String(v ?? '').toLowerCase();
  if (/managing/.test(t)) return 'MANAGING_DIRECTOR';
  if (/whole[\s-]*time/.test(t)) return 'WHOLE_TIME_DIRECTOR';
  if (/nominee/.test(t)) return 'NOMINEE_DIRECTOR';
  if (/independent/.test(t)) return 'INDEPENDENT_DIRECTOR';
  if (/secretary|\bcs\b/.test(t)) return 'CS';
  if (/financial|\bcfo\b/.test(t)) return 'CFO';
  if (/executive officer|\bceo\b|manager/.test(t)) return 'CEO';
  return 'DIRECTOR';
}

/** Adds each zod issue of `schema` on `value` under `prefix` (only for fields we have a value for or that are required). */
function validate(schema: { safeParse: (v: unknown) => any }, value: Any, prefix: string, check: Record<string, string>) {
  const r = schema.safeParse(value);
  if (!r.success) for (const i of r.error.issues) check[`${prefix}.${i.path.join('.')}`] ??= i.message;
}

function readCompany(c: Any = {}, check: Record<string, string>) {
  const cin = upper(c.cin);
  const out = {
    cin, name: clean(c.name), companyType: companyType(cin), smallCompany: false,
    incorporationDate: toDate(c.incorporationDate), rocOffice: clean(c.rocOffice), registeredOffice: clean(c.registeredOffice),
    email: clean(c.email)?.toLowerCase() ?? null, authorisedCapital: toMoney(c.authorisedCapital), paidUpCapital: toMoney(c.paidUpCapital),
  };
  if (cin && !CIN_RE.test(cin)) check['client.cin'] = 'Doesn’t look like a CIN — check it';
  else if (cin && !out.companyType) check['client.companyType'] = 'Only private companies and OPCs are covered for now';
  if (c.incorporationDate && !out.incorporationDate) check['client.incorporationDate'] = `Couldn’t read the date “${c.incorporationDate}”`;
  if (out.cin && out.companyType) validate(clientInput, out, 'client', check);
  return out;
}

function readPeople(list: unknown, check: Record<string, string>, prefix = 'directors') {
  return (Array.isArray(list) ? list : []).filter((d) => clean(d?.name)).map((d: Any, i) => {
    const p = {
      name: clean(d.name)!, designation: toDesignation(d.designation), din: upper(d.din)?.replace(/^0*(?=\d{8}$)/, '') ?? null,
      pan: upper(d.pan), appointedOn: toDate(d.appointedOn), ceasedOn: toDate(d.ceasedOn),
    };
    if (p.din && !DIN_RE.test(p.din)) check[`${prefix}.${i}.din`] = 'DIN is 8 digits — check it';
    if (p.pan && !PAN_RE.test(p.pan)) check[`${prefix}.${i}.pan`] = 'PAN looks like ABCDE1234F';
    validate(personInput, p, `${prefix}.${i}`, check);
    return p;
  });
}

function cinCheck(cin: string | null, ctx: Context, warnings: string[]) {
  if (cin && ctx.clientCin && cin !== ctx.clientCin) warnings.push(`This document is for CIN ${cin}, not this client (${ctx.clientCin}).`);
}

/** The model names fields as in its schema ("company.cin", "firmName"); the screens use "client.cin", "auditor.firmName". */
function unclearPath(docType: DocType, path: string) {
  const p = path.replace(/^data\./, '').replace(/^company\./, 'client.');
  return docType === 'AUDITOR' && !p.startsWith('auditor.') ? `auditor.${p}` : p;
}

export function normalise(docType: DocType, raw: Any, ctx: Context = {}): Read {
  const check: Record<string, string> = {};
  const warnings: string[] = [];
  if (raw.matchesExpected === false) warnings.push(`This looks like ${raw.documentKind ? `“${raw.documentKind}”` : 'a different document'} — check you picked the right file.`);
  for (const path of Array.isArray(raw.unclear) ? raw.unclear : []) if (typeof path === 'string') check[unclearPath(docType, path)] ??= 'Hard to read — check it';
  const d: Any = raw.data ?? {};

  switch (docType) {
    case 'MCA_MASTER':
    case 'INCORPORATION': {
      const client = readCompany(d.company, check);
      cinCheck(client.cin, ctx, warnings);
      return { values: { client, directors: readPeople(d.directors, check) }, check, warnings };
    }
    case 'SRN_CHALLAN': {
      const srn = upper(d.srn);
      const v = { srn, form: clean(d.form), filedOn: toDate(d.filedOn), cin: upper(d.cin), companyName: clean(d.companyName), amount: toMoney(d.amount), approved: d.approved === true, approvedOn: toDate(d.approvedOn) };
      if (srn && !/^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{9}$/.test(srn)) check.srn = 'An SRN has 9 letters and digits — check it';
      if (!srn) check.srn = 'No SRN found';
      cinCheck(v.cin, ctx, warnings);
      const squash = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (v.form && ctx.obligationForm && !squash(v.form).includes(squash(ctx.obligationForm)) && !squash(ctx.obligationForm).includes(squash(v.form)))
        warnings.push(`This challan is for ${v.form}, not ${ctx.obligationForm}.`);
      return { values: v, check, warnings };
    }
    case 'MGT7': {
      const shareholders = (Array.isArray(d.shareholders) ? d.shareholders : []).filter((x: Any) => clean(x?.name)).map((x: Any, i: number) => {
        const sh = { name: clean(x.name)!, pan: upper(x.pan), folio: clean(x.folio), shareClass: /pref/i.test(String(x.shareClass ?? '')) ? 'PREFERENCE' : 'EQUITY', shares: Number(x.shares) || 0, faceValue: toMoney(x.faceValue) ?? '10' };
        validate(shareholderInput, sh, `shareholders.${i}`, check);
        return sh;
      });
      const auditor = clean(d.auditor?.firmName) ? { firmName: clean(d.auditor.firmName)!, frn: upper(d.auditor.frn) } : null;
      const cin = upper(d.cin);
      cinCheck(cin, ctx, warnings);
      const fy = fyOf(d.fy);
      if (!fy) check.fy = 'Which financial year is this return for?';
      return { values: { cin, fy, agmDate: toDate(d.agmDate), shareholders, directors: readPeople(d.directors, check), auditor, boardMeetingDates: (d.boardMeetingDates ?? []).map(toDate).filter(Boolean) }, check, warnings };
    }
    case 'FINANCIALS': {
      const paidUp = toMoney(d.paidUpCapital); const turnover = toMoney(d.turnover);
      const cin = upper(d.cin);
      cinCheck(cin, ctx, warnings);
      const small = paidUp !== null && turnover !== null ? Number(paidUp) <= SMALL_LIMITS.paidUp && Number(turnover) <= SMALL_LIMITS.turnover : null;
      const smallReason = small === null ? 'Paid-up capital or turnover not found.'
        : `Paid-up ₹${Number(paidUp).toLocaleString('en-IN')} ${Number(paidUp) <= SMALL_LIMITS.paidUp ? '≤' : '>'} ₹10 crore; turnover ₹${Number(turnover).toLocaleString('en-IN')} ${Number(turnover) <= SMALL_LIMITS.turnover ? '≤' : '>'} ₹100 crore.`;
      return {
        values: { cin, fy: fyOf(d.fy), paidUpCapital: paidUp, turnover, borrowings: toMoney(d.borrowings), msmeDuesAmount: toMoney(d.msmeDuesAmount),
          smallCompany: small, smallReason, flags: { msmeDues: d.msmeDuesOver45Days === true, depositsOrLoans: d.loansFromOthers === true } },
        check, warnings,
      };
    }
    case 'AUDITOR': {
      const auditor = { firmName: clean(d.firmName), frn: upper(d.frn), appointedOn: toDate(d.appointedOn), termFromFy: fyOf(d.termFromFy), termToFy: fyOf(d.termToFy), current: true };
      if (auditor.termFromFy && !auditor.termToFy) auditor.termToFy = auditor.termFromFy + 4, check['auditor.termToFy'] = 'Assumed a 5-year term — check it';
      validate(auditorInput, auditor, 'auditor', check);
      cinCheck(upper(d.cin), ctx, warnings);
      return { values: { auditor }, check, warnings };
    }
  }
}

/** How alike two names are (0–1), ignoring titles, case and punctuation — matches DSC holders to directors. */
export function nameMatch(a: string, b: string) {
  const words = (x: string) => new Set(x.toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !['MR', 'MRS', 'MS', 'DR', 'SHRI', 'SMT'].includes(w)));
  const A = words(a); const B = words(b);
  if (!A.size || !B.size) return 0;
  let both = 0; for (const w of A) if (B.has(w)) both++;
  return both / Math.max(A.size, B.size);
}
