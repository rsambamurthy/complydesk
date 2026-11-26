/**
 * AOC-4 XBRL (C&I taxonomy 2016, Accounting Standards / Schedule III Division I) — pure: ComplyDesk's data → facts,
 * MCA business-rule checks, and what is and isn't covered yet. Element names come from the taxonomy (instance.ts
 * refuses anything else). Tested in tests/xbrl.test.ts.
 */
import type { Figures, Year } from '../financials/statements.js';
import { checkCalculations, writeInstance, type Fact, type Issue, type Period } from './instance.js';

/** Our Schedule III lines (financials/statements.ts) → taxonomy elements. Totals we compute are not listed here. */
export const LINE_ELEMENT: Record<string, string> = {
  shareCapital: 'ShareCapital', reserves: 'ReservesAndSurplus', shareWarrants: 'MoneyReceivedAgainstShareWarrants', shareAppMoney: 'ShareApplicationMoneyPendingAllotment',
  ltBorrowings: 'LongTermBorrowings', deferredTaxLiab: 'DeferredTaxLiabilitiesNet', otherLtLiab: 'OtherLongTermLiabilities', ltProvisions: 'LongTermProvisions',
  stBorrowings: 'ShortTermBorrowings', tradePayables: 'TradePayables', otherCurLiab: 'OtherCurrentLiabilities', stProvisions: 'ShortTermProvisions', totalEqLiab: 'EquityAndLiabilities',
  ppe: 'TangibleAssets', intangibles: 'IntangibleAssets', cwip: 'TangibleAssetsCapitalWorkInProgress', intangiblesDev: 'IntangibleAssetsUnderDevelopmentOrWorkInProgress',
  ncInvestments: 'NoncurrentInvestments', deferredTaxAsset: 'DeferredTaxAssetsNet', ltLoans: 'LongTermLoansAndAdvances', otherNcAssets: 'OtherNoncurrentAssets',
  curInvestments: 'CurrentInvestments', inventories: 'Inventories', tradeReceivables: 'TradeReceivables', cash: 'CashAndBankBalances', stLoans: 'ShortTermLoansAndAdvances',
  otherCurAssets: 'OtherCurrentAssets', totalAssets: 'Assets',
  revenue: 'RevenueFromOperations', otherIncome: 'OtherIncome', totalIncome: 'Revenue', materials: 'CostOfMaterialsConsumed', purchases: 'PurchasesOfStockInTrade',
  inventoryChange: 'ChangesInInventoriesOfFinishedGoodsWorkInProgressAndStockInTrade', employee: 'EmployeeBenefitExpense', finance: 'FinanceCosts',
  depreciation: 'DepreciationDepletionAndAmortisationExpense', totalExpenses: 'Expenses', pbt: 'ProfitBeforeTax', currentTax: 'CurrentTax', deferredTax: 'DeferredTax', pat: 'ProfitLossForPeriod',
};

/** "Mandatory field" in MCA's business rules (C&I 2016, V1.3) for the balance sheet and P&L — reported as 0 when nil. */
export const MANDATORY = [
  'ShareCapital', 'ReservesAndSurplus', 'ShareApplicationMoneyPendingAllotment', 'LongTermBorrowings', 'LongTermProvisions', 'NoncurrentLiabilities', 'ShortTermBorrowings',
  'TradePayables', 'ShortTermProvisions', 'CurrentLiabilities', 'TangibleAssets', 'IntangibleAssets', 'FixedAssets', 'NoncurrentInvestments', 'LongTermLoansAndAdvances',
  'NoncurrentAssets', 'CurrentInvestments', 'Inventories', 'TradeReceivables', 'CashAndBankBalances', 'ShortTermLoansAndAdvances', 'CurrentAssets', 'Assets',
  'RevenueFromOperations', 'OtherIncome', 'Revenue', 'CostOfMaterialsConsumed', 'ChangesInInventoriesOfFinishedGoodsWorkInProgressAndStockInTrade', 'EmployeeBenefitExpense',
  'FinanceCosts', 'DepreciationDepletionAndAmortisationExpense', 'CSRExpenditure', 'Expenses', 'ProfitBeforeTax', 'TaxExpense', 'ProfitLossForPeriodFromContinuingOperations', 'ProfitLossForPeriod',
];
/** "Should be greater than or equal to zero" in the business rules. */
const NON_NEGATIVE = ['LongTermBorrowings', 'ShortTermBorrowings', 'TradePayables', 'TangibleAssets', 'IntangibleAssets', 'FixedAssets', 'NoncurrentInvestments', 'CurrentInvestments', 'TradeReceivables', 'CSRExpenditure'];

export type Pair = { cy: number | null; py: number | null };
export interface Person { name: string; din?: string | null; pan?: string | null; designation?: string | null; date?: string | null }
export interface XbrlData {
  fy: number; firstYear: boolean;
  company: { cin: string; name: string; pan?: string | null; address: string; incorporationDate: string | null; category: string; listed: boolean; industry: string };
  details: { rounding: string; employees: number | null; boardMeetingDate: string | null; cashFlowMethod: string; booksElectronic: boolean; sustainabilityReport: boolean };
  figures: Figures;
  /** Splits the statements don't carry as lines: revenue by kind, depreciation vs amortisation, CSR spend, EPS. */
  extra: Partial<Record<'revProducts' | 'revServices' | 'revOther' | 'revDuties' | 'depreciationOnly' | 'amortisation' | 'csr' | 'epsBasic' | 'epsDiluted', Pair>>;
  /** Equity shares (one class): numbers at each year end, the par value, and shares at the start of the previous year. */
  shares: { par: number; authorised: Pair; issued: Pair; paidUp: Pair; pyOpening: number | null } | null;
  signatories: { directors: Person[]; cs: Person | null; cfo: Person | null };
  auditor: { category: 'Individual' | 'Auditors firm'; firmName: string | null; signingName: string | null; frn: string | null; membershipNo: string | null; address: string | null; pan: string | null; adt1Srn: string | null; reportDate: string | null; bsSignDate: string | null } | null;
}

/** What the instance covers and what still has to be tagged before MCA's validator accepts it. */
export const COVERAGE: { section: string; status: 'done' | 'partial' | 'todo'; note: string }[] = [
  { section: '[400100] General information about the company', status: 'done', note: 'Company, document and reporting period details' },
  { section: '[100100] Balance sheet', status: 'done', note: 'Every Schedule III line, both years, with sub-totals' },
  { section: '[100200] Statement of profit and loss', status: 'done', note: 'Lines, revenue split, depreciation / amortisation, tax, profit chain, EPS' },
  { section: '[200100] Notes — share capital', status: 'partial', note: 'Equity shares (one class): authorised, issued, subscribed, paid-up, reconciliation of shares. Not yet: preference shares, shareholders holding more than 5%' },
  { section: '[400300] Signatories of financial statements', status: 'done', note: 'Directors, company secretary, CFO from the records' },
  { section: '[400200] Auditors report', status: 'partial', note: 'Auditor details. Not yet: CARO remarks (DisclosureOfAuditorsQualifications… table)' },
  { section: '[100300]/[100400] Cash flow statement', status: 'todo', note: 'Not generated yet' },
  { section: '[200200] Notes — reserves and surplus', status: 'todo', note: 'Statement of changes in reserves is mandatory when reserves are not zero' },
  { section: '[200300]–[200600] Notes — borrowings, investments, sub-classification of assets and liabilities', status: 'todo', note: 'Mandatory tables for borrowings, loans and advances, trade receivables, inventories' },
  { section: '[201000]/[201100] Notes — tangible and intangible assets', status: 'todo', note: 'Movement tables and depreciation method' },
  { section: '[201600] Notes — related party', status: 'todo', note: 'Related parties and transactions' },
  { section: '[300500]/[300600] Notes — income and expenses, additional P&L information', status: 'todo', note: 'Breakup of other expenses, payments to auditor, foreign currency' },
  { section: '[300700] KMP and directors remuneration', status: 'todo', note: '' },
  { section: '[400400] Directors report', status: 'todo', note: 'Includes principal products / services and CSR' },
];

const v = (p: Pair | undefined, y: Year) => p?.[y] ?? null;
const PER: Record<Year, Period> = { cy: 'CY', py: 'PY' };

/** First / middle / last from a full name (MCA wants them separately). */
export function nameParts(full: string) {
  const w = full.trim().split(/\s+/);
  if (w.length === 1) return { first: w[0], middle: null, last: null };
  return { first: w[0], middle: w.length > 2 ? w.slice(1, -1).join(' ') : null, last: w[w.length - 1] };
}

export function buildAoc4Xbrl(d: XbrlData) {
  const facts: Fact[] = [];
  const issues: Issue[] = [];
  const years: Year[] = d.firstYear ? ['cy'] : ['cy', 'py'];
  const add = (section: string, concept: string, period: Period, value: Fact['value'] | null | undefined, dims?: Fact['dims']) => {
    if (value === null || value === undefined || value === '') return;
    facts.push({ section, concept, period, value, dims });
  };
  const F = d.figures;
  const fig = (k: string, y: Year) => F[k]?.[y] ?? null;
  const sum = (keys: string[], y: Year) => keys.reduce((s, k) => s + (fig(k, y) ?? 0), 0);

  // ---- [400100] General information (current year; reporting period dates for both years — business rule 12)
  const G = '[400100] General information';
  const c = d.company;
  add(G, 'NameOfCompany', 'CY', c.name);
  add(G, 'CorporateIdentityNumber', 'CY', c.cin);
  add(G, 'PermanentAccountNumberOfEntity', 'CY', c.pan ?? null);
  add(G, 'AddressOfRegisteredOfficeOfCompany', 'CY', c.address);
  add(G, 'TypeOfIndustry', 'CY', c.industry);
  add(G, 'RegistrationDate', 'CY', c.incorporationDate);
  add(G, 'CategoryOrSubcategoryOfCompany', 'CY', c.category);
  add(G, 'WhetherCompanyIsListedCompany', 'CY', c.listed);
  add(G, 'NumberOfEmployeesInTheCompanyAtTheEndOfTheFinancialYear', 'CY', d.details.employees);
  add(G, 'WhetherCompanyHasPublishedSustainabilityReportForTheFinancialYear', 'CY', d.details.sustainabilityReport);
  add(G, 'DateOfBoardMeetingWhenFinalAccountsWereApproved', 'CY', d.details.boardMeetingDate);
  for (const y of years) {
    const s = y === 'cy' ? d.fy : d.fy - 1;
    add(G, 'PeriodCoveredByFinancialStatements', PER[y], `01/04/${s} to 31/03/${s + 1}`);
    add(G, 'DateOfStartOfReportingPeriod', PER[y], `${s}-04-01`);
    add(G, 'DateOfEndOfReportingPeriod', PER[y], `${s + 1}-03-31`);
  }
  add(G, 'NatureOfReportStandaloneConsolidated', 'CY', 'Standalone');
  add(G, 'ContentOfReport', 'CY', 'Financial Statements');
  add(G, 'DescriptionOfPresentationCurrency', 'CY', 'INR');
  add(G, 'LevelOfRoundingUsedInFinancialStatements', 'CY', d.details.rounding);
  add(G, 'TypeOfCashFlowStatement', 'CY', d.details.cashFlowMethod);
  add(G, 'WhetherCompanyIsMaintainingBooksOfAccountAndOtherRelevantBooksAndPapersInElectronicForm', 'CY', d.details.booksElectronic);
  if (d.details.employees === null) issues.push({ level: 'fix', section: G, text: 'Number of employees at the end of the year is mandatory.' });
  if (!d.details.boardMeetingDate) issues.push({ level: 'fix', section: G, text: 'Date of the board meeting that approved the accounts is missing.' });

  // ---- [100100] Balance sheet and [100200] P&L
  const BS = '[100100] Balance sheet'; const PL = '[100200] Statement of profit and loss';
  const zeroFilled = new Set<string>();
  for (const y of years) {
    const p = PER[y];
    const put = (sec: string, el: string, val: number | null) => { if (val === null && MANDATORY.includes(el)) { zeroFilled.add(el); val = 0; } add(sec, el, p, val); };
    const bs = (k: string) => put(BS, LINE_ELEMENT[k], fig(k, y));
    ['shareCapital', 'reserves', 'shareWarrants'].forEach(bs);
    put(BS, 'ShareholdersFunds', sum(['shareCapital', 'reserves', 'shareWarrants'], y));
    ['shareAppMoney', 'ltBorrowings', 'deferredTaxLiab', 'otherLtLiab', 'ltProvisions'].forEach(bs);
    put(BS, 'NoncurrentLiabilities', sum(['ltBorrowings', 'deferredTaxLiab', 'otherLtLiab', 'ltProvisions'], y));
    ['stBorrowings', 'tradePayables', 'otherCurLiab', 'stProvisions'].forEach(bs);
    put(BS, 'CurrentLiabilities', sum(['stBorrowings', 'tradePayables', 'otherCurLiab', 'stProvisions'], y));
    bs('totalEqLiab');
    ['ppe', 'intangibles', 'cwip', 'intangiblesDev'].forEach(bs);
    put(BS, 'FixedAssets', sum(['ppe', 'intangibles', 'cwip', 'intangiblesDev'], y));
    ['ncInvestments', 'deferredTaxAsset', 'ltLoans', 'otherNcAssets'].forEach(bs);
    put(BS, 'NoncurrentAssets', sum(['ppe', 'intangibles', 'cwip', 'intangiblesDev', 'ncInvestments', 'deferredTaxAsset', 'ltLoans', 'otherNcAssets'], y));
    ['curInvestments', 'inventories', 'tradeReceivables', 'cash', 'stLoans', 'otherCurAssets'].forEach(bs);
    put(BS, 'CurrentAssets', sum(['curInvestments', 'inventories', 'tradeReceivables', 'cash', 'stLoans', 'otherCurAssets'], y));
    bs('totalAssets');

    // Revenue: from operations needs its parts (business rule 1). Duties / taxes collected are deducted.
    const [prod, serv, oth, dut] = (['revProducts', 'revServices', 'revOther', 'revDuties'] as const).map((k) => v(d.extra[k], y));
    if (prod !== null || serv !== null || oth !== null) {
      add(PL, 'RevenueFromSaleOfProducts', p, prod); add(PL, 'RevenueFromSaleOfServices', p, serv); add(PL, 'OtherOperatingRevenues', p, oth); add(PL, 'OtherDutiesTaxesCollected', p, dut);
      add(PL, 'RevenueFromOperationsOtherThanFinanceCompany', p, (prod ?? 0) + (serv ?? 0) + (oth ?? 0) - (dut ?? 0));
    } else if ((fig('revenue', y) ?? 0) !== 0) issues.push({ level: 'fix', section: PL, text: `Split revenue from operations (${y === 'cy' ? 'current' : 'previous'} year) into sale of products, sale of services and other operating revenue.` });
    put(PL, 'RevenueFromOperations', fig('revenue', y));
    put(PL, 'OtherIncome', fig('otherIncome', y));
    put(PL, 'Revenue', fig('totalIncome', y));
    ['materials', 'purchases', 'inventoryChange', 'employee', 'finance'].forEach((k) => put(PL, LINE_ELEMENT[k], fig(k, y)));
    const dep = fig('depreciation', y);
    const depOnly = v(d.extra.depreciationOnly, y); const amort = v(d.extra.amortisation, y);
    if (depOnly !== null || amort !== null) { add(PL, 'DepreciationExpense', p, depOnly); add(PL, 'AmortisationExpense', p, amort); }
    else if ((dep ?? 0) !== 0) { add(PL, 'DepreciationExpense', p, dep); if (y === 'cy') issues.push({ level: 'look', section: PL, text: 'All of depreciation and amortisation is reported as depreciation — enter amortisation separately if there is any.' }); }
    put(PL, 'DepreciationDepletionAndAmortisationExpense', dep);
    const csr = v(d.extra.csr, y) ?? 0;
    put(PL, 'CSRExpenditure', csr);
    put(PL, 'OtherExpenses', fig('otherExpenses', y) === null ? null : fig('otherExpenses', y)! - csr);
    put(PL, 'Expenses', fig('totalExpenses', y));
    const beforeExceptional = (fig('totalIncome', y) ?? 0) - (fig('totalExpenses', y) ?? 0);
    const exceptional = -(fig('exceptional', y) ?? 0); // our line is an expense when positive; the taxonomy adds it
    add(PL, 'ProfitBeforePriorPeriodItemsExceptionalItemsExtraordinaryItemsAndTax', p, beforeExceptional);
    if (exceptional !== 0) add(PL, 'ExceptionalItemsBeforeTax', p, exceptional);
    add(PL, 'ProfitBeforeExtraordinaryItemsAndTax', p, beforeExceptional + exceptional);
    put(PL, 'ProfitBeforeTax', fig('pbt', y));
    put(PL, 'CurrentTax', fig('currentTax', y)); put(PL, 'DeferredTax', fig('deferredTax', y));
    const tax = (fig('currentTax', y) ?? 0) + (fig('deferredTax', y) ?? 0);
    put(PL, 'TaxExpense', tax);
    put(PL, 'ProfitLossForPeriodFromContinuingOperations', (fig('pbt', y) ?? 0) - tax);
    add(PL, 'ProfitLossForPeriodBeforeMinorityInterest', p, (fig('pbt', y) ?? 0) - tax);
    put(PL, 'ProfitLossForPeriod', fig('pat', y));
    const eb = v(d.extra.epsBasic, y); const ed = v(d.extra.epsDiluted, y);
    add(PL, 'BasicEarningPerEquityShare', p, eb); add(PL, 'DilutedEarningsPerEquityShare', p, ed ?? eb);
    if (eb === null) issues.push({ level: 'fix', section: PL, text: `Basic earnings per share (${y === 'cy' ? 'current' : 'previous'} year) is mandatory.` });
    if (d.shares) add(PL, 'NominalValueOfPerEquityShare', p, d.shares.par);
  }
  if (zeroFilled.size) issues.push({ level: 'look', section: BS, text: `${zeroFilled.size} mandatory line${zeroFilled.size === 1 ? '' : 's'} not in the statements reported as 0: ${[...zeroFilled].slice(0, 6).join(', ')}${zeroFilled.size > 6 ? '…' : ''}.` });
  for (const y of years) {
    const el = fig('totalEqLiab', y), as = fig('totalAssets', y);
    if (el !== null && as !== null && Math.abs(el - as) > 1) issues.push({ level: 'fix', section: BS, text: `Equity and liabilities must equal assets (${y === 'cy' ? 'current' : 'previous'} year).` });
  }
  for (const f of facts) if (NON_NEGATIVE.includes(f.concept) && typeof f.value === 'number' && f.value < 0) issues.push({ level: 'fix', section: f.section, concept: f.concept, text: `${f.concept} must not be negative.` });

  // ---- [200100] Share capital: one class of equity shares at the parent members (ShareCapital member is the default, so no dimension)
  const SC = '[200100] Share capital';
  const shareCapital = fig('shareCapital', 'cy') ?? 0;
  if (d.shares && d.shares.par > 0) {
    const s = d.shares;
    const levels = [[], [{ axis: 'ClassesOfShareCapitalAxis', member: 'EquitySharesMember' }], [{ axis: 'ClassesOfShareCapitalAxis', member: 'EquityShares1Member' }]];
    for (const dims of levels) {
      const leaf = dims.length && dims[0].member === 'EquityShares1Member';
      for (const y of years) {
        const p = PER[y];
        const [au, is, pu] = [v(s.authorised, y), v(s.issued, y), v(s.paidUp, y)];
        if (au === null || is === null || pu === null) { if (leaf) issues.push({ level: 'fix', section: SC, text: `Number of shares authorised / issued / paid up (${y === 'cy' ? 'current' : 'previous'} year) is missing.` }); continue; }
        const money = (n: number) => Math.round(n * s.par * 100) / 100;
        add(SC, 'NumberOfSharesAuthorised', p, au, dims); add(SC, 'ValueOfSharesAuthorised', p, money(au), dims);
        add(SC, 'NumberOfSharesIssued', p, is, dims); add(SC, 'ValueOfSharesIssued', p, money(is), dims);
        add(SC, 'NumberOfSharesSubscribedAndFullyPaid', p, pu, dims); add(SC, 'ValueOfSharesSubscribedAndFullyPaid', p, money(pu), dims);
        add(SC, 'NumberOfSharesSubscribedButNotFullyPaid', p, 0, dims); add(SC, 'ValueOfSharesSubscribedButNotFullyPaid', p, 0, dims);
        add(SC, 'NumberOfSharesSubscribed', p, pu, dims); add(SC, 'ValueOfSharesSubscribed', p, money(pu), dims);
        add(SC, 'NumberOfSharesPaidUp', p, pu, dims); add(SC, 'ValueOfSharesCalled', p, money(pu), dims); add(SC, 'ValueOfSharesPaidUp', p, money(pu), dims);
        add(SC, 'NumberOfSharesOutstanding', p, pu, dims);
        if (dims.length) add(SC, 'ShareCapital', p, money(pu), dims); // the default member's share capital is the balance sheet fact
        if (leaf) { add(SC, 'TypeOfShare', p, 'Equity shares', dims); add(SC, 'ParValuePerShare', p, s.par, dims); add(SC, 'AmountPerShareCalledInCaseSharesNotFullyCalled', p, 0, dims); }
        // Reconciliation: change in the year = closing − opening (opening of the previous year is asked for separately).
        const opening = y === 'cy' ? v(s.paidUp, 'py') : s.pyOpening;
        if (opening === null || opening === undefined) { if (leaf && !d.firstYear) issues.push({ level: 'look', section: SC, text: 'Shares outstanding at the start of the previous year not given — the previous-year reconciliation is left out.' }); continue; }
        if (y === 'py') { add(SC, 'NumberOfSharesOutstanding', 'PY0', opening, dims); if (dims.length) add(SC, 'ShareCapital', 'PY0', money(opening), dims); else add(SC, 'ShareCapital', 'PY0', money(opening)); }
        const change = pu - opening;
        add(SC, 'IncreaseDecreaseInNumberOfSharesOutstanding', p, change, dims);
        add(SC, 'IncreaseDecreaseInShareCapital', p, money(change), dims);
        if (change > 0) {
          add(SC, 'NumberOfOtherIssuesOfShares', p, change, dims); add(SC, 'AggregateNumberOfSharesIssuedDuringPeriod', p, change, dims);
          add(SC, 'AmountOfOtherIssuesDuringPeriod', p, money(change), dims); add(SC, 'AggregateAmountOfIncreaseInShareCapitalDuringPeriod', p, money(change), dims);
          if (leaf) issues.push({ level: 'look', section: SC, text: `${change} shares issued in the ${y === 'cy' ? 'current' : 'previous'} year are reported as “other issues” — classify them (rights, private placement, bonus…) if needed.` });
        } else if (change < 0) {
          add(SC, 'OtherDecreaseInNumberOfShares', p, -change, dims); add(SC, 'DecreaseInNumberOfSharesDuringPeriod', p, -change, dims);
          add(SC, 'DecreaseInShareCapitalDuringPeriod', p, money(-change), dims);
        }
      }
    }
    const pu = v(s.paidUp, 'cy');
    if (pu !== null && Math.abs(pu * s.par - shareCapital) > 1) issues.push({ level: 'fix', section: SC, text: `Paid-up shares × par value (₹${Math.round(pu * s.par).toLocaleString('en-IN')}) must equal share capital in the balance sheet (₹${shareCapital.toLocaleString('en-IN')}).` });
  } else if (shareCapital > 0) issues.push({ level: 'fix', section: SC, text: 'The share capital note is mandatory when share capital is more than zero: number of shares and par value are missing.' });

  // ---- [400300] Signatories (current year only)
  const SG = '[400300] Signatories';
  const ds = d.signatories.directors.filter((x) => x.name);
  if (!ds.length) issues.push({ level: 'fix', section: SG, text: 'At least one director signing the financial statements is needed.' });
  ds.forEach((x, i) => {
    const dims = [{ axis: 'DirectorsSigningFinancialStatementsAxis', typed: String(i + 1) }];
    const n = nameParts(x.name);
    add(SG, 'FirstNameOfDirector', 'CY', n.first, dims); add(SG, 'MiddleNameOfDirector', 'CY', n.middle, dims); add(SG, 'LastNameOfDirector', 'CY', n.last, dims);
    add(SG, 'DesignationOfDirector', 'CY', x.designation ?? 'Director', dims);
    add(SG, 'DirectorIdentificationNumberOfDirector', 'CY', x.din ?? null, dims);
    add(SG, 'DateOfSigningOfFinancialStatementsByDirector', 'CY', x.date ?? null, dims);
    if (!x.din || !x.date) issues.push({ level: 'fix', section: SG, text: `${x.name}: DIN and date of signing are needed.` });
  });
  for (const [who, el] of [[d.signatories.cs, 'CompanySecretary'], [d.signatories.cfo, 'ChiefFinancialOfficer']] as const) {
    if (!who) continue;
    add(SG, `NameOf${el}`, 'CY', who.name); add(SG, `PermanentAccountNumberOf${el}`, 'CY', who.pan ?? null); add(SG, `DateOfSigningOfFinancialStatementsBy${el}`, 'CY', who.date ?? null);
  }

  // ---- [400200] Auditor (current year only)
  const AU = '[400200] Auditor';
  if (d.auditor) {
    const a = d.auditor; const dims = [{ axis: 'AuditorsAxis', typed: '1' }];
    add(AU, 'CategoryOfAuditor', 'CY', a.category, dims); add(AU, 'NameOfAuditFirm', 'CY', a.firmName, dims); add(AU, 'NameOfAuditorSigningReport', 'CY', a.signingName, dims);
    add(AU, 'FirmsRegistrationNumberOfAuditFirm', 'CY', a.frn, dims); add(AU, 'MembershipNumberOfAuditor', 'CY', a.membershipNo, dims); add(AU, 'AddressOfAuditors', 'CY', a.address, dims);
    add(AU, 'PermanentAccountNumberOfAuditorOrAuditorsFirm', 'CY', a.pan, dims); add(AU, 'SRNOfFormADT1', 'CY', a.adt1Srn, dims);
    add(AU, 'DateOfSigningAuditReportByAuditors', 'CY', a.reportDate, dims); add(AU, 'DateOfSigningOfBalanceSheetByAuditors', 'CY', a.bsSignDate ?? a.reportDate, dims);
    const missing = Object.entries({ 'name of the auditor signing': a.signingName, 'membership number': a.membershipNo, address: a.address, PAN: a.pan, 'SRN of ADT-1': a.adt1Srn, 'date of the audit report': a.reportDate }).filter(([, x]) => !x).map(([k]) => k);
    if (missing.length) issues.push({ level: 'fix', section: AU, text: `Auditor: ${missing.join(', ')} missing.` });
  } else issues.push({ level: 'fix', section: AU, text: 'No current auditor on record.' });

  // ---- Previous year for every monetary fact (business rule 6), calculations, then write.
  issues.push(...checkCalculations(facts, ['BalanceSheet', 'StatementOfProfitAndLoss']));
  return { facts, issues };
}

/** Builds the facts and the XML, and merges the issues (business rules first, then anything the writer refused). */
export function aoc4Instance(d: XbrlData) {
  const { facts, issues } = buildAoc4Xbrl(d);
  const out = writeInstance(d.company.cin, d.fy, facts);
  const all = [...issues, ...out.issues];
  return { xml: out.xml, facts: out.written, issues: all, fixes: all.filter((i) => i.level === 'fix').length, coverage: COVERAGE };
}

