import { describe, it, expect } from 'vitest';
import { REGISTERS, registerSpec } from '../src/registers/specs.js';
import { buildRegister, checkEntry, ledgerHoldings, newEvents, namesFrom, fmtDate, type RegCtx } from '../src/registers/build.js';
import { CATALOGUE } from '../src/compliance/catalogue.js';

const people = [
  { id: 'p1', name: 'Anita Rao', din: '01234567', pan: 'ABCPR1234K', designation: 'MANAGING_DIRECTOR', appointedOn: '2015-06-10', ceasedOn: null, address: 'Chennai', fatherName: 'S Rao', dob: '1975-01-02' },
  { id: 'p2', name: 'Vikram Shah', din: '07654321', pan: null, designation: 'DIRECTOR', appointedOn: '2015-06-10', ceasedOn: '2024-03-31' },
];
const members = [
  { id: 'm1', name: 'Anita Rao', pan: 'ABCPR1234K', folio: '1', shareClass: 'EQUITY', shares: 6000, faceValue: '10', address: 'Chennai' },
  { id: 'm2', name: 'Vikram Shah', pan: null, folio: '2', shareClass: 'EQUITY', shares: 4000, faceValue: '10' },
];
const ctx = (entries: any[] = []): RegCtx => ({ people: people as any, members: members as any, entries });
const spec = (c: string) => registerSpec(c)!;

describe('registers', () => {
  it('every event rule exists in the catalogue', () => {
    const codes = new Set(CATALOGUE.map((r) => r.code));
    for (const r of REGISTERS) for (const e of r.events ?? []) expect(codes.has(e.ruleCode), e.ruleCode).toBe(true);
  });
  it('checks entries: required, types, people and members of this company', () => {
    const bad = checkEntry(spec('CHARGES'), { createdOn: '2026-01-05', holder: '', amount: 'abc', nature: 'X', property: 'Stock' }, ctx());
    expect(bad.ok).toBe(false);
    expect(Object.keys(bad.errors).sort()).toEqual(['amount', 'holder', 'nature']);
    const ok = checkEntry(spec('CHARGES'), { createdOn: '2026-01-05', holder: 'SBI', amount: '₹50,00,000', nature: 'HYPOTHECATION', property: 'Stock and book debts' }, ctx());
    expect(ok.ok).toBe(true);
    expect(ok.data.amount).toBe(5000000);
    expect(checkEntry(spec('CONTRACTS'), { part: 'B', date: '2026-01-01', party: 'X', director: 'zz', interest: 'Relative', nature: 'Lease' }, ctx()).errors.director).toBeTruthy();
  });
  it('share entries: distinctive numbers must cover the shares; transfer fields only for transfers', () => {
    const r = checkEntry(spec('SHARE_LEDGER'), { kind: 'ALLOTMENT', date: '2026-02-01', toMember: 'm1', shareClass: 'EQUITY', shares: 100, distinctiveFrom: 10001, distinctiveTo: 10050, fromMember: 'm2' }, ctx());
    expect(r.errors.distinctiveTo).toMatch(/50 shares/);
    expect(r.data.fromMember).toBeUndefined();
    expect(checkEntry(spec('SHARE_LEDGER'), { kind: 'TRANSFER', date: '2026-02-01', shareClass: 'EQUITY', shares: 10, toMember: 'm1' }, ctx()).errors.fromMember).toBeTruthy();
  });
  it('events: CHG-1 on creation, CHG-4 when satisfied later, PAS-3 only for allotments', () => {
    const n = namesFrom(ctx());
    const d = { createdOn: '2026-01-05', holder: 'SBI', amount: 5000000 };
    expect(newEvents(spec('CHARGES'), d, null, n).map((e) => e.ruleCode)).toEqual(['CHG1']);
    expect(newEvents(spec('CHARGES'), { ...d, satisfiedOn: '2026-09-01' }, d, n).map((e) => e.ruleCode)).toEqual(['CHG4']);
    expect(newEvents(spec('SHARE_LEDGER'), { kind: 'TRANSFER', date: '2026-02-01', shares: 5 }, null, n)).toEqual([]);
    expect(newEvents(spec('SHARE_LEDGER'), { kind: 'ALLOTMENT', date: '2026-02-01', shares: 500, toMember: 'm1' }, null, n)[0].label).toBe('Allotment of 500 shares to Anita Rao');
  });
  it('members register flags a holding that the allotments and transfers don\'t add up to', () => {
    const entries = [
      { id: 'e1', register: 'SHARE_LEDGER', entryDate: '2015-06-10', closedOn: null, data: { kind: 'ALLOTMENT', date: '2015-06-10', toMember: 'm1', shareClass: 'EQUITY', shares: 5000 } },
      { id: 'e2', register: 'SHARE_LEDGER', entryDate: '2020-01-01', closedOn: null, data: { kind: 'TRANSFER', date: '2020-01-01', fromMember: 'm2', toMember: 'm1', shareClass: 'EQUITY', shares: 1000 } },
    ];
    expect(ledgerHoldings(entries as any).get('m1|EQUITY')).toBe(6000);
    const v = buildRegister(spec('MEMBERS'), ctx(entries));
    expect(v.rows[0].warn).toBeUndefined();
    expect(v.rows[0].cells.movements).toContain('Transfer from Vikram Shah 1,000');
    expect(v.rows[1].warn).toMatch(/-1,000/);
    expect(v.rows[0].cells.paidUp).toBe('₹60,000');
  });
  it('directors register: shares held matched by PAN, else name; missing particulars listed', () => {
    const v = buildRegister(spec('DIRECTORS'), ctx());
    expect(v.rows[0].cells.shares).toBe('6,000 equity');
    expect(v.rows[0].cells.designation).toBe('MANAGING_DIRECTOR');
    expect(v.rows[1].closed).toBe(true);
    expect(v.warnings.join()).toMatch(/Vikram Shah: address/);
  });
  it('entry registers number rows by date and blank out fields that don\'t apply', () => {
    const v = buildRegister(spec('LOANS'), ctx([
      { id: 'b', register: 'LOANS', entryDate: '2026-03-01', closedOn: null, data: { kind: 'INVESTMENT', date: '2026-03-01', party: 'Y Ltd', amount: 100, purpose: 'Investment', securities: '10 shares' } },
      { id: 'a', register: 'LOANS', entryDate: '2026-01-01', closedOn: null, data: { kind: 'LOAN', date: '2026-01-01', party: 'X Ltd', amount: 100000, purpose: 'Working capital', rate: 9 } },
    ]));
    expect(v.rows.map((r) => r.cells._no + r.cells.party)).toEqual(['1X Ltd', '2Y Ltd']);
    expect(v.rows[1].cells.rate).toBe('—');
    expect(fmtDate('2026-01-05')).toBe('05/01/2026');
  });
});
