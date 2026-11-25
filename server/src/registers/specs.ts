/**
 * The statutory registers, as data. Two kinds:
 *  - derived: built from the client's records (members from shareholders, directors & KMP from people);
 *  - entries: kept as entries in `register_entries`, with the fields below (one form, one table, one export each).
 * `events` put event-based filings on the calendar when an entry records them (via services/obligations.addEvent).
 * Column wording follows the prescribed forms; have a practising CS confirm before relying on a print as the register.
 */
export type FieldType = 'text' | 'textarea' | 'date' | 'number' | 'money' | 'select' | 'person' | 'member';
export interface RegField {
  key: string; label: string; type: FieldType; required?: boolean; help?: string; wide?: boolean;
  options?: { value: string; label: string }[];
  /** Show only for these values of another field (e.g. transfer details only for transfers). */
  when?: { key: string; in: string[] };
  /** Left out of the on-screen table (still in print and Excel). */
  detailOnly?: boolean;
}
export interface RegEvent { ruleCode: string; dateKey: string; when?: { key: string; in: string[] }; label: (d: Record<string, any>, names: Names) => string }
export interface Names { person: (id?: string) => string; member: (id?: string) => string }

export interface RegisterSpec {
  code: RegisterCode; title: string; short: string; law: string; form?: string; about: string;
  kind: 'derived' | 'entries';
  fields?: RegField[];
  /** The entry's date (sorting, "entered on") and, if any, the date that closes it (charge satisfied). */
  dateKey?: string; closeKey?: string; closedLabel?: string;
  events?: RegEvent[];
}
export type RegisterCode = 'MEMBERS' | 'SHARE_LEDGER' | 'DIRECTORS' | 'CHARGES' | 'CONTRACTS' | 'LOANS';

const money = (v: unknown) => (v === null || v === undefined || v === '' ? '' : `₹${Number(v).toLocaleString('en-IN')}`);

export const REGISTERS: RegisterSpec[] = [
  {
    code: 'MEMBERS', title: 'Register of members', short: 'Members', law: 'Sec 88(1)(a); Rule 3, Management & Administration Rules', form: 'MGT-1', kind: 'derived',
    about: 'Every member with their particulars and holding — from the Shareholders tab; allotments and transfers come from the share register.',
  },
  {
    code: 'SHARE_LEDGER', title: 'Allotments and transfers of shares', short: 'Allotments & transfers', law: 'Sec 88 (MGT-1 share details); Sec 39, 56', form: 'MGT-1 (Part)', kind: 'entries',
    about: 'Each allotment, transfer or transmission, with distinctive numbers and certificate. Recording an allotment adds PAS-3 to the calendar.',
    dateKey: 'date',
    fields: [
      { key: 'kind', label: 'What happened', type: 'select', required: true, options: [
        { value: 'ALLOTMENT', label: 'Allotment' }, { value: 'TRANSFER', label: 'Transfer' }, { value: 'TRANSMISSION', label: 'Transmission' }, { value: 'BUYBACK', label: 'Buy-back / reduction' }] },
      { key: 'date', label: 'Date of allotment / registration of transfer', type: 'date', required: true },
      { key: 'toMember', label: 'Member (allottee / transferee)', type: 'member', required: true, help: 'Add a new member on the Shareholders tab first.', when: { key: 'kind', in: ['ALLOTMENT', 'TRANSFER', 'TRANSMISSION'] } },
      { key: 'fromMember', label: 'From member (transferor / deceased / bought back from)', type: 'member', required: true, when: { key: 'kind', in: ['TRANSFER', 'TRANSMISSION', 'BUYBACK'] } },
      { key: 'shareClass', label: 'Class', type: 'select', required: true, options: [{ value: 'EQUITY', label: 'Equity' }, { value: 'PREFERENCE', label: 'Preference' }] },
      { key: 'shares', label: 'Number of shares', type: 'number', required: true },
      { key: 'distinctiveFrom', label: 'Distinctive no. from', type: 'number' },
      { key: 'distinctiveTo', label: 'Distinctive no. to', type: 'number' },
      { key: 'certificateNo', label: 'Share certificate no.', type: 'text' },
      { key: 'price', label: 'Price per share (₹)', type: 'money', help: 'Issue price for an allotment; consideration per share for a transfer.' },
      { key: 'consideration', label: 'Consideration', type: 'select', options: [{ value: 'CASH', label: 'Cash' }, { value: 'OTHER', label: 'Other than cash' }, { value: 'NIL', label: 'Nil (gift / transmission)' }], detailOnly: true },
      { key: 'boardOn', label: 'Board meeting approving it', type: 'date', detailOnly: true },
      { key: 'remarks', label: 'Remarks', type: 'textarea', wide: true, detailOnly: true },
    ],
    events: [{ ruleCode: 'PAS3', dateKey: 'date', when: { key: 'kind', in: ['ALLOTMENT'] }, label: (d, n) => `Allotment of ${d.shares} shares to ${n.member(d.toMember)}` }],
  },
  {
    code: 'DIRECTORS', title: 'Register of directors and key managerial personnel and their shareholding', short: 'Directors & KMP', law: 'Sec 170(1); Rule 17, Appointment & Qualification of Directors Rules', kind: 'derived',
    about: 'Every director and KMP with particulars, appointment and cessation, and shares they hold — from the Directors & KMP tab.',
  },
  {
    code: 'CHARGES', title: 'Register of charges', short: 'Charges', law: 'Sec 85(1); Rule 10, Registration of Charges Rules', form: 'CHG-7', kind: 'entries',
    about: 'Charges on the company’s property. Recording a charge adds CHG-1; a modification adds CHG-1; satisfaction adds CHG-4.',
    dateKey: 'createdOn', closeKey: 'satisfiedOn', closedLabel: 'Satisfied',
    fields: [
      { key: 'chargeId', label: 'Charge ID (MCA)', type: 'text', help: 'Given by MCA once CHG-1 is registered.' },
      { key: 'createdOn', label: 'Date of creation', type: 'date', required: true },
      { key: 'holder', label: 'Charge holder', type: 'text', required: true, help: 'e.g. the bank' },
      { key: 'holderAddress', label: 'Charge holder’s address', type: 'textarea', wide: true, detailOnly: true },
      { key: 'amount', label: 'Amount secured (₹)', type: 'money', required: true },
      { key: 'nature', label: 'Type of charge', type: 'select', required: true, options: [
        { value: 'HYPOTHECATION', label: 'Hypothecation' }, { value: 'MORTGAGE', label: 'Mortgage' }, { value: 'PLEDGE', label: 'Pledge' }, { value: 'LIEN', label: 'Lien' }, { value: 'OTHER', label: 'Other' }] },
      { key: 'property', label: 'Property charged', type: 'textarea', required: true, wide: true },
      { key: 'instrument', label: 'Instrument creating the charge', type: 'text', detailOnly: true, help: 'e.g. Deed of hypothecation dated …' },
      { key: 'terms', label: 'Principal terms (rate, repayment, margin)', type: 'textarea', wide: true, detailOnly: true },
      { key: 'modifiedOn', label: 'Date of modification', type: 'date', detailOnly: true },
      { key: 'modification', label: 'Particulars of modification', type: 'textarea', wide: true, detailOnly: true },
      { key: 'satisfiedOn', label: 'Date of satisfaction', type: 'date' },
      { key: 'srn', label: 'SRN of CHG-1 / CHG-4', type: 'text', detailOnly: true },
    ],
    events: [
      { ruleCode: 'CHG1', dateKey: 'createdOn', label: (d) => `Charge of ${money(d.amount)} to ${d.holder}` },
      { ruleCode: 'CHG1', dateKey: 'modifiedOn', label: (d) => `Modification of charge to ${d.holder}` },
      { ruleCode: 'CHG4', dateKey: 'satisfiedOn', label: (d) => `Satisfaction of charge to ${d.holder}` },
    ],
  },
  {
    code: 'CONTRACTS', title: 'Register of contracts or arrangements in which directors are interested', short: 'Contracts (directors interested)', law: 'Sec 189(1); Rule 16, Meetings of Board Rules', form: 'MBP-4', kind: 'entries',
    about: 'Part A: contracts with bodies or firms where a director is interested (Sec 184(2)). Part B: related-party contracts (Sec 188).',
    dateKey: 'date',
    fields: [
      { key: 'part', label: 'Part', type: 'select', required: true, options: [{ value: 'A', label: 'A — director interested (Sec 184(2))' }, { value: 'B', label: 'B — related party (Sec 188)' }] },
      { key: 'date', label: 'Date of contract / arrangement', type: 'date', required: true },
      { key: 'party', label: 'Party (company, firm or person)', type: 'text', required: true },
      { key: 'director', label: 'Director interested / related', type: 'person', required: true },
      { key: 'interest', label: 'Nature of interest / relationship', type: 'text', required: true },
      { key: 'nature', label: 'Nature of contract', type: 'text', required: true, help: 'e.g. Sale of goods, lease, services' },
      { key: 'terms', label: 'Principal terms', type: 'textarea', wide: true, detailOnly: true },
      { key: 'value', label: 'Value (₹)', type: 'money' },
      { key: 'boardOn', label: 'Board approval on', type: 'date' },
      { key: 'membersOn', label: 'Members’ approval on (if needed)', type: 'date', detailOnly: true },
      { key: 'remarks', label: 'Remarks', type: 'textarea', wide: true, detailOnly: true },
    ],
  },
  {
    code: 'LOANS', title: 'Register of loans, guarantees, security and acquisitions', short: 'Loans & investments', law: 'Sec 186(9); Rule 12(1), Meetings of Board Rules', form: 'MBP-2', kind: 'entries',
    about: 'Loans given, guarantees, security provided and investments acquired. A special resolution date adds MGT-14.',
    dateKey: 'date',
    fields: [
      { key: 'kind', label: 'Transaction', type: 'select', required: true, options: [
        { value: 'LOAN', label: 'Loan given' }, { value: 'GUARANTEE', label: 'Guarantee given' }, { value: 'SECURITY', label: 'Security provided' }, { value: 'INVESTMENT', label: 'Investment / acquisition' }] },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'party', label: 'Name of the person / body corporate', type: 'text', required: true },
      { key: 'partyAddress', label: 'Address', type: 'textarea', wide: true, detailOnly: true },
      { key: 'amount', label: 'Amount (₹)', type: 'money', required: true },
      { key: 'period', label: 'Period', type: 'text', when: { key: 'kind', in: ['LOAN', 'GUARANTEE', 'SECURITY'] } },
      { key: 'purpose', label: 'Purpose', type: 'text', required: true },
      { key: 'rate', label: 'Rate of interest (%)', type: 'number', when: { key: 'kind', in: ['LOAN'] } },
      { key: 'securities', label: 'Securities acquired (number, kind, face value, cost)', type: 'textarea', wide: true, when: { key: 'kind', in: ['INVESTMENT'] } },
      { key: 'boardOn', label: 'Board resolution on', type: 'date' },
      { key: 'specialResolutionOn', label: 'Special resolution on (if above the limit)', type: 'date', detailOnly: true },
      { key: 'remarks', label: 'Remarks', type: 'textarea', wide: true, detailOnly: true },
    ],
    events: [{ ruleCode: 'MGT14', dateKey: 'specialResolutionOn', label: (d) => `Special resolution under Sec 186 — ${d.party}` }],
  },
];

export const registerSpec = (code: string) => REGISTERS.find((r) => r.code === code);
export const isRegisterCode = (code: string): code is RegisterCode => !!registerSpec(code);
