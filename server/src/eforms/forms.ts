/**
 * MCA V3 form data packs, as data. Labels follow the form's own wording and part numbers where they are stable;
 * values come from the records, or are typed once (client profile — reused every year) or per filing.
 * Keep these in step with MCA's instruction kits; docs/eforms.md lists what each pack covers.
 */
import type { FieldSpec, FormCtx, FormSpec, PartSpec, Person } from './build.js';
import { agmLastDate, firstFy, fyLabel } from '../compliance/dates.js';
import { BALANCE_SHEET, PROFIT_LOSS, ALL_LINES, fsKey, figuresFromFormData, netWorth } from '../financials/statements.js';

const fmt = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }) : null);
const num = (n: number | string | null | undefined) => (n === null || n === undefined || n === '' ? null : Number(n).toLocaleString('en-IN'));
const fyStart = (fy: number) => `${fy}-04-01`;
const fyEnd = (fy: number) => `${fy + 1}-03-31`;
import { DESIGNATION_LABEL as DESIG } from '../lib/validators.js';
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
/** Part B: Schedule III lines, current and previous year (read from the signed statements, or typed). Lines left blank are "nil". */
const statementParts = (): PartSpec[] => [...BALANCE_SHEET, ...PROFIT_LOSS].map((g) => ({
  title: `Part B — ${g.title.toLowerCase()} (₹, current year / previous year)`,
  fields: g.lines.flatMap((l): FieldSpec[] => (['cy', 'py'] as const).map((y) => ({
    key: fsKey(l.key, y), label: `${l.label} — ${y === 'cy' ? 'current year' : 'previous year'}`, aliases: [l.label],
    input: { scope: 'filing', type: 'number' }, optional: !l.total && !['shareCapital', 'reserves', 'revenue', 'pbt', 'pat'].includes(l.key), help: l.help,
  }))),
}));
/** Net worth, turnover, profit: from the statement lines (older filings: the figures typed before lines existed). */
const keyFigures = (c: FormCtx) => {
  const f = figuresFromFormData(c.formData);
  const has = ALL_LINES.some((l) => f[l.key].cy !== null);
  return has ? { netWorth: netWorth(f), turnover: f.revenue.cy ?? 0, pbt: f.pbt.cy ?? 0 }
    : { netWorth: Number(c.formData.netWorth ?? 0), turnover: Number(c.formData.turnover ?? 0), pbt: Number(c.formData.pbt ?? 0) };
};

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
      ...statementParts(),
    ];
  },
  attachments: (c) => {
    const k = keyFigures(c);
    const csr = k.netWorth >= 500_00_00_000 || k.turnover >= 1000_00_00_000 || k.pbt >= 5_00_00_000;
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

/** AOC-4 XBRL: the same data; the financial statements go as an XBRL instance document made with an XBRL tool. */
const aoc4Xbrl: FormSpec = {
  form: 'AOC-4 XBRL', title: 'Financial statements in XBRL',
  note: 'The balance sheet and P&L are filed as an XBRL instance document: prepare it in an XBRL tool from the figures below (Excel: XBRL working paper), validate it with MCA’s XBRL validation tool, then attach it to the form.',
  parts: (c) => [
    ...aoc4.parts(c),
    { title: 'XBRL working paper', tables: [{
      key: 'xbrlWorking', title: 'Schedule III figures for the XBRL tool', columns: ['Statement', 'Line item', 'Current year (₹)', 'Previous year (₹)'],
      rows: (c) => { const f = figuresFromFormData(c.formData); return [...BALANCE_SHEET, ...PROFIT_LOSS].flatMap((g) => g.lines.map((l) => [g.title, l.label, f[l.key].cy, f[l.key].py])); },
      empty: 'Read or type the financial statements first.',
    }] },
  ],
  attachments: (c) => [
    { name: 'XBRL instance document (validated with MCA’s XBRL validation tool)' },
    { name: 'Human-readable PDF of the XBRL document (from the validation tool)' },
    ...aoc4.attachments(c).filter((a) => !a.name.startsWith('Financial statements')),
  ],
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

// ---- DPT-3 ------------------------------------------------------------------------------------------------------
const money = (key: string, label: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ key, label, input: { scope: 'filing', type: 'number', default: '0' }, ...extra });
const dpt3: FormSpec = {
  form: 'DPT-3', title: 'Return of deposits / particulars of money not treated as deposits',
  note: 'Figures as on 31 March, from the audited balance sheet. Private companies: amounts from members and directors are shown separately.',
  parts: (c) => [
    { title: 'Company', fields: [...company(), { key: 'asOn', label: 'Return as on', value: (c) => fmt(fyEnd(c.ob.fy)) }] },
    { title: 'Net worth (as per the latest audited balance sheet)', fields: [
      { key: 'paidAmt', label: 'Paid-up share capital (₹)', value: (c) => num(c.client.paidUpCapital), fixAt: 'details' },
      money('freeReserves', 'Free reserves (₹)'), money('securitiesPremium', 'Securities premium (₹)'),
      money('netWorth', 'Net worth (₹)', { input: { scope: 'filing', type: 'number' } }),
    ] },
    { title: 'Particulars of receipts not considered as deposits (outstanding as on 31 March)', fields: [
      money('fromDirectors', 'Amount received from directors (₹)', { help: 'Needs a written declaration that it is not from borrowed funds.' }),
      money('fromRelatives', 'Amount received from relatives of directors (₹)', { show: () => c.client.companyType === 'PRIVATE' }),
      money('fromMembers', 'Amount received from members (₹)', { show: () => c.client.companyType === 'PRIVATE' }),
      money('fromCompanies', 'Amount received from other companies (₹)'),
      money('fromBanks', 'Loans from banks / financial institutions (₹)'),
      money('advances', 'Advances for supply of goods / services (₹)'),
      money('others', 'Any other amount not treated as deposit (₹)'),
      { key: 'total', label: 'Total (₹)', value: (c) => num(['fromDirectors', 'fromRelatives', 'fromMembers', 'fromCompanies', 'fromBanks', 'advances', 'others'].reduce((t, k) => t + Number(c.formData[k] ?? 0), 0)) },
    ] },
    { title: 'Deposits', fields: [
      { key: 'acceptsDeposits', label: 'Whether the company has accepted deposits', input: { scope: 'filing', type: 'select', options: ['No', 'Yes'], default: 'No' } },
      money('depositsOutstanding', 'Deposits outstanding (₹)', { show: () => c.formData.acceptsDeposits === 'Yes' }),
    ] },
  ],
  attachments: (c) => [
    ...(c.formData.acceptsDeposits === 'Yes' ? [{ name: 'Auditor’s certificate', why: 'Required when the return covers deposits' }, { name: 'List of depositors' }] : []),
    { name: 'Copy of trust deed / instrument, if any', why: 'Only where applicable' },
  ],
};

// ---- MSME-1 -----------------------------------------------------------------------------------------------------
const msme1: FormSpec = {
  form: 'MSME-1', title: 'Outstanding dues to micro and small enterprises',
  note: 'Half-yearly. List each micro or small supplier unpaid for more than 45 days from acceptance of goods / services.',
  parts: (c) => [
    { title: 'Company', fields: company() },
    { title: 'Return period', fields: [
      { key: 'period', label: 'Return for the half-year', input: { scope: 'filing', type: 'select', options: ['April to September', 'October to March'], default: c.ob.dueDate.slice(5, 7) === '04' ? 'October to March' : 'April to September' } },
      { key: 'fyOf', label: 'Financial year', value: (c) => fyLabel(c.ob.fy) },
    ] },
    { title: 'Dues', fields: [
      { key: 'suppliers', label: 'Number of micro / small suppliers with dues over 45 days', input: { scope: 'filing', type: 'number' } },
      money('amountDue', 'Amount due to them (₹)', { input: { scope: 'filing', type: 'number' } }),
      { key: 'reason', label: 'Reason for delay in payment', input: { scope: 'filing' } },
      { key: 'supplierList', label: 'Each supplier: name, PAN, amount due, date due (one per line)', input: { scope: 'filing' }, help: 'Entered supplier by supplier in the form.', optional: true },
    ] },
  ],
  attachments: () => [],
};

// ---- CHG-1 / CHG-4 ----------------------------------------------------------------------------------------------
const NATURE: Record<string, string> = { HYPOTHECATION: 'Hypothecation', MORTGAGE: 'Mortgage', PLEDGE: 'Pledge', LIEN: 'Lien', OTHER: 'Others' };
/** The charge this filing is about: the one created, modified or satisfied on the event date. */
const chargeOf = (c: FormCtx, kind: 'create' | 'satisfy') => (c.charges ?? []).find((x) => (kind === 'satisfy' ? x.satisfiedOn : (x.createdOn === c.ob.eventDate ? x.createdOn : x.modifiedOn)) === c.ob.eventDate) ?? null;
const chg1: FormSpec = {
  form: 'CHG-1', title: 'Creation / modification of charge',
  note: 'Within 30 days of creation; up to 60 more days with additional fees. Record the charge in the client’s register of charges — the details below come from it.',
  parts: (c) => {
    const ch = chargeOf(c, 'create');
    const modification = !!ch && ch.modifiedOn === c.ob.eventDate && ch.createdOn !== c.ob.eventDate;
    return [
      { title: 'Company', fields: company() },
      { title: 'Charge', fields: [
        { key: 'purpose', label: 'Form filed for', value: () => (ch ? (modification ? 'Modification of charge' : 'Creation of charge') : null), help: 'Add the charge to Registers → Charges.', fixAt: 'details' },
        { key: 'chargeId', label: 'Charge ID (for a modification)', value: () => ch?.chargeId, show: () => modification },
        { key: 'eventDate', label: modification ? 'Date of the instrument modifying the charge' : 'Date of the instrument creating the charge', value: (c) => fmt(c.ob.eventDate) },
        { key: 'nature', label: 'Type of charge', value: () => (ch?.nature ? NATURE[ch.nature] ?? ch.nature : null) },
        { key: 'holder', label: 'Name of the charge holder', aliases: ['Name of the charge-holder'], value: () => ch?.holder },
        { key: 'holderAddress', label: 'Address of the charge holder', value: () => ch?.holderAddress },
        { key: 'holderCategory', label: 'Category of charge holder', input: { scope: 'filing', type: 'select', options: ['Scheduled bank', 'Financial institution', 'NBFC', 'Others'], default: 'Scheduled bank' } },
        { key: 'amount', label: 'Amount secured by the charge (₹)', value: () => num(ch?.amount) },
        { key: 'property', label: 'Short particulars of the property charged', value: () => ch?.property },
        { key: 'instrument', label: 'Brief description of the instrument', value: () => ch?.instrument, optional: true },
        { key: 'terms', label: 'Rate of interest, repayment terms, margin', value: () => ch?.terms, optional: true },
        { key: 'consortium', label: 'Whether consortium / multiple banking', input: { scope: 'filing', type: 'select', options: ['No', 'Yes'], default: 'No' } },
        { key: 'modification', label: 'Particulars of the modification', value: () => ch?.modification, show: () => modification },
      ] },
    ];
  },
  attachments: () => [{ name: 'Instrument creating / modifying the charge (certified copy)' }, { name: 'Particulars of all modifications, if any', why: 'Only if the charge was modified' }],
};
const chg4: FormSpec = {
  form: 'CHG-4', title: 'Satisfaction of charge',
  note: 'Within 30 days of payment in full. The charge holder also signs the form with its DSC.',
  parts: (c) => {
    const ch = chargeOf(c, 'satisfy');
    return [
      { title: 'Company', fields: company() },
      { title: 'Charge satisfied', fields: [
        { key: 'chargeId', label: 'Charge ID', value: () => ch?.chargeId, help: 'From the register of charges (MCA index of charges).' },
        { key: 'holder', label: 'Name of the charge holder', value: () => ch?.holder },
        { key: 'createdOn', label: 'Date of creation of the charge', value: () => fmt(ch?.createdOn) },
        { key: 'amount', label: 'Amount secured (₹)', value: () => num(ch?.amount) },
        { key: 'satisfiedOn', label: 'Date of satisfaction', value: (c) => fmt(c.ob.eventDate) },
        { key: 'full', label: 'Satisfied in full', input: { scope: 'filing', type: 'select', options: ['Yes', 'No — part'], default: 'Yes' } },
      ] },
    ];
  },
  attachments: () => [{ name: 'Letter / NOC from the charge holder confirming payment in full' }],
};

// ---- MGT-14 / SH-7 / INC-22: from the meeting that passed the resolution ---------------------------------------
const MEETING: Record<string, string> = { BOARD: 'Board meeting', AGM: 'Annual general meeting', EGM: 'Extraordinary general meeting' };
const RES: Record<string, string> = { BOARD: 'Board resolution', ORDINARY: 'Ordinary resolution', SPECIAL: 'Special resolution', NONE: '—' };
const meetingFields = (): FieldSpec[] => [
  { key: 'meetingType', label: 'Type of meeting', value: (c) => (c.fromMeeting ? MEETING[c.fromMeeting.type] : null), help: 'Filled when the resolution was passed in a meeting recorded in ComplyDesk.' },
  { key: 'meetingDate', label: 'Date of passing the resolution', aliases: ['Date of meeting'], value: (c) => fmt(c.fromMeeting?.date ?? c.ob.eventDate) },
];
const mgt14: FormSpec = {
  form: 'MGT-14', title: 'Filing of resolutions with the Registrar',
  note: 'Special resolutions (and some board resolutions of public companies). Private companies are exempt from filing board resolutions under Sec 179(3).',
  parts: (c) => {
    const items = c.fromMeeting?.items ?? [];
    return [
      { title: 'Company', fields: company() },
      { title: 'Resolution', fields: [
        ...meetingFields(),
        { key: 'resolutions', label: 'Number of resolutions', value: () => items.length || null, input: items.length ? undefined : { scope: 'filing', type: 'number', default: '1' } },
        { key: 'resType', label: 'Type of resolution', value: () => (items[0] ? RES[items[0].resolutionType] : null) },
        { key: 'subject', label: 'Subject matter of the resolution', value: () => items.map((i) => i.title).join('; ') || null },
        { key: 'section', label: 'Section of the Act under which passed', input: { scope: 'filing' }, help: 'e.g. 14 (alteration of articles), 13 (MOA), 180, 186.' },
      ] },
    ];
  },
  attachments: (c) => [
    { name: 'Certified true copy of each resolution', why: 'Print from the meeting: Certified true copy' },
    ...(c.fromMeeting && c.fromMeeting.type !== 'BOARD' ? [{ name: 'Explanatory statement (Sec 102) and notice of the meeting' }] : []),
    { name: 'Altered memorandum / articles, if altered' },
  ],
};
const sh7: FormSpec = {
  form: 'SH-7', title: 'Alteration of share capital',
  note: 'Update the client’s authorised capital in Details after filing — the "after" figure comes from there.',
  parts: (c) => [
    { title: 'Company', fields: company() },
    { title: 'Alteration', fields: [
      ...meetingFields(),
      { key: 'purpose', label: 'Purpose', input: { scope: 'filing', type: 'select', options: ['Increase in authorised capital', 'Consolidation / division', 'Conversion', 'Cancellation of unissued shares', 'Redemption of preference shares'], default: 'Increase in authorised capital' } },
      money('authBefore', 'Authorised capital before the alteration (₹)', { input: { scope: 'filing', type: 'number' } }),
      { key: 'authAfter', label: 'Authorised capital after the alteration (₹)', value: (c) => num(c.client.authorisedCapital), fixAt: 'details' },
      { key: 'increase', label: 'Increase (₹)', value: (c) => (c.formData.authBefore && c.client.authorisedCapital ? num(Number(c.client.authorisedCapital) - Number(c.formData.authBefore)) : null) },
      { key: 'faceValue', label: 'Nominal value per share (₹)', value: (c) => faceValue(c), fixAt: 'shareholders' },
    ] },
  ],
  attachments: () => [{ name: 'Certified copy of the resolution' }, { name: 'Altered memorandum of association' }, { name: 'Altered articles of association, if applicable' }],
};
const inc22: FormSpec = {
  form: 'INC-22', title: 'Situation of registered office / change',
  note: 'Within 30 days of the change. Outside the city (same RoC) needs a special resolution and MGT-14 too.',
  parts: () => [
    { title: 'Company', fields: [...company().filter((f) => f.key !== 'regOffice')] },
    { title: 'New registered office', fields: [
      ...meetingFields(),
      { key: 'purpose', label: 'Purpose', input: { scope: 'filing', type: 'select', options: ['Change within the local limits of the city', 'Change outside the local limits, within the same RoC', 'Change from one RoC to another (same state)'], default: 'Change within the local limits of the city' } },
      { key: 'newAddress', label: 'Address of the new registered office', value: (c) => c.client.registeredOffice, fixAt: 'details', help: 'From the client’s Details — update it there first.' },
      { key: 'effectiveFrom', label: 'With effect from', value: (c) => fmt(c.ob.eventDate) },
      { key: 'ownership', label: 'Premises', input: { scope: 'filing', type: 'select', options: ['Owned by the company', 'Owned by a director (not taken on lease)', 'Taken on lease', 'Other'] } },
      { key: 'policeStation', label: 'Jurisdictional police station', input: { scope: 'filing' } },
      { key: 'geo', label: 'Latitude and longitude of the office', input: { scope: 'filing' }, help: 'Needed on V3 — a geo-tagged photo of the office is also attached.' },
    ] },
  ],
  attachments: (c) => [
    { name: 'Proof of registered office (conveyance / lease deed / rent agreement)' },
    { name: 'Utility bill not older than two months' },
    ...(c.formData.ownership && c.formData.ownership !== 'Owned by the company' ? [{ name: 'NOC from the owner of the premises' }] : []),
    { name: 'Copy of the board / special resolution' },
    { name: 'Geo-tagged photograph of the office' },
  ],
};

/** Which pack a filing gets, by its rule code. */
export const FORM_SPECS: Record<string, FormSpec> = {
  MGT7: annualReturn('MGT-7'), MGT7A: annualReturn('MGT-7A'), MGT7A_OPC: annualReturn('MGT-7A'),
  AOC4: aoc4, AOC4_OPC: aoc4, AOC4_XBRL: aoc4Xbrl, DIR12: dir12, ADT1: adt1, PAS3: pas3,
  DPT3: dpt3, MSME1: msme1, CHG1: chg1, CHG4: chg4, MGT14: mgt14, SH7: sh7, INC22: inc22,
};
export const specFor = (ruleCode: string) => FORM_SPECS[ruleCode] ?? null;
