/**
 * End-to-end check against a running API (npm run dev + seeded demo): sign in, add a client with a director,
 * record the AGM, add an event filing, mark it filed, import from Excel, try a client user's scope.
 * Run: npx tsx scripts/smoke.ts
 */
import ExcelJS from 'exceljs';
const BASE = process.env.BASE ?? 'http://localhost:4000/api';
let cookie = '';
async function call(path: string, opts: { method?: string; body?: any; expect?: number } = {}) {
  const isForm = opts.body instanceof FormData;
  const r = await fetch(BASE + path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { 'X-Requested-With': 'fetch', cookie, ...(opts.body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? (isForm ? opts.body : JSON.stringify(opts.body)) : undefined,
  });
  const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  const ct = r.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await r.json() : await r.arrayBuffer();
  const want = opts.expect ?? (r.ok ? r.status : 200);
  if (r.status !== want) throw new Error(`${opts.method ?? 'GET'} ${path} → ${r.status} ${JSON.stringify(data)}`);
  return data as any;
}
const ok = (cond: unknown, msg: string) => { if (!cond) throw new Error('FAILED: ' + msg); console.log('✓', msg); };

await call('/auth/login', { body: { workspace: 'demo', email: 'admin@demo.in', password: 'Demo@12345' } });
ok((await call('/auth/me')).user.email === 'admin@demo.in', 'signed in');

// Validation: a bad CIN and a CIN/type mismatch are refused with field errors.
const bad = await call('/clients', { body: { cin: 'XYZ', name: 'Bad', companyType: 'PRIVATE' }, expect: 400 });
ok(bad.details.cin, 'bad CIN refused with a field error');
const mismatch = await call('/clients', { body: { cin: 'U74999TN2021OPC140999', name: 'Mismatch Pvt Ltd', companyType: 'PRIVATE' }, expect: 400 });
ok(/PTC/.test(mismatch.details.cin), 'CIN / type mismatch caught');

const c = await call('/clients', { body: { cin: 'U70100TN2010PTC077001', name: 'Smoke Test Realty Private Limited', companyType: 'PRIVATE', smallCompany: false, incorporationDate: '2010-05-05', flags: { depositsOrLoans: true } } });
ok(c.id, 'client added');
await call('/clients', { body: { cin: c.cin, name: 'Dupe', companyType: 'PRIVATE' }, expect: 409 });
ok(true, 'duplicate CIN refused');

const dirNoDin = await call(`/clients/${c.id}/people`, { body: { name: 'No Din', designation: 'DIRECTOR' }, expect: 400 });
ok(dirNoDin.details.din, 'director without DIN refused');
const d = await call(`/clients/${c.id}/people`, { body: { name: 'Meera Nair', designation: 'DIRECTOR', din: '09876543', kycLastFiledFy: 2023 } });
ok(d.id, 'director added');

let list = await call(`/obligations?clientId=${c.id}&bucket=all`);
const aoc4 = list.find((o: any) => o.form === 'AOC-4' && o.fy === 2025);
ok(aoc4?.provisional && aoc4.dueDate === '2026-10-30', 'AOC-4 FY 2025-26 provisional 30 Oct before AGM is known');
ok(list.some((o: any) => o.form === 'DPT-3'), 'DPT-3 on because of the loans flag');
ok(list.some((o: any) => o.form === 'DIR-3 KYC' && o.dueDate === '2026-06-30'), 'DIR-3 KYC due 30 Jun 2026 (filed FY 2023 + 3)');

// Mark the AGM held → AOC-4 and MGT-7 move.
const agm = list.find((o: any) => o.ruleCode === 'AGM' && o.fy === 2025);
const noDate = await call(`/obligations/${agm.id}`, { method: 'PATCH', body: { status: 'FILED' }, expect: 400 });
ok(noDate.details.filedOn, 'held date required');
await call(`/obligations/${agm.id}`, { method: 'PATCH', body: { status: 'FILED', filedOn: '2026-09-10' } });
list = await call(`/obligations?clientId=${c.id}&bucket=all`);
const aoc4b = list.find((o: any) => o.id === aoc4.id);
ok(aoc4b.dueDate === '2026-10-10' && !aoc4b.provisional, 'AGM held 10 Sep → AOC-4 due 10 Oct');
ok(aoc4b.lateFee === null || aoc4b.lateFee > 0, `late fee estimated for overdue AOC-4: ₹${aoc4b.lateFee}`);

// Toggle the flag off → DPT-3 disappears (untouched); small company → MGT-7A instead of MGT-7.
await call(`/clients/${c.id}`, { method: 'PATCH', body: { flags: {}, smallCompany: true } });
list = await call(`/obligations?clientId=${c.id}&bucket=all`);
ok(!list.some((o: any) => o.form === 'DPT-3'), 'DPT-3 gone after flag off');
ok(list.some((o: any) => o.form === 'MGT-7A') && !list.some((o: any) => o.form === 'MGT-7'), 'small company → MGT-7A');
ok(list.filter((o: any) => o.form === 'Board meeting' && o.fy === 2026).length === 2, 'small company → 2 board meetings');

// Event filing.
const ev = await call(`/clients/${c.id}/events`, { body: { ruleCode: 'DIR12', eventDate: '2026-11-15', label: 'Appointment of Meera Nair', personId: d.id } });
ok(ev.dueDate === '2026-12-15', 'DIR-12 due 30 days after appointment');
await call(`/clients/${c.id}/events`, { body: { ruleCode: 'DIR12', eventDate: '2026-11-15', label: 'Appointment of Meera Nair', personId: d.id }, expect: 409 });
await call(`/obligations/${ev.id}`, { method: 'PATCH', body: { status: 'FILED', filedOn: '2026-11-20', srn: 'AB1234567' } });
ok((await call(`/obligations?clientId=${c.id}&bucket=done`)).some((o: any) => o.id === ev.id && o.srn === 'AB1234567'), 'DIR-12 marked filed with SRN');

// Rule override: change DPT-3 date, then revert.
await call('/admin/rules/AOC4', { method: 'PUT', body: { form: 'AOC-4', law: 'Sec 137', applies: { types: ['PRIVATE'] }, title: 'Financial statements', active: true, notes: null, effectiveFrom: null, effectiveTo: null, due: { kind: 'AFTER_ANCHOR', anchor: 'AGM', days: 45, fallback: 'AGM_LAST_DATE' }, lateFee: { kind: 'PER_DAY', amount: 100 } } });
list = await call(`/obligations?clientId=${c.id}&bucket=all`);
ok(list.find((o: any) => o.id === aoc4.id).dueDate === '2026-10-25', 'workspace rule override recomputes (45 days)');
await call('/admin/rules/AOC4', { method: 'DELETE' });
list = await call(`/obligations?clientId=${c.id}&bucket=all`);
ok(list.find((o: any) => o.id === aoc4.id).dueDate === '2026-10-10', 'revert to built-in');

// Excel import: template → fill → check → import.
const tpl = await call('/import/template');
const wb = new ExcelJS.Workbook(); await wb.xlsx.load(tpl as ArrayBuffer);
wb.getWorksheet('Clients')!.addRow(['U01100MH2018PTC300100', 'Konkan Agro Private Limited', 'PRIVATE', 'Y', '2018-07-01', 'RoC Mumbai', 'Pune', '', 100000, 100000, 'N', 'N']);
wb.getWorksheet('Clients')!.addRow(['BADCIN', 'Broken', 'PRIVATE']);
wb.getWorksheet('Directors & KMP')!.addRow(['U01100MH2018PTC300100', 'Sanjay Patil', 'Director', '11223344', 'ABCPP1234K', '', '2018-07-01', '', '2018-06-15', 2024]);
wb.getWorksheet('Directors & KMP')!.addRow(['U00000XX0000PTC000000', 'Ghost', 'DIRECTOR', '12345678']);
wb.getWorksheet('Shareholders')!.addRow(['U01100MH2018PTC300100', 'Sanjay Patil', '', 'F1', 'equity', 10000, 10]);
const buf = Buffer.from(await wb.xlsx.writeBuffer());
const fd = () => { const f = new FormData(); f.append('file', new Blob([buf]), 'x.xlsx'); return f; };
const check = await call('/import', { body: fd() });
ok(check.ready.length === 3 && check.errors.length === 2 && check.created.length === 0, `import check: ${check.ready.length} ready, ${check.errors.length} problems, nothing saved`);
const done = await call('/import?commit=1', { body: fd() });
ok(done.created.length === 3, 'import committed');
const konkan = (await call('/clients?q=Konkan'))[0];
ok(konkan?.smallCompany && (await call(`/obligations?clientId=${konkan.id}&bucket=all`)).some((o: any) => o.form === 'MGT-7A'), 'imported client has its calendar');

// Client user only sees their company.
const roles = await call('/admin/roles');
const clientRole = roles.find((r: any) => r.key === 'CLIENT_VIEWER');
await call('/admin/users', { body: { name: 'Client Person', email: 'client@konkan.in', password: 'Konkan@12345', roleIds: [clientRole.id], clientIds: [] }, expect: 400 });
await call('/admin/users', { body: { name: 'Client Person', email: 'client@konkan.in', password: 'Konkan@12345', roleIds: [clientRole.id], clientIds: [konkan.id] } });
cookie = '';
await call('/auth/login', { body: { workspace: 'demo', email: 'client@konkan.in', password: 'Konkan@12345' } });
const seen = await call('/clients');
ok(seen.length === 1 && seen[0].id === konkan.id, 'client user sees only their company');
await call(`/clients/${c.id}`, { expect: 404 });
await call(`/obligations/${ev.id}`, { method: 'PATCH', body: { notes: 'x' }, expect: 403 });
ok(true, 'client user cannot see other clients or edit');
console.log('\nAll smoke checks passed');
