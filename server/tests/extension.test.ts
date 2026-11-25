import { describe, it, expect } from 'vitest';
// @ts-ignore — plain JS module shared with the Chrome extension
import { norm, score, matchFields, toIsoDate } from '../../extension/lib/match.js';

describe('extension: matching portal labels', () => {
  it('normalises numbering, stars and punctuation', () => {
    expect(norm('(i) *Corporate Identity Number (CIN) of the company')).toBe('corporate identity number cin of the company');
    expect(norm('a) E-mail ID')).toBe('email id');
  });
  it('scores close wordings high and different fields low', () => {
    expect(score('Corporate Identity Number (CIN)', '*Corporate Identity Number (CIN) of the company')).toBeGreaterThan(0.6);
    expect(score('PAN of the company', '*Permanent Account Number (PAN) of the company')).toBeGreaterThan(0.6);
    expect(score('Name of the company', 'Email ID of the company')).toBeLessThan(0.6);
    expect(score('Permanent Account Number (PAN) of the company', '*Permanent Account Number (PAN) of the company')).toBe(1);
    expect(score('Date of AGM', 'Due date of AGM')).toBeLessThan(1);
  });
  it('matches each portal field once, best first, using aliases', () => {
    const pack = [
      { key: 'cin', label: 'Corporate Identity Number (CIN)', aliases: ['CIN'], value: 'U72900TN2015PTC101234' },
      { key: 'pan', label: 'PAN of the company', aliases: ['Permanent Account Number (PAN) of the company'], value: 'AABCK1234L' },
      { key: 'agmDate', label: 'Date of AGM', aliases: ['Date of annual general meeting'], value: '22/09/2026' },
      { key: 'agmDue', label: 'Due date of AGM', value: '30/09/2026' },
      { key: 'turnover', label: 'Turnover (₹)', value: null },
    ];
    const page = [
      { ref: 'a', label: '*Corporate Identity Number (CIN) of the company' },
      { ref: 'b', label: '*Permanent Account Number (PAN) of the company' },
      { ref: 'c', label: '(b) Date of AGM' },
      { ref: 'd', label: '(c) Due date of AGM' },
      { ref: 'e', label: 'Turnover' },
    ];
    const m = Object.fromEntries(matchFields(pack, page).map((x: any) => [x.key, x.ref]));
    expect(m).toEqual({ cin: 'a', pan: 'b', agmDate: 'c', agmDue: 'd' });
  });
  it('dates for date inputs', () => expect(toIsoDate('22/09/2026')).toBe('2026-09-22'));
});

// @ts-ignore — plain JS module shared with the Chrome extension
import { classifyStatus, readStatuses, lastDate } from '../../extension/lib/srn.js';
describe('extension: filing status from MCA pages', () => {
  it('reads the status words, negatives first', () => {
    expect(classifyStatus('AB1234567 MGT-7 Approved')?.status).toBe('APPROVED');
    expect(classifyStatus('Not Approved')?.status).toBe('REJECTED');
    expect(classifyStatus('Pending for Approval')?.status).toBe('PENDING');
    expect(classifyStatus('Marked for Resubmission (RSUB)')?.status).toBe('RESUBMIT');
    expect(classifyStatus('Under Processing')?.status).toBe('PENDING');
    expect(classifyStatus('Download')).toBeNull();
  });
  it('takes the latest date on the row', () => {
    expect(lastDate('Filed 21/10/2026 approved 05-11-2026')).toBe('2026-11-05');
    expect(lastDate('on 3 Nov 2026')).toBe('2026-11-03');
    expect(lastDate('no date')).toBeNull();
  });
  it('matches known SRNs on their own row only', () => {
    const rows = [
      'Sr. SRN Form Date Status',
      '1 F80412233 AOC-4 20/10/2026 Approved 02/11/2026',
      '2 F42670314 DPT-3 27/06/2026 Pending for Approval',
      '3 AB1234567 MGT-7 Under Processing',
      'F11111111 and F22222222 both here Approved',
      { text: 'Menu Rejected applications … SRN AB7654321 details Approved', whole: true },
    ];
    const out = readStatuses(rows, ['F80412233', 'F42670314', 'F11111111', 'AB7654321', 'ZZ0000000']);
    expect(out.F80412233).toMatchObject({ status: 'APPROVED', date: '2026-11-02', sure: true });
    expect(out.F42670314.status).toBe('PENDING');
    expect(out.AB1234567).toBeUndefined();
    expect(out.F11111111).toBeUndefined();
    expect(out.AB7654321).toMatchObject({ status: 'REJECTED', sure: false });
    expect(out.ZZ0000000).toBeUndefined();
  });
});
