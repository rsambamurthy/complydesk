/**
 * The reviewer's second pair of eyes — pure functions, tested.
 * recordChecks: what our own records say about a filing before it goes to MCA.
 * compareDraft: values read from the draft form (by AI) compared with our records — the comparing is code, not AI.
 */
export type Level = 'error' | 'warn' | 'ok';
export interface Finding { level: Level; text: string; source: 'records' | 'draft' }

export interface Ctx {
  today: string;
  ob: { ruleCode: string; form: string; fy: number; dueDate: string; eventDate: string | null; personId: string | null; status: string };
  client: { cin: string; name: string; companyType: string; smallCompany: boolean; paidUpCapital: string | null; authorisedCapital: string | null; flags: Record<string, boolean> };
  people: { id: string; name: string; din: string | null; designation: string; appointedOn: string | null; ceasedOn: string | null; dscExpiry: string | null }[];
  shareholders: { shares: number; faceValue: string }[];
  auditors: { firmName: string; frn: string | null; appointedOn: string | null; termFromFy: number | null; termToFy: number | null; current: boolean }[];
  agmDate: string | null;
  /** Board meetings marked held in the filing's FY. */
  boardMeetingsHeld: number;
  /** Directors whose DIR-3 KYC is overdue (DIN deactivated until filed). */
  kycOverdue: string[];
  attachments: number;
}

const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const isDirector = (d: string) => d.includes('DIRECTOR');
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const ANNUAL = ['MGT7', 'MGT7A', 'MGT7A_OPC', 'AOC4', 'AOC4_OPC'];
const RETURNS = ['MGT7', 'MGT7A', 'MGT7A_OPC'];

export function recordChecks(c: Ctx): Finding[] {
  const out: Finding[] = [];
  const add = (level: Level, text: string) => out.push({ level, text, source: 'records' });
  const code = c.ob.ruleCode;
  const active = c.people.filter((p) => !p.ceasedOn);
  const directors = active.filter((p) => isDirector(p.designation));

  // Someone has to sign it.
  const signers = directors.filter((p) => p.din && !c.kycOverdue.includes(p.id) && p.dscExpiry && p.dscExpiry >= c.today);
  if (!signers.length) add('error', 'No director can sign: none has a DIN with KYC up to date and a valid DSC on file.');
  else add('ok', `Can be signed by ${signers.map((p) => p.name).join(', ')}.`);
  for (const id of c.kycOverdue) { const p = c.people.find((x) => x.id === id); if (p && !p.ceasedOn) add('warn', `${p.name}’s DIR-3 KYC is overdue — their DIN is deactivated until it’s filed.`); }
  for (const p of directors) if (p.dscExpiry && p.dscExpiry < c.today) add('warn', `${p.name}’s DSC expired on ${fmt(p.dscExpiry)}.`);

  if (c.ob.status !== 'FILED' && c.ob.dueDate < c.today) add('warn', `Due ${fmt(c.ob.dueDate)} — ${days(c.ob.dueDate, c.today)} days late; additional fees apply.`);
  if (!c.attachments) add('warn', 'No documents attached (resolution, financial statements, consent…).');

  // Annual return / financial statements
  if (ANNUAL.includes(code)) {
    if (!c.agmDate) add('warn', `AGM date for FY ${c.ob.fy}-${String((c.ob.fy + 1) % 100).padStart(2, '0')} isn’t recorded — the due date is an estimate.`);
    else add('ok', `AGM held on ${fmt(c.agmDate)}.`);
    const cur = c.auditors.find((a) => a.current);
    if (!cur) add('warn', 'No current statutory auditor on file.');
    else if (!cur.frn) add('warn', `Auditor ${cur.firmName}: no firm registration number (FRN) on file.`);
  }
  if (RETURNS.includes(code)) {
    const small = c.client.smallCompany || c.client.companyType === 'OPC';
    if (code === 'MGT7' && small) add('error', 'This company is a small company / OPC — the return is MGT-7A, not MGT-7.');
    if (code !== 'MGT7' && !small) add('error', 'This company isn’t a small company / OPC — the return is MGT-7, not MGT-7A.');
    const need = small ? 2 : 4;
    if (c.boardMeetingsHeld < need) add('warn', `Only ${c.boardMeetingsHeld} board meeting${c.boardMeetingsHeld === 1 ? '' : 's'} marked held this year — at least ${need} needed.`);
    else add('ok', `${c.boardMeetingsHeld} board meetings held this year.`);
  }
  if ([...RETURNS, 'PAS3', 'SH7'].includes(code)) {
    const value = c.shareholders.reduce((s, x) => s + x.shares * Number(x.faceValue), 0);
    const paid = Number(c.client.paidUpCapital ?? 0);
    if (!c.shareholders.length) add('warn', 'Register of members is empty.');
    else if (!paid) add('warn', 'Paid-up capital isn’t recorded in the client’s details.');
    else if (Math.abs(value - paid) > 0.5) add('error', `Shares held add up to ${rupees(value)} but paid-up capital is ${rupees(paid)}.`);
    else add('ok', `Shareholding matches paid-up capital (${rupees(paid)}).`);
  }

  // Event filings
  if (code === 'DIR12') {
    const p = c.people.find((x) => x.id === c.ob.personId);
    if (!p) add('warn', 'Not linked to a director / KMP — link the person so the form matches the register.');
    else {
      if (isDirector(p.designation) && !p.din) add('error', `${p.name} has no DIN on file.`);
      const ev = c.ob.eventDate;
      if (ev && p.appointedOn !== ev && p.ceasedOn !== ev) add('warn', `${p.name}: neither the appointment date (${p.appointedOn ? fmt(p.appointedOn) : '—'}) nor the cessation date (${p.ceasedOn ? fmt(p.ceasedOn) : '—'}) is the event date ${fmt(ev)}.`);
      else if (ev) add('ok', `${p.name}’s ${p.ceasedOn === ev ? 'cessation' : 'appointment'} on ${fmt(ev)} matches the register.`);
    }
    if (directors.length < (c.client.companyType === 'OPC' ? 1 : 2)) add('error', `Only ${directors.length} director${directors.length === 1 ? '' : 's'} in office — a private company needs at least 2.`);
  }
  if (code === 'ADT1') {
    const cur = c.auditors.find((a) => a.current);
    if (!cur) add('error', 'No current auditor on file to report.');
    else {
      if (!cur.frn) add('warn', `${cur.firmName}: FRN missing.`);
      if (!cur.termFromFy || !cur.termToFy) add('warn', `${cur.firmName}: term years missing.`);
      else add('ok', `${cur.firmName}, term FY ${cur.termFromFy} to FY ${cur.termToFy}.`);
    }
  }
  if (code === 'DPT3' && !c.client.flags.depositsOrLoans) add('warn', 'The client isn’t marked as having outstanding loans / money received — check whether DPT-3 is needed.');
  if (code === 'MSME1' && !c.client.flags.msmeDues) add('warn', 'The client isn’t marked as owing MSME suppliers beyond 45 days — check whether MSME-1 is needed.');
  return out;
}

/** What the AI read from the draft form. Every field may be missing (null). */
export interface Draft {
  form?: string | null; cin?: string | null; companyName?: string | null; fy?: number | null; agmDate?: string | null;
  paidUpCapital?: string | null; authorisedCapital?: string | null; totalShares?: number | null;
  directors?: { name: string; din: string | null }[]; auditor?: { firmName: string | null; frn: string | null } | null;
  eventDate?: string | null; person?: { name: string | null; din: string | null } | null;
}

const squash = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, '');
const sameName = (a: string, b: string) => squash(a.replace(/\b(private|pvt|limited|ltd)\b\.?/gi, '')) === squash(b.replace(/\b(private|pvt|limited|ltd)\b\.?/gi, ''));

export function compareDraft(d: Draft, c: Ctx): Finding[] {
  const out: Finding[] = [];
  const add = (level: Level, text: string) => out.push({ level, text, source: 'draft' });
  const same = (label: string, draft: string | null | undefined, ours: string | null | undefined, show: (v: string) => string = (v) => v, level: Level = 'error') => {
    if (!draft) return;
    if (!ours) add('warn', `${label} in the draft is ${show(draft)}; nothing on file to compare.`);
    else if (draft !== ours) add(level, `${label}: draft says ${show(draft)}, records say ${show(ours)}.`);
    else add('ok', `${label} matches (${show(ours)}).`);
  };
  if (d.form && !squash(d.form).includes(squash(c.ob.form)) && !squash(c.ob.form).includes(squash(d.form))) add('error', `This draft is ${d.form}, not ${c.ob.form}.`);
  same('CIN', d.cin?.toUpperCase().replace(/\s/g, ''), c.client.cin);
  if (d.companyName) sameName(d.companyName, c.client.name) ? add('ok', 'Company name matches.') : add('warn', `Company name: draft says “${d.companyName}”, records say “${c.client.name}”.`);
  if (d.fy && ANNUAL.includes(c.ob.ruleCode) && d.fy !== c.ob.fy) add('error', `Financial year: draft is for FY ${d.fy}-${String((d.fy + 1) % 100).padStart(2, '0')}, the filing is for FY ${c.ob.fy}-${String((c.ob.fy + 1) % 100).padStart(2, '0')}.`);
  same('AGM date', d.agmDate, c.agmDate, fmt);
  const money = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? null : String(Math.round(Number(v))));
  same('Paid-up capital', money(d.paidUpCapital), money(c.client.paidUpCapital), (v) => rupees(Number(v)));
  same('Authorised capital', money(d.authorisedCapital), money(c.client.authorisedCapital), (v) => rupees(Number(v)));
  if (d.totalShares && c.shareholders.length) {
    const ours = c.shareholders.reduce((s, x) => s + x.shares, 0);
    d.totalShares === ours ? add('ok', `Total shares match (${ours.toLocaleString('en-IN')}).`) : add('error', `Total shares: draft says ${d.totalShares.toLocaleString('en-IN')}, register says ${ours.toLocaleString('en-IN')}.`);
  }
  if (d.directors?.length) {
    const inOffice = c.people.filter((p) => !p.ceasedOn && isDirector(p.designation));
    const dins = new Set(d.directors.map((x) => x.din).filter(Boolean));
    const extra = d.directors.filter((x) => x.din && !c.people.some((p) => p.din === x.din));
    const missing = inOffice.filter((p) => p.din && !dins.has(p.din));
    for (const x of extra) add('error', `Director ${x.name} (DIN ${x.din}) is in the draft but not in our records.`);
    for (const p of missing) add('warn', `${p.name} (DIN ${p.din}) is in office but not in the draft.`);
    if (!extra.length && !missing.length) add('ok', `Directors match (${inOffice.length}).`);
  }
  if (d.auditor?.frn) same('Auditor FRN', d.auditor.frn.toUpperCase(), c.auditors.find((a) => a.current)?.frn?.toUpperCase() ?? null);
  if (d.eventDate && c.ob.eventDate) same('Event date', d.eventDate, c.ob.eventDate, fmt);
  if (d.person?.din && c.ob.personId) same('DIN of the person', d.person.din, c.people.find((p) => p.id === c.ob.personId)?.din ?? null);
  if (!out.length) add('warn', 'Nothing in the draft could be compared — is it the filled-in form?');
  return out;
}

export const tally = (f: Finding[]) => ({ errors: f.filter((x) => x.level === 'error').length, warnings: f.filter((x) => x.level === 'warn').length });
