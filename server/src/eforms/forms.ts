/**
 * MCA V3 form data packs, as data. Labels follow the form's own wording and part numbers where they are stable;
 * values come from the records, or are typed once (client profile — reused every year) or per filing.
 * Keep these in step with MCA's instruction kits; docs/eforms.md lists what each pack covers.
 */
import type { FieldSpec, FormCtx, FormSpec, PartSpec, Person } from './build.js';
import { agmLastDate, firstFy, fyLabel } from '../compliance/dates.js';

const fmt = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }) : null);
const num = (n: number | string | null | undefined) => (n === null || n === undefined || n === '' ? null : Number(n).toLocaleString('en-IN'));
const fyStart = (fy: number) => `${fy}-04-01`;
const fyEnd = (fy: number) => `${fy + 1}-03-31`;
const DESIG: Record<string, string> = { DIRECTOR: 'Director', MANAGING_DIRECTOR: 'Managing Director', WHOLE_TIME_DIRECTOR: 'Whole-time Director', NOMINEE_DIRECTOR: 'Nominee Director', INDEPENDENT_DIRECTOR: 'Independent Director', CEO: 'CEO', CFO: 'CFO', CS: 'Company Secretary' };
const isDirector = (p: Person) => p.designation.includes('DIRECTOR');
const inOffice = (p: Person, on: string) => (!p.appointedOn || p.appointedOn <= on) && (!p.ceasedOn || p.ceasedOn > on);
const totalShares = (c: FormCtx) => c.shareholders.reduce((s, x) => s + x.shares, 0);
const faceValue = (c: FormCtx) => { const fv = [...new Set(c.shareholders.map((s) => Number(s.faceValue)))]; return fv.length === 1 ? fv[0] : null; };
const sharesOf = (c: FormCtx, p: Person) => c.shareholders.filter((s) => (p.pan && s.pan === p.pan) || s.name.trim().toLowerCase() === p.name.trim().toLowerCase()).reduce((t, s) => t + s.shares, 0);
const agmOf = (c: FormCtx, fy: number) => c.years.find((y) => y.fy === fy)?.agmDate ?? null;
const agmDue = (c: FormCtx, fy: number) => agmLastDate(fy, !!c.client.incorporationDate && firstFy(c.client.incorporationDate) === fy);
const person = (c: FormCtx) => c.people.find((p) => p.id === c.ob.personId) ?? null;

// ---- Shared field groups ----------------------------------------------------------------------------------------
const company = (extra: FieldSpec[] = []): FieldSpec[] => [
  { key: 'cin', label: 'Corporate Identity Number (CIN)', aliases: ['CIN', 'Corporate Identification Number', 'CIN of the company'], value: (c) => c.client.cin, help: 'Enter it first — the portal pre-fills the registration details from it.' },
  { key: 'pan', label: 'PAN of the company', aliases: ['Permanent Account Number (PAN) of the company', 'Income-tax PAN'], input: { scope: 'client' } },
  { key: 'name', label: 'Name of the company', aliases: ['Company name'], value: (c) => c.client.name },
  { key: 'regOffice', label: 'Registered office address', aliases: ['Address of the registered office of the company'], value: (c) => c.client.registeredOffice, fixAt: 'details' },
  { key: 'email', label: 'Email ID of the company', aliases: ['Email address of the company', 'Email ID'], value: (c) => c.client.email, fixAt: 'details' },
  ...extra,
];
const fyFields = (): FieldSpec[] => [
  { key: 'fyFrom', label: 'Financial year — from', aliases: ['Financial year from date', 'From date'], value: (c) => fmt(fyStart(c.ob.fy)) },
  { key: 'fyTo', label: 'Financial year — to', aliases: ['Financial year to date', 'To date'], value: (c) => fmt(fyEnd(c.ob.fy)) },
];
const capital = (): FieldSpec[] => [
  { key: 'authAmt', label: 'Authorised capital (₹)', aliases: ['Total amount of authorised capital'], value: (c) => num(c.client.authorisedCapital), fixAt: 'details' },
  { key: 'authShares', label: 'Authorised — number of equity shares', value: (c) => { const fv = faceValue(c); return fv && c.client.authorisedCapital ? num(Number(c.client.authorisedCapital) / fv) : null; }, fixAt: 'details' },
  { key: 'paidShares', label: 'Issued / subscribed / paid-up — number of shares', aliases: ['Total number of equity shares', 'Number of paid up equity shares'], value: (c) => (c.shareholders.length ? num(totalShares(c)) : null), fixAt: 'shareholders' },
  { key: 'faceValue', label: 'Nominal value per share (₹)', value: (c) => faceValue(c), fixAt: 'shareholders' },
  { key: 'paidAmt', label: 'Paid-up capital (₹)', value: (c) => num(c.client.paidUpCapital), fixAt: 'details' },
];

// ---- Annual return: MGT-7 / MGT-7A ------------------------------------------------------------------------------
const annualReturn = (form: 'MGT-7' | 'MGT-7A'): FormSpec => ({
  form, title: form === 'MGT-7' ? 'Annual return' : 'Annual return (small company / OPC)',
  note: 'V3: shareholder lists and meeting details go in MCA’s Excel templates attached to the form — the Shareholders and Meetings tables below are in that order.',
  parts: (c): PartSpec[] => {
    const end = fyEnd(c.ob.fy);
    const atEnd = c.people.filter((p) => inOffice(p, end));
    const changes = c.people.flatMap((p) => [
      ...(p.appointedOn && p.appointedOn >= fyStart(c.ob.fy) && p.appointedOn <= end ? [[p.name, p.din ?? p.pan, DESIG[p.designation] ?? p.designation, fmt(p.appointedOn), 'Appointment']] : []),
      ...(p.ceasedOn && p.ceasedOn >= fyStart(c.ob.fy) && p.ceasedOn <= end ? [[p.name, p.din ?? p.pan, DESIG[p.designation] ?? p.designation, fmt(p.ceasedOn), 'Cessation']] : []),
    ]);
    return [
      { title: 'I. Registration and other details', fields: [
        ...company([
          { key: 'phone', label: 'Telephone number with STD code', aliases: ['Phone number', 'Telephone number'], input: { scope: 'client' } },
          { key: 'website', label: 'Website', input: { scope: 'client' }, optional: true },
        ]),
        { key: 'incDate', label: 'Date of incorporation', value: (c) => fmt(c.client.incorporationDate), fixAt: 'details' },
        { key: 'type', label: 'Type of the company', value: (c) => (c.client.companyType === 'OPC' ? 'One Person Company' : 'Private company') },
        { key: 'category', label: 'Category / sub-category', value: () => 'Company limited by shares / Indian Non-Government company', help: 'Change on the form if different.' },
        { key: 'listed', label: 'Whether shares listed on a stock exchange', value: () => 'No' },
        ...fyFields(),
        { key: 'agmHeld', label: 'Whether AGM held', aliases: ['Whether annual general meeting (AGM) held'], value: (c) => (agmOf(c, c.ob.fy) ? 'Yes' : null), fixAt: 'year', show: () => form === 'MGT-7' || c.client.companyType !== 'OPC' },
        { key: 'agmDate', label: 'Date of AGM', aliases: ['Date of annual general meeting', 'AGM date'], value: (c) => fmt(agmOf(c, c.ob.fy)), fixAt: 'year', show: () => c.client.companyType !== 'OPC' },
        { key: 'agmDue', label: 'Due date of AGM', value: (c) => fmt(agmDue(c, c.ob.fy)), show: () => c.client.companyType !== 'OPC' },
        { key: 'agmExtension', label: 'Whether any extension for AGM granted', input: { scope: 'filing', type: 'select', options: ['No', 'Yes'], default: 'No' }, show: () => c.client.companyType !== 'OPC' },
      ] },
      { title: 'II. Principal business activities', fields: [
        { key: 'mainActivityCode', label: 'Main activity group code', input: { scope: 'client' }, help: 'From the MCA activity code list (e.g. J for Information and communication).' },
        { key: 'mainActivityDesc', label: 'Description of main activity group', input: { scope: 'client' } },
        { key: 'businessActivityCode', label: 'Business activity code', input: { scope: 'client' } },
        { key: 'businessActivityDesc', label: 'Description of business activity', input: { scope: 'client' } },
        { key: 'turnoverPct', label: '% of turnover of the company', input: { scope: 'filing', type: 'number', default: '100' } },
      ] },
      { title: 'III. Holding, subsidiary and associate companies', fields: [
        { key: 'hsaCount', label: 'Number of holding / subsidiary / associate / joint venture companies', input: { scope: 'filing', type: 'number', default: '0' } },
      ] },
      { title: 'IV. Share capital, debentures and turnover', fields: [
        ...capital(),
        { key: 'debentures', label: 'Debentures / other securities outstanding (₹)', input: { scope: 'filing', type: 'number', default: '0' } },
        { key: 'turnover', label: 'Turnover (₹)', input: { scope: 'filing', type: 'number' } },
        { key: 'netWorth', label: 'Net worth of the company (₹)', input: { scope: 'filing', type: 'number' } },
      ] },
      { title: 'V–VI. Shareholding and members', fields: [
        { key: 'members', label: 'Number of members at the end of the year', value: (c) => (c.shareholders.length ? c.shareholders.length : null), fixAt: 'shareholders' },
        { key: 'promoters', label: 'Number of promoters at the end of the year', input: { scope: 'filing', type: 'number' } },
      ], tables: [{ key: 'holders', title: 'List of shareholders (for MCA’s Excel template)', columns: ['Name', 'PAN', 'Folio', 'Class', 'Number of shares', 'Nominal value (₹)'],
        rows: (c) => c.shareholders.map((s) => [s.name, s.pan, s.folio, s.shareClass === 'EQUITY' ? 'Equity' : 'Preference', s.shares, Number(s.faceValue)]), empty: 'Register of members is empty.' }] },
      { title: 'VII. Directors and key managerial personnel', fields: [
        { key: 'directorsAtEnd', label: 'Number of directors at the end of the year', value: () => atEnd.filter(isDirector).length || null, fixAt: 'directors' },
      ], tables: [
        { key: 'dkmp', title: 'Directors and KMP as on the closure of the financial year', columns: ['Name', 'DIN / PAN', 'Designation', 'Shares held', 'Date of appointment'],
          rows: (c) => atEnd.map((p) => [p.name, p.din ?? p.pan, DESIG[p.designation] ?? p.designation, sharesOf(c, p) || 0, fmt(p.appointedOn)]), empty: 'No directors on file.' },
        { key: 'changes', title: 'Changes during the year', columns: ['Name', 'DIN / PAN', 'Designation', 'Date', 'Nature of change'], rows: () => changes, empty: 'No changes during the year.' },
      ] },
      { title: 'VIII. Meetings of members, board and committees', fields: [
        { key: 'boardCount', label: 'Number of board meetings held', value: (c) => c.meetings.filter((m) => m.type === 'BOARD').length || null, help: 'From meetings marked held in ComplyDesk.' },
      ], tables: [
        { key: 'gm', title: 'Members’ meetings (AGM / EGM)', columns: ['Type', 'Date', 'Members entitled', 'Members present'],
          rows: (c) => c.meetings.filter((m) => m.type !== 'BOARD').map((m) => [m.type, fmt(m.date), m.entitled, m.present]), empty: 'No general meetings recorded in this FY.' },
        { key: 'bm', title: 'Board meetings', columns: ['Date', 'Directors on that date', 'Directors attended', '% attendance'],
          rows: (c) => c.meetings.filter((m) => m.type === 'BOARD').map((m) => [fmt(m.date), m.entitled, m.present, m.entitled && m.present !== null ? `${Math.round((m.present / m.entitled) * 100)}%` : null]), empty: 'No board meetings recorded in this FY.' },
      ] },
      { title: 'IX–XI. Remuneration, compliance, penalties', fields: [
        { key: 'remuneration', label: 'Remuneration of directors and KMP (₹, total)', input: { scope: 'filing', type: 'number', default: '0' } },
        { key: 'compliance', label: 'Whether the company has made compliances and disclosures under the Act', input: { scope: 'filing', type: 'select', options: ['Yes', 'No'], default: 'Yes' } },
        { key: 'penalty', label: 'Penalty / punishment / compounding during the year', input: { scope: 'filing', default: 'Nil' } },
      ] },
    ];
  },
  attachments: (c) => {
    const big = Number(c.client.paidUpCapital ?? 0) >= 10_00_00_000 || Number(c.formData.turnover ?? 0) >= 50_00_00_000;
    return [
      { name: 'List of shareholders (MCA Excel template)', why: 'Table in part V–VI' },
      { name: 'Meeting details (MCA Excel template)', why: 'Tables in part VIII' },
      ...(form === 'MGT-7' && big ? [{ name: 'MGT-8 certificate by a practising CS', why: 'Paid-up ≥ ₹10 crore or turnover ≥ ₹50 crore' }] : []),
      ...(c.formData.agmExtension === 'Yes' ? [{ name: 'Approval letter for extension of AGM' }] : []),
    ];
  },
});

// ---- AOC-4 ------------------------------------------------------------------------------------------------------
const aoc4: FormSpec = {
  form: 'AOC-4', title: 'Financial statements',
  parts: (c) => {
    const aud = c.auditors.find((a) => a.current);
    return [
      { title: 'Part A — company and meeting details', fields: [
        ...company(), ...fyFields(),
        { key: 'boardDate', label: 'Date of board meeting approving the financial statements', input: { scope: 'filing', type: 'date' } },
        { key: 'agmDate', label: 'Date of AGM', aliases: ['Date of annual general meeting', 'AGM date'], value: (c) => fmt(agmOf(c, c.ob.fy)), fixAt: 'year', show: () => c.client.companyType !== 'OPC' },
        { key: 'agmDue', label: 'Due date of AGM', value: (c) => fmt(agmDue(c, c.ob.fy)), show: () => c.client.companyType !== 'OPC' },
      ] },
      { title: 'Auditor', fields: [
        { key: 'audCategory', label: 'Category of auditor', input: { scope: 'filing', type: 'select', options: ['Auditor’s firm', 'Individual'], default: 'Auditor’s firm' } },
        { key: 'audName', label: 'Name of the auditor / firm', value: () => aud?.firmName, fixAt: 'auditor' },
        { key: 'audFrn', label: 'Firm registration number', value: () => aud?.frn, fixAt: 'auditor' },
        { key: 'audPan', label: 'PAN of the auditor / firm', input: { scope: 'filing' } },
        { key: 'audMembership', label: 'Membership number of the signing partner', input: { scope: 'filing' } },
      ] },
      { title: 'Part B — key figures (from the signed financial statements)', fields: [
        { key: 'paidAmt', label: 'Share capital (₹)', value: (c) => num(c.client.paidUpCapital), fixAt: 'details' },
        { key: 'netWorth', label: 'Net worth (₹)', input: { scope: 'filing', type: 'number' } },
        { key: 'turnover', label: 'Revenue from operations (₹)', input: { scope: 'filing', type: 'number' } },
        { key: 'pbt', label: 'Profit / (loss) before tax (₹)', input: { scope: 'filing', type: 'number' } },
        { key: 'borrowings', label: 'Borrowings (₹)', input: { scope: 'filing', type: 'number', default: '0' } },
      ] },
    ];
  },
  attachments: (c) => {
    const csr = Number(c.formData.netWorth ?? 0) >= 500_00_00_000 || Number(c.formData.turnover ?? 0) >= 1000_00_00_000 || Number(c.formData.pbt ?? 0) >= 5_00_00_000;
    return [
      { name: 'Financial statements (balance sheet, P&L, cash flow, notes)' },
      { name: 'Board’s report with annexures' },
      { name: 'Auditor’s report' },
      ...(Number(c.formData.hsaCount ?? 0) > 0 ? [{ name: 'AOC-1 (subsidiaries / associates)' }] : []),
      { name: 'AOC-2 (related party contracts), if any', why: 'Only if there were related party contracts' },
      ...(csr ? [{ name: 'CSR report annexure', why: 'Net worth ≥ ₹500 cr, turnover ≥ ₹1,000 cr or net profit ≥ ₹5 cr (s.135)' }] : []),
    ];
  },
};

// ---- DIR-12 -----------------------------------------------------------------------------------------------------
const purposeOf = (c: FormCtx) => {
  const p = person(c); const ev = c.ob.eventDate;
  if (!p || !ev) return null;
  return p.ceasedOn === ev ? 'Cessation' : p.appointedOn === ev ? 'Appointment' : null;
};
const dir12: FormSpec = {
  form: 'DIR-12', title: 'Appointment / cessation of directors and KMP',
  note: 'V3: the DIR-2 consent is part of the form and is signed with the new director’s DSC.',
  parts: (c) => {
    const p = person(c);
    const purpose = purposeOf(c) ?? c.formData.purpose ?? null;
    return [
      { title: 'Company', fields: company() },
      { title: 'Change', fields: [
        purposeOf(c) ? { key: 'purpose', label: 'Purpose', value: () => purposeOf(c) } : { key: 'purpose', label: 'Purpose', input: { scope: 'filing', type: 'select', options: ['Appointment', 'Cessation', 'Change in designation'] }, help: 'Couldn’t tell from the director’s dates.' },
        { key: 'din', label: p && !isDirector(p) ? 'PAN / DIN of the KMP' : 'DIN', value: () => p?.din ?? p?.pan ?? null, fixAt: 'directors' },
        { key: 'pname', label: 'Name', value: () => p?.name ?? null, fixAt: 'directors' },
        { key: 'designation', label: 'Designation', value: () => (p ? DESIG[p.designation] ?? p.designation : null), fixAt: 'directors' },
        p?.designation === 'INDEPENDENT_DIRECTOR' ? { key: 'category', label: 'Category', value: () => 'Independent' }
          : p?.designation === 'NOMINEE_DIRECTOR' ? { key: 'category', label: 'Category', value: () => 'Nominee' }
          : { key: 'category', label: 'Category', input: { scope: 'filing', type: 'select', options: ['Promoter', 'Professional', 'Independent', 'Nominee'] }, show: () => !!p && isDirector(p) },
        { key: 'eventDate', label: purpose === 'Cessation' ? 'Date of cessation' : 'Date of appointment / change', value: (c) => fmt(c.ob.eventDate) },
        { key: 'reason', label: 'Reason for cessation', input: { scope: 'filing', type: 'select', options: ['Resignation', 'Death', 'Disqualification', 'Removal', 'Other'] }, show: () => purpose === 'Cessation' },
        { key: 'pemail', label: 'Email ID of the person', value: () => p?.email ?? null, fixAt: 'directors', show: () => purpose !== 'Cessation' },
        { key: 'directorsAfter', label: 'Number of directors after the change', value: (c) => (c.ob.eventDate ? c.people.filter((x) => isDirector(x) && inOffice(x, c.ob.eventDate!)).length : null) },
      ] },
    ];
  },
  attachments: (c) => {
    const purpose = purposeOf(c) ?? c.formData.purpose;
    const p = person(c);
    if (purpose === 'Cessation') return [{ name: 'Notice of resignation / evidence of cessation' }, { name: 'Board resolution noting the cessation', why: 'Usual practice' }];
    return [
      { name: 'Board / members’ resolution for the appointment' },
      { name: 'Letter of appointment' },
      ...(p && isDirector(p) ? [{ name: 'DIR-2 consent — filled in the form, signed with the director’s DSC' }, { name: 'DIR-8 declaration and MBP-1 disclosure (keep on record)', why: 'Not uploaded; kept with the company' }] : []),
    ];
  },
};

// ---- ADT-1 ------------------------------------------------------------------------------------------------------
const adt1: FormSpec = {
  form: 'ADT-1', title: 'Appointment of auditor',
  parts: (c) => {
    const a = c.auditors.find((x) => x.current);
    return [
      { title: 'Company', fields: company() },
      { title: 'Auditor', fields: [
        { key: 'nature', label: 'Nature of appointment', input: { scope: 'filing', type: 'select', options: ['Appointment / re-appointment in AGM', 'Appointment of first auditor', 'Casual vacancy'], default: 'Appointment / re-appointment in AGM' } },
        { key: 'audCategory', label: 'Category of auditor', input: { scope: 'filing', type: 'select', options: ['Auditor’s firm', 'Individual'], default: 'Auditor’s firm' } },
        { key: 'audName', label: 'Name of the auditor / firm', value: () => a?.firmName, fixAt: 'auditor' },
        { key: 'audFrn', label: 'Firm / membership registration number', value: () => a?.frn, fixAt: 'auditor' },
        { key: 'audPan', label: 'PAN of the auditor / firm', input: { scope: 'filing' } },
        { key: 'audEmail', label: 'Email ID of the auditor', input: { scope: 'filing' } },
        { key: 'audAddress', label: 'Address of the auditor', input: { scope: 'filing' } },
        { key: 'from', label: 'Period of appointment — from (FY)', value: () => (a?.termFromFy ? fyLabel(a.termFromFy) : null), fixAt: 'auditor' },
        { key: 'to', label: 'Period of appointment — to (FY)', value: () => (a?.termToFy ? fyLabel(a.termToFy) : null), fixAt: 'auditor' },
        { key: 'years', label: 'Number of financial years', value: () => (a?.termFromFy && a?.termToFy ? a.termToFy - a.termFromFy + 1 : null), fixAt: 'auditor' },
        { key: 'appointedOn', label: 'Date of appointment (AGM / board meeting)', value: () => fmt(a?.appointedOn), fixAt: 'auditor' },
        { key: 'joint', label: 'Whether joint auditors', value: () => 'No' },
      ] },
    ];
  },
  attachments: () => [{ name: 'Copy of the resolution appointing the auditor' }, { name: 'Auditor’s written consent and eligibility certificate' }, { name: 'Intimation letter to the auditor' }],
};

// ---- PAS-3 ------------------------------------------------------------------------------------------------------
const pas3: FormSpec = {
  form: 'PAS-3', title: 'Return of allotment',
  note: 'Add the new allottees to the register of members first, so paid-up capital and the shareholder list match.',
  parts: (c) => {
    const n = Number(c.formData.sharesAllotted ?? 0); const fv = Number(c.formData.nominal ?? faceValue(c) ?? 0); const prem = Number(c.formData.premium ?? 0);
    return [
      { title: 'Company', fields: company() },
      { title: 'Allotment', fields: [
        { key: 'allotDate', label: 'Date of allotment', value: (c) => fmt(c.ob.eventDate) },
        { key: 'resolutionDate', label: 'Date of board / members’ resolution', input: { scope: 'filing', type: 'date' } },
        { key: 'mode', label: 'Type of issue', input: { scope: 'filing', type: 'select', options: ['Rights', 'Private placement', 'Preferential', 'Bonus', 'ESOP', 'Other'] } },
        { key: 'consideration', label: 'Shares allotted for', input: { scope: 'filing', type: 'select', options: ['Cash', 'Consideration other than cash'], default: 'Cash' } },
        { key: 'sharesAllotted', label: 'Number of equity shares allotted', input: { scope: 'filing', type: 'number' } },
        { key: 'nominal', label: 'Nominal value per share (₹)', input: { scope: 'filing', type: 'number', default: faceValue(c) ? String(faceValue(c)) : undefined } },
        { key: 'premium', label: 'Premium per share (₹)', input: { scope: 'filing', type: 'number', default: '0' } },
        { key: 'amount', label: 'Total amount payable on allotment (₹)', value: () => (n && fv ? num(n * (fv + prem)) : null), help: 'Shares × (nominal value + premium).' },
      ] },
      { title: 'Capital after the allotment', fields: [...capital()] },
    ];
  },
  attachments: (c) => [
    { name: 'List of allottees' },
    { name: 'Board resolution for the allotment' },
    ...(c.formData.mode === 'Private placement' || c.formData.mode === 'Preferential' ? [{ name: 'Special resolution and PAS-4 offer letter', why: 'Private placement / preferential issue' }, { name: 'Valuation report', why: 'Price must be backed by a registered valuer' }] : []),
    ...(c.formData.consideration === 'Consideration other than cash' ? [{ name: 'Contract / valuation for non-cash consideration' }] : []),
  ],
};

/** Which pack a filing gets, by its rule code. */
export const FORM_SPECS: Record<string, FormSpec> = {
  MGT7: annualReturn('MGT-7'), MGT7A: annualReturn('MGT-7A'), MGT7A_OPC: annualReturn('MGT-7A'),
  AOC4: aoc4, AOC4_OPC: aoc4, DIR12: dir12, ADT1: adt1, PAS3: pas3,
};
export const specFor = (ruleCode: string) => FORM_SPECS[ruleCode] ?? null;
