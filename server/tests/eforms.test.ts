import { describe, it, expect } from 'vitest';
import { buildForm, inputKeys, type FormCtx } from '../src/eforms/build.js';
import { FORM_SPECS } from '../src/eforms/forms.js';

const ctx = (over: Partial<FormCtx> = {}): FormCtx => ({
  today: '2026-11-25',
  client: { cin: 'U72900TN2015PTC101234', name: 'Kaveri Software Private Limited', companyType: 'PRIVATE', smallCompany: false, incorporationDate: '2015-06-10', rocOffice: 'RoC Chennai', registeredOffice: 'Chennai', email: 'cs@kaveri.in', authorisedCapital: '1000000', paidUpCapital: '500000' },
  profile: {}, formData: {},
  ob: { ruleCode: 'MGT7', form: 'MGT-7', fy: 2025, dueDate: '2026-11-21', eventDate: null, personId: null },
  people: [
    { id: 'a', name: 'Anita Rao', din: '01234567', pan: 'ABCPR1234K', email: 'anita@kaveri.in', designation: 'MANAGING_DIRECTOR', appointedOn: '2015-06-10', ceasedOn: null },
    { id: 's', name: 'Suresh Iyer', din: '02345678', pan: null, email: null, designation: 'DIRECTOR', appointedOn: '2015-06-10', ceasedOn: '2025-11-15' },
    { id: 'k', name: 'Karan Mehta', din: '08123456', pan: null, email: 'karan@x.in', designation: 'DIRECTOR', appointedOn: '2025-11-18', ceasedOn: null },
  ],
  shareholders: [{ name: 'Anita Rao', pan: 'ABCPR1234K', folio: '1', shareClass: 'EQUITY', shares: 30000, faceValue: '10' }, { name: 'Suresh Iyer', pan: null, folio: '2', shareClass: 'EQUITY', shares: 20000, faceValue: '10' }],
  auditors: [{ firmName: 'Iyer & Co', frn: '007311S', appointedOn: '2021-09-25', termFromFy: 2021, termToFy: 2025, current: true }],
  years: [{ fy: 2025, agmDate: '2026-09-22' }],
  meetings: [{ type: 'AGM', date: '2025-09-26', entitled: 2, present: 2 }, { type: 'BOARD', date: '2025-05-20', entitled: 2, present: 2 }, { type: 'BOARD', date: '2025-11-18', entitled: 2, present: 1 }],
  ...over,
});
const field = (b: ReturnType<typeof buildForm>, key: string) => b.parts.flatMap((p) => p.fields).find((f) => f.key === key);
const table = (b: ReturnType<typeof buildForm>, key: string) => b.parts.flatMap((p) => p.tables).find((t) => t.key === key)!;

describe('MGT-7 pack', () => {
  const b = buildForm(FORM_SPECS.MGT7, ctx());
  it('fills registration, FY, AGM and capital from records', () => {
    expect(field(b, 'cin')!.value).toBe('U72900TN2015PTC101234');
    expect(field(b, 'fyFrom')!.value).toBe('01/04/2025');
    expect(field(b, 'agmDate')!.value).toBe('22/09/2026');
    expect(field(b, 'agmDue')!.value).toBe('30/09/2026');
    expect(field(b, 'authShares')!.value).toBe('1,00,000');
    expect(field(b, 'paidShares')!.value).toBe('50,000');
  });
  it('directors at year end with shares held, and changes during the year', () => {
    expect(table(b, 'dkmp').rows.map((r) => r[0])).toEqual(['Anita Rao', 'Karan Mehta']);
    expect(table(b, 'dkmp').rows[0][3]).toBe(30000);
    expect(table(b, 'changes').rows.map((r) => `${r[0]}:${r[4]}`)).toEqual(['Suresh Iyer:Cessation', 'Karan Mehta:Appointment']);
  });
  it('meetings and attendance', () => {
    expect(field(b, 'boardCount')!.value).toBe('2');
    expect(table(b, 'bm').rows[1]).toEqual(['18/11/2025', 2, 1, '50%']);
  });
  it('what is still missing is listed; defaults count as filled', () => {
    expect(b.progress.missing).toEqual(expect.arrayContaining(['PAN of the company', 'Main activity group code', 'Turnover (₹)', 'Net worth of the company (₹)']));
    expect(b.progress.missing).not.toContain('Website');
    expect(field(b, 'turnoverPct')!.value).toBe('100');
  });
  it('typed values fill the gaps; client profile vs this filing', () => {
    const keys = inputKeys(FORM_SPECS.MGT7, ctx());
    expect(keys.get('pan')).toBe('client'); expect(keys.get('turnover')).toBe('filing');
    const f = buildForm(FORM_SPECS.MGT7, ctx({ profile: { pan: 'AABCK1234L' }, formData: { turnover: '600000000' } }));
    expect(field(f, 'pan')!.value).toBe('AABCK1234L');
    expect(f.attachments.map((a) => a.name)).toContain('MGT-8 certificate by a practising CS');
  });
  it('first FY: AGM due 31 Dec', () => {
    const f = buildForm(FORM_SPECS.MGT7A, ctx({ client: { ...ctx().client, incorporationDate: '2025-08-20', smallCompany: true }, ob: { ...ctx().ob, ruleCode: 'MGT7A', form: 'MGT-7A' } }));
    expect(field(f, 'agmDue')!.value).toBe('31/12/2026');
    expect(f.attachments.some((a) => a.name.startsWith('MGT-8'))).toBe(false);
  });
});

describe('event packs', () => {
  it('DIR-12 cessation: purpose from the register, reason asked', () => {
    const b = buildForm(FORM_SPECS.DIR12, ctx({ ob: { ruleCode: 'DIR12', form: 'DIR-12', fy: 2025, dueDate: '2025-12-15', eventDate: '2025-11-15', personId: 's' } }));
    expect(field(b, 'purpose')!.value).toBe('Cessation');
    expect(field(b, 'reason')!.missing).toBe(true);
    expect(field(b, 'pemail')).toBeUndefined();
    expect(field(b, 'directorsAfter')!.value).toBe('1');
    expect(b.attachments[0].name).toMatch(/resignation/);
  });
  it('DIR-12 appointment: category asked, DIR-2 in the form', () => {
    const b = buildForm(FORM_SPECS.DIR12, ctx({ ob: { ruleCode: 'DIR12', form: 'DIR-12', fy: 2025, dueDate: '2025-12-18', eventDate: '2025-11-18', personId: 'k' } }));
    expect(field(b, 'purpose')!.value).toBe('Appointment');
    expect(field(b, 'category')!.input?.options).toContain('Professional');
    expect(b.attachments.some((a) => a.name.includes('DIR-2'))).toBe(true);
  });
  it('PAS-3 works out the amount payable', () => {
    const b = buildForm(FORM_SPECS.PAS3, ctx({ ob: { ruleCode: 'PAS3', form: 'PAS-3', fy: 2026, dueDate: '2026-12-18', eventDate: '2026-11-18', personId: null }, formData: { sharesAllotted: '5000', premium: '90', mode: 'Private placement' } }));
    expect(field(b, 'nominal')!.value).toBe('10');
    expect(field(b, 'amount')!.value).toBe('5,00,000');
    expect(b.attachments.some((a) => a.name.startsWith('Valuation report'))).toBe(true);
  });
  it('ADT-1 term from the auditor record', () => {
    const b = buildForm(FORM_SPECS.ADT1, ctx({ ob: { ruleCode: 'ADT1', form: 'ADT-1', fy: 2025, dueDate: '2026-10-07', eventDate: null, personId: null } }));
    expect(field(b, 'from')!.value).toBe('FY 2021-22'); expect(field(b, 'years')!.value).toBe('5');
  });
});

describe('new packs: DPT-3, MSME-1, CHG-1, CHG-4, MGT-14, SH-7, INC-22', () => {
  const charge = { chargeId: '100845123', createdOn: '2026-04-15', modifiedOn: null, satisfiedOn: '2026-11-20', holder: 'HDFC Bank Limited', holderAddress: 'Mumbai', amount: 15000000, nature: 'HYPOTHECATION', property: 'Stock and book debts', instrument: 'Deed of hypothecation', terms: 'Repo + 3.25%', modification: null };
  it('DPT-3 adds up the amounts not treated as deposits', () => {
    const b = buildForm(FORM_SPECS.DPT3, ctx({ ob: { ruleCode: 'DPT3', form: 'DPT-3', fy: 2025, dueDate: '2026-06-30', eventDate: null, personId: null }, formData: { fromDirectors: '500000', fromBanks: '1500000' } }));
    expect(field(b, 'total')!.value).toBe('20,00,000');
    expect(field(b, 'asOn')!.value).toBe('31/03/2026');
    expect(b.attachments.some((a) => /Auditor/.test(a.name))).toBe(false);
  });
  it('MSME-1 picks the half-year from the due date', () => {
    const b = buildForm(FORM_SPECS.MSME1, ctx({ ob: { ruleCode: 'MSME1', form: 'MSME-1', fy: 2026, dueDate: '2026-10-31', eventDate: null, personId: null } }));
    expect(field(b, 'period')!.value).toBe('April to September');
  });
  it('CHG-1 comes from the register of charges', () => {
    const b = buildForm(FORM_SPECS.CHG1, ctx({ ob: { ruleCode: 'CHG1', form: 'CHG-1', fy: 2026, dueDate: '2026-05-15', eventDate: '2026-04-15', personId: null }, charges: [charge] }));
    expect(field(b, 'purpose')!.value).toBe('Creation of charge');
    expect(field(b, 'holder')!.value).toBe('HDFC Bank Limited');
    expect(field(b, 'amount')!.value).toBe('1,50,00,000');
    expect(field(b, 'nature')!.value).toBe('Hypothecation');
  });
  it('CHG-1 without a register entry says so', () => {
    const b = buildForm(FORM_SPECS.CHG1, ctx({ ob: { ruleCode: 'CHG1', form: 'CHG-1', fy: 2026, dueDate: '2026-05-15', eventDate: '2026-04-15', personId: null }, charges: [] }));
    expect(b.progress.missing).toContain('Form filed for');
  });
  it('CHG-4 finds the satisfied charge', () => {
    const b = buildForm(FORM_SPECS.CHG4, ctx({ ob: { ruleCode: 'CHG4', form: 'CHG-4', fy: 2026, dueDate: '2026-12-20', eventDate: '2026-11-20', personId: null }, charges: [charge] }));
    expect(field(b, 'chargeId')!.value).toBe('100845123');
  });
  it('MGT-14 and SH-7 from the meeting that passed the resolution', () => {
    const fromMeeting = { type: 'EGM' as const, title: 'EGM', date: '2026-12-20', items: [{ title: 'Increase in authorised share capital', resolutionType: 'ORDINARY', text: 'RESOLVED…', explanatory: 'x' }] };
    const m = buildForm(FORM_SPECS.MGT14, ctx({ ob: { ruleCode: 'MGT14', form: 'MGT-14', fy: 2026, dueDate: '2027-01-19', eventDate: '2026-12-20', personId: null }, fromMeeting }));
    expect(field(m, 'meetingType')!.value).toBe('Extraordinary general meeting');
    expect(field(m, 'subject')!.value).toBe('Increase in authorised share capital');
    const s = buildForm(FORM_SPECS.SH7, ctx({ ob: { ruleCode: 'SH7', form: 'SH-7', fy: 2026, dueDate: '2027-01-19', eventDate: '2026-12-20', personId: null }, fromMeeting, formData: { authBefore: '500000' } }));
    expect(field(s, 'increase')!.value).toBe('5,00,000');
  });
  it('INC-22 asks for an NOC only when the company doesn’t own the premises', () => {
    const base = { ob: { ruleCode: 'INC22', form: 'INC-22', fy: 2026, dueDate: '2026-12-30', eventDate: '2026-11-30', personId: null } };
    expect(buildForm(FORM_SPECS.INC22, ctx({ ...base, formData: { ownership: 'Owned by the company' } })).attachments.some((a) => /NOC/.test(a.name))).toBe(false);
    expect(buildForm(FORM_SPECS.INC22, ctx({ ...base, formData: { ownership: 'Taken on lease' } })).attachments.some((a) => /NOC/.test(a.name))).toBe(true);
  });
});
