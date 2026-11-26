/**
 * The documents ComplyDesk can read, as data: what to ask the model for (a JSON schema the model must fill in)
 * and how to turn its answer into the app's own field shapes. Adding a document = adding an entry here.
 */
import { BALANCE_SHEET, PROFIT_LOSS } from '../financials/statements.js';

export type DocType = 'MCA_MASTER' | 'INCORPORATION' | 'SRN_CHALLAN' | 'MGT7' | 'FINANCIALS' | 'FIN_STATEMENTS' | 'AUDITOR' | 'BOARD_PAPERS' | 'DRAFT_FORM';

type Schema = Record<string, unknown>;
const s = (description: string): Schema => ({ type: ['string', 'null'], description });
const n = (description: string): Schema => ({ type: ['number', 'null'], description });
const b = (description: string): Schema => ({ type: ['boolean', 'null'], description });
const obj = (properties: Record<string, Schema>): Schema => ({ type: 'object', properties, required: Object.keys(properties) });
const arr = (items: Schema, description: string): Schema => ({ type: 'array', items, description });

const DATE = 'as YYYY-MM-DD';
const MONEY = 'in rupees as a plain number (convert lakhs / crores / "₹ in thousands" headings to rupees)';

const company = obj({
  cin: s('Corporate Identification Number, 21 characters, e.g. U72900TN2015PTC123456'),
  name: s('Company name exactly as shown'),
  incorporationDate: s(`Date of incorporation ${DATE}`),
  rocOffice: s('Registrar of Companies office, e.g. "RoC Chennai"'),
  registeredOffice: s('Registered office address on one line'),
  email: s('Company email address'),
  authorisedCapital: n(`Authorised capital ${MONEY}`),
  paidUpCapital: n(`Paid-up capital ${MONEY}`),
});
const director = obj({
  name: s('Full name'),
  din: s('DIN / DPIN, 8 digits'),
  designation: s('Designation as written, e.g. Director, Managing Director, Additional Director, Company Secretary, CFO'),
  appointedOn: s(`Date of appointment ${DATE}`),
  ceasedOn: s(`Date of cessation ${DATE}, null if still in office`),
});

/** Each Schedule III line as { cy, py } in rupees — the line list is the one the checks use (financials/statements.ts). */
const yearPair = (label: string): Schema => obj({ cy: n(`${label}, current year, ${MONEY}`), py: n(`${label}, previous year, ${MONEY}`) });
const lines = (groups: typeof BALANCE_SHEET) => obj(Object.fromEntries(groups.flatMap((g) => g.lines).map((l) => [l.key, yearPair(l.label)])));

export interface DocDef {
  label: string;
  /** What the person uploads — shown in the picker. */
  hint: string;
  /** Who may read it: client master or filing work. */
  perm: 'clients.manage' | 'compliance.work';
  /** What the model fills in. */
  schema: Schema;
  /** Extra guidance for this document. */
  guide: string;
  /** Not offered in the document picker (used by another feature, e.g. the reviewer check). */
  hidden?: boolean;
}

export const DOC_TYPES: Record<DocType, DocDef> = {
  DRAFT_FORM: {
    label: 'Draft MCA form (for the reviewer check)',
    hint: 'The filled-in form before it is uploaded to MCA.',
    perm: 'compliance.work', hidden: true,
    guide: 'This is a draft of an MCA e-form (e.g. MGT-7, MGT-7A, AOC-4, DIR-12, PAS-3, ADT-1, DPT-3) before filing. Read the values as entered in the form — do not correct them. For lists of directors, give every director listed with DIN.',
    schema: obj({
      form: s('Form name, e.g. MGT-7'), cin: s('CIN as entered'), companyName: s('Company name as entered'),
      fy: n('Start year of the financial year the form is for, if any (FY 2025-26 → 2025)'),
      agmDate: s(`AGM date as entered ${DATE}`),
      paidUpCapital: n(`Paid-up capital as entered ${MONEY}`), authorisedCapital: n(`Authorised capital as entered ${MONEY}`),
      totalShares: n('Total number of equity shares as entered'),
      directors: arr(obj({ name: s('Name'), din: s('DIN') }), 'Directors listed in the form'),
      auditor: obj({ firmName: s('Auditor firm'), frn: s('Firm registration number') }),
      eventDate: s(`For event forms (DIR-12, PAS-3, CHG-1…): date of the event / allotment / appointment ${DATE}`),
      person: obj({ name: s('For DIR-12: the person appointed / ceasing'), din: s('Their DIN') }),
    }),
  },
  BOARD_PAPERS: {
    label: 'Board / general meeting papers (find filings)',
    hint: 'Minutes, resolutions or a circular resolution — finds appointments, resignations, allotments, charges and other events that need an MCA filing.',
    perm: 'compliance.work',
    guide: [
      'These are minutes or resolutions of an Indian private company (board meeting, AGM / EGM, or a circular resolution).',
      'List every decision or event that needs an event-based MCA filing, using ONLY the filing codes listed below. One event per filing per person.',
      'eventDate is when the event took effect: the date of appointment / resignation (use the effective date if one is stated), the date of allotment, the date the charge was created or modified, the date the office shift takes effect; otherwise the meeting / resolution date.',
      'A board approval to borrow is NOT a charge: list CHG-1 only when the papers say a charge / hypothecation / mortgage is created or modified, and put that event in "unclear" if the creation date is not stated.',
      'Private companies are exempt from filing board resolutions under section 179(3) in MGT-14: propose MGT-14 only for special resolutions and other resolutions that section 117 requires to be filed.',
      'Decisions that need no filing go in notFiled with the reason. quote: the few words of the document that record the event (at most 20 words).',
    ].join(' '),
    schema: obj({
      meeting: obj({ kind: s('BOARD, AGM, EGM, CIRCULAR or OTHER'), date: s(`Date of the meeting or resolution ${DATE}`), cin: s('CIN of the company, if shown') }),
      events: arr(obj({
        ruleCode: s('One of the filing codes listed'),
        eventDate: s(`When the event took effect ${DATE}`),
        summary: s('One line: what happened, e.g. "Appointment of Karan Mehta as Additional Director"'),
        personName: s('Person involved, if any'), personDin: s('Their DIN, if shown'),
        personRole: s('Their designation as written, if any'),
        change: s('APPOINTED, RESIGNED, DESIGNATION_CHANGED or null'),
        quote: s('The words of the document that record it (≤ 20 words)'),
      }), 'Events that need an MCA filing'),
      notFiled: arr(obj({ summary: s('Decision'), reason: s('Why no filing is needed') }), 'Decisions noticed that need no filing'),
    }),
  },
  MCA_MASTER: {
    label: 'MCA company master data',
    hint: 'The “View company master data” page from the MCA portal, saved as PDF or a screenshot.',
    perm: 'clients.manage',
    guide: 'This is the MCA21 company master data. Read the company details and the full list of directors / signatories (with DIN and appointment date).',
    schema: obj({ company, directors: arr(director, 'Every director and signatory listed') }),
  },
  INCORPORATION: {
    label: 'Certificate of Incorporation / MOA',
    hint: 'Certificate of Incorporation, or the MOA for authorised capital.',
    perm: 'clients.manage',
    guide: 'This is a Certificate of Incorporation and/or a Memorandum / Articles of Association. Read the company details; list first directors only if they are named.',
    schema: obj({ company, directors: arr(director, 'First directors, if named') }),
  },
  SRN_CHALLAN: {
    label: 'MCA challan / SRN acknowledgment',
    hint: 'The challan or acknowledgment you got after filing on the MCA portal, or the approval letter / email.',
    perm: 'compliance.work',
    guide: 'This is an MCA challan / payment receipt / acknowledgment, or an approval mail for a filed form. The SRN is a 9-character code (letters and digits).',
    schema: obj({
      srn: s('Service Request Number, 9 characters'),
      form: s('Form name, e.g. AOC-4, MGT-7, DIR-3 KYC, ADT-1'),
      filedOn: s(`Date the form was filed / paid ${DATE}`),
      cin: s('CIN of the company, if shown'),
      companyName: s('Company name, if shown'),
      amount: n('Total fees paid in rupees'),
      approved: b('true if this document says the form was approved / registered by the RoC'),
      approvedOn: s(`Approval date ${DATE}, if approved`),
    }),
  },
  MGT7: {
    label: 'Last filed annual return (MGT-7 / MGT-7A)',
    hint: 'The annual return as filed, with its list of shareholders if attached.',
    perm: 'clients.manage',
    guide: 'This is an annual return in form MGT-7 or MGT-7A. "fy" is the start year of the financial year it is for (FY 2024-25 → 2024).',
    schema: obj({
      cin: s('CIN'),
      fy: n('Start year of the financial year the return is for, e.g. 2024 for FY 2024-25'),
      agmDate: s(`Date the AGM was held ${DATE}`),
      shareholders: arr(obj({
        name: s('Shareholder name'), pan: s('PAN, if shown'), folio: s('Folio number, if shown'),
        shareClass: s('EQUITY or PREFERENCE'), shares: n('Number of shares held'), faceValue: n('Face value per share in rupees'),
      }), 'Shareholders at the end of the year'),
      directors: arr(director, 'Directors and KMP listed'),
      auditor: obj({ firmName: s('Statutory auditor firm name'), frn: s('Firm registration number') }),
      boardMeetingDates: arr(s(DATE), 'Dates of board meetings held in the year'),
    }),
  },
  FINANCIALS: {
    label: 'Audited financial statements',
    hint: 'Balance sheet and profit & loss (with notes), as signed.',
    perm: 'clients.manage',
    guide: 'These are financial statements of an Indian company. Use the current-year column. Watch the "amounts in lakhs / thousands" heading.',
    schema: obj({
      cin: s('CIN, if shown'),
      fy: n('Start year of the financial year, e.g. 2024 for year ended 31 March 2025'),
      paidUpCapital: n(`Paid-up equity + preference share capital ${MONEY}`),
      turnover: n(`Revenue from operations ${MONEY}`),
      borrowings: n(`Total borrowings (long + short term) ${MONEY}`),
      loansFromOthers: b('true if the company has outstanding loans or money received from anyone other than banks (e.g. directors, relatives, other companies) — relevant to DPT-3'),
      msmeDuesOver45Days: b('true if amounts are due to micro or small enterprises beyond 45 days (MSMED Act disclosure)'),
      msmeDuesAmount: n(`Amount due to micro and small enterprises ${MONEY}`),
    }),
  },
  FIN_STATEMENTS: {
    label: 'Signed financial statements (for AOC-4)',
    hint: 'Balance sheet and statement of profit and loss as signed, with the previous year column.',
    perm: 'compliance.work',
    guide: [
      'These are the audited financial statements of an Indian company (Schedule III). Read the balance sheet and the statement of profit and loss into the lines given, for the current year and the previous year columns.',
      'Convert every amount to whole rupees: watch the "₹ in lakhs / thousands / crores" heading. roundedTo is the smallest amount the statements show, in rupees (1 for rupees, 1000 for lakhs with two decimals, 100000 for crores with two decimals, 1000 for thousands).',
      'Put each item under the Schedule III line it belongs to; if the statements show a sub-total (e.g. "Shareholders’ funds") do not add it as a line. Use the totals exactly as printed for totalEqLiab, totalAssets, totalIncome, totalExpenses, pbt and pat — do not compute them.',
      'Amounts shown in brackets are negative. Write null for lines the statements do not have. If the statements are Ind AS (Division II), set standard to IND_AS and map to the nearest line.',
    ].join(' '),
    schema: obj({
      cin: s('CIN, if shown'),
      fy: n('Start year of the financial year, e.g. 2025 for the year ended 31 March 2026'),
      standard: s('AS for Schedule III Division I (Accounting Standards), IND_AS for Division II'),
      roundedTo: n('The smallest amount shown, in rupees (see guidance)'),
      grossTurnover: n(`Gross turnover including duties and taxes, if stated, ${MONEY}`),
      balanceSheet: lines(BALANCE_SHEET),
      profitLoss: lines(PROFIT_LOSS),
    }),
  },
  AUDITOR: {
    label: 'Auditor appointment (consent letter / ADT-1)',
    hint: 'The auditor’s consent letter, appointment resolution or ADT-1.',
    perm: 'clients.manage',
    guide: 'This is an auditor appointment document. A 5-year term from FY 2024-25 runs to FY 2028-29 (termFromFy 2024, termToFy 2028).',
    schema: obj({
      cin: s('CIN of the company, if shown'),
      firmName: s('Audit firm name'), frn: s('Firm registration number'),
      appointedOn: s(`Date of appointment ${DATE}`),
      termFromFy: n('Start year of the first FY of the term'), termToFy: n('Start year of the last FY of the term'),
    }),
  },
};

export const isDocType = (x: unknown): x is DocType => typeof x === 'string' && x in DOC_TYPES;
