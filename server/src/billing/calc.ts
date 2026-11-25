/**
 * Pure billing arithmetic: GST state codes, place of supply, invoice totals (CGST + SGST or IGST), invoice numbers,
 * amount in words (Indian system), what is still owed, and ageing. Tested in tests/billing.test.ts.
 */
import { daysBetween, fyOf } from '../compliance/dates.js';

/** GST state / UT codes. */
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland',
  '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};

/** State letters in a CIN (characters 7–8) → GST state code. */
const CIN_STATE: Record<string, string> = {
  JK: '01', HP: '02', PB: '03', CH: '04', UR: '05', UT: '05', UK: '05', HR: '06', DL: '07', RJ: '08', UP: '09', BR: '10', SK: '11',
  AR: '12', NL: '13', MN: '14', MZ: '15', TR: '16', ML: '17', AS: '18', WB: '19', JH: '20', OR: '21', OD: '21', CT: '22', CG: '22',
  MP: '23', GJ: '24', DD: '26', DN: '26', MH: '27', KA: '29', GA: '30', LD: '31', KL: '32', TN: '33', PY: '34', AN: '35', TG: '36',
  TS: '36', AP: '37', LA: '38',
};
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Where the client is, for GST: their GSTIN's state, else the state they gave, else the state in their CIN. */
export function clientStateCode(b: { gstin?: string | null; stateCode?: string | null }, cin?: string | null) {
  if (b.gstin && GSTIN_RE.test(b.gstin)) return b.gstin.slice(0, 2);
  if (b.stateCode && GST_STATES[b.stateCode]) return b.stateCode;
  const st = cin && /^[LU]\d{5}([A-Z]{2})/.exec(cin)?.[1];
  return (st && CIN_STATE[st]) || null;
}
export const stateName = (code?: string | null) => (code ? `${GST_STATES[code] ?? 'Unknown'} (${code})` : '');

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export interface LineIn { amount: number | string; taxable: boolean }
export interface Totals { taxable: number; cgst: number; sgst: number; igst: number; nonTaxable: number; total: number; intraState: boolean }

/**
 * Totals. Inside the firm's state: CGST + SGST at half the rate each; otherwise IGST. Government fees paid for the
 * client (taxable = false) are added without GST. An unknown place of supply is treated as inside the state.
 */
export function invoiceTotals(lines: LineIn[], gstRate: number, firmState?: string | null, clientState?: string | null): Totals {
  const taxable = r2(lines.filter((l) => l.taxable).reduce((s, l) => s + Number(l.amount || 0), 0));
  const nonTaxable = r2(lines.filter((l) => !l.taxable).reduce((s, l) => s + Number(l.amount || 0), 0));
  const intraState = !firmState || !clientState || firmState === clientState;
  const half = r2((taxable * gstRate) / 200);
  const cgst = intraState ? half : 0;
  const sgst = intraState ? half : 0;
  const igst = intraState ? 0 : r2((taxable * gstRate) / 100);
  return { taxable, cgst, sgst, igst, nonTaxable, total: r2(taxable + cgst + sgst + igst + nonTaxable), intraState };
}

/** e.g. INV/26-27/007 — under GST, at most 16 characters, unique in the FY. */
export function invoiceNumber(prefix: string, fy: number, seq: number) {
  const p = (prefix || 'INV').replace(/[^A-Za-z0-9/-]/g, '').slice(0, 5) || 'INV';
  return `${p}/${String(fy % 100).padStart(2, '0')}-${String((fy + 1) % 100).padStart(2, '0')}/${String(seq).padStart(3, '0')}`;
}
export const invoiceFy = (date: string) => fyOf(date);

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const three = (n: number) => [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : '', two(n % 100)].filter(Boolean).join(' ');
function words(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(`${words(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (n) parts.push(three(n));
  return parts.join(' ');
}
/** "Rupees Twelve Thousand Three Hundred Ninety and Fifty Paise Only" */
export function amountInWords(amount: number) {
  const rupees = Math.floor(r2(amount));
  const paise = Math.round(r2(amount - rupees) * 100);
  return `Rupees ${words(rupees)}${paise ? ` and ${two(paise)} Paise` : ''} Only`;
}

/** Still owed on an invoice: total less payments received and TDS deducted by the client. */
export function balanceOf(total: number | string, payments: { amount: number | string; tds: number | string }[]) {
  const settled = payments.reduce((s, p) => s + Number(p.amount) + Number(p.tds), 0);
  return r2(Number(total) - settled);
}

/** Ageing bucket of an unpaid invoice by days past its due date. */
export function ageBucket(dueDate: string, today: string): 'NOT_DUE' | '0_30' | '31_60' | '61_90' | 'OVER_90' {
  const d = daysBetween(dueDate, today);
  if (d <= 0) return 'NOT_DUE';
  if (d <= 30) return '0_30';
  if (d <= 60) return '31_60';
  if (d <= 90) return '61_90';
  return 'OVER_90';
}

/** The fee for a filing: the client's own fee for that kind of filing, else the firm's default, else none. */
export function feeFor(ruleCode: string, clientFees: Map<string, number>, firmFees: Map<string, number>) {
  return clientFees.get(ruleCode) ?? firmFees.get(ruleCode) ?? null;
}
