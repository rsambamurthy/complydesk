/**
 * Built-in compliance rules for private companies and OPCs (Companies Act, 2013). Seeded into `rules` with
 * tenant_id null; a workspace can override any rule (same code) from Administration → Compliance rules.
 *
 * Every date here must be checked by a practising Company Secretary before release; the law changes often,
 * which is why these are data and not code.
 */
import type { RuleDef } from './types.js';

const PER_DAY_100 = { kind: 'PER_DAY', amount: 100, note: 'Additional fee ₹100 per day of delay (Companies (Registration Offices and Fees) Rules).' } as const;
const MULTIPLE = { kind: 'NOTE', note: 'Additional fee 2×–12× the normal fee depending on the delay.' } as const;

export const CATALOGUE: RuleDef[] = [
  // ---- Meetings -------------------------------------------------------------------------------------------
  {
    code: 'BM_QUARTERLY', form: 'Board meeting', title: 'Board meeting for the quarter', law: 'Sec 173(1)', frequency: 'QUARTERLY',
    applies: { types: ['PRIVATE'], small: false },
    due: { kind: 'PERIODS', periods: [
      { label: 'Q1 (Apr–Jun)', date: { month: 6, day: 30, yearOffset: 0 } },
      { label: 'Q2 (Jul–Sep)', date: { month: 9, day: 30, yearOffset: 0 } },
      { label: 'Q3 (Oct–Dec)', date: { month: 12, day: 31, yearOffset: 0 } },
      { label: 'Q4 (Jan–Mar)', date: { month: 3, day: 31, yearOffset: 1 } },
    ] },
    notes: 'At least 4 meetings a year, not more than 120 days between two meetings.',
  },
  {
    code: 'BM_HALF_YEARLY', form: 'Board meeting', title: 'Board meeting for the half-year', law: 'Sec 173(5)', frequency: 'HALF_YEARLY',
    applies: { types: ['PRIVATE', 'OPC'], small: true },
    due: { kind: 'PERIODS', periods: [
      { label: 'H1 (Apr–Sep)', date: { month: 9, day: 30, yearOffset: 0 } },
      { label: 'H2 (Oct–Mar)', date: { month: 3, day: 31, yearOffset: 1 } },
    ] },
    notes: 'Small companies and OPCs: one meeting in each half of the year, at least 90 days apart. An OPC with a single director is exempt.',
  },
  {
    code: 'BM_FIRST', form: 'Board meeting', title: 'First board meeting', law: 'Sec 173(1)', frequency: 'ONE_TIME',
    applies: { conditions: ['FIRST_FY'] },
    due: { kind: 'AFTER_ANCHOR', anchor: 'INCORPORATION', days: 30 },
  },
  {
    code: 'AGM', form: 'AGM', title: 'Annual general meeting', law: 'Sec 96', frequency: 'ANNUAL',
    applies: { types: ['PRIVATE'] },
    due: { kind: 'AGM_LAST_DATE' },
    notes: 'Within 6 months of the FY end (first AGM: within 9 months of the end of the first FY). Not required for OPCs.',
  },
  {
    code: 'MBP1_DIR8', form: 'MBP-1 / DIR-8', title: 'Directors’ disclosures of interest and non-disqualification', law: 'Sec 184(1), 164(2)', frequency: 'ANNUAL',
    applies: {},
    due: { kind: 'AFTER_ANCHOR', anchor: 'FIRST_BM', days: 0, fallback: { month: 6, day: 30, yearOffset: 0 } },
    notes: 'Taken on record at the first board meeting of the FY.',
  },
  // ---- Annual filings -------------------------------------------------------------------------------------
  {
    code: 'AOC4', form: 'AOC-4', title: 'Financial statements', law: 'Sec 137', frequency: 'ANNUAL',
    applies: { types: ['PRIVATE'], notFlags: ['xbrl'] },
    due: { kind: 'AFTER_ANCHOR', anchor: 'AGM', days: 30, fallback: 'AGM_LAST_DATE' },
    lateFee: PER_DAY_100,
  },
  {
    code: 'AOC4_XBRL', form: 'AOC-4 XBRL', title: 'Financial statements in XBRL', law: 'Sec 137; XBRL Rules 2015', frequency: 'ANNUAL',
    applies: { types: ['PRIVATE'], flags: ['xbrl'] },
    due: { kind: 'AFTER_ANCHOR', anchor: 'AGM', days: 30, fallback: 'AGM_LAST_DATE' },
    lateFee: PER_DAY_100,
    notes: 'Listed companies and their Indian subsidiaries; paid-up capital ≥ ₹5 crore; turnover ≥ ₹100 crore; Ind AS companies; and any company that filed in XBRL before. The XBRL instance document is made with an XBRL tool and checked with MCA’s validation tool.',
  },
  {
    code: 'AOC4_OPC', form: 'AOC-4', title: 'Financial statements (OPC)', law: 'Sec 137 proviso', frequency: 'ANNUAL',
    applies: { types: ['OPC'] },
    due: { kind: 'FIXED', date: { month: 9, day: 27, yearOffset: 1 } },
    lateFee: PER_DAY_100,
    notes: 'Within 180 days of the FY end.',
  },
  {
    code: 'MGT7', form: 'MGT-7', title: 'Annual return', law: 'Sec 92(4)', frequency: 'ANNUAL',
    applies: { types: ['PRIVATE'], small: false },
    due: { kind: 'AFTER_ANCHOR', anchor: 'AGM', days: 60, fallback: 'AGM_LAST_DATE' },
    lateFee: PER_DAY_100,
  },
  {
    code: 'MGT7A', form: 'MGT-7A', title: 'Annual return (small company)', law: 'Sec 92(4)', frequency: 'ANNUAL',
    applies: { types: ['PRIVATE'], small: true },
    due: { kind: 'AFTER_ANCHOR', anchor: 'AGM', days: 60, fallback: 'AGM_LAST_DATE' },
    lateFee: PER_DAY_100,
  },
  {
    code: 'MGT7A_OPC', form: 'MGT-7A', title: 'Annual return (OPC)', law: 'Sec 92(4)', frequency: 'ANNUAL',
    applies: { types: ['OPC'] },
    due: { kind: 'FIXED', date: { month: 11, day: 29, yearOffset: 1 } },
    lateFee: PER_DAY_100,
    notes: '60 days from the date the AGM would have been due (30 September).',
  },
  {
    code: 'ADT1', form: 'ADT-1', title: 'Appointment of auditor', law: 'Sec 139', frequency: 'ANNUAL',
    applies: { types: ['PRIVATE'], conditions: ['AUDITOR_TERM_ENDS'] },
    due: { kind: 'AFTER_ANCHOR', anchor: 'AGM', days: 15, fallback: 'AGM_LAST_DATE' },
    lateFee: MULTIPLE,
    notes: 'When the auditor is appointed or re-appointed at the AGM (the current term ends with this FY).',
  },
  {
    code: 'DPT3', form: 'DPT-3', title: 'Return of deposits / outstanding loans', law: 'Rule 16, Acceptance of Deposits Rules', frequency: 'ANNUAL',
    applies: { flags: ['depositsOrLoans'] },
    due: { kind: 'FIXED', date: { month: 6, day: 30, yearOffset: 1 } },
    lateFee: MULTIPLE,
  },
  {
    code: 'MSME1', form: 'MSME-1', title: 'Dues to micro and small enterprises', law: 'Sec 405, MSME order', frequency: 'HALF_YEARLY',
    applies: { flags: ['msmeDues'] },
    due: { kind: 'PERIODS', periods: [
      { label: 'H1 (Apr–Sep)', date: { month: 10, day: 31, yearOffset: 0 } },
      { label: 'H2 (Oct–Mar)', date: { month: 4, day: 30, yearOffset: 1 } },
    ] },
    lateFee: MULTIPLE,
    notes: 'Only when payments to MSME suppliers are outstanding for more than 45 days.',
  },
  {
    code: 'INC20A', form: 'INC-20A', title: 'Declaration for commencement of business', law: 'Sec 10A', frequency: 'ONE_TIME',
    applies: { conditions: ['FIRST_FY'] },
    due: { kind: 'AFTER_ANCHOR', anchor: 'INCORPORATION', days: 180 },
    lateFee: { kind: 'NOTE', note: 'Penalty on the company and officers in default (Sec 10A(2)).' },
  },
  // ---- Directors ------------------------------------------------------------------------------------------
  {
    code: 'DIR3KYC', form: 'DIR-3 KYC', title: 'Director KYC (every 3 years)', law: 'Rule 12A, Appointment & Qualification of Directors Rules', frequency: 'PER_DIRECTOR',
    applies: {},
    due: { kind: 'KYC_CYCLE', everyYears: 3, date: { month: 6, day: 30 } },
    lateFee: { kind: 'NOTE', note: 'DIN is deactivated until filed with a ₹5,000 fee.' },
    effectiveFrom: '2026-03-31',
    notes: 'G.S.R. 943(E), 31 Dec 2025: once every three financial years, by 30 June. Counted from the FY of the last filing, or the FY of DIN allotment.',
  },
  // ---- Event-based (added from a meeting or an event) -----------------------------------------------------
  { code: 'DIR12', form: 'DIR-12', title: 'Change in directors / KMP', law: 'Sec 170(2)', frequency: 'EVENT', event: 'Appointment, resignation or change in designation', applies: {}, due: { kind: 'AFTER_EVENT', days: 30 }, lateFee: MULTIPLE },
  { code: 'PAS3', form: 'PAS-3', title: 'Return of allotment', law: 'Sec 39(4), 42', frequency: 'EVENT', event: 'Allotment of shares', applies: {}, due: { kind: 'AFTER_EVENT', days: 30 }, lateFee: MULTIPLE, notes: 'Private placement: within 15 days — change the days on the obligation if so.' },
  { code: 'MGT14', form: 'MGT-14', title: 'Filing of resolutions', law: 'Sec 117', frequency: 'EVENT', event: 'Special resolution / resolution needing filing', applies: {}, due: { kind: 'AFTER_EVENT', days: 30 }, lateFee: MULTIPLE },
  { code: 'SH7', form: 'SH-7', title: 'Alteration of share capital', law: 'Sec 64', frequency: 'EVENT', event: 'Increase / alteration of authorised capital', applies: {}, due: { kind: 'AFTER_EVENT', days: 30 }, lateFee: MULTIPLE },
  { code: 'CHG1', form: 'CHG-1', title: 'Creation / modification of charge', law: 'Sec 77', frequency: 'EVENT', event: 'Charge created or modified', applies: {}, due: { kind: 'AFTER_EVENT', days: 30 }, lateFee: { kind: 'NOTE', note: 'Up to 60 days with additional fee; beyond that, ad valorem fee.' } },
  { code: 'CHG4', form: 'CHG-4', title: 'Satisfaction of charge', law: 'Sec 82', frequency: 'EVENT', event: 'Charge satisfied', applies: {}, due: { kind: 'AFTER_EVENT', days: 30 }, lateFee: MULTIPLE },
  { code: 'INC22', form: 'INC-22', title: 'Change of registered office', law: 'Sec 12(4)', frequency: 'EVENT', event: 'Registered office shifted', applies: {}, due: { kind: 'AFTER_EVENT', days: 30 }, lateFee: MULTIPLE },
  { code: 'DIR3KYC_CHANGE', form: 'DIR-3 KYC', title: 'Director KYC — change in contact details', law: 'Rule 12A', frequency: 'EVENT', event: 'Director’s mobile, email or address changed', applies: {}, due: { kind: 'AFTER_EVENT', days: 30 }, effectiveFrom: '2026-03-31' },
];
