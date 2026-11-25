/**
 * MCA form data packs for a filing: gather the records, build the pack (eforms/build.ts + forms.ts),
 * save the values the records don't hold, and export the pack to Excel for the team.
 */
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { db, schema, HttpError, notFound } from '../lib/core.js';
import { todayIso, fyLabel } from '../compliance/dates.js';
import { buildForm, inputKeys, type FormCtx, type MeetingLite } from '../eforms/build.js';
import { specFor } from '../eforms/forms.js';
import { clientDetail } from './clients.js';
import { getObligation } from './obligations.js';

const { meetings: m, meetingAttendance: att, obligations: o, clients } = schema;

async function contextFor(tenantId: string, obligationId: string) {
  const ob = await getObligation(tenantId, obligationId);
  const spec = specFor(ob.ruleCode);
  if (!spec) throw new HttpError(404, `No MCA form data pack for ${ob.form} yet`);
  const d = await clientDetail(tenantId, ob.clientId);
  const from = `${ob.fy}-04-01`; const to = `${ob.fy + 1}-03-31`;
  // Meetings held in the FY: from the Meetings module (with attendance), else from the calendar.
  const held = await db.select().from(m).where(and(eq(m.clientId, ob.clientId), inArray(m.status, ['HELD', 'MINUTES_SIGNED'])));
  const inFy = held.filter((x) => (x.heldOn ?? x.date) >= from && (x.heldOn ?? x.date) <= to);
  const marks = inFy.length ? await db.select().from(att).where(inArray(att.meetingId, inFy.map((x) => x.id))) : [];
  const directorsOn = (day: string) => d.people.filter((p) => p.designation.includes('DIRECTOR') && (!p.appointedOn || p.appointedOn <= day) && (!p.ceasedOn || p.ceasedOn > day)).length;
  let meetings: MeetingLite[] = inFy.map((x) => {
    const day = x.heldOn ?? x.date;
    if (x.type === 'BOARD') {
      const mine = marks.filter((a) => a.meetingId === x.id);
      return { type: 'BOARD', date: day, entitled: directorsOn(day), present: mine.length ? mine.filter((a) => a.status === 'PRESENT' || a.status === 'VIDEO').length : null };
    }
    return { type: x.type as 'AGM' | 'EGM', date: day, entitled: d.shareholders.length || null, present: x.membersPresent ?? null };
  });
  if (!inFy.length) {
    const cal = await db.select({ form: o.form, filedOn: o.filedOn }).from(o).where(and(eq(o.clientId, ob.clientId), inArray(o.form, ['Board meeting', 'AGM']), eq(o.status, 'FILED'), gte(o.filedOn, from), lte(o.filedOn, to)));
    meetings = cal.map((x) => ({ type: x.form === 'AGM' ? 'AGM' : 'BOARD', date: x.filedOn!, entitled: x.form === 'AGM' ? d.shareholders.length || null : directorsOn(x.filedOn!), present: null }));
  }
  meetings.sort((a, b) => a.date.localeCompare(b.date));
  // Charges (register of charges) and the meeting whose resolution created this filing.
  const charges = (await db.select().from(schema.registerEntries).where(and(eq(schema.registerEntries.clientId, ob.clientId), eq(schema.registerEntries.register, 'CHARGES'))))
    .map((e) => { const x = e.data as Record<string, any>; return { chargeId: x.chargeId ?? null, createdOn: x.createdOn, modifiedOn: x.modifiedOn ?? null, satisfiedOn: x.satisfiedOn ?? null, holder: x.holder, holderAddress: x.holderAddress ?? null, amount: x.amount ?? null, nature: x.nature ?? null, property: x.property ?? null, instrument: x.instrument ?? null, terms: x.terms ?? null, modification: x.modification ?? null }; });
  const [src] = await db.select({ i: schema.meetingItems, m }).from(schema.meetingItems).innerJoin(m, eq(m.id, schema.meetingItems.meetingId))
    .where(and(eq(m.clientId, ob.clientId), sql`${schema.meetingItems.createdObligationIds} @> ${JSON.stringify([ob.id])}::jsonb`)).limit(1);
  const fromMeeting = src ? {
    type: src.m.type as 'BOARD' | 'AGM' | 'EGM', title: src.m.title, date: src.m.heldOn ?? src.m.date,
    items: (await db.select().from(schema.meetingItems).where(and(eq(schema.meetingItems.meetingId, src.m.id), eq(schema.meetingItems.outcome, 'PASSED'))))
      .filter((i) => i.filings.includes(ob.ruleCode)).map((i) => ({ title: i.title, resolutionType: i.resolutionType, text: i.text, explanatory: i.explanatory })),
  } : null;
  const ctx: FormCtx = {
    today: todayIso(),
    client: d.client, profile: (d.client as any).profile ?? {}, formData: ob.formData ?? {},
    ob: { ruleCode: ob.ruleCode, form: ob.form, fy: ob.fy, dueDate: ob.dueDate, eventDate: ob.eventDate, personId: ob.personId },
    people: d.people, shareholders: d.shareholders, auditors: d.auditors, years: d.years, meetings, charges, fromMeeting,
  };
  return { ob, spec, ctx, clientId: d.client.id };
}

export const hasPack = (ruleCode: string) => !!specFor(ruleCode);

export async function formPack(tenantId: string, obligationId: string) {
  const { ob, spec, ctx, clientId } = await contextFor(tenantId, obligationId);
  return { obligation: { id: ob.id, form: ob.form, fy: ob.fy, fyLabel: fyLabel(ob.fy), dueDate: ob.dueDate, periodLabel: ob.periodLabel, clientId, clientName: ctx.client.name }, ...buildForm(spec, ctx) };
}

/** Saves typed values: client-scope keys into the client's profile (reused next year), filing-scope into the filing. */
export async function saveInputs(tenantId: string, obligationId: string, values: Record<string, unknown>) {
  const { ob, spec, ctx, clientId } = await contextFor(tenantId, obligationId);
  const keys = inputKeys(spec, ctx);
  const client: Record<string, string> = {}; const filing: Record<string, string> = {};
  for (const [k, v] of Object.entries(values ?? {})) {
    const scope = keys.get(k);
    if (!scope) continue;
    const s = v === null || v === undefined ? '' : String(v).trim().slice(0, 500);
    (scope === 'client' ? client : filing)[k] = s;
  }
  const drop = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== ''));
  if (Object.keys(client).length) await db.update(clients).set({ profile: drop({ ...ctx.profile, ...client }) }).where(eq(clients.id, clientId));
  if (Object.keys(filing).length) await db.update(o).set({ formData: drop({ ...ctx.formData, ...filing }) }).where(eq(o.id, ob.id));
  return formPack(tenantId, obligationId);
}

/** The pack as an Excel workbook: one sheet of fields, one per table (ready to paste into MCA's templates). */
export async function formWorkbook(tenantId: string, obligationId: string) {
  const p = await formPack(tenantId, obligationId);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ComplyDesk';
  const ws = wb.addWorksheet(p.form.replace(/[^\w-]/g, ''));
  ws.columns = [{ header: 'Part', width: 34 }, { header: 'Field on the form', width: 52 }, { header: 'Value', width: 48 }, { header: 'Source', width: 14 }];
  ws.getRow(1).font = { bold: true };
  ws.insertRow(1, [`${p.form} — ${p.obligation.clientName} — ${p.obligation.fyLabel}${p.obligation.periodLabel ? ` — ${p.obligation.periodLabel}` : ''}`]);
  ws.getRow(1).font = { bold: true, size: 13 };
  for (const part of p.parts) for (const f of part.fields) {
    const r = ws.addRow([part.title, f.label, f.value ?? (f.optional ? '' : 'MISSING'), f.source === 'records' ? 'Records' : f.source === 'client' ? 'Client profile' : 'This filing']);
    if (f.missing) r.getCell(3).font = { color: { argb: 'FFB42318' }, bold: true };
  }
  ws.addRow([]);
  ws.addRow(['Attachments to upload on MCA']).font = { bold: true };
  for (const a of p.attachments) ws.addRow(['', a.name, a.why ?? '']);
  for (const part of p.parts) for (const t of part.tables) {
    const sh = wb.addWorksheet(t.title.replace(/[^\w ]/g, '').slice(0, 30));
    sh.addRow(t.columns).font = { bold: true };
    for (const row of t.rows) sh.addRow(row.map((v) => (v === null ? '' : v)));
    sh.columns.forEach((c) => { c.width = 22; });
  }
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), fileName: `${p.form} ${p.obligation.clientName} ${p.obligation.fyLabel}.xlsx`.replace(/[^\w .-]/g, '') };
}
