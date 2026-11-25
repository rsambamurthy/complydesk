/**
 * Demo workspace "demo" (admin@demo.in / Demo@12345): a CS firm with a few clients of each kind,
 * so the calendar has something to show. Safe to run again: it skips if the workspace exists.
 */
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, schema, pool } from '../lib/core.js';
import { migrate, seedCatalogue } from './migrate.js';
import { createWorkspace } from '../services/tenants.js';
import { createClient, peopleSvc, shareholdersSvc, auditorsSvc, setYear } from '../services/clients.js';
import { syncClient } from '../compliance/sync.js';
import { updateObligation } from '../services/obligations.js';
import { addDays } from '../compliance/dates.js';

/** Creates the demo workspace unless it exists. Run from the CLI (npm run db:seed) or on start with SEED_DEMO=true. */
export async function seedDemo() {
const [exists] = await db.select().from(schema.tenants).where(eq(schema.tenants.slug, 'demo'));
if (exists) { console.log('Demo workspace already there'); return; }

const { tenant, roles } = await createWorkspace({ name: 'Rao & Associates, Company Secretaries', slug: 'demo', admin: { name: 'Lakshmi Rao', email: 'admin@demo.in', password: 'Demo@12345' } });
const t = tenant.id;
const role = (k: string) => roles.find((r) => r.key === k)!.id;
const [exec] = await db.insert(schema.users).values({ tenantId: t, name: 'Karthik S', email: 'karthik@demo.in', passwordHash: await bcrypt.hash('Demo@12345', 10), emailVerifiedAt: new Date() }).returning();
await db.insert(schema.userRoles).values({ userId: exec.id, roleId: role('CS_EXECUTIVE') });

const mk = async (c: Omit<Parameters<typeof createClient>[1], 'ownerId'>, directors: [string, string, string, number | null][], holders: [string, number][], auditor?: { firm: string; to: number }, agm?: string) => {
  const row = await createClient(t, { ...c, ownerId: exec.id }, { sync: false });
  for (const [name, designation, din, kyc] of directors) await peopleSvc.add(t, row.id, { name, designation, din, dinAllottedOn: '2014-04-10', kycLastFiledFy: kyc, dscExpiry: '2027-02-15', appointedOn: c.incorporationDate }, { sync: false });
  for (const [name, shares] of holders) await shareholdersSvc.add(t, row.id, { name, shares, faceValue: '10', shareClass: 'EQUITY' }, { sync: false });
  if (auditor) await auditorsSvc.add(t, row.id, { firmName: auditor.firm, termFromFy: auditor.to - 4, termToFy: auditor.to, current: true }, { sync: false });
  if (agm) await setYear(t, row.id, 2025, { agmDate: agm, firstBoardMeetingDate: null });
  await syncClient(t, row.id);
  return row;
};

const base = { rocOffice: 'RoC Chennai', registeredOffice: 'Chennai', email: null, authorisedCapital: '1000000', paidUpCapital: '500000' };
const kaveri = await mk({ ...base, cin: 'U72900TN2015PTC101234', name: 'Kaveri Software Private Limited', companyType: 'PRIVATE', smallCompany: false, incorporationDate: '2015-06-10', flags: { depositsOrLoans: true, msmeDues: true } },
  [['Anita Rao', 'MANAGING_DIRECTOR', '01234567', 2025], ['Suresh Iyer', 'DIRECTOR', '02345678', 2023]], [['Anita Rao', 30000], ['Suresh Iyer', 20000]], { firm: 'Iyer & Co, Chartered Accountants', to: 2025 });
await mk({ ...base, cin: 'U51909TN2019PTC129876', name: 'Marina Traders Private Limited', companyType: 'PRIVATE', smallCompany: true, incorporationDate: '2019-02-14', flags: {} },
  [['Ramesh Kumar', 'DIRECTOR', '03456789', 2025], ['Priya Kumar', 'DIRECTOR', '04567890', 2025]], [['Ramesh Kumar', 5000], ['Priya Kumar', 5000]], { firm: 'Natarajan Associates', to: 2028 });
await mk({ ...base, cin: 'U74999TN2021OPC140001', name: 'Vel Design Studio (OPC) Private Limited', companyType: 'OPC', smallCompany: true, incorporationDate: '2021-07-01', flags: {} },
  [['Vel Murugan', 'DIRECTOR', '05678901', 2025]], [['Vel Murugan', 10000]]);
await mk({ ...base, cin: 'U62099KA2026PTC200450', name: 'Nimbus Analytics Private Limited', companyType: 'PRIVATE', smallCompany: true, incorporationDate: '2026-08-20', rocOffice: 'RoC Bengaluru', flags: {} },
  [['Divya Menon', 'DIRECTOR', '06789012', null], ['Arjun Shetty', 'DIRECTOR', '07890123', null]], [['Divya Menon', 5000], ['Arjun Shetty', 5000]]);

// Some work already done, so the dashboard looks like a real practice.
const { obligations: o } = schema;
// Meetings held before October are marked through the service, so AGM / first board meeting dates feed the other due dates.
const meetingDay = (d: string) => addDays(d, -8);
for (const x of await db.select().from(o).where(eq(o.tenantId, t))) {
  if ((x.form === 'Board meeting' || x.form === 'AGM') && x.dueDate < '2026-10-01') await updateObligation(t, x.id, { status: 'FILED', filedOn: meetingDay(x.dueDate) });
}
for (const x of await db.select().from(o).where(eq(o.tenantId, t))) {
  if (x.status === 'FILED' || x.form === 'Board meeting' || x.form === 'AGM') continue;
  if (x.dueDate < '2026-10-01') await updateObligation(t, x.id, { status: 'FILED', filedOn: addDays(x.dueDate, -3), srn: `F${Math.floor(10000000 + Math.random() * 9e7)}` });
  else if (x.fy === 2025 && x.form === 'MGT-7') await updateObligation(t, x.id, { status: 'IN_PROGRESS', assigneeId: exec.id });
  else if (x.fy === 2025 && x.form === 'AOC-4' && x.clientId === kaveri.id) await updateObligation(t, x.id, { status: 'FILED', filedOn: '2026-10-20', srn: 'F80412233' });
}
// Statutory registers for Kaveri: member and director particulars, the original allotments, a bank charge.
{
  const ms = await db.select().from(schema.shareholders).where(eq(schema.shareholders.clientId, kaveri.id));
  const ps = await db.select().from(schema.people).where(eq(schema.people.clientId, kaveri.id));
  const m = (n: string) => ms.find((x) => x.name === n)!;
  const p = (n: string) => ps.find((x) => x.name === n)!;
  const addr = { 'Anita Rao': '12, Second Main Road, Gandhi Nagar, Adyar, Chennai 600020', 'Suresh Iyer': '4, Lake View Street, T. Nagar, Chennai 600017' } as Record<string, string>;
  const fam = { 'Anita Rao': 'S. Raghavan', 'Suresh Iyer': 'K. Iyer' } as Record<string, string>;
  for (const [i, n] of ['Anita Rao', 'Suresh Iyer'].entries()) {
    await db.update(schema.shareholders).set({ folio: String(i + 1), address: addr[n], fatherName: fam[n], occupation: 'Business', nationality: 'Indian', becameMemberOn: '2015-06-10' }).where(eq(schema.shareholders.id, m(n).id));
    await db.update(schema.people).set({ address: addr[n], fatherName: fam[n], occupation: 'Business', nationality: 'Indian', dob: i ? '1978-11-03' : '1974-02-21' }).where(eq(schema.people.id, p(n).id));
  }
  const entry = (register: string, entryDate: string, data: Record<string, unknown>, closedOn: string | null = null) => ({ tenantId: t, clientId: kaveri.id, register, entryDate, data, closedOn });
  await db.insert(schema.registerEntries).values([
    entry('SHARE_LEDGER', '2015-06-10', { kind: 'ALLOTMENT', date: '2015-06-10', toMember: m('Anita Rao').id, shareClass: 'EQUITY', shares: 30000, distinctiveFrom: 1, distinctiveTo: 30000, certificateNo: '1', price: 10, consideration: 'CASH' }),
    entry('SHARE_LEDGER', '2015-06-10', { kind: 'ALLOTMENT', date: '2015-06-10', toMember: m('Suresh Iyer').id, shareClass: 'EQUITY', shares: 20000, distinctiveFrom: 30001, distinctiveTo: 50000, certificateNo: '2', price: 10, consideration: 'CASH' }),
    entry('CHARGES', '2024-04-15', { chargeId: '100845123', createdOn: '2024-04-15', holder: 'HDFC Bank Limited', holderAddress: 'HDFC Bank House, Senapati Bapat Marg, Lower Parel, Mumbai 400013', amount: 15000000, nature: 'HYPOTHECATION', property: 'Current assets — stock and book debts, present and future', instrument: 'Deed of hypothecation dated 15 April 2024', terms: 'Working capital limit; interest at repo + 3.25%; repayable on demand' }),
    entry('LOANS', '2025-09-01', { kind: 'INVESTMENT', date: '2025-09-01', party: 'Kaveri Cloud Services Private Limited', amount: 1000000, purpose: 'Investment in wholly owned subsidiary', securities: '1,00,000 equity shares of ₹10 each at par', boardOn: '2025-08-20' }),
  ]);
}

// Billing: the firm's details, fees, and two invoices (one part paid, one overdue).
{
  const { saveProfile, saveFees, createInvoice, issueInvoice, addPayment } = await import('../services/billing.js');
  let [tn] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, t));
  await saveProfile(tn, { legalName: 'Rao & Associates, Company Secretaries', gstin: '33AAKFR1234M1Z7', pan: 'AAKFR1234M', address: '21, Cathedral Road, Gopalapuram, Chennai 600086', stateCode: '33', sac: '998399', gstRate: 18, invoicePrefix: 'RAO', dueDays: 15, billFrom: '2026-04-01', bankDetails: 'Rao & Associates · HDFC Bank, Cathedral Road · A/c 50200012345678 · IFSC HDFC0001234 · UPI raoassociates@hdfcbank', terms: 'Payable within 15 days. Government fees are reimbursements at actuals.' } as any);
  await saveFees(t, null, { fees: [['AOC4', 6000], ['AOC4_OPC', 3500], ['MGT7', 6000], ['MGT7A', 4000], ['MGT7A_OPC', 3000], ['ADT1', 2000], ['DIR3KYC', 750], ['DPT3', 3000], ['MSME1', 1500], ['MBP1_DIR8', 1500], ['DIR12', 3500], ['PAS3', 5000], ['CHG1', 4000], ['CHG4', 2500], ['MGT14', 3000], ['INC22', 3500], ['AGM', 7500], ['BM_QUARTERLY', 2500], ['BM_HALF_YEARLY', 2500]].map(([ruleCode, amount]) => ({ ruleCode: String(ruleCode), amount })) });
  [tn] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, t));
  const admin = (await db.select().from(schema.users).where(eq(schema.users.email, 'admin@demo.in')))[0];
  const kvWork = (await import('../services/billing.js')).unbilled;
  const work = await kvWork(tn, kaveri.id);
  const first = work.filter((w) => w.fee !== null).slice(0, 2);
  if (first.length) {
    const a = await createInvoice(tn, admin.id, { clientId: kaveri.id, obligationIds: first.map((w) => w.id), lines: [{ description: 'Government (MCA) fees paid on your behalf', amount: 600, taxable: false }], retainer: false });
    await db.update(schema.invoices).set({ date: '2026-10-05', dueDate: '2026-10-20' }).where(eq(schema.invoices.id, a.id));
    const ia = await issueInvoice(tn, a.id);
    await addPayment(t, admin.id, a.id, { date: '2026-10-25', amount: Math.round(Number(ia.total) / 2), tds: 0, mode: 'UPI', reference: 'UTR 6230981123' } as any);

  }
  const marina = (await db.select().from(schema.clients).where(eq(schema.clients.cin, 'U51909TN2019PTC129876')))[0];
  const b = await createInvoice(tn, admin.id, { clientId: marina.id, obligationIds: [], lines: [{ description: 'Annual compliance retainer — FY 2026-27 (first half)', amount: 18000, taxable: true }], retainer: false });
  await db.update(schema.invoices).set({ date: '2026-09-01', dueDate: '2026-09-16' }).where(eq(schema.invoices.id, b.id));
  await issueInvoice(tn, b.id);
}

// A published regulatory update (platform-wide), not yet reviewed by the demo firm.
{
  const [has] = await db.select({ id: schema.regUpdates.id }).from(schema.regUpdates).limit(1);
  if (!has) await db.insert(schema.regUpdates).values({
    title: 'Small company limits raised: paid-up up to ₹10 crore, turnover up to ₹100 crore', source: 'MCA notification G.S.R. 880(E)', issuedOn: '2025-12-01', effectiveFrom: '2025-12-01',
    summary: 'The thresholds for a "small company" under Section 2(85) are raised to paid-up capital of up to ₹10 crore and turnover of up to ₹100 crore. More private companies now qualify: fewer board meetings, MGT-7A instead of MGT-7 and lighter reporting.',
    actions: 'Recheck the small-company status of private clients with paid-up capital up to ₹10 crore and turnover up to ₹100 crore\nUpdate “Small company” on each client so MGT-7A and board-meeting rules follow',
    applies: { types: ['PRIVATE'], small: false }, forms: ['MGT7', 'MGT7A', 'BM_QUARTERLY', 'BM_HALF_YEARLY'], impact: 'HIGH', status: 'PUBLISHED', publishedAt: new Date('2025-12-02'), createdBy: 'seed',
  });
}

// Time logged this month by the team (Team page).
{
  const admin = (await db.select().from(schema.users).where(eq(schema.users.email, 'admin@demo.in')))[0];
  const marina = (await db.select().from(schema.clients).where(eq(schema.clients.cin, 'U51909TN2019PTC129876')))[0];
  const month = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 8);
  const day = (n: number) => `${month}${String(Math.min(n, Number(new Date(Date.now() + 330 * 60_000).toISOString().slice(8, 10)))).padStart(2, '0')}`;
  await db.insert(schema.timeEntries).values([
    { tenantId: t, userId: exec.id, clientId: kaveri.id, date: day(3), minutes: 150, note: 'MGT-7 data collection' },
    { tenantId: t, userId: exec.id, clientId: kaveri.id, date: day(10), minutes: 90, note: 'Registers update' },
    { tenantId: t, userId: admin.id, clientId: kaveri.id, date: day(12), minutes: 60, note: 'Review of AOC-4' },
    { tenantId: t, userId: exec.id, clientId: marina.id, date: day(5), minutes: 120, note: 'MGT-7A and board minutes' },
  ]);
}

console.log('Seeded demo workspace: workspace "demo", admin@demo.in / Demo@12345');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await migrate(); await seedCatalogue(); await seedDemo(); await pool.end();
}
