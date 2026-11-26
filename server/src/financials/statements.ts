/**
 * Financial statements for AOC-4 — pure. The line items of Schedule III (Division I) as data, the arithmetic checks a
 * person would do before filing (totals add up, the balance sheet balances, profit follows from income and expenses),
 * and whether the company must file in XBRL. AI reads the statements (extract/doctypes.ts FIN_STATEMENTS); code checks.
 * Tested in tests/statements.test.ts.
 */
export type Year = 'cy' | 'py';
export interface LineDef { key: string; label: string; total?: boolean; /** May be negative (e.g. change in inventories, reserves). */ signed?: boolean; help?: string }

export const BALANCE_SHEET: { title: string; lines: LineDef[] }[] = [
  { title: 'Equity and liabilities', lines: [
    { key: 'shareCapital', label: 'Share capital' },
    { key: 'reserves', label: 'Reserves and surplus', signed: true, help: 'Negative when accumulated losses exceed reserves.' },
    { key: 'shareWarrants', label: 'Money received against share warrants' },
    { key: 'shareAppMoney', label: 'Share application money pending allotment' },
    { key: 'ltBorrowings', label: 'Long-term borrowings' },
    { key: 'deferredTaxLiab', label: 'Deferred tax liabilities (net)' },
    { key: 'otherLtLiab', label: 'Other long-term liabilities' },
    { key: 'ltProvisions', label: 'Long-term provisions' },
    { key: 'stBorrowings', label: 'Short-term borrowings' },
    { key: 'tradePayables', label: 'Trade payables' },
    { key: 'otherCurLiab', label: 'Other current liabilities' },
    { key: 'stProvisions', label: 'Short-term provisions' },
    { key: 'totalEqLiab', label: 'Total equity and liabilities', total: true },
  ] },
  { title: 'Assets', lines: [
    { key: 'ppe', label: 'Property, plant and equipment (tangible assets)' },
    { key: 'intangibles', label: 'Intangible assets' },
    { key: 'cwip', label: 'Capital work-in-progress' },
    { key: 'intangiblesDev', label: 'Intangible assets under development' },
    { key: 'ncInvestments', label: 'Non-current investments' },
    { key: 'deferredTaxAsset', label: 'Deferred tax assets (net)' },
    { key: 'ltLoans', label: 'Long-term loans and advances' },
    { key: 'otherNcAssets', label: 'Other non-current assets' },
    { key: 'curInvestments', label: 'Current investments' },
    { key: 'inventories', label: 'Inventories' },
    { key: 'tradeReceivables', label: 'Trade receivables' },
    { key: 'cash', label: 'Cash and cash equivalents' },
    { key: 'stLoans', label: 'Short-term loans and advances' },
    { key: 'otherCurAssets', label: 'Other current assets' },
    { key: 'totalAssets', label: 'Total assets', total: true },
  ] },
];
export const PROFIT_LOSS: { title: string; lines: LineDef[] }[] = [
  { title: 'Statement of profit and loss', lines: [
    { key: 'revenue', label: 'Revenue from operations' },
    { key: 'otherIncome', label: 'Other income' },
    { key: 'totalIncome', label: 'Total income', total: true },
    { key: 'materials', label: 'Cost of materials consumed' },
    { key: 'purchases', label: 'Purchases of stock-in-trade' },
    { key: 'inventoryChange', label: 'Changes in inventories of finished goods, work-in-progress and stock-in-trade', signed: true },
    { key: 'employee', label: 'Employee benefits expense' },
    { key: 'finance', label: 'Finance costs' },
    { key: 'depreciation', label: 'Depreciation and amortisation expense' },
    { key: 'otherExpenses', label: 'Other expenses' },
    { key: 'totalExpenses', label: 'Total expenses', total: true, signed: true },
    { key: 'exceptional', label: 'Exceptional and extraordinary items (expense as positive)', signed: true },
    { key: 'pbt', label: 'Profit / (loss) before tax', signed: true },
    { key: 'currentTax', label: 'Current tax', signed: true },
    { key: 'deferredTax', label: 'Deferred tax', signed: true },
    { key: 'pat', label: 'Profit / (loss) for the year', signed: true },
  ] },
];
export const ALL_LINES = [...BALANCE_SHEET, ...PROFIT_LOSS].flatMap((g) => g.lines);
export const LINE = Object.fromEntries(ALL_LINES.map((l) => [l.key, l])) as Record<string, LineDef>;

/** Figures in whole rupees: { shareCapital: { cy: 500000, py: 500000 }, … }. Missing = null. */
export type Figures = Record<string, { cy: number | null; py: number | null }>;
export interface Issue { level: 'fix' | 'look'; text: string; keys: string[] }

const EQ_LIAB = ['shareCapital', 'reserves', 'shareWarrants', 'shareAppMoney', 'ltBorrowings', 'deferredTaxLiab', 'otherLtLiab', 'ltProvisions', 'stBorrowings', 'tradePayables', 'otherCurLiab', 'stProvisions'];
const ASSETS = ['ppe', 'intangibles', 'cwip', 'intangiblesDev', 'ncInvestments', 'deferredTaxAsset', 'ltLoans', 'otherNcAssets', 'curInvestments', 'inventories', 'tradeReceivables', 'cash', 'stLoans', 'otherCurAssets'];
const EXPENSES = ['materials', 'purchases', 'inventoryChange', 'employee', 'finance', 'depreciation', 'otherExpenses'];

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const YEAR_LABEL: Record<Year, string> = { cy: 'this year', py: 'previous year' };

/**
 * The checks. `roundedTo` = the smallest amount the statements show in rupees (1 for rupees, 1,000 for "₹ in lakhs"
 * with two decimals, 1,00,000 for "₹ in crores" with two decimals): differences within rounding are not flagged.
 */
export function checkStatements(f: Figures, opts: { roundedTo?: number; paidUpOnRecord?: number | null } = {}): Issue[] {
  const out: Issue[] = [];
  const step = Math.max(1, opts.roundedTo ?? 1);
  const v = (k: string, y: Year) => f[k]?.[y] ?? null;
  const sum = (keys: string[], y: Year) => keys.reduce((s, k) => s + (v(k, y) ?? 0), 0);
  const near = (a: number, b: number, parts: number) => Math.abs(a - b) <= step * Math.max(1, parts) / 2 + 0.5;
  for (const y of ['cy', 'py'] as Year[]) {
    const yl = YEAR_LABEL[y];
    const anyFigure = ALL_LINES.some((l) => v(l.key, y) !== null);
    if (!anyFigure) { if (y === 'cy') out.push({ level: 'fix', text: 'No figures for this year.', keys: [] }); continue; }
    const tEL = v('totalEqLiab', y); const tA = v('totalAssets', y);
    if (tEL !== null && !near(sum(EQ_LIAB, y), tEL, EQ_LIAB.length)) out.push({ level: 'fix', text: `Equity and liabilities, ${yl}: the lines add up to ${inr(sum(EQ_LIAB, y))}, the total says ${inr(tEL)}.`, keys: ['totalEqLiab'] });
    if (tA !== null && !near(sum(ASSETS, y), tA, ASSETS.length)) out.push({ level: 'fix', text: `Assets, ${yl}: the lines add up to ${inr(sum(ASSETS, y))}, the total says ${inr(tA)}.`, keys: ['totalAssets'] });
    if (tEL !== null && tA !== null && !near(tEL, tA, 1)) out.push({ level: 'fix', text: `The balance sheet doesn’t balance (${yl}): assets ${inr(tA)}, equity and liabilities ${inr(tEL)}.`, keys: ['totalAssets', 'totalEqLiab'] });
    if (tEL === null || tA === null) out.push({ level: 'look', text: `Balance sheet totals missing for ${yl}.`, keys: ['totalAssets', 'totalEqLiab'] });
    const ti = v('totalIncome', y);
    if (ti !== null && !near(sum(['revenue', 'otherIncome'], y), ti, 2)) out.push({ level: 'fix', text: `Total income, ${yl}: revenue + other income = ${inr(sum(['revenue', 'otherIncome'], y))}, the total says ${inr(ti)}.`, keys: ['totalIncome'] });
    const te = v('totalExpenses', y);
    if (te !== null && !near(sum(EXPENSES, y), te, EXPENSES.length)) out.push({ level: 'fix', text: `Total expenses, ${yl}: the lines add up to ${inr(sum(EXPENSES, y))}, the total says ${inr(te)}.`, keys: ['totalExpenses'] });
    const pbt = v('pbt', y);
    if (pbt !== null && ti !== null && te !== null && !near(ti - te - (v('exceptional', y) ?? 0), pbt, 3)) out.push({ level: 'fix', text: `Profit before tax, ${yl}: income − expenses − exceptional items = ${inr(ti - te - (v('exceptional', y) ?? 0))}, the statement says ${inr(pbt)}.`, keys: ['pbt'] });
    const pat = v('pat', y);
    if (pat !== null && pbt !== null && !near(pbt - (v('currentTax', y) ?? 0) - (v('deferredTax', y) ?? 0), pat, 3)) out.push({ level: 'fix', text: `Profit for the year, ${yl}: profit before tax − taxes = ${inr(pbt - (v('currentTax', y) ?? 0) - (v('deferredTax', y) ?? 0))}, the statement says ${inr(pat)}.`, keys: ['pat'] });
    for (const l of ALL_LINES) { const x = v(l.key, y); if (x !== null && x < 0 && !l.signed) out.push({ level: 'look', text: `${l.label} is negative (${yl}) — check the sign.`, keys: [l.key] }); }
  }
  const sc = v('shareCapital', 'cy');
  if (sc !== null && opts.paidUpOnRecord !== null && opts.paidUpOnRecord !== undefined && !near(sc, opts.paidUpOnRecord, 1))
    out.push({ level: 'look', text: `Share capital in the statements is ${inr(sc)}; ComplyDesk has paid-up capital ${inr(opts.paidUpOnRecord)}. Update the client, or check for an allotment (PAS-3) during the year.`, keys: ['shareCapital'] });
  if ((v('revenue', 'cy') ?? 0) === 0 && (v('totalIncome', 'cy') ?? 0) === 0) out.push({ level: 'look', text: 'No revenue this year — correct?', keys: ['revenue'] });
  return out;
}

/** Net worth = share capital + reserves and surplus (+ warrants money), for CSR and AOC-4. */
export const netWorth = (f: Figures, y: Year = 'cy') => ['shareCapital', 'reserves', 'shareWarrants'].reduce((s, k) => s + (f[k]?.[y] ?? 0), 0);
export const borrowings = (f: Figures, y: Year = 'cy') => (f.ltBorrowings?.[y] ?? 0) + (f.stBorrowings?.[y] ?? 0);

/**
 * Companies (Filing of Documents and Forms in XBRL) Rules, 2015, rule 3: listed companies and their Indian subsidiaries;
 * paid-up capital ≥ ₹5 crore; turnover ≥ ₹100 crore (gross, incl. duties and taxes); companies preparing Ind AS
 * statements; and companies that filed in XBRL before. Banking, insurance, power and NBFCs are exempt.
 */
export const XBRL_LIMITS = { paidUp: 5_00_00_000, turnover: 100_00_00_000 };
export function xbrlRequired(x: { paidUp?: number | null; turnover?: number | null; indAs?: boolean; listedOrSubsidiary?: boolean; filedXbrlBefore?: boolean; exemptSector?: boolean }) {
  if (x.exemptSector) return { required: false, reasons: ['Banking, insurance, power and NBFCs are exempt'] };
  const reasons: string[] = [];
  if (x.listedOrSubsidiary) reasons.push('listed company or Indian subsidiary of a listed company');
  if ((x.paidUp ?? 0) >= XBRL_LIMITS.paidUp) reasons.push('paid-up capital ₹5 crore or more');
  if ((x.turnover ?? 0) >= XBRL_LIMITS.turnover) reasons.push('turnover ₹100 crore or more');
  if (x.indAs) reasons.push('prepares Ind AS financial statements');
  if (x.filedXbrlBefore) reasons.push('filed in XBRL before (must continue)');
  return { required: reasons.length > 0, reasons };
}

/** Form-data keys used on AOC-4 filings: "fs.shareCapital.cy". */
export const fsKey = (line: string, y: Year) => `fs.${line}.${y}`;
export function figuresFromFormData(formData: Record<string, string | undefined>): Figures {
  const num = (s: string | undefined) => (s === undefined || s === '' ? null : Number(String(s).replace(/,/g, '')));
  return Object.fromEntries(ALL_LINES.map((l) => [l.key, { cy: num(formData[fsKey(l.key, 'cy')]), py: num(formData[fsKey(l.key, 'py')]) }]));
}
