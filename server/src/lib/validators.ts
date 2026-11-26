/**
 * One set of field rules for clients, people, shareholders and auditors — used by the screens' API routes
 * and by the Excel import, so both accept exactly the same data.
 */
import { z } from 'zod';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date (YYYY-MM-DD)');
const optDate = dateStr.nullish().or(z.literal('').transform(() => null));
const optText = z.string().trim().nullish().transform((v) => (v ? v : null));
const money = z.union([z.number(), z.string()]).nullish().transform((v) => (v === null || v === undefined || v === '' ? null : String(v)))
  .refine((v) => v === null || /^\d+(\.\d+)?$/.test(v), 'Enter an amount');

export const CIN_RE = /^[LU]\d{5}[A-Z]{2}\d{4}(PTC|OPC|PLC|NPL|GOI|SGC|FLC|GAP|ULL|ULT)\d{6}$/;
export const DIN_RE = /^\d{8}$/;
export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

export const COMPANY_TYPES = ['PRIVATE', 'OPC'] as const;
export const DESIGNATIONS = ['DIRECTOR', 'MANAGING_DIRECTOR', 'WHOLE_TIME_DIRECTOR', 'NOMINEE_DIRECTOR', 'INDEPENDENT_DIRECTOR', 'CEO', 'CFO', 'CS'] as const;
export const DESIGNATION_LABEL: Record<string, string> = { DIRECTOR: 'Director', MANAGING_DIRECTOR: 'Managing Director', WHOLE_TIME_DIRECTOR: 'Whole-time Director', NOMINEE_DIRECTOR: 'Nominee Director', INDEPENDENT_DIRECTOR: 'Independent Director', CEO: 'CEO', CFO: 'CFO', CS: 'Company Secretary' };
export const FLAGS = { msmeDues: 'Owes MSME suppliers for more than 45 days (MSME-1)', depositsOrLoans: 'Has outstanding loans / money received (DPT-3)', xbrl: 'Files financial statements in XBRL (AOC-4 XBRL)' } as const;

export const clientInput = z.object({
  cin: z.string().trim().toUpperCase().regex(CIN_RE, 'CIN should look like U72900TN2015PTC123456'),
  name: z.string().trim().min(2, 'Enter the company name'),
  companyType: z.enum(COMPANY_TYPES),
  smallCompany: z.boolean().default(false),
  incorporationDate: optDate,
  rocOffice: optText,
  registeredOffice: optText,
  email: z.string().trim().email('Enter a valid email').nullish().or(z.literal('').transform(() => null)),
  authorisedCapital: money,
  paidUpCapital: money,
  flags: z.record(z.boolean()).default({}),
  ownerId: optText,
}).superRefine((c, ctx) => {
  // The CIN carries the company type: catch a mismatch early.
  if (c.companyType === 'OPC' && !c.cin.includes('OPC')) ctx.addIssue({ code: 'custom', path: ['cin'], message: 'An OPC’s CIN contains “OPC”' });
  if (c.companyType === 'PRIVATE' && !c.cin.includes('PTC')) ctx.addIssue({ code: 'custom', path: ['cin'], message: 'A private company’s CIN contains “PTC”' });
});

export const personInput = z.object({
  name: z.string().trim().min(2, 'Enter the name'),
  designation: z.enum(DESIGNATIONS),
  din: z.string().trim().nullish().transform((v) => v || null).refine((v) => !v || DIN_RE.test(v), 'DIN is 8 digits'),
  pan: z.string().trim().toUpperCase().nullish().transform((v) => v || null).refine((v) => !v || PAN_RE.test(v), 'PAN looks like ABCDE1234F'),
  email: z.string().trim().email('Enter a valid email').nullish().or(z.literal('').transform(() => null)),
  appointedOn: optDate,
  ceasedOn: optDate,
  dscExpiry: optDate,
  dinAllottedOn: optDate,
  kycLastFiledFy: z.coerce.number().int().min(2000).max(2100).nullish().or(z.literal('').transform(() => null)),
  fatherName: optText, address: optText, dob: optDate, nationality: optText, occupation: optText, membershipNo: optText,
}).superRefine((p, ctx) => {
  if (p.designation.includes('DIRECTOR') && !p.din) ctx.addIssue({ code: 'custom', path: ['din'], message: 'A director needs a DIN' });
});

export const shareholderInput = z.object({
  name: z.string().trim().min(2, 'Enter the name'),
  pan: z.string().trim().toUpperCase().nullish().transform((v) => v || null).refine((v) => !v || PAN_RE.test(v), 'PAN looks like ABCDE1234F'),
  folio: optText,
  shareClass: z.enum(['EQUITY', 'PREFERENCE']).default('EQUITY'),
  shares: z.coerce.number().int().min(0, 'Number of shares'),
  faceValue: money.transform((v) => v ?? '10'),
  fatherName: optText, address: optText, email: z.string().trim().email('Enter a valid email').nullish().or(z.literal('').transform(() => null)),
  occupation: optText, nationality: optText, becameMemberOn: optDate, ceasedOn: optDate,
}).superRefine((s, ctx) => {
  if (!s.shares && !s.ceasedOn) ctx.addIssue({ code: 'custom', path: ['shares'], message: 'Number of shares (0 only for a former member — enter the date they ceased)' });
});

export const auditorInput = z.object({
  firmName: z.string().trim().min(2, 'Enter the audit firm'),
  frn: optText,
  appointedOn: optDate,
  termFromFy: z.coerce.number().int().min(2000).max(2100).nullish().or(z.literal('').transform(() => null)),
  termToFy: z.coerce.number().int().min(2000).max(2100).nullish().or(z.literal('').transform(() => null)),
  current: z.boolean().default(true),
});

export const yearInput = z.object({ agmDate: optDate, firstBoardMeetingDate: optDate });

export const obligationPatch = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'FILED', 'NOT_APPLICABLE']).optional(),
  srn: optText.optional(),
  filedOn: optDate.optional(),
  assigneeId: optText.optional(),
  notes: optText.optional(),
  dueDate: dateStr.optional(),
}).refine((o) => o.status !== 'FILED' || !!o.filedOn, { message: 'Enter the filed date', path: ['filedOn'] });

export const eventInput = z.object({ ruleCode: z.string(), eventDate: dateStr, label: z.string().trim().min(2, 'Describe the event'), personId: optText });

/** Turns a zod error into { field: message } for the screens. */
export const fieldErrors = (e: z.ZodError) => Object.fromEntries(e.issues.map((i) => [i.path.join('.') || '_', i.message]));
