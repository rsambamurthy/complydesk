/**
 * Pure: checks an entry against its register's fields, builds every register's view (columns + rows, formatted the same
 * for screen, print and Excel), and works out which event filings an entry records.
 */
import { REGISTERS, type RegField, type RegisterSpec, type Names } from './specs.js';

export interface Person { id: string; name: string; din: string | null; pan: string | null; designation: string; appointedOn: string | null; ceasedOn: string | null; email?: string | null; fatherName?: string | null; address?: string | null; dob?: string | null; nationality?: string | null; occupation?: string | null; membershipNo?: string | null }
export interface Member { id: string; name: string; pan: string | null; folio: string | null; shareClass: string; shares: number; faceValue: string; fatherName?: string | null; address?: string | null; email?: string | null; occupation?: string | null; nationality?: string | null; becameMemberOn?: string | null; ceasedOn?: string | null }
export interface Entry { id: string; register: string; entryDate: string; closedOn: string | null; data: Record<string, any> }
export interface RegCtx { people: Person[]; members: Member[]; entries: Entry[]; designationLabel?: (d: string) => string }

export interface Column { key: string; label: string; detailOnly?: boolean }
export interface Row { id: string; cells: Record<string, string>; closed?: boolean; warn?: string; source?: 'person' | 'member' | 'entry' }
export interface RegisterView { code: string; title: string; short: string; law: string; form?: string; about: string; kind: 'derived' | 'entries'; columns: Column[]; rows: Row[]; warnings: string[] }

const D = /^(\d{4})-(\d{2})-(\d{2})$/;
export const fmtDate = (v: unknown) => { const m = typeof v === 'string' ? D.exec(v) : null; return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
export const fmtMoney = (v: unknown) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? '' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
export const fmtNum = (v: unknown) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('en-IN'));

export const namesFrom = (ctx: Pick<RegCtx, 'people' | 'members'>): Names => ({
  person: (id) => ctx.people.find((p) => p.id === id)?.name ?? '',
  member: (id) => ctx.members.find((m) => m.id === id)?.name ?? '',
});

export const fieldShown = (f: RegField, d: Record<string, any>) => !f.when || f.when.in.includes(String(d[f.when.key] ?? ''));

function cell(f: RegField, v: any, names: Names) {
  switch (f.type) {
    case 'date': return fmtDate(v);
    case 'money': return fmtMoney(v);
    case 'number': return fmtNum(v);
    case 'select': return f.options?.find((o) => o.value === v)?.label ?? (v ?? '');
    case 'person': return names.person(v);
    case 'member': return names.member(v);
    default: return v === null || v === undefined ? '' : String(v);
  }
}

/** Checks and cleans an entry. Returns the clean data, or field errors ({ key: message }). */
export function checkEntry(spec: RegisterSpec, raw: Record<string, any>, ctx: Pick<RegCtx, 'people' | 'members'>) {
  const data: Record<string, any> = {};
  const errors: Record<string, string> = {};
  for (const f of spec.fields ?? []) {
    let v = raw?.[f.key];
    if (typeof v === 'string') v = v.trim();
    if (v === '' || v === undefined) v = null;
    if (!fieldShown(f, { ...raw })) { continue; }
    if (v === null) { if (f.required) errors[f.key] = `Enter ${f.label.toLowerCase().replace(/ \(.*\)$/, '')}`; else data[f.key] = null; continue; }
    switch (f.type) {
      case 'date': if (!D.test(String(v))) errors[f.key] = 'Enter a date'; else data[f.key] = v; break;
      case 'number': case 'money': {
        const n = Number(String(v).replace(/[₹,\s]/g, ''));
        if (!Number.isFinite(n) || n < 0) errors[f.key] = 'Enter a number';
        else if (/shares|distinctive/i.test(f.key) && !Number.isInteger(n)) errors[f.key] = 'Whole number';
        else data[f.key] = n;
        break;
      }
      case 'select': if (!f.options?.some((o) => o.value === v)) errors[f.key] = 'Pick one'; else data[f.key] = v; break;
      case 'person': if (!ctx.people.some((p) => p.id === v)) errors[f.key] = 'Pick a director or KMP of this company'; else data[f.key] = v; break;
      case 'member': if (!ctx.members.some((m) => m.id === v)) errors[f.key] = 'Pick a member of this company'; else data[f.key] = v; break;
      default: data[f.key] = String(v).slice(0, 4000);
    }
  }
  if (spec.code === 'SHARE_LEDGER') {
    if (data.shares !== undefined && data.shares !== null && data.shares <= 0) errors.shares = 'Number of shares';
    if (data.distinctiveFrom != null && data.distinctiveTo != null) {
      if (data.distinctiveTo < data.distinctiveFrom) errors.distinctiveTo = 'Must be at or after "from"';
      else if (data.shares && data.distinctiveTo - data.distinctiveFrom + 1 !== data.shares) errors.distinctiveTo = `From–to covers ${data.distinctiveTo - data.distinctiveFrom + 1} shares, not ${data.shares}`;
    }
    if (data.toMember && data.fromMember && data.toMember === data.fromMember) errors.toMember = 'Transferor and transferee are the same';
  }
  if (spec.closeKey && spec.dateKey && data[spec.closeKey] && data[spec.dateKey] && data[spec.closeKey] < data[spec.dateKey]) errors[spec.closeKey] = 'Can’t be before the date of creation';
  return { data, errors, ok: !Object.keys(errors).length };
}

/** Event filings an entry records that its previous version didn't (new or changed dates). */
export function newEvents(spec: RegisterSpec, data: Record<string, any>, before: Record<string, any> | null, names: Names) {
  return (spec.events ?? [])
    .filter((e) => data[e.dateKey] && (!e.when || e.when.in.includes(String(data[e.when.key]))) && data[e.dateKey] !== before?.[e.dateKey])
    .map((e) => ({ ruleCode: e.ruleCode, eventDate: data[e.dateKey] as string, label: e.label(data, names).slice(0, 200) }));
}

/** Net shares per member and class from the share register (allotments and transfers in, less transfers out / buy-backs). */
export function ledgerHoldings(entries: Entry[]) {
  const net = new Map<string, number>();
  const add = (m: string | undefined, cls: string, n: number) => { if (m) net.set(`${m}|${cls}`, (net.get(`${m}|${cls}`) ?? 0) + n); };
  for (const e of entries.filter((x) => x.register === 'SHARE_LEDGER')) {
    const d = e.data; const n = Number(d.shares) || 0; const cls = d.shareClass ?? 'EQUITY';
    if (d.kind !== 'BUYBACK') add(d.toMember, cls, n);
    if (d.kind !== 'ALLOTMENT') add(d.fromMember, cls, -n);
  }
  return net;
}

const MEMBER_COLS: Column[] = [
  { key: 'folio', label: 'Folio' }, { key: 'name', label: 'Name of member' }, { key: 'fatherName', label: 'Father’s / mother’s / spouse’s name', detailOnly: true },
  { key: 'address', label: 'Address' }, { key: 'email', label: 'Email', detailOnly: true }, { key: 'pan', label: 'PAN' },
  { key: 'occupation', label: 'Occupation', detailOnly: true }, { key: 'nationality', label: 'Nationality', detailOnly: true },
  { key: 'shareClass', label: 'Class' }, { key: 'shares', label: 'Shares held' }, { key: 'faceValue', label: 'Face value' }, { key: 'paidUp', label: 'Amount paid up' },
  { key: 'becameMemberOn', label: 'Date of becoming member' }, { key: 'ceasedOn', label: 'Date of cessation' }, { key: 'movements', label: 'Allotments / transfers', detailOnly: true },
];

const PERSON_COLS: Column[] = [
  { key: 'name', label: 'Name' }, { key: 'din', label: 'DIN / membership no.' }, { key: 'pan', label: 'PAN', detailOnly: true },
  { key: 'fatherName', label: 'Father’s / mother’s / spouse’s name', detailOnly: true }, { key: 'address', label: 'Address', detailOnly: true },
  { key: 'dob', label: 'Date of birth', detailOnly: true }, { key: 'nationality', label: 'Nationality', detailOnly: true }, { key: 'occupation', label: 'Occupation', detailOnly: true },
  { key: 'designation', label: 'Office held' }, { key: 'appointedOn', label: 'Date of appointment' }, { key: 'ceasedOn', label: 'Date of cessation' },
  { key: 'shares', label: 'Shares held in the company' }, { key: 'email', label: 'Email', detailOnly: true },
];

function members(spec: RegisterSpec, ctx: RegCtx): RegisterView {
  const names = namesFrom(ctx);
  const ledger = ctx.entries.filter((e) => e.register === 'SHARE_LEDGER');
  const net = ledgerHoldings(ledger);
  const warnings: string[] = [];
  const rows: Row[] = [...ctx.members].sort((a, b) => (a.folio ?? '').localeCompare(b.folio ?? '', 'en', { numeric: true }) || a.name.localeCompare(b.name)).map((m) => {
    const mine = ledger.filter((e) => e.data.toMember === m.id || e.data.fromMember === m.id).sort((a, b) => a.entryDate.localeCompare(b.entryDate));
    const movements = mine.map((e) => {
      const d = e.data; const out = d.fromMember === m.id && d.kind !== 'ALLOTMENT';
      const other = out ? names.member(d.toMember) : names.member(d.fromMember);
      const what = d.kind === 'ALLOTMENT' ? 'Allotted' : d.kind === 'BUYBACK' ? 'Bought back' : out ? `${d.kind === 'TRANSMISSION' ? 'Transmitted' : 'Transferred'} to ${other}` : `${d.kind === 'TRANSMISSION' ? 'Transmission' : 'Transfer'} from ${other}`;
      return `${fmtDate(d.date)}: ${what} ${fmtNum(d.shares)}${d.distinctiveFrom ? ` (${d.distinctiveFrom}–${d.distinctiveTo})` : ''}${d.certificateNo ? `, cert. ${d.certificateNo}` : ''}`;
    }).join('; ');
    let warn: string | undefined;
    const n = net.get(`${m.id}|${m.shareClass}`);
    if (mine.length && n !== undefined && n !== m.shares) warn = `Allotments and transfers add up to ${fmtNum(n)} shares; the holding says ${fmtNum(m.shares)}.`;
    if (warn) warnings.push(`${m.name}: ${warn}`);
    if (!m.address) warnings.push(`${m.name}: address missing`);
    return {
      id: m.id, source: 'member', closed: !!m.ceasedOn, warn,
      cells: {
        folio: m.folio ?? '', name: m.name, fatherName: m.fatherName ?? '', address: m.address ?? '', email: m.email ?? '', pan: m.pan ?? '',
        occupation: m.occupation ?? '', nationality: m.nationality ?? '', shareClass: m.shareClass === 'PREFERENCE' ? 'Preference' : 'Equity',
        shares: fmtNum(m.shares), faceValue: fmtMoney(m.faceValue), paidUp: fmtMoney(m.shares * Number(m.faceValue)),
        becameMemberOn: fmtDate(m.becameMemberOn), ceasedOn: fmtDate(m.ceasedOn), movements,
      },
    };
  });
  return view(spec, MEMBER_COLS, rows, warnings);
}

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z]/g, '');

function directors(spec: RegisterSpec, ctx: RegCtx): RegisterView {
  const warnings: string[] = [];
  const rows: Row[] = [...ctx.people].sort((a, b) => Number(!!a.ceasedOn) - Number(!!b.ceasedOn) || (a.appointedOn ?? '').localeCompare(b.appointedOn ?? '')).map((p) => {
    const held = ctx.members.filter((m) => (p.pan && m.pan === p.pan) || (!m.pan && norm(m.name) === norm(p.name)));
    const shares = held.map((m) => `${fmtNum(m.shares)} ${m.shareClass === 'PREFERENCE' ? 'preference' : 'equity'}`).join(', ') || 'Nil';
    const missing = ['address', 'fatherName', 'dob'].filter((k) => !(p as any)[k]);
    if (missing.length) warnings.push(`${p.name}: ${missing.map((k) => ({ address: 'address', fatherName: 'father’s name', dob: 'date of birth' } as any)[k]).join(', ')} missing`);
    return {
      id: p.id, source: 'person', closed: !!p.ceasedOn,
      cells: {
        name: p.name, din: p.din ?? p.membershipNo ?? '', pan: p.pan ?? '', fatherName: p.fatherName ?? '', address: p.address ?? '', dob: fmtDate(p.dob),
        nationality: p.nationality ?? '', occupation: p.occupation ?? '', designation: ctx.designationLabel?.(p.designation) ?? p.designation,
        appointedOn: fmtDate(p.appointedOn), ceasedOn: fmtDate(p.ceasedOn), shares, email: p.email ?? '',
      },
    };
  });
  return view(spec, PERSON_COLS, rows, warnings);
}

function entries(spec: RegisterSpec, ctx: RegCtx): RegisterView {
  const names = namesFrom(ctx);
  const cols: Column[] = [{ key: '_no', label: 'Sl.' }, ...(spec.fields ?? []).map((f) => ({ key: f.key, label: f.label.replace(/ \(₹\)$/, ''), detailOnly: f.detailOnly }))];
  const rows: Row[] = ctx.entries.filter((e) => e.register === spec.code).sort((a, b) => a.entryDate.localeCompare(b.entryDate)).map((e, i) => ({
    id: e.id, source: 'entry', closed: !!e.closedOn,
    cells: Object.fromEntries([['_no', String(i + 1)], ...(spec.fields ?? []).map((f) => [f.key, fieldShown(f, e.data) ? cell(f, e.data[f.key], names) : '—'])]),
  }));
  return view(spec, cols, rows, []);
}

const view = (spec: RegisterSpec, columns: Column[], rows: Row[], warnings: string[]): RegisterView =>
  ({ code: spec.code, title: spec.title, short: spec.short, law: spec.law, form: spec.form, about: spec.about, kind: spec.kind, columns, rows, warnings });

export function buildRegister(spec: RegisterSpec, ctx: RegCtx): RegisterView {
  if (spec.code === 'MEMBERS') return members(spec, ctx);
  if (spec.code === 'DIRECTORS') return directors(spec, ctx);
  return entries(spec, ctx);
}

export const buildAll = (ctx: RegCtx) => REGISTERS.map((s) => buildRegister(s, ctx));
