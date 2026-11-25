import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalise, toDate, toMoney, toDesignation, nameMatch, SMALL_LIMITS } from '../src/extract/normalise.js';
import { FIXTURES } from '../src/extract/fixtures.js';
import { readCertificate } from '../src/extract/reader.js';

describe('reading values', () => {
  it('dates in Indian formats', () => {
    expect(toDate('14/07/2021')).toBe('2021-07-14');
    expect(toDate('14-07-2021')).toBe('2021-07-14');
    expect(toDate('14th July 2021')).toBe('2021-07-14');
    expect(toDate('2021-07-14')).toBe('2021-07-14');
    expect(toDate('31/02/2021')).toBeNull();
    expect(toDate('July')).toBeNull();
  });
  it('amounts', () => {
    expect(toMoney('₹ 15,00,000')).toBe('1500000');
    expect(toMoney(2500000)).toBe('2500000');
    expect(toMoney('n/a')).toBeNull();
  });
  it('designations', () => {
    expect(toDesignation('Additional Director')).toBe('DIRECTOR');
    expect(toDesignation('Managing Director')).toBe('MANAGING_DIRECTOR');
    expect(toDesignation('Whole-time Director')).toBe('WHOLE_TIME_DIRECTOR');
    expect(toDesignation('Company Secretary')).toBe('CS');
    expect(toDesignation('Chief Financial Officer')).toBe('CFO');
  });
  it('name matching', () => {
    expect(nameMatch('ANITA RAO', 'Anita Rao')).toBe(1);
    expect(nameMatch('Mrs. Anita  Rao', 'ANITA RAO')).toBe(1);
    expect(nameMatch('Suresh Iyer', 'Anita Rao')).toBe(0);
  });
});

describe('normalise', () => {
  it('MCA master data → client + directors, flags what to check', () => {
    const r = normalise('MCA_MASTER', FIXTURES.MCA_MASTER);
    expect(r.values.client).toMatchObject({ cin: 'U01100TN2021PTC145678', companyType: 'PRIVATE', incorporationDate: '2021-07-14', paidUpCapital: '1500000' });
    expect(r.values.directors.map((d: any) => d.designation)).toEqual(['DIRECTOR', 'DIRECTOR', 'CS']);
    expect(r.check['directors.1.appointedOn']).toMatch(/check/i);
    expect(Object.keys(r.check)).not.toContain('directors.2.din'); // a CS needs no DIN
  });
  it('warns when the CIN is another company’s', () => {
    const r = normalise('MCA_MASTER', FIXTURES.MCA_MASTER, { clientCin: 'U72900TN2015PTC101234' });
    expect(r.warnings[0]).toMatch(/not this client/);
  });
  it('a director without DIN is flagged', () => {
    const raw = structuredClone(FIXTURES.MCA_MASTER); raw.data.directors[0].din = null;
    expect(normalise('MCA_MASTER', raw).check['directors.0.din']).toMatch(/DIN/);
  });
  it('challan: SRN shape and form match', () => {
    const ok = normalise('SRN_CHALLAN', FIXTURES.SRN_CHALLAN, { clientCin: 'U72900TN2015PTC101234', obligationForm: 'DPT-3' });
    expect(ok.values).toMatchObject({ srn: 'AB1234567', filedOn: '2026-11-24', amount: '600' });
    expect(ok.warnings).toEqual([]);
    expect(normalise('SRN_CHALLAN', FIXTURES.SRN_CHALLAN, { obligationForm: 'AOC-4' }).warnings[0]).toMatch(/not AOC-4/);
    const bad = structuredClone(FIXTURES.SRN_CHALLAN); bad.data.srn = 'AB12';
    expect(normalise('SRN_CHALLAN', bad).check.srn).toMatch(/9/);
  });
  it('financials: small company under the Dec 2025 limits', () => {
    const r = normalise('FINANCIALS', FIXTURES.FINANCIALS);
    expect(r.values.smallCompany).toBe(true); // ₹48.65 crore turnover ≤ ₹100 crore
    expect(r.values.flags).toEqual({ msmeDues: true, depositsOrLoans: true });
    const big = structuredClone(FIXTURES.FINANCIALS); big.data.turnover = SMALL_LIMITS.turnover + 1;
    expect(normalise('FINANCIALS', big).values.smallCompany).toBe(false);
  });
  it('auditor: assumes a 5-year term and says so', () => {
    const r = normalise('AUDITOR', FIXTURES.AUDITOR);
    expect(r.values.auditor).toMatchObject({ termFromFy: 2025, termToFy: 2029, current: true });
    expect(r.check['auditor.termToFy']).toMatch(/5-year/);
  });
  it('MGT-7: shareholders, directors, auditor, AGM', () => {
    const r = normalise('MGT7', FIXTURES.MGT7);
    expect(r.values.fy).toBe(2024);
    expect(r.values.shareholders).toHaveLength(3);
    expect(r.values.auditor.frn).toBe('007311S');
    expect(r.check['shareholders.2.shares']).toBeTruthy();
  });
  it('wrong document is called out', () => {
    expect(normalise('MGT7', { matchesExpected: false, documentKind: 'Bank statement', unclear: [], data: {} }).warnings[0]).toMatch(/Bank statement/);
  });
});

describe('DSC certificate', () => {
  it('reads holder and expiry', () => {
    const c = readCertificate(readFileSync(new URL('./files/dsc_anita.pem', import.meta.url)));
    expect(c.holder).toBe('ANITA RAO');
    expect(c.validTo).toBe('2028-11-24');
  });
  it('refuses other files', () => expect(() => readCertificate(Buffer.from('hello'))).toThrow(/certificate/));
});
