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
