/**
 * Reading filing status from MCA portal pages (Application History / Track SRN): find SRNs and the status shown on
 * the same row. Pure — tested in server/tests/extension.test.ts. The portal's wording is the contract, so the
 * phrases live here, checked in order (negative phrases before "approved").
 */
/** SRN on MCA V3: 9 letters and digits, starting with a letter (e.g. AB1234567, F12345678). */
export const SRN_IN_TEXT = /\b([A-Z]{1,2}\d{7,8})\b/g;

const RULES = [
  ['REJECTED', /\b(not approved|rejected|rejection|invalid|void|cancell?ed)\b/i],
  ['RESUBMIT', /\b(re-?submi(ssion|t)|rsub|marked for resubmission|defective|sent back)\b/i],
  ['PENDING', /\b(pending|under (processing|process|review|scrutiny|examination)|in process|processing|payment|awaiting|submitted|work in progress)\b/i],
  ['APPROVED', /\b(approved|registered|completed|accepted|taken on record)\b/i],
];

/** The status a row of text shows, with the words that decided it. */
export function classifyStatus(text) {
  for (const [status, re] of RULES) { const m = re.exec(text ?? ''); if (m) return { status, phrase: m[0] }; }
  return null;
}

/** First date in a row (dd/mm/yyyy, dd-mm-yyyy or dd Mon yyyy) as yyyy-mm-dd. */
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export function lastDate(text) {
  const found = [];
  for (const m of String(text ?? '').matchAll(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/g)) found.push([m[3], m[2], m[1]]);
  for (const m of String(text ?? '').matchAll(/\b(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*[ -,]*(\d{4})\b/g)) { const mo = MON[m[2].toLowerCase()]; if (mo) found.push([m[3], mo, m[1]]); }
  if (!found.length) return null;
  const iso = found.map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`).sort();
  return iso[iso.length - 1];
}

/**
 * Rows of text from the page (strings, or { text, whole } where `whole` = the whole page, no rows found) →
 * { SRN: { status, phrase, date, text, sure } } for the SRNs we know. A row with several SRNs is skipped (we can't
 * tell whose status it is). When the same SRN appears in several rows, a row with a status wins. A status read from
 * the whole page is not `sure` (menus and help text can carry status words) — the panel leaves it unticked.
 */
export function readStatuses(rows, knownSrns) {
  const known = new Set(knownSrns.map((s) => s.toUpperCase()));
  const out = {};
  for (const r of rows) {
    const row = typeof r === 'string' ? r : r.text;
    const whole = typeof r === 'object' && !!r.whole;
    const all = [...new Set([...String(row).toUpperCase().matchAll(SRN_IN_TEXT)].map((m) => m[1]))];
    if (all.length !== 1 || !known.has(all[0])) continue;
    const srn = all[0];
    const c = classifyStatus(row);
    if (!c && out[srn]) continue;
    if (out[srn]?.status && !c) continue;
    out[srn] = { status: c?.status ?? null, phrase: c?.phrase ?? null, date: whole ? null : lastDate(row), text: String(row).slice(0, 300), sure: !whole };
  }
  return out;
}
