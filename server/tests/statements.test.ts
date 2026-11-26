import { describe, it, expect } from 'vitest';
import { checkStatements, xbrlRequired, figuresFromFormData, fsKey, netWorth, type Figures } from '../src/financials/statements.js';

/** A small company that adds up (₹): assets 30,00,000 = equity and liabilities 30,00,000; profit 3,00,000. */
const good = (): Figures => {
  const f: Figures = {};
  const set = (k: string, cy: number, py: number) => { f[k] = { cy, py }; };
  set('shareCapital', 500000, 500000); set('reserves', 1200000, 975000); set('ltBorrowings', 300000, 400000);
  set('tradePayables', 600000, 525000); set('otherCurLiab', 250000, 200000); set('stProvisions', 150000, 100000);
  set('totalEqLiab', 3000000, 2700000);
  set('ppe', 800000, 850000); set('tradeReceivables', 1100000, 950000); set('cash', 700000, 600000); set('otherCurAssets', 400000, 300000);
  set('totalAssets', 3000000, 2700000);
  set('revenue', 9000000, 8000000); set('otherIncome', 100000, 50000); set('totalIncome', 9100000, 8050000);
  set('employee', 5000000, 4500000); set('finance', 50000, 60000); set('depreciation', 150000, 140000); set('otherExpenses', 3600000, 3080000);
  set('totalExpenses', 8800000, 7780000); set('exceptional', 0, 0); set('pbt', 300000, 270000); set('currentTax', 75000, 70000); set('deferredTax', 0, 0); set('pat', 225000, 200000);
  return f;
};

describe('financial statements: checks', () => {
  it('statements that add up pass', () => {
    expect(checkStatements(good(), { paidUpOnRecord: 500000 })).toEqual([]);
  });
  it('a balance sheet that doesn’t balance, and a wrong total', () => {
    const f = good(); f.totalAssets.cy = 3100000; f.cash.cy = 800000;
    const issues = checkStatements(f);
    expect(issues.some((i) => i.level === 'fix' && i.text.includes('doesn’t balance') && i.text.includes('this year'))).toBe(true);
    const f2 = good(); f2.totalExpenses.py = 7790000;
    expect(checkStatements(f2).map((i) => i.keys[0])).toEqual(expect.arrayContaining(['totalExpenses', 'pbt']));
  });
  it('rounding in lakhs is not flagged', () => {
    const f = good(); f.totalEqLiab.cy = 3000500; f.totalAssets.cy = 3000500;
    expect(checkStatements(f, { roundedTo: 1000 }).filter((i) => i.level === 'fix')).toEqual([]);
    expect(checkStatements(f, { roundedTo: 1 }).some((i) => i.keys.includes('totalEqLiab'))).toBe(true);
  });
  it('profit after tax must follow from profit before tax', () => {
    const f = good(); f.pat.cy = 300000;
    expect(checkStatements(f)[0]).toMatchObject({ level: 'fix', keys: ['pat'] });
  });
  it('share capital different from the records is worth a look', () => {
    expect(checkStatements(good(), { paidUpOnRecord: 1000000 })).toEqual([expect.objectContaining({ level: 'look', keys: ['shareCapital'] })]);
  });
  it('negative where it can’t be', () => {
    const f = good(); f.cash.cy = -700000; f.totalAssets.cy = 1600000; f.totalEqLiab.cy = 1600000; f.reserves.cy = -200000;
    expect(checkStatements(f).some((i) => i.text.startsWith('Cash and cash equivalents is negative'))).toBe(true);
    expect(checkStatements(f).some((i) => i.text.startsWith('Reserves'))).toBe(false);
  });
});

describe('XBRL applicability (rule 3, XBRL Rules 2015)', () => {
  it('thresholds and reasons', () => {
    expect(xbrlRequired({ paidUp: 50000000, turnover: 0 })).toEqual({ required: true, reasons: ['paid-up capital ₹5 crore or more'] });
    expect(xbrlRequired({ paidUp: 49999999, turnover: 999999999 }).required).toBe(false);
    expect(xbrlRequired({ turnover: 1000000000 }).reasons).toEqual(['turnover ₹100 crore or more']);
    expect(xbrlRequired({ filedXbrlBefore: true }).required).toBe(true);
    expect(xbrlRequired({ paidUp: 1e9, exemptSector: true }).required).toBe(false);
  });
});

describe('AOC-4 form data', () => {
  it('figures from the filing’s form data, and net worth', () => {
    const f = figuresFromFormData({ [fsKey('shareCapital', 'cy')]: '5,00,000', [fsKey('reserves', 'cy')]: '-1000', [fsKey('reserves', 'py')]: '' });
    expect(f.shareCapital).toEqual({ cy: 500000, py: null });
    expect(f.reserves).toEqual({ cy: -1000, py: null });
    expect(netWorth(f)).toBe(499000);
  });
});
