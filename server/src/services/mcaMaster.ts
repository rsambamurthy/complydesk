/**
 * MCA master data read by the browser extension from the portal page the user has open (View Company / Director
 * Master Data — the user solves the portal's captcha; ComplyDesk never logs in to MCA or stores portal credentials).
 *
 * Company page → stored as an ordinary document read (`extractions`, docType MCA_MASTER, model "mca-portal", no file,
 * no AI call) so the person checks and saves it in the same review screen as an uploaded master data PDF
 * (services/extract.ts `applyRead`). Director page → a comparison with the firm's records, read only.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, HttpError } from '../lib/core.js';
import type { StaffCtx } from '../auth/session.js';
import { normalise, nameMatch } from '../extract/normalise.js';

const { clients, people, registerEntries, extractions } = schema;
export const PORTAL_MODEL = 'mca-portal';

const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish();
const t = (max = 300) => z.string().trim().max(max).nullish();
export const companyPage = z.object({
  kind: z.literal('COMPANY'),
  company: z.object({
    cin: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{8,21}$/), name: z.string().trim().min(2).max(300),
    rocOffice: t(), registrationNumber: t(40), incorporationDate: d, email: t(), registeredOffice: t(600), listed: z.boolean().nullish(),
    category: t(), subcategory: t(), classOfCompany: t(), activeCompliance: t(), authorisedCapital: z.number().nonnegative().nullish(),
    paidUpCapital: z.number().nonnegative().nullish(), lastAgm: d, balanceSheetDate: d, status: t(80),
  }),
  directors: z.array(z.object({ din: t(8), pan: t(10), name: z.string().trim().min(1).max(200), designation: t(80), appointedOn: d, ceasedOn: d, signatory: z.boolean().nullish() })).max(200).default([]),
  charges: z.array(z.object({ chargeId: t(40), holder: t(), amount: z.number().nullish(), createdOn: d, modifiedOn: d, satisfiedOn: d, status: t(40) })).max(500).default([]),
});
export const directorPage = z.object({
  kind: z.literal('DIRECTOR'), din: z.string().regex(/^\d{8}$/), name: t(200), dinStatus: t(80),
  companies: z.array(z.object({ cin: z.string().trim().toUpperCase().max(25), name: t(300), designation: t(80), beginOn: d, endOn: d, activeCompliance: t(80) })).max(300),
});
export type CompanyPage = z.infer<typeof companyPage>;
export type DirectorPage = z.infer<typeof directorPage>;

type PersonLite = { name: string; din: string | null; pan: string | null; ceasedOn: string | null; appointedOn: string | null };
const samePerson = (a: { din?: string | null; pan?: string | null; name: string }, b: PersonLite) =>
  (a.din && b.din === a.din) || (!a.din && a.pan && b.pan === a.pan) || (!a.din && !a.pan && nameMatch(a.name, b.name) >= 0.99);

/** Pure: what the portal says that the records don't (people, status, charges). Shown as warnings above the review. */
export function portalNotes(p: CompanyPage, onFile: PersonLite[], chargeIds: string[]) {
  const notes: string[] = [];
  const st = p.company.status ?? '';
  if (st && !/^active$/i.test(st.trim())) notes.push(`MCA shows the company status as “${st}”.`);
  if (p.company.activeCompliance && !/^(active|yes|-)$/i.test(p.company.activeCompliance)) notes.push(`MCA shows ACTIVE compliance as “${p.company.activeCompliance}” — check INC-22A.`);
  for (const x of p.directors) {
    const have = onFile.find((h) => samePerson(x, h));
    if (x.ceasedOn && have && !have.ceasedOn) notes.push(`${x.name} ceased on ${x.ceasedOn} per MCA but is in office in ComplyDesk — record the cessation on the Directors & KMP tab.`);
    if (!x.ceasedOn && have?.ceasedOn) notes.push(`${x.name} is still listed on MCA but ceased on ${have.ceasedOn} in ComplyDesk — check DIR-12 was filed and approved.`);
    if (!x.ceasedOn && have && x.appointedOn && have.appointedOn && have.appointedOn !== x.appointedOn) notes.push(`${x.name}: appointed ${x.appointedOn} per MCA, ${have.appointedOn} in ComplyDesk.`);
  }
  for (const h of onFile.filter((h) => !h.ceasedOn)) {
    if (!p.directors.some((x) => samePerson(x, h))) notes.push(`${h.name} is in office in ComplyDesk but not on MCA’s list — appointment not filed (DIR-12), or a resignation not recorded here?`);
  }
  const open = p.charges.filter((c) => !c.satisfiedOn && !/satisf|closed/i.test(c.status ?? ''));
  const missing = open.filter((c) => c.chargeId && !chargeIds.includes(c.chargeId));
  if (missing.length) notes.push(`MCA lists ${missing.length} open charge${missing.length === 1 ? '' : 's'} not in the register of charges: ${missing.slice(0, 5).map((c) => `${c.chargeId} (${c.holder ?? 'holder?'})`).join(', ')}.`);
  return notes;
}

/** Stores the company page as a document read; returns where to review it. */
export async function readCompanyPage(staff: StaffCtx, scope: string[] | null, p: CompanyPage) {
  const tenantId = staff.tenant.id;
  if (!staff.permissions.has('clients.manage')) throw new HttpError(403, 'You don’t have permission to update clients');
  const [client] = await db.select().from(clients).where(and(eq(clients.tenantId, tenantId), eq(clients.cin, p.company.cin)));
  if (client && scope && !scope.includes(client.id)) throw new HttpError(404, 'This company isn’t one of your clients');
  const current = p.directors.filter((x) => !x.ceasedOn);
  const raw = { data: { company: p.company, directors: current.map((x) => ({ name: x.name, din: x.din, pan: x.pan, designation: x.designation, appointedOn: x.appointedOn })) } };
  const read = normalise('MCA_MASTER', raw, { clientCin: client?.cin ?? null });
  let onFile: PersonLite[] = []; let chargeIds: string[] = [];
  if (client) {
    onFile = await db.select({ name: people.name, din: people.din, pan: people.pan, ceasedOn: people.ceasedOn, appointedOn: people.appointedOn }).from(people).where(eq(people.clientId, client.id));
    chargeIds = (await db.select({ data: registerEntries.data }).from(registerEntries).where(and(eq(registerEntries.clientId, client.id), eq(registerEntries.register, 'CHARGES'))))
      .map((r) => String((r.data as any)?.chargeId ?? '')).filter(Boolean);
  }
  read.warnings.unshift(...portalNotes(p, onFile, chargeIds));
  (read.values as any).portal = { lastAgm: p.company.lastAgm, balanceSheetDate: p.company.balanceSheetDate, status: p.company.status, charges: p.charges };
  const [row] = await db.insert(extractions).values({
    tenantId, userId: staff.user.id, docType: 'MCA_MASTER', clientId: client?.id ?? null, fileName: `MCA master data — ${p.company.cin} (read from the portal)`,
    contentType: 'text/html', size: 0, storageKey: null, status: 'READ', model: PORTAL_MODEL, result: read as any,
  }).returning();
  return { id: row.id, clientId: client?.id ?? null, clientName: client?.name ?? null, name: p.company.name, cin: p.company.cin, notes: read.warnings, directors: current.length, charges: p.charges.length };
}

/** Pure: the director's companies as MCA shows them, against the firm's records of the same DIN. */
export function compareDirector(p: DirectorPage, mine: { clientId: string; clientName: string; cin: string | null; appointedOn: string | null; ceasedOn: string | null }[], clientsByCin: Map<string, { id: string; name: string }>) {
  const rows = p.companies.map((c) => {
    const client = clientsByCin.get(c.cin) ?? null;
    const rec = client ? mine.find((m) => m.clientId === client.id) ?? null : null;
    const issues: string[] = [];
    if (client && !rec && !c.endOn) issues.push('Director per MCA, not on file in ComplyDesk');
    if (rec && c.endOn && !rec.ceasedOn) issues.push(`Ceased ${c.endOn} per MCA, in office in ComplyDesk`);
    if (rec && !c.endOn && rec.ceasedOn) issues.push(`Ceased ${rec.ceasedOn} in ComplyDesk, still on MCA`);
    if (rec && c.beginOn && rec.appointedOn && rec.appointedOn !== c.beginOn) issues.push(`Appointed ${c.beginOn} per MCA, ${rec.appointedOn} in ComplyDesk`);
    return { cin: c.cin, name: c.name, beginOn: c.beginOn, endOn: c.endOn, clientId: client?.id ?? null, clientName: client?.name ?? null, onFile: !!rec, issues };
  });
  const missingOnMca = mine.filter((m) => !m.ceasedOn && m.cin && !p.companies.some((c) => c.cin === m.cin))
    .map((m) => ({ clientId: m.clientId, clientName: m.clientName, cin: m.cin, issue: 'In office in ComplyDesk, not on MCA’s list for this DIN' }));
  return { din: p.din, name: p.name, dinStatus: p.dinStatus, rows, missingOnMca };
}

export async function readDirectorPage(staff: StaffCtx, scope: string[] | null, p: DirectorPage) {
  const tenantId = staff.tenant.id;
  const mine = (await db.select({ clientId: clients.id, clientName: clients.name, cin: clients.cin, appointedOn: people.appointedOn, ceasedOn: people.ceasedOn })
    .from(people).innerJoin(clients, eq(clients.id, people.clientId)).where(and(eq(people.tenantId, tenantId), eq(people.din, p.din))))
    .filter((m) => !scope || scope.includes(m.clientId));
  const cins = p.companies.map((c) => c.cin).filter(Boolean);
  const cl = cins.length ? await db.select({ id: clients.id, name: clients.name, cin: clients.cin }).from(clients).where(and(eq(clients.tenantId, tenantId), inArray(clients.cin, cins))) : [];
  const byCin = new Map(cl.filter((c) => !scope || scope.includes(c.id)).map((c) => [c.cin!, { id: c.id, name: c.name }]));
  return compareDirector(p, mine, byCin);
}
