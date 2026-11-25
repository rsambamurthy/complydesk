/** Statutory registers for a client: views, entries (add / edit / remove), event filings they record, Excel. */
import ExcelJS from 'exceljs';
import { and, eq } from 'drizzle-orm';
import { db, schema, HttpError, notFound } from '../lib/core.js';
import { DESIGNATION_LABEL } from '../lib/validators.js';
import { getClient } from './clients.js';
import { addEvent } from './obligations.js';
import { REGISTERS, registerSpec, type RegisterSpec } from '../registers/specs.js';
import { buildAll, buildRegister, checkEntry, namesFrom, newEvents, type Entry, type RegCtx } from '../registers/build.js';

const { people, shareholders, registerEntries: re } = schema;

async function contextFor(tenantId: string, clientId: string): Promise<RegCtx> {
  const [ps, ms, es] = await Promise.all([
    db.select().from(people).where(and(eq(people.tenantId, tenantId), eq(people.clientId, clientId))),
    db.select().from(shareholders).where(and(eq(shareholders.tenantId, tenantId), eq(shareholders.clientId, clientId))),
    db.select().from(re).where(and(eq(re.tenantId, tenantId), eq(re.clientId, clientId))),
  ]);
  return { people: ps as any, members: ms as any, entries: es as Entry[], designationLabel: (d) => DESIGNATION_LABEL[d] ?? d };
}

const specOr404 = (code: string) => { const s = registerSpec(code); if (!s) throw notFound('No such register'); return s; };
const entrySpec = (code: string) => { const s = specOr404(code); if (s.kind !== 'entries') throw new HttpError(400, 'This register is built from the client’s records — edit the Directors & KMP or Shareholders tab.'); return s; };

export async function registerList(tenantId: string, clientId: string) {
  await getClient(tenantId, clientId);
  const views = buildAll(await contextFor(tenantId, clientId));
  return views.map((v) => ({ code: v.code, title: v.title, short: v.short, law: v.law, form: v.form, kind: v.kind, count: v.rows.length, open: v.rows.filter((r) => !r.closed).length, warnings: v.warnings.length }));
}

export async function registerView(tenantId: string, clientId: string, code: string) {
  const spec = specOr404(code);
  const client = await getClient(tenantId, clientId);
  const ctx = await contextFor(tenantId, clientId);
  const view = buildRegister(spec, ctx);
  const raw = spec.kind === 'entries' ? Object.fromEntries(ctx.entries.filter((e) => e.register === code).map((e) => [e.id, e.data])) : {};
  return {
    client: { id: client.id, name: client.name, cin: client.cin },
    ...view, fields: spec.fields ?? [], raw,
    options: {
      people: ctx.people.map((p) => ({ value: p.id, label: `${p.name}${p.ceasedOn ? ' (ceased)' : ''}` })),
      members: ctx.members.map((m) => ({ value: m.id, label: `${m.name}${m.folio ? ` · folio ${m.folio}` : ''}` })),
    },
  };
}

async function saveEvents(tenantId: string, clientId: string, spec: RegisterSpec, data: Record<string, any>, before: Record<string, any> | null, ctx: RegCtx) {
  const added: { form: string; dueDate: string; label: string }[] = [];
  for (const ev of newEvents(spec, data, before, namesFrom(ctx))) {
    try {
      const o = await addEvent(tenantId, clientId, { ruleCode: ev.ruleCode, eventDate: ev.eventDate, label: ev.label } as any);
      added.push({ form: o.form, dueDate: o.dueDate, label: ev.label });
    } catch (e) { if (!(e instanceof HttpError && e.status === 409)) throw e; }
  }
  return added;
}

const datesOf = (spec: RegisterSpec, d: Record<string, any>) => ({ entryDate: d[spec.dateKey!] as string, closedOn: spec.closeKey ? (d[spec.closeKey] ?? null) : null });

export async function addEntry(tenantId: string, userId: string, clientId: string, code: string, raw: Record<string, any>) {
  const spec = entrySpec(code);
  await getClient(tenantId, clientId);
  const ctx = await contextFor(tenantId, clientId);
  const { data, errors, ok } = checkEntry(spec, raw, ctx);
  if (!ok) throw new HttpError(400, 'Please check the highlighted fields', errors);
  const [row] = await db.insert(re).values({ tenantId, clientId, register: code, data, ...datesOf(spec, data), createdBy: userId }).returning();
  return { entry: row, filings: await saveEvents(tenantId, clientId, spec, data, null, ctx) };
}

async function getEntry(tenantId: string, id: string) {
  const [e] = await db.select().from(re).where(and(eq(re.id, id), eq(re.tenantId, tenantId)));
  if (!e) throw notFound('Entry not found');
  return e;
}

export async function updateEntry(tenantId: string, id: string, raw: Record<string, any>) {
  const e = await getEntry(tenantId, id);
  const spec = entrySpec(e.register);
  const ctx = await contextFor(tenantId, e.clientId);
  const { data, errors, ok } = checkEntry(spec, raw, ctx);
  if (!ok) throw new HttpError(400, 'Please check the highlighted fields', errors);
  const [row] = await db.update(re).set({ data, ...datesOf(spec, data), updatedAt: new Date() }).where(eq(re.id, id)).returning();
  return { entry: row, filings: await saveEvents(tenantId, e.clientId, spec, data, e.data as any, ctx) };
}

export async function removeEntry(tenantId: string, id: string) {
  const e = await getEntry(tenantId, id);
  await db.delete(re).where(eq(re.id, id));
  return e;
}
export const entryClient = async (tenantId: string, id: string) => (await getEntry(tenantId, id)).clientId;

/** Excel: one sheet per register (or just one), every column, with the company and the law at the top. */
export async function registersWorkbook(tenantId: string, clientId: string, code?: string) {
  const client = await getClient(tenantId, clientId);
  const ctx = await contextFor(tenantId, clientId);
  const specs = code ? [specOr404(code)] : REGISTERS;
  const wb = new ExcelJS.Workbook(); wb.creator = 'ComplyDesk';
  for (const spec of specs) {
    const v = buildRegister(spec, ctx);
    const ws = wb.addWorksheet(v.short.replace(/[^\w &-]/g, '').slice(0, 30));
    ws.addRow([`${client.name}${client.cin ? ` (CIN ${client.cin})` : ''}`]).font = { bold: true, size: 13 };
    ws.addRow([`${v.title}${v.form ? ` — Form ${v.form}` : ''}`]).font = { bold: true };
    ws.addRow([`[${v.law}]`]).font = { italic: true, color: { argb: 'FF555555' } };
    ws.addRow([]);
    const head = ws.addRow(v.columns.map((c) => c.label)); head.font = { bold: true }; head.alignment = { wrapText: true, vertical: 'top' };
    for (const r of v.rows) {
      const row = ws.addRow(v.columns.map((c) => r.cells[c.key] ?? ''));
      row.alignment = { wrapText: true, vertical: 'top' };
      if (r.closed) row.font = { color: { argb: 'FF777777' } };
    }
    if (!v.rows.length) ws.addRow(['No entries.']);
    v.columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.key === '_no' ? 6 : /address|property|terms|movements|remarks|securities|modification/.test(c.key) ? 40 : 20; });
  }
  const name = `Registers ${code ? `${specs[0].short} ` : ''}${client.name}.xlsx`.replace(/[^\w .&-]/g, '');
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), fileName: name };
}
