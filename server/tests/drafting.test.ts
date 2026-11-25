import { describe, it, expect } from 'vitest';
import { cleanDraft, longDate, mockMinutes, strangeFigures, verifyMinutes, type MinutesFacts, type ResolutionFacts } from '../src/meetings/drafting.js';

const RES = 'RESOLVED THAT 5,000 equity shares of ₹10 each be allotted to Anita Rao at ₹100 per share.';
const facts = (over: Partial<MinutesFacts> = {}): MinutesFacts => ({
  company: 'Kaveri Software Private Limited', cin: 'U72900TN2015PTC101234', registeredOffice: 'Chennai',
  meeting: { type: 'BOARD', title: 'Board meeting', date: '2026-11-10', time: '11:00', mode: 'PHYSICAL', venue: 'Chennai', fy: 'FY 2026-27' },
  chair: 'Anita Rao', present: ['Anita Rao'], byVideo: ['Suresh Iyer'], leave: [], absent: [], membersPresent: null, quorumMet: true,
  items: [{ n: 1, title: 'Allotment of shares', resolutionType: 'BOARD', text: RES, outcome: 'PASSED', notes: 'Funds of ₹5,00,000 received on 2 Nov.' }],
  notes: null, ...over,
});

describe('meeting drafting checks', () => {
  it('the stand-in minutes pass every check', () => {
    const f = facts();
    expect(verifyMinutes(f, mockMinutes(f).minutes)).toEqual([]);
  });
  it('flags a reworded resolution, a missing director and chair', () => {
    const f = facts();
    const text = mockMinutes(f).minutes.replace('at ₹100 per share', 'at a premium').replace(/Suresh Iyer/g, 'S. Iyer');
    const issues = verifyMinutes(f, text);
    expect(issues.filter((i) => i.level === 'fix').map((i) => i.text).join('|')).toMatch(/word for word.*\|.*Suresh Iyer/);
  });
  it('flags figures that are not in the record or notes', () => {
    const f = facts();
    const issues = verifyMinutes(f, mockMinutes(f).minutes + '\nThe Board noted a loan of ₹25,00,000.');
    expect(issues.find((i) => i.level === 'look' && /25,00,000/.test(i.text))).toBeTruthy();
    expect(strangeFigures('₹5,00,000 on 2026', JSON.stringify(f))).toEqual([]);
  });
  it('flags "quorum present" when attendance says otherwise', () => {
    const f = facts({ quorumMet: false });
    expect(verifyMinutes(f, mockMinutes(facts()).minutes).some((i) => /quorum/.test(i.text))).toBe(true);
  });
  it('dates in words', () => expect(longDate('2026-11-10')).toBe('10 November 2026'));
});

describe('resolution drafts', () => {
  const rf = (type: 'BOARD' | 'AGM' | 'EGM'): ResolutionFacts => ({ company: 'K', cin: 'U', meetingType: type, meetingDate: '2026-11-10', people: [], description: 'allot 5000 shares at ₹100', filings: [{ code: 'PAS3', form: 'PAS-3', title: 'Return of allotment' }] });
  it('keeps board meetings to board resolutions and drops unknown filings', () => {
    const d = cleanDraft(rf('BOARD'), { title: 'Allotment', resolutionType: 'SPECIAL', text: 'RESOLVED THAT 5000 shares be allotted at ₹100', explanatory: 'x', filings: ['PAS3', 'XYZ'], missing: [] });
    expect(d.resolutionType).toBe('BOARD');
    expect(d.filings).toEqual(['PAS3']);
    expect(d.explanatory).toBe('');
    expect(d.issues.some((i) => /general meeting/.test(i.text))).toBe(true);
  });
  it('flags invented figures and blanks', () => {
    const d = cleanDraft(rf('EGM'), { title: 'Allotment', resolutionType: 'SPECIAL', text: 'RESOLVED THAT 5000 shares be allotted at ₹100 to ___ raising ₹7,50,000', explanatory: 'Statement', filings: [], missing: [] });
    expect(d.issues.map((i) => i.text).join('|')).toMatch(/7,50,000.*\|.*Blanks/);
    expect(d.explanatory).toBe('Statement');
  });
});
