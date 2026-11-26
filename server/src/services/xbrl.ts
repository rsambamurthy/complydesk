/**
 * AOC-4 XBRL instance document for a filing: gathers the statements (form data fs.*), the XBRL details typed on the
 * form pack (xbrl.*) and the records (company, directors and KMP, register of members, auditor, ADT-1 SRN), then
 * xbrl/aoc4.ts builds, checks and writes it. Read only.
 */
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { db, schema, HttpError } from '../lib/core.js';
import { fyLabel } from '../compliance/dates.js';
import { figuresFromFormData } from '../financials/statements.js';
import { aoc4Instance, type Pair, type XbrlData } from '../xbrl/aoc4.js';
import { packContext } from './eforms.js';

const { obligations: o } = schema;
const num = (s: string | undefined | null) => (s === undefined || s === null || String(s).trim() === '' ? null : Number(String(s).replace(/,/g, '')));
const pair = (fd: Record<string, string>, key: string): Pair => ({ cy: num(fd[`xbrl.${key}.cy`]), py: num(fd[`xbrl.${key}.py`]) });

export async function xbrlData(tenantId: string, obligationId: string): Promise<{ data: XbrlData; fileName: string; clientId: string }> {
  const { ob, ctx, clientId } = await packContext(tenantId, obligationId);
  if (ob.ruleCode !== 'AOC4_XBRL') throw new HttpError(400, 'The XBRL instance document is for AOC-4 XBRL filings');
  const fd = (ob.formData ?? {}) as Record<string, string>;
  const pf = (ctx.profile ?? {}) as Record<string, string>;
  const c = ctx.client as any;
  const yearEnd = `${ob.fy + 1}-03-31`;
  const inOffice = (p: { appointedOn: string | null; ceasedOn: string | null }) => (!p.appointedOn || p.appointedOn <= yearEnd) && (!p.ceasedOn || p.ceasedOn > yearEnd);
  const people = ctx.people.filter(inOffice);
  const directors = people.filter((p) => p.designation.includes('DIRECTOR') && p.din);
  const boardDate = fd['xbrl.boardMeetingDate'] || null;
  const signDate = fd['xbrl.signingDate'] || boardDate;
  const dins = (fd['xbrl.signingDins'] ?? '').split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
  const signers = dins.length ? dins.map((din) => directors.find((p) => p.din === din) ?? { name: `DIN ${din}`, din, designation: 'DIRECTOR' }) : directors.slice(0, 2);
  const DESIG: Record<string, string> = { MANAGING_DIRECTOR: 'Managing Director', WHOLE_TIME_DIRECTOR: 'Whole-time Director', NOMINEE_DIRECTOR: 'Nominee Director', INDEPENDENT_DIRECTOR: 'Independent Director' };
  const kmp = (d: string) => { const p = people.find((x) => x.designation === d); return p ? { name: p.name, pan: p.pan ?? null, date: signDate } : null; };

  // Equity shares from the register of members at year end; par value from the members' face value.
  const members = ctx.shareholders.filter((s: any) => (s.shareClass ?? 'EQUITY') === 'EQUITY' && (!s.ceasedOn || s.ceasedOn > yearEnd));
  const paidUp = members.reduce((n: number, s: any) => n + Number(s.shares), 0);
  const par = members.length ? Number(members[0].faceValue) : null;
  const shares = par && paidUp ? {
    par,
    authorised: { cy: c.authorisedCapital ? Math.round(Number(c.authorisedCapital) / par) : null, py: c.authorisedCapital ? Math.round(Number(c.authorisedCapital) / par) : null },
    issued: { cy: paidUp, py: num(fd['xbrl.sharesPy']) ?? paidUp },
    paidUp: { cy: paidUp, py: num(fd['xbrl.sharesPy']) ?? paidUp },
    pyOpening: num(fd['xbrl.sharesPyOpening']),
  } : null;

  const auditor = ctx.auditors.find((a: any) => a.current) ?? null;
  const [adt1] = await db.select({ srn: o.srn }).from(o).where(and(eq(o.clientId, clientId), eq(o.ruleCode, 'ADT1'), isNotNull(o.srn))).orderBy(desc(o.filedOn)).limit(1);
  const firstYear = !!c.incorporationDate && c.incorporationDate >= `${ob.fy}-04-01`;
  const data: XbrlData = {
    fy: ob.fy, firstYear,
    company: {
      cin: c.cin, name: c.name, pan: pf.pan || null, address: c.registeredOffice ?? '', incorporationDate: c.incorporationDate ?? null,
      category: pf['xbrl.category'] || 'Company limited by shares, Indian Non-Government company', listed: false, industry: pf['xbrl.industry'] || 'Commercial and Industrial',
    },
    details: {
      rounding: fd['xbrl.rounding'] || 'Actual', employees: num(fd['xbrl.employees']), boardMeetingDate: boardDate,
      cashFlowMethod: fd['xbrl.cashFlow'] || 'Indirect Method', booksElectronic: (pf['xbrl.booksElectronic'] || 'Yes') === 'Yes', sustainabilityReport: false,
    },
    figures: figuresFromFormData(fd),
    extra: Object.fromEntries(['revProducts', 'revServices', 'revOther', 'revDuties', 'depreciationOnly', 'amortisation', 'csr', 'epsBasic', 'epsDiluted'].map((k) => [k, pair(fd, k)])),
    shares,
    signatories: {
      directors: signers.map((p: any) => ({ name: p.name, din: p.din, designation: DESIG[p.designation] ?? 'Director', date: signDate })),
      cs: kmp('CS'), cfo: kmp('CFO'),
    },
    auditor: auditor ? {
      category: 'Auditors firm', firmName: auditor.firmName, signingName: fd['xbrl.auditorSigner'] || null, frn: auditor.frn ?? null,
      membershipNo: fd['xbrl.auditorMembership'] || null, address: fd['xbrl.auditorAddress'] || null, pan: (fd['xbrl.auditorPan'] || '').toUpperCase() || null,
      adt1Srn: (fd['xbrl.adt1Srn'] || adt1?.srn || '').toUpperCase() || null, reportDate: fd['xbrl.auditReportDate'] || null, bsSignDate: fd['xbrl.auditReportDate'] || null,
    } : null,
  };
  return { data, clientId, fileName: `${c.cin}_AOC-4_XBRL_${fyLabel(ob.fy).replace(/\s/g, '')}.xml` };
}

/** The checks and coverage (for the form pack page); the XML itself only on download. */
export async function xbrlReport(tenantId: string, obligationId: string) {
  const { data, fileName, clientId } = await xbrlData(tenantId, obligationId);
  const out = aoc4Instance(data);
  return { clientId, fileName, facts: out.facts, fixes: out.fixes, issues: out.issues, coverage: out.coverage, bytes: Buffer.byteLength(out.xml) };
}
export async function xbrlXml(tenantId: string, obligationId: string) {
  const { data, fileName, clientId } = await xbrlData(tenantId, obligationId);
  return { clientId, fileName, xml: aoc4Instance(data).xml };
}
