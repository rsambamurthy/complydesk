import { describe, it, expect } from 'vitest';
import { recordChecks, compareDraft, tally, type Ctx } from '../src/review/checks.js';

const base = (): Ctx => ({
  today: '2026-11-25',
  ob: { ruleCode: 'MGT7', form: 'MGT-7', fy: 2025, dueDate: '2026-11-21', eventDate: null, personId: null, status: 'OPEN' },
  client: { cin: 'U72900TN2015PTC101234', name: 'Kaveri Software Private Limited', companyType: 'PRIVATE', smallCompany: false, paidUpCapital: '500000', authorisedCapital: '1000000', flags: {} },
  people: [
    { id: 'a', name: 'Anita Rao', din: '01234567', designation: 'MANAGING_DIRECTOR', appointedOn: '2015-06-10', ceasedOn: null, dscExpiry: '2027-02-15' },
    { id: 's', name: 'Suresh Iyer', din: '02345678', designation: 'DIRECTOR', appointedOn: '2015-06-10', ceasedOn: null, dscExpiry: '2026-01-01' },
  ],
  shareholders: [{ shares: 30000, faceValue: '10' }, { shares: 20000, faceValue: '10' }],
  auditors: [{ firmName: 'Iyer & Co', frn: null, appointedOn: null, termFromFy: 2021, termToFy: 2025, current: true }],
  agmDate: '2026-09-22', boardMeetingsHeld: 4, kycOverdue: [], attachments: 1,
});
const texts = (f: { text: string }[]) => f.map((x) => x.text).join(' | ');

describe('record checks', () => {
  it('clean MGT-7: shareholding, AGM, meetings, signer; late and missing FRN flagged', () => {
    const f = recordChecks(base());
    expect(tally(f).errors).toBe(0);
    expect(texts(f)).toMatch(/Shareholding matches paid-up capital/);
    expect(texts(f)).toMatch(/Can be signed by Anita Rao/);
    expect(texts(f)).toMatch(/Suresh Iyer’s DSC expired/);
    expect(texts(f)).toMatch(/4 days late/);
    expect(texts(f)).toMatch(/no firm registration number/);
  });
  it('shares not adding up to paid-up capital is an error', () => {
    const c = base(); c.client.paidUpCapital = '600000';
    expect(recordChecks(c).find((x) => x.level === 'error')!.text).toMatch(/₹5,00,000 but paid-up capital is ₹6,00,000/);
  });
  it('wrong annual return form for a small company', () => {
    const c = base(); c.client.smallCompany = true;
    expect(texts(recordChecks(c).filter((x) => x.level === 'error'))).toMatch(/MGT-7A, not MGT-7/);
  });
  it('too few board meetings and no AGM date', () => {
    const c = base(); c.boardMeetingsHeld = 2; c.agmDate = null;
    const t = texts(recordChecks(c));
    expect(t).toMatch(/Only 2 board meetings/); expect(t).toMatch(/isn’t recorded/);
  });
  it('nobody can sign when KYC is overdue and DSCs expired', () => {
    const c = base(); c.kycOverdue = ['a'];
    const f = recordChecks(c);
    expect(f[0]).toMatchObject({ level: 'error' });
    expect(texts(f)).toMatch(/Anita Rao’s DIR-3 KYC is overdue/);
  });
  it('DIR-12: event date must match the register', () => {
    const c = base(); c.ob = { ...c.ob, ruleCode: 'DIR12', form: 'DIR-12', eventDate: '2026-11-15', personId: 's' };
    expect(texts(recordChecks(c))).toMatch(/neither the appointment date/);
    c.people[1].ceasedOn = '2026-11-15';
    const f = recordChecks(c);
    expect(texts(f)).toMatch(/cessation on 15 Nov 2026 matches/);
    expect(texts(f.filter((x) => x.level === 'error'))).toMatch(/Only 1 director in office/);
  });
  it('DPT-3 for a client not marked with loans', () => {
    const c = base(); c.ob = { ...c.ob, ruleCode: 'DPT3', form: 'DPT-3' };
    expect(texts(recordChecks(c))).toMatch(/check whether DPT-3 is needed/);
  });
});

describe('draft vs records', () => {
  it('finds the mismatches and confirms the matches', () => {
    const f = compareDraft({ form: 'MGT-7', cin: 'U72900TN2015PTC101234', companyName: 'Kaveri Software Pvt. Ltd.', fy: 2025, agmDate: '2026-09-21', paidUpCapital: '500000', totalShares: 50000,
      directors: [{ name: 'Anita Rao', din: '01234567' }, { name: 'Ravi Kumar', din: '07777777' }], auditor: { firmName: 'Iyer & Co', frn: '007311S' } }, base());
    const e = texts(f.filter((x) => x.level === 'error'));
    expect(e).toMatch(/AGM date: draft says 21 Sept 2026, records say 22 Sept 2026/);
    expect(e).toMatch(/Ravi Kumar \(DIN 07777777\) is in the draft but not in our records/);
    const w = texts(f.filter((x) => x.level === 'warn'));
    expect(w).toMatch(/Suresh Iyer \(DIN 02345678\) is in office but not in the draft/);
    expect(w).toMatch(/Auditor FRN in the draft is 007311S; nothing on file/);
    const ok = texts(f.filter((x) => x.level === 'ok'));
    expect(ok).toMatch(/CIN matches/); expect(ok).toMatch(/Company name matches/); expect(ok).toMatch(/Total shares match/); expect(ok).toMatch(/Paid-up capital matches/);
  });
  it('wrong form, wrong year', () => {
    const e = texts(compareDraft({ form: 'AOC-4', fy: 2024 }, base()).filter((x) => x.level === 'error'));
    expect(e).toMatch(/This draft is AOC-4, not MGT-7/); expect(e).toMatch(/FY 2024-25/);
  });
  it('nothing comparable', () => expect(compareDraft({}, base())[0].text).toMatch(/Nothing in the draft/));
});
