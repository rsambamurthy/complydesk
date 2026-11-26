/** What the mock reader returns (EXTRACT_DRIVER=mock): realistic answers in the model's own shape, for tests and demos. */
import type { DocType } from './doctypes.js';

const KAVERI = 'U72900TN2015PTC101234';

export const FIXTURES: Record<DocType, Record<string, any>> = {
  DRAFT_FORM: {
    documentKind: 'Draft form MGT-7', matchesExpected: true, unclear: [],
    data: {
      form: 'MGT-7', cin: KAVERI, companyName: 'Kaveri Software Pvt. Ltd.', fy: 2025, agmDate: '2026-09-21',
      paidUpCapital: 500000, authorisedCapital: 1000000, totalShares: 50000,
      directors: [{ name: 'Anita Rao', din: '01234567' }, { name: 'Suresh Iyer', din: '02345678' }, { name: 'Ravi Kumar', din: '07777777' }],
      auditor: { firmName: 'Iyer & Co, Chartered Accountants', frn: '007311S' }, eventDate: null, person: { name: null, din: null },
    },
  },
  BOARD_PAPERS: {
    documentKind: 'Minutes of board meeting', matchesExpected: true, unclear: ['events.3.eventDate'],
    data: {
      meeting: { kind: 'BOARD', date: '2026-11-18', cin: KAVERI },
      events: [
        { ruleCode: 'DIR12', eventDate: '2026-11-18', summary: 'Appointment of Karan Mehta as Additional Director', personName: 'Karan Mehta', personDin: '08123456', personRole: 'Additional Director', change: 'APPOINTED', quote: 'Mr. Karan Mehta (DIN 08123456) be and is hereby appointed as an Additional Director' },
        { ruleCode: 'DIR12', eventDate: '2026-11-15', summary: 'Resignation of Suresh Iyer as Director', personName: 'Suresh Iyer', personDin: '02345678', personRole: 'Director', change: 'RESIGNED', quote: 'noted the resignation of Mr. Suresh Iyer with effect from 15th November 2026' },
        { ruleCode: 'PAS3', eventDate: '2026-11-18', summary: 'Allotment of 5,000 equity shares on rights basis', personName: null, personDin: null, personRole: null, change: null, quote: 'allotted 5,000 equity shares of ₹10 each on rights basis' },
        { ruleCode: 'CHG1', eventDate: '2026-11-20', summary: 'Hypothecation of book debts to HDFC Bank for ₹50 lakh working capital', personName: null, personDin: null, personRole: null, change: null, quote: 'hypothecation of book debts in favour of HDFC Bank Ltd' },
        { ruleCode: 'INC22', eventDate: '2026-12-01', summary: 'Registered office shifted to Guindy, Chennai (within the city)', personName: null, personDin: null, personRole: null, change: null, quote: 'shifted to Plot 14, Industrial Estate, Guindy with effect from 1st December 2026' },
      ],
      notFiled: [
        { summary: 'Approval to borrow up to ₹50 lakh from HDFC Bank', reason: 'Board resolution under s.179(3) — private companies are exempt from MGT-14' },
        { summary: 'Noting of the compliance status report', reason: 'Information item' },
      ],
    },
  },
  MCA_MASTER: {
    documentKind: 'MCA company master data', matchesExpected: true, unclear: ['directors.1.appointedOn'],
    data: {
      company: { cin: 'U01100TN2021PTC145678', name: 'Aranya Agritech Private Limited', incorporationDate: '14/07/2021', rocOffice: 'RoC Chennai',
        registeredOffice: 'No. 12, Second Floor, Anna Salai, Teynampet, Chennai, Tamil Nadu 600018', email: 'accounts@aranyaagri.in', authorisedCapital: 2500000, paidUpCapital: 1500000 },
      directors: [
        { name: 'Meenakshi Sundaram', din: '09234567', designation: 'Director', appointedOn: '2021-07-14', ceasedOn: null },
        { name: 'Arvind Ramesh', din: '09234568', designation: 'Additional Director', appointedOn: '2023-02-01', ceasedOn: null },
        { name: 'Priya Natarajan', din: null, designation: 'Company Secretary', appointedOn: '2024-04-01', ceasedOn: null },
      ],
    },
  },
  INCORPORATION: {
    documentKind: 'Certificate of Incorporation', matchesExpected: true, unclear: [],
    data: { company: { cin: 'U01100TN2021PTC145678', name: 'Aranya Agritech Private Limited', incorporationDate: '14th July 2021', rocOffice: 'RoC Chennai', registeredOffice: null, email: null, authorisedCapital: 2500000, paidUpCapital: null }, directors: [] },
  },
  SRN_CHALLAN: {
    documentKind: 'MCA challan', matchesExpected: true, unclear: [],
    data: { srn: 'AB1234567', form: 'DPT-3', filedOn: '2026-11-24', cin: KAVERI, companyName: 'Kaveri Software Private Limited', amount: 600, approved: false, approvedOn: null },
  },
  MGT7: {
    documentKind: 'Form MGT-7 annual return', matchesExpected: true, unclear: ['shareholders.2.shares'],
    data: {
      cin: KAVERI, fy: 2024, agmDate: '2025-09-26',
      shareholders: [
        { name: 'Anita Rao', pan: 'ABCPR1234K', folio: '001', shareClass: 'Equity', shares: 30000, faceValue: 10 },
        { name: 'Suresh Iyer', pan: 'ABCPI5678M', folio: '002', shareClass: 'Equity', shares: 15000, faceValue: 10 },
        { name: 'Karan Mehta', pan: null, folio: '003', shareClass: 'Equity', shares: 5000, faceValue: 10 },
      ],
      directors: [
        { name: 'Anita Rao', din: '01234567', designation: 'Managing Director', appointedOn: '2015-06-10', ceasedOn: null },
        { name: 'Suresh Iyer', din: '02345678', designation: 'Director', appointedOn: '2015-06-10', ceasedOn: null },
        { name: 'Karan Mehta', din: '08123456', designation: 'Additional Director', appointedOn: '2024-11-18', ceasedOn: null },
      ],
      auditor: { firmName: 'Iyer & Co, Chartered Accountants', frn: '007311S' },
      boardMeetingDates: ['2024-05-20', '2024-08-12', '2024-11-18', '2025-02-14'],
    },
  },
  FINANCIALS: {
    documentKind: 'Audited financial statements', matchesExpected: true, unclear: [],
    data: { cin: KAVERI, fy: 2025, paidUpCapital: 1000000, turnover: 486500000, borrowings: 12500000, loansFromOthers: true, msmeDuesOver45Days: true, msmeDuesAmount: 845000 },
  },
  FIN_STATEMENTS: {
    documentKind: 'Audited balance sheet and statement of profit and loss', matchesExpected: true, unclear: ['profitLoss.otherExpenses.py'],
    data: {
      cin: KAVERI, fy: 2025, standard: 'AS', roundedTo: 1000, grossTurnover: null,
      balanceSheet: {
        shareCapital: { cy: 500000, py: 500000 }, reserves: { cy: 1200000, py: 975000 }, shareWarrants: { cy: null, py: null }, shareAppMoney: { cy: null, py: null },
        ltBorrowings: { cy: 300000, py: 400000 }, deferredTaxLiab: { cy: null, py: null }, otherLtLiab: { cy: null, py: null }, ltProvisions: { cy: null, py: null },
        stBorrowings: { cy: null, py: null }, tradePayables: { cy: 600000, py: 525000 }, otherCurLiab: { cy: 250000, py: 200000 }, stProvisions: { cy: 150000, py: 100000 },
        totalEqLiab: { cy: 3000000, py: 2700000 },
        ppe: { cy: 800000, py: 850000 }, intangibles: { cy: null, py: null }, cwip: { cy: null, py: null }, intangiblesDev: { cy: null, py: null }, ncInvestments: { cy: null, py: null },
        deferredTaxAsset: { cy: null, py: null }, ltLoans: { cy: null, py: null }, otherNcAssets: { cy: null, py: null }, curInvestments: { cy: null, py: null }, inventories: { cy: null, py: null },
        tradeReceivables: { cy: 1100000, py: 950000 }, cash: { cy: 700000, py: 600000 }, stLoans: { cy: null, py: null }, otherCurAssets: { cy: 400000, py: 300000 },
        totalAssets: { cy: 3000000, py: 2700000 },
      },
      profitLoss: {
        revenue: { cy: 9000000, py: 8000000 }, otherIncome: { cy: 100000, py: 50000 }, totalIncome: { cy: 9100000, py: 8050000 },
        materials: { cy: null, py: null }, purchases: { cy: null, py: null }, inventoryChange: { cy: null, py: null }, employee: { cy: 5000000, py: 4500000 },
        finance: { cy: 50000, py: 60000 }, depreciation: { cy: 150000, py: 140000 }, otherExpenses: { cy: 3600000, py: 3090000 },
        totalExpenses: { cy: 8800000, py: 7780000 }, exceptional: { cy: null, py: null }, pbt: { cy: 300000, py: 270000 },
        currentTax: { cy: 75000, py: 70000 }, deferredTax: { cy: null, py: null }, pat: { cy: 225000, py: 200000 },
      },
    },
  },
  AUDITOR: {
    documentKind: 'Auditor consent letter', matchesExpected: true, unclear: [],
    data: { cin: KAVERI, firmName: 'Raman & Co., Chartered Accountants', frn: '004512S', appointedOn: '2025-09-26', termFromFy: 2025, termToFy: null },
  },
};
