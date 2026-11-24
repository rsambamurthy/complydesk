/**
 * Bulk import of clients with their directors/KMP and shareholders from one Excel workbook (three sheets,
 * matched by CIN). Check first (nothing saved), then import. Rows go through the same validators and the
 * same client service as the screens.
 */
import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import { db, schema, h, audit, HttpError } from '../lib/core.js';
import { requirePerm } from '../auth/session.js';
import { clientInput, personInput, shareholderInput, fieldErrors, DESIGNATIONS } from '../lib/validators.js';
import { createClient, peopleSvc, shareholdersSvc } from '../services/clients.js';
import { syncClient } from '../compliance/sync.js';
import { assertClientCapacity } from '../services/platform.js';

export const importRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

interface Col { header: string; key: string; type?: 'date' | 'bool' | 'number'; required?: boolean; width?: number }
const SHEETS: { name: string; cols: Col[]; example: (string | number)[] }[] = [
  { name: 'Clients', cols: [
    { header: 'CIN', key: 'cin', required: true, width: 26 }, { header: 'Company name', key: 'name', required: true, width: 34 },
    { header: 'Type (PRIVATE/OPC)', key: 'companyType', required: true }, { header: 'Small company (Y/N)', key: 'smallCompany', type: 'bool' },
    { header: 'Incorporation date', key: 'incorporationDate', type: 'date' }, { header: 'RoC', key: 'rocOffice' },
    { header: 'Registered office', key: 'registeredOffice', width: 40 }, { header: 'Email', key: 'email', width: 26 },
    { header: 'Authorised capital', key: 'authorisedCapital', type: 'number' }, { header: 'Paid-up capital', key: 'paidUpCapital', type: 'number' },
    { header: 'MSME dues > 45 days (Y/N)', key: 'flags.msmeDues', type: 'bool' }, { header: 'Loans / deposits outstanding (Y/N)', key: 'flags.depositsOrLoans', type: 'bool' },
  ], example: ['U72900TN2015PTC123456', 'Example Technologies Private Limited', 'PRIVATE', 'N', '2015-06-10', 'RoC Chennai', 'Chennai', 'cs@example.com', 1000000, 500000, 'N', 'Y'] },
  { name: 'Directors & KMP', cols: [
    { header: 'CIN', key: 'cin', required: true, width: 26 }, { header: 'Name', key: 'name', required: true, width: 26 },
    { header: 'Designation', key: 'designation', required: true, width: 22 }, { header: 'DIN', key: 'din' }, { header: 'PAN', key: 'pan' },
    { header: 'Email', key: 'email', width: 26 }, { header: 'Appointed on', key: 'appointedOn', type: 'date' },
    { header: 'DSC expiry', key: 'dscExpiry', type: 'date' }, { header: 'DIN allotted on', key: 'dinAllottedOn', type: 'date' },
    { header: 'Last DIR-3 KYC filed in FY (e.g. 2025)', key: 'kycLastFiledFy', type: 'number' },
  ], example: ['U72900TN2015PTC123456', 'Anita Rao', 'MANAGING_DIRECTOR', '01234567', 'ABCDE1234F', 'anita@example.com', '2015-06-10', '2027-03-31', '2015-05-20', 2025] },
  { name: 'Shareholders', cols: [
    { header: 'CIN', key: 'cin', required: true, width: 26 }, { header: 'Name', key: 'name', required: true, width: 26 },
    { header: 'PAN', key: 'pan' }, { header: 'Folio', key: 'folio' }, { header: 'Class (EQUITY/PREFERENCE)', key: 'shareClass' },
    { header: 'Shares', key: 'shares', type: 'number', required: true }, { header: 'Face value', key: 'faceValue', type: 'number' },
  ], example: ['U72900TN2015PTC123456', 'Anita Rao', 'ABCDE1234F', 'F001', 'EQUITY', 40000, 10] },
];

importRouter.get('/template', requirePerm('clients.manage'), h(async (_req, res) => {
  const wb = new ExcelJS.Workbook();
  const how = wb.addWorksheet('How to fill in');
  how.columns = [{ width: 24 }, { width: 100 }];
  for (const [a, b] of [
    ['Sheets', 'Clients, Directors & KMP and Shareholders. Directors and shareholders are matched to a client by CIN (in this file or already added).'],
    ['Yellow columns', 'Required. Blue columns are optional.'],
    ['Dates', 'YYYY-MM-DD or an Excel date.'],
    ['Designation', DESIGNATIONS.join(', ')],
    ['Example rows', 'The grey row on each sheet is an example: replace or delete it.'],
  ]) { const r = how.addRow([a, b]); r.getCell(1).font = { bold: true }; }
  for (const s of SHEETS) {
    const ws = wb.addWorksheet(s.name);
    const head = ws.addRow(s.cols.map((c) => c.header)); head.font = { bold: true };
    s.cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width ?? 18; head.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.required ? 'FFFDE68A' : 'FFDBEAFE' } }; });
    ws.addRow(s.example).font = { italic: true, color: { argb: 'FF64748B' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="clients-import-template.xlsx"');
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));

function cell(c: ExcelJS.Cell, type?: Col['type']) {
  let v: any = c.value;
  if (v && typeof v === 'object' && 'result' in v) v = v.result;
  if (v && typeof v === 'object' && 'richText' in v) v = v.richText.map((t: any) => t.text).join('');
  if (v && typeof v === 'object' && 'text' in v) v = v.text;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (type === 'bool') return /^(y|yes|true|1)$/i.test(String(v ?? '').trim());
  if (type === 'number') return v === null || v === undefined || v === '' ? null : Number(v);
  if (typeof v === 'number') return String(v);
  return String(v ?? '').trim();
}

function readRows(wb: ExcelJS.Workbook, s: (typeof SHEETS)[number]) {
  const ws = wb.getWorksheet(s.name);
  if (!ws) return [];
  const heads = (ws.getRow(1).values as any[]).map((v) => String(v ?? '').trim().toLowerCase());
  const out: { row: number; data: Record<string, any> }[] = [];
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const data: Record<string, any> = {};
    for (const c of s.cols) {
      const idx = heads.indexOf(c.header.toLowerCase());
      if (idx < 1) continue;
      const v = cell(r.getCell(idx), c.type);
      if (c.key.startsWith('flags.')) (data.flags ??= {})[c.key.slice(6)] = v; else data[c.key] = v;
    }
    if (Object.values(data).every((v) => v === '' || v === null || v === false || (typeof v === 'object' && Object.values(v).every((x) => !x)))) return;
    if (String(data.cin) === String(s.example[0])) return; // the example row, left in
    out.push({ row: n, data });
  });
  return out;
}

const errText = (e: z.ZodError) => Object.entries(fieldErrors(e)).map(([k, m]) => `${k}: ${m}`).join('; ');

importRouter.post('/', requirePerm('clients.manage'), upload.single('file'), h(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose the filled-in template');
  const tenantId = req.staff!.tenant.id;
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(req.file.buffer as any); } catch { throw new HttpError(400, 'This isn’t an Excel (.xlsx) file we can read.'); }
  const existing = new Map((await db.select({ id: schema.clients.id, cin: schema.clients.cin }).from(schema.clients).where(eq(schema.clients.tenantId, tenantId))).map((c) => [c.cin, c.id]));
  const errors: { row: number; message: string }[] = [];
  const ready: { row: number; sheet: string; cin: string; name: string; detail: string }[] = [];
  const newClients: { row: number; input: z.output<typeof clientInput> }[] = [];
  const kids: { row: number; sheet: string; cin: string; input: any }[] = [];

  for (const r of readRows(wb, SHEETS[0])) {
    const p = clientInput.safeParse({ ...r.data, smallCompany: !!r.data.smallCompany, companyType: String(r.data.companyType || '').toUpperCase() });
    if (!p.success) { errors.push({ row: r.row, message: `Clients: ${errText(p.error)}` }); continue; }
    if (existing.has(p.data.cin) || newClients.some((c) => c.input.cin === p.data.cin)) { errors.push({ row: r.row, message: `Clients: ${p.data.cin} is already added` }); continue; }
    newClients.push({ row: r.row, input: p.data });
    ready.push({ row: r.row, sheet: 'Clients', cin: p.data.cin, name: p.data.name, detail: p.data.companyType + (p.data.smallCompany ? ' · small' : '') });
  }
  const known = (cin: string) => existing.has(cin) || newClients.some((c) => c.input.cin === cin);
  for (const [s, schemaFor] of [[SHEETS[1], personInput], [SHEETS[2], shareholderInput]] as const) {
    for (const r of readRows(wb, s)) {
      const cin = String(r.data.cin ?? '').toUpperCase();
      if (!known(cin)) { errors.push({ row: r.row, message: `${s.name}: no client with CIN “${cin}”` }); continue; }
      const { cin: _c, ...rest } = r.data;
      const p = (schemaFor as z.ZodTypeAny).safeParse(s.name === 'Shareholders' ? { ...rest, shareClass: rest.shareClass ? String(rest.shareClass).toUpperCase() : undefined } : { ...rest, designation: String(rest.designation || '').toUpperCase().replace(/[\s-]+/g, '_') });
      if (!p.success) { errors.push({ row: r.row, message: `${s.name}: ${errText(p.error)}` }); continue; }
      kids.push({ row: r.row, sheet: s.name, cin, input: p.data });
      ready.push({ row: r.row, sheet: s.name, cin, name: p.data.name, detail: s.name === 'Shareholders' ? `${p.data.shares} shares` : p.data.designation });
    }
  }

  const created: string[] = [];
  if (req.query.commit) {
    await assertClientCapacity(tenantId, newClients.length);
    const ids = new Map(existing);
    for (const c of newClients) { const row = await createClient(tenantId, c.input, { sync: false }); ids.set(row.cin, row.id); created.push(row.id); }
    for (const k of kids) {
      const svc = k.sheet === 'Shareholders' ? shareholdersSvc : peopleSvc;
      const row = await svc.add(tenantId, ids.get(k.cin)!, k.input, { sync: false }); created.push((row as any).id);
    }
    for (const cin of new Set([...newClients.map((c) => c.input.cin), ...kids.map((k) => k.cin)])) await syncClient(tenantId, ids.get(cin)!);
    await audit(req, 'import.clients', 'client', null, { clients: newClients.length, rows: kids.length });
  }
  res.json({ ready, errors, created });
}));

