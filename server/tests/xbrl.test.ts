import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { aoc4Instance, buildAoc4Xbrl, nameParts, type XbrlData } from '../src/xbrl/aoc4.js';
import { checkFact, checkCalculations, concept, writeInstance } from '../src/xbrl/instance.js';
import type { Figures } from '../src/financials/statements.js';

const figures = (): Figures => {
  const f: Figures = {};
  const set = (k: string, cy: number, py: number) => { f[k] = { cy, py }; };
  set('shareCapital', 500000, 400000); set('reserves', 1200000, 1075000); set('ltBorrowings', 300000, 400000);
  set('tradePayables', 600000, 525000); set('otherCurLiab', 250000, 200000); set('stProvisions', 150000, 100000);
  set('totalEqLiab', 3000000, 2700000);
  set('ppe', 800000, 850000); set('tradeReceivables', 1100000, 950000); set('cash', 700000, 600000); set('otherCurAssets', 400000, 300000);
  set('totalAssets', 3000000, 2700000);
  set('revenue', 9000000, 8000000); set('otherIncome', 100000, 50000); set('totalIncome', 9100000, 8050000);
  set('employee', 5000000, 4500000); set('finance', 50000, 60000); set('depreciation', 150000, 140000); set('otherExpenses', 3600000, 3080000);
  set('totalExpenses', 8800000, 7780000); set('pbt', 300000, 270000); set('currentTax', 75000, 70000); set('pat', 225000, 200000);
  return f;
};
const sample = (): XbrlData => ({
  fy: 2025, firstYear: false,
  company: { cin: 'U72900TN2015PTC101234', name: 'Kaveri Software Private Limited', pan: 'AABCK1234C', address: '12, Anna Salai, Chennai 600002', incorporationDate: '2015-06-10', category: 'Company limited by shares, Indian Non-Government company', listed: false, industry: 'Commercial and Industrial' },
  details: { rounding: 'Lakhs', employees: 42, boardMeetingDate: '2026-08-20', cashFlowMethod: 'Indirect Method', booksElectronic: true, sustainabilityReport: false },
  figures: figures(),
  extra: { revServices: { cy: 9000000, py: 8000000 }, csr: { cy: 0, py: 0 }, epsBasic: { cy: 4.5, py: 5 }, epsDiluted: { cy: 4.5, py: 5 } },
  shares: { par: 10, authorised: { cy: 100000, py: 100000 }, issued: { cy: 50000, py: 40000 }, paidUp: { cy: 50000, py: 40000 }, pyOpening: 40000 },
  signatories: {
    directors: [{ name: 'Anita Rao', din: '01234567', designation: 'Managing Director', date: '2026-08-20' }, { name: 'Suresh Kumar Iyer', din: '07654321', designation: 'Director', date: '2026-08-20' }],
    cs: { name: 'Priya Shah', pan: 'ABCPS1234F', date: '2026-08-20' }, cfo: null,
  },
  auditor: { category: 'Auditors firm', firmName: 'R K & Co', signingName: 'Ramesh Kumar', frn: '012345S', membershipNo: '212345', address: 'Chennai', pan: 'AAAFR1234K', adt1Srn: 'AB1234567', reportDate: '2026-08-20', bsSignDate: '2026-08-20' },
});

describe('taxonomy checks', () => {
  it('knows the C&I 2016 elements and their types', () => {
    expect(concept('ShareCapital')).toMatchObject({ prefix: 'in-gaap', type: 'monetary', periodType: 'i', balance: 'c' });
    expect(concept('LevelOfRoundingUsedInFinancialStatements')?.type).toBe('in-ca-types:LevelOfRounding');
    expect(concept('MadeUpElement')).toBeNull();
  });
  it('refuses wrong elements, types, enumerations, patterns and default members', () => {
    expect(checkFact({ section: 's', concept: 'Madeup', period: 'CY', value: 1 })).toMatch(/not in the C&I 2016/);
    expect(checkFact({ section: 's', concept: 'ShareCapital', period: 'CY', value: 'x' })).toMatch(/number/);
    expect(checkFact({ section: 's', concept: 'LevelOfRoundingUsedInFinancialStatements', period: 'CY', value: 'Hundreds' })).toMatch(/one of/);
    expect(checkFact({ section: 's', concept: 'SRNOfFormADT1', period: 'CY', value: 'AB12', dims: [{ axis: 'AuditorsAxis', typed: '1' }] })).toMatch(/format/);
    expect(checkFact({ section: 's', concept: 'SRNOfFormADT1', period: 'CY', value: 'AB1234567', dims: [{ axis: 'AuditorsAxis', typed: '1' }] })).toBeNull();
    expect(checkFact({ section: 's', concept: 'NumberOfSharesAuthorised', period: 'CY', value: 1, dims: [{ axis: 'ClassesOfShareCapitalAxis', member: 'ShareCapitalMember' }] })).toMatch(/default/);
    expect(checkFact({ section: 's', concept: 'Revenue', period: 'PY0', value: 1 })).toMatch(/duration/);
  });
  it('calculation linkbase: totals and parent-child', () => {
    const f = (concept: string, value: number) => ({ section: 's', concept, period: 'CY' as const, value });
    expect(checkCalculations([f('EquityAndLiabilities', 100), f('CurrentLiabilities', 100), f('TradePayables', 60), f('ShortTermBorrowings', 40)], ['BalanceSheet'])).toEqual([]);
    expect(checkCalculations([f('EquityAndLiabilities', 100), f('CurrentLiabilities', 100), f('TradePayables', 60)], ['BalanceSheet'])[0].text).toMatch(/parts add up to 60/);
    expect(checkCalculations([f('RevenueFromOperations', 100)], ['StatementOfProfitAndLoss']).some((i) => i.concept === 'RevenueFromOperations' && /needs at least one of its parts/.test(i.text))).toBe(true);
  });
});

describe('AOC-4 XBRL instance', () => {
  it('a complete small company has no business-rule errors', () => {
    const out = aoc4Instance(sample());
    // XBRL_OUT=/tmp/x.xml npx vitest run tests/xbrl.test.ts → then scripts/xbrl-schema-check.py against MCA's taxonomy
    if (process.env.XBRL_OUT) writeFileSync(process.env.XBRL_OUT, out.xml);
    expect(out.issues.filter((i) => i.level === 'fix')).toEqual([]);
    expect(out.facts).toBeGreaterThan(150);
  });
  it('writes the MCA conventions: V3 schemaRef, CIN scheme, scenario dimensions, units, no precision', () => {
    const { xml } = aoc4Instance(sample());
    expect(xml).toContain('xlink:href="https://www.mca.gov.in/V3XBRL/2016/07/26/Taxonomy/CnI/in-ci-ent-2016-03-31.xsd"');
    expect(xml).toContain('<xbrli:identifier scheme="http://www.mca.gov.in/CIN">U72900TN2015PTC101234</xbrli:identifier>');
    expect(xml).toMatch(/<in-gaap:ShareCapital contextRef="I_CY" unitRef="INR" decimals="0">500000<\/in-gaap:ShareCapital>/);
    expect(xml).toMatch(/<xbrli:scenario><xbrldi:typedMember dimension="in-ca:DirectorsSigningFinancialStatementsAxis"><in-ca:DirectorsSigningFinancialStatementsDomain>1<\/in-ca:DirectorsSigningFinancialStatementsDomain>/);
    expect(xml).toContain('<xbrldi:explicitMember dimension="in-gaap:ClassesOfShareCapitalAxis">in-gaap:EquityShares1Member</xbrldi:explicitMember>');
    expect(xml).not.toContain('in-gaap:ShareCapitalMember');
    expect(xml).not.toContain('precision=');
    expect(xml).toContain('<xbrli:unit id="INRPerShare">');
    // every context is used, none twice
    const ids = [...xml.matchAll(/<xbrli:context id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(xml).toContain(`contextRef="${id}"`);
  });
  it('profit chain, subtotals and the share capital reconciliation', () => {
    const { facts } = buildAoc4Xbrl(sample());
    const get = (c: string, p = 'CY', dim?: string) => facts.find((f) => f.concept === c && f.period === p && (dim ? f.dims?.[0]?.member === dim : !f.dims))?.value;
    expect(get('ShareholdersFunds')).toBe(1700000);
    expect(get('NoncurrentAssets')).toBe(800000);
    expect(get('ProfitBeforePriorPeriodItemsExceptionalItemsExtraordinaryItemsAndTax')).toBe(300000);
    expect(get('TaxExpense')).toBe(75000);
    expect(get('IncreaseDecreaseInNumberOfSharesOutstanding', 'CY', 'EquityShares1Member')).toBe(10000);
    expect(get('NumberOfSharesOutstanding', 'PY0', 'EquityShares1Member')).toBe(40000);
    expect(get('CSRExpenditure')).toBe(0);
  });
  it('tells what is missing instead of guessing', () => {
    const d = sample(); d.extra = {}; d.details.employees = null; d.shares = null; d.auditor = null;
    const texts = buildAoc4Xbrl(d).issues.map((i) => i.text).join(' | ');
    expect(texts).toMatch(/Split revenue from operations/);
    expect(texts).toMatch(/Basic earnings per share/);
    expect(texts).toMatch(/Number of employees/);
    expect(texts).toMatch(/share capital note is mandatory/);
    expect(texts).toMatch(/No current auditor/);
  });
  it('the balance sheet must balance', () => {
    const d = sample(); d.figures.totalAssets.cy = 3100000;
    expect(buildAoc4Xbrl(d).issues.some((i) => i.text.startsWith('Equity and liabilities must equal assets'))).toBe(true);
  });
  it('names split for MCA', () => {
    expect(nameParts('Suresh Kumar Iyer')).toEqual({ first: 'Suresh', middle: 'Kumar', last: 'Iyer' });
    expect(nameParts('Anita')).toEqual({ first: 'Anita', middle: null, last: null });
  });
  it('a duplicate fact with another value is refused', () => {
    const out = writeInstance('U72900TN2015PTC101234', 2025, [
      { section: 's', concept: 'ShareCapital', period: 'CY', value: 1 }, { section: 's', concept: 'ShareCapital', period: 'CY', value: 2 },
    ]);
    expect(out.written).toBe(1);
    expect(out.issues[0].text).toMatch(/twice/);
  });
});
