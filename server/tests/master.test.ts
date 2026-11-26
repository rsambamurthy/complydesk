import { describe, it, expect } from 'vitest';
// @ts-ignore — plain JS module shared with the Chrome extension
import { readMasterData, pairsFromLines, isoDate, rupees } from '../../extension/lib/master.js';

const COMPANY_LINES = [
  'Master data Index of Charges Director/Signatory details',
  'Company Information',
  'CIN\tU72900TN2015PTC123456',
  'Company Name\tSUNRISE TECH PRIVATE LIMITED',
  'ROC Name\tROC Chennai',
  'Registration Number\t123456',
  'Date of Incorporation\t12/06/2015',
  'Email Id\tAccounts@Sunrise.in',
  'Registered Address\t12, Anna Salai, Chennai, Tamil Nadu, India, 600002',
  'Address at which the books of account are to be maintained\t-',
  'Listed in Stock Exchange(s) (Y/N)\tNo',
  'Category of Company\tCompany limited by shares',
  'Subcategory of the Company\tNon-government company',
  'Class of Company\tPrivate',
  'ACTIVE compliance\t-',
  'Authorised Capital (Rs)\t10,00,000',
  'Paid up Capital (Rs)\t5,00,000',
  'Date of last AGM\t30/09/2025',
  'Date of Balance Sheet\t31/03/2025',
  'Company Status\tActive',
  'Jurisdiction',
  'ROC (name and office)\tROC Chennai',
];
const DIRECTORS = { headers: ['DIN/PAN', 'Name', 'Designation', 'Date of Appointment', 'Cessation Date', 'Signatory'], rows: [
  ['01234567', 'ANITA RAO', 'Director', '12/06/2015', '-', 'Yes'],
  ['07654321', 'KARAN MEHTA', 'Additional Director', '01/04/2025', '-', 'Yes'],
  ['ABCDE1234F', 'PRIYA SHAH', 'Company Secretary', '01/07/2020', '31/03/2024', 'Yes'],
] };
const CHARGES = { headers: ['SRN', 'Charge Id', 'Charge Holder Name', 'Date of Creation', 'Date of Modification', 'Date of Satisfaction', 'Amount', 'Address'], rows: [
  ['T12345678', '100567890', 'HDFC BANK LIMITED', '15/02/2022', '-', '-', '25,00,000', 'Mumbai'],
] };

describe('MCA master data: company page', () => {
  const r = readMasterData({ lines: COMPANY_LINES, tables: [{ headers: ['Something'], rows: [['x']] }, DIRECTORS, CHARGES] });
  it('reads the company details', () => {
    expect(r.kind).toBe('COMPANY');
    expect(r.company).toMatchObject({
      cin: 'U72900TN2015PTC123456', name: 'SUNRISE TECH PRIVATE LIMITED', rocOffice: 'ROC Chennai', incorporationDate: '2015-06-12',
      email: 'accounts@sunrise.in', registeredOffice: '12, Anna Salai, Chennai, Tamil Nadu, India, 600002', listed: false, classOfCompany: 'Private',
      authorisedCapital: 1000000, paidUpCapital: 500000, lastAgm: '2025-09-30', balanceSheetDate: '2025-03-31', status: 'Active', activeCompliance: null,
    });
  });
  it('reads directors (DIN or PAN) and cessation', () => {
    expect(r.directors).toHaveLength(3);
    expect(r.directors[0]).toMatchObject({ din: '01234567', name: 'ANITA RAO', appointedOn: '2015-06-12', ceasedOn: null, signatory: true });
    expect(r.directors[2]).toMatchObject({ din: null, pan: 'ABCDE1234F', designation: 'Company Secretary', ceasedOn: '2024-03-31' });
  });
  it('reads charges', () => {
    expect(r.charges).toEqual([{ chargeId: '100567890', holder: 'HDFC BANK LIMITED', amount: 2500000, createdOn: '2022-02-15', modifiedOn: null, satisfiedOn: null, status: null }]);
  });
  it('reads "label value" on one line, and a label with its value on the next line', () => {
    const p = pairsFromLines(['CIN U72900TN2015PTC123456', 'Company Name', 'SUNRISE TECH PRIVATE LIMITED', 'Paid up Capital (Rs) 5,00,000', 'Company Status: Active'],
      { cin: ['cin'], name: ['company name'], paidUpCapital: ['paid up capital rs'], status: ['company status'] });
    expect(p).toEqual({ cin: 'U72900TN2015PTC123456', name: 'SUNRISE TECH PRIVATE LIMITED', paidUpCapital: '5,00,000', status: 'Active' });
  });
  it('is not a master data page without a CIN', () => {
    expect(readMasterData({ lines: ['Application History', 'SRN AB1234567 Approved'], tables: [] })).toBeNull();
  });
});

describe('MCA master data: director page', () => {
  it('reads the DIN and the companies with dates', () => {
    const r = readMasterData({
      lines: ['Director Master Data', 'DIN\t07654321', 'Name\tKARAN MEHTA', 'DIN Status\tApproved'],
      tables: [{ headers: ['CIN/FCRN', 'Company Name', 'Begin date', 'End date', 'Active compliance'], rows: [
        ['U72900TN2015PTC123456', 'SUNRISE TECH PRIVATE LIMITED', '01/04/2025', '-', '-'],
        ['U74999MH2019PTC654321', 'OTHER CO PRIVATE LIMITED', '02/01/2020', '15/03/2024', '-'],
      ] }],
    });
    expect(r).toEqual({ kind: 'DIRECTOR', din: '07654321', name: 'KARAN MEHTA', dinStatus: 'Approved', companies: [
      { cin: 'U72900TN2015PTC123456', name: 'SUNRISE TECH PRIVATE LIMITED', designation: null, beginOn: '2025-04-01', endOn: null, activeCompliance: null },
      { cin: 'U74999MH2019PTC654321', name: 'OTHER CO PRIVATE LIMITED', designation: null, beginOn: '2020-01-02', endOn: '2024-03-15', activeCompliance: null },
    ] });
  });
});

describe('MCA master data: values', () => {
  it('dates and rupees', () => {
    expect(isoDate('05-Mar-2024')).toBe('2024-03-05');
    expect(isoDate('-')).toBeNull();
    expect(rupees('Rs. 1,00,000.00')).toBe(100000);
    expect(rupees('-')).toBeNull();
  });
});
