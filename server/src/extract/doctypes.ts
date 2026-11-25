/**
 * The documents ComplyDesk can read, as data: what to ask the model for (a JSON schema the model must fill in)
 * and how to turn its answer into the app's own field shapes. Adding a document = adding an entry here.
 */
export type DocType = 'MCA_MASTER' | 'INCORPORATION' | 'SRN_CHALLAN' | 'MGT7' | 'FINANCIALS' | 'AUDITOR';

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
}

export const DOC_TYPES: Record<DocType, DocDef> = {
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
