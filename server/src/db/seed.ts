/**
 * Demo workspace "demo" (admin@demo.in / Demo@12345): a CS firm with a few clients of each kind,
 * so the calendar has something to show. Safe to run again: it skips if the workspace exists.
 */
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db, schema, pool } from '../lib/core.js';
import { migrate, seedCatalogue } from './migrate.js';
import { createWorkspace } from '../services/tenants.js';
import { createClient, peopleSvc, shareholdersSvc, auditorsSvc, setYear } from '../services/clients.js';
import { syncClient } from '../compliance/sync.js';
import { updateObligation } from '../services/obligations.js';
import { addDays } from '../compliance/dates.js';

await migrate();
await seedCatalogue();
const [exists] = await db.select().from(schema.tenants).where(eq(schema.tenants.slug, 'demo'));
if (exists) { console.log('Demo workspace already there'); await pool.end(); process.exit(0); }

const { tenant, roles } = await createWorkspace({ name: 'Rao & Associates, Company Secretaries', slug: 'demo', admin: { name: 'Lakshmi Rao', email: 'admin@demo.in', password: 'Demo@12345' } });
const t = tenant.id;
const role = (k: string) => roles.find((r) => r.key === k)!.id;
const [exec] = await db.insert(schema.users).values({ tenantId: t, name: 'Karthik S', email: 'karthik@demo.in', passwordHash: await bcrypt.hash('Demo@12345', 10) }).returning();
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
console.log('Seeded demo workspace: workspace "demo", admin@demo.in / Demo@12345');
await pool.end();
