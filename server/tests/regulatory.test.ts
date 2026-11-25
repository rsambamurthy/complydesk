import { describe, it, expect } from 'vitest';
import { affects, describeApplies } from '../src/regulatory/match.js';
import { mockRegDraft } from '../src/regulatory/draft.js';

const pvt = { id: '1', name: 'A', cin: 'U1', companyType: 'PRIVATE', smallCompany: false, flags: { msmeDues: true } };
const opcSmall = { id: '2', name: 'B', cin: 'U2', companyType: 'OPC', smallCompany: true, flags: {} };

describe('regulatory updates: who is affected', () => {
  it('all / empty conditions affect everyone', () => {
    expect(affects({ all: true }, opcSmall)).toBe(true);
    expect(affects({}, pvt)).toBe(true);
  });
  it('type, small and flags must all hold', () => {
    expect(affects({ types: ['PRIVATE'] }, opcSmall)).toBe(false);
    expect(affects({ small: true }, pvt)).toBe(false);
    expect(affects({ types: ['PRIVATE'], flags: ['msmeDues'] }, pvt)).toBe(true);
    expect(affects({ flags: ['depositsOrLoans'] }, pvt)).toBe(false);
  });
  it('describes the companies in words', () => {
    expect(describeApplies({ types: ['PRIVATE'], small: false, flags: ['msmeDues'] }, () => 'MSME dues')).toBe('Private companies that are not small companies where: MSME dues');
    expect(describeApplies({ all: true })).toBe('All companies');
  });
  it('stand-in draft picks up a date and the forms', () => {
    const d = mockRegDraft('Small company limits revised\nEffective 2025-12-01, MGT-7 changes');
    expect(d.effectiveFrom).toBe('2025-12-01');
    expect(d.forms).toContain('MGT7A');
    expect(d.impact).toBe('HIGH');
  });
});
