import { describe, it, expect } from 'vitest';
import { ageBucket, amountInWords, balanceOf, clientStateCode, feeFor, invoiceNumber, invoiceTotals } from '../src/billing/calc.js';

describe('billing arithmetic', () => {
  it('place of supply: GSTIN, then the state given, then the CIN', () => {
    expect(clientStateCode({ gstin: '29ABCDE1234F1Z5', stateCode: '33' }, 'U72900TN2015PTC101234')).toBe('29');
    expect(clientStateCode({ stateCode: '27' }, 'U72900TN2015PTC101234')).toBe('27');
    expect(clientStateCode({}, 'U72900TN2015PTC101234')).toBe('33');
    expect(clientStateCode({}, 'U62099KA2026PTC200450')).toBe('29');
    expect(clientStateCode({}, 'U74999TG2020PTC140001')).toBe('36');
    expect(clientStateCode({}, 'bad')).toBeNull();
  });
  it('same state: CGST + SGST; other state: IGST; government fees without GST', () => {
    const ls = [{ amount: 10000, taxable: true }, { amount: '2500.50', taxable: true }, { amount: 600, taxable: false }];
    const intra = invoiceTotals(ls, 18, '33', '33');
    expect(intra).toMatchObject({ taxable: 12500.5, cgst: 1125.05, sgst: 1125.05, igst: 0, nonTaxable: 600, total: 15350.6, intraState: true });
    const inter = invoiceTotals(ls, 18, '33', '29');
    expect(inter).toMatchObject({ cgst: 0, sgst: 0, igst: 2250.09, total: 15350.59, intraState: false });
    expect(invoiceTotals(ls, 0, '33', '29').total).toBe(13100.5);
  });
  it('invoice numbers (prefix up to 5): prefix/FY/sequence, at most 16 characters', () => {
    expect(invoiceNumber('INV', 2026, 7)).toBe('INV/26-27/007');
    expect(invoiceNumber('RAO-CS', 2026, 1234)).toBe('RAO-C/26-27/1234');
    expect(invoiceNumber('RAO-CS', 2026, 1234).length).toBeLessThanOrEqual(16);
    expect(invoiceNumber('', 2099, 1)).toBe('INV/99-00/001');
  });
  it('amount in words, Indian system', () => {
    expect(amountInWords(15350.6)).toBe('Rupees Fifteen Thousand Three Hundred Fifty and Sixty Paise Only');
    expect(amountInWords(12500000)).toBe('Rupees One Crore Twenty Five Lakh Only');
    expect(amountInWords(0)).toBe('Rupees Zero Only');
  });
  it('balance counts TDS; ageing by days past due', () => {
    expect(balanceOf(11800, [{ amount: 9800, tds: 1000 }])).toBe(1000);
    expect(ageBucket('2026-11-30', '2026-11-26')).toBe('NOT_DUE');
    expect(ageBucket('2026-10-01', '2026-11-26')).toBe('31_60');
    expect(ageBucket('2026-06-01', '2026-11-26')).toBe('OVER_90');
  });
  it('fee: client’s own, else the firm’s, else none', () => {
    const firm = new Map([['MGT7', 5000], ['AOC4', 4000]]);
    expect(feeFor('MGT7', new Map([['MGT7', 7500]]), firm)).toBe(7500);
    expect(feeFor('AOC4', new Map(), firm)).toBe(4000);
    expect(feeFor('DPT3', new Map(), firm)).toBeNull();
  });
});

import { waNumber, waParam } from '../src/lib/whatsapp.js';
describe('WhatsApp numbers', () => {
  it('Indian mobiles become 91 + 10 digits; landlines and junk are refused', () => {
    expect(waNumber('98400 12345')).toBe('919840012345');
    expect(waNumber('+91-98400-12345')).toBe('919840012345');
    expect(waNumber('09840012345')).toBe('919840012345');
    expect(waNumber('044-2434567')).toBeNull();
    expect(waNumber(null)).toBeNull();
  });
  it('template parameters lose new lines and tabs', () => expect(waParam('a\nb\t c')).toBe('a b c'));
});
