import { describe, expect, it } from 'vitest';
import { CATALOGUE } from '../src/compliance/catalogue.js';
import { obligationsFor, nextKycFy, eventObligation, lateFeeEstimate, type EngineInput } from '../src/compliance/engine.js';
import { firstFy, agmLastDate } from '../src/compliance/dates.js';

const pvt = { companyType: 'PRIVATE', smallCompany: false, incorporationDate: '2015-06-10', flags: {} };
const run = (over: Partial<EngineInput>) => obligationsFor({ client: pvt, people: [], year: {}, rules: CATALOGUE, fy: 2025, ...over });
const byCode = (list: ReturnType<typeof run>, code: string) => list.filter((o) => o.ruleCode === code);

describe('financial years', () => {
  it('first FY runs to the next 31 March when incorporated Jan–Mar', () => {
    expect(firstFy('2025-06-01')).toBe(2025);
    expect(firstFy('2026-02-15')).toBe(2026);
    expect(agmLastDate(2025, false)).toBe('2026-09-30');
    expect(agmLastDate(2025, true)).toBe('2026-12-31');
  });
});

describe('private company, not small', () => {
  it('has 4 board meetings, AGM, AOC-4, MGT-7 and MBP-1', () => {
    const l = run({});
    expect(byCode(l, 'BM_QUARTERLY').map((o) => o.dueDate)).toEqual(['2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31']);
    expect(byCode(l, 'AGM')[0].dueDate).toBe('2026-09-30');
    expect(byCode(l, 'MGT7A')).toHaveLength(0);
    expect(byCode(l, 'AOC4_OPC')).toHaveLength(0);
    expect(byCode(l, 'DPT3')).toHaveLength(0); // flag off
  });
  it('AOC-4 / MGT-7 are provisional until the AGM date is known', () => {
    const before = run({});
    expect(byCode(before, 'AOC4')[0]).toMatchObject({ dueDate: '2026-10-30', provisional: true });
    expect(byCode(before, 'MGT7')[0]).toMatchObject({ dueDate: '2026-11-29', provisional: true });
    const after = run({ year: { agmDate: '2026-09-15' } });
    expect(byCode(after, 'AOC4')[0]).toMatchObject({ dueDate: '2026-10-15', provisional: false });
    expect(byCode(after, 'MGT7')[0]).toMatchObject({ dueDate: '2026-11-14', provisional: false });
  });
  it('flags switch on DPT-3 and MSME-1', () => {
    const l = run({ client: { ...pvt, flags: { depositsOrLoans: true, msmeDues: true } } });
    expect(byCode(l, 'DPT3')[0].dueDate).toBe('2026-06-30');
    expect(byCode(l, 'MSME1').map((o) => o.dueDate)).toEqual(['2025-10-31', '2026-04-30']);
  });
  it('ADT-1 only when the auditor term ends this FY', () => {
    expect(byCode(run({}), 'ADT1')).toHaveLength(0);
    expect(byCode(run({ auditorTermToFy: 2025, year: { agmDate: '2026-09-20' } }), 'ADT1')[0].dueDate).toBe('2026-10-05');
  });
});

describe('small company and OPC', () => {
  it('small company: 2 board meetings and MGT-7A', () => {
    const l = run({ client: { ...pvt, smallCompany: true } });
    expect(byCode(l, 'BM_HALF_YEARLY')).toHaveLength(2);
    expect(byCode(l, 'BM_QUARTERLY')).toHaveLength(0);
    expect(byCode(l, 'MGT7A')).toHaveLength(1);
    expect(byCode(l, 'MGT7')).toHaveLength(0);
  });
  it('OPC: no AGM, AOC-4 in 180 days, MGT-7A by 29 Nov', () => {
    const l = run({ client: { ...pvt, companyType: 'OPC' } });
    expect(byCode(l, 'AGM')).toHaveLength(0);
    expect(byCode(l, 'AOC4_OPC')[0].dueDate).toBe('2026-09-27');
    expect(byCode(l, 'MGT7A_OPC')[0].dueDate).toBe('2026-11-29');
  });
});

describe('new company', () => {
  const fresh = { ...pvt, incorporationDate: '2025-08-20' };
  it('first board meeting, INC-20A, no meetings before incorporation, 9-month first AGM', () => {
    const l = run({ client: fresh });
    expect(byCode(l, 'BM_FIRST')[0].dueDate).toBe('2025-09-19');
    expect(byCode(l, 'INC20A')[0].dueDate).toBe('2026-02-16');
    expect(byCode(l, 'BM_QUARTERLY').map((o) => o.dueDate)).toEqual(['2025-09-30', '2025-12-31', '2026-03-31']);
    expect(byCode(l, 'AGM')[0].dueDate).toBe('2026-12-31');
  });
  it('nothing for years before incorporation', () => {
    expect(run({ client: fresh, fy: 2024 })).toEqual([]);
  });
});

describe('DIR-3 KYC every 3 years', () => {
  it('counts from the last filing or DIN allotment', () => {
    expect(nextKycFy({ kycLastFiledFy: 2025, dinAllottedOn: null }, 3, 2026)).toBe(2028);
    expect(nextKycFy({ kycLastFiledFy: null, dinAllottedOn: '2025-07-01' }, 3, 2026)).toBe(2029);
    expect(nextKycFy({ kycLastFiledFy: 2019, dinAllottedOn: null }, 3, 2026)).toBe(2028);
    expect(nextKycFy({ kycLastFiledFy: null, dinAllottedOn: null }, 3, 2026)).toBeNull();
  });
  it('creates one obligation per director in the FY it falls due', () => {
    const people = [
      { id: 'a', name: 'A', designation: 'DIRECTOR', dinAllottedOn: null, kycLastFiledFy: 2025, ceasedOn: null },
      { id: 'b', name: 'B', designation: 'DIRECTOR', dinAllottedOn: null, kycLastFiledFy: 2024, ceasedOn: null },
      { id: 'c', name: 'C', designation: 'CS', dinAllottedOn: null, kycLastFiledFy: 2025, ceasedOn: null },
    ];
    const l = byCode(run({ people, fy: 2028 }), 'DIR3KYC');
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ personId: 'a', dueDate: '2028-06-30' });
  });
});

describe('events and fees', () => {
  it('event obligations are 30 days after the event', () => {
    const dir12 = CATALOGUE.find((r) => r.code === 'DIR12')!;
    expect(eventObligation(dir12, '2026-11-10', 'Appointment of X').dueDate).toBe('2026-12-10');
  });
  it('late fee per day', () => {
    expect(lateFeeEstimate({ kind: 'PER_DAY', amount: 100 }, '2026-10-30', '2026-11-09')).toBe(1000);
    expect(lateFeeEstimate({ kind: 'PER_DAY', amount: 100 }, '2026-10-30', '2026-10-01')).toBe(0);
    expect(lateFeeEstimate({ kind: 'NOTE', note: 'x' }, '2026-10-30', '2026-11-09')).toBeNull();
  });
});
