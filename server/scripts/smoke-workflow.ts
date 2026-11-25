/**
 * Sprint 4 end to end: filing workflow (maker-checker, client approval, SRN, MCA approval, resubmission),
 * documents, and the daily reminder email. Needs the API running and a fresh demo seed.
 * Run: npx tsx scripts/smoke-workflow.ts
 */
import { runWorkspace } from '../src/services/reminders.js';
import { db, schema, pool } from '../src/lib/core.js';
import { eq } from 'drizzle-orm';
const BASE = process.env.BASE ?? 'http://localhost:4000/api';
class Agent {
  cookie = '';
  async call(path: string, opts: { method?: string; body?: any; expect?: number; raw?: boolean } = {}) {
    const isForm = opts.body instanceof FormData;
    const r = await fetch(BASE + path, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers: { 'X-Requested-With': 'fetch', cookie: this.cookie, ...(opts.body && !isForm ? { 'Content-Type': 'application/json' } : {}) }, body: opts.body ? (isForm ? opts.body : JSON.stringify(opts.body)) : undefined, redirect: 'manual' });
    const set = r.headers.get('set-cookie'); if (set) this.cookie = set.split(';')[0];
    const data: any = opts.raw ? Buffer.from(await r.arrayBuffer()) : await r.json().catch(() => ({}));
    if (opts.expect ? r.status !== opts.expect : !r.ok) throw new Error(`${opts.method ?? 'GET'} ${path} → ${r.status} ${opts.raw ? '' : JSON.stringify(data)}`);
    return data;
  }
}
const ok = (c: unknown, m: string) => { if (!c) throw new Error('FAILED: ' + m); console.log('✓', m); };
const login = async (email: string, pw = 'Demo@12345') => { const a = new Agent(); await a.call('/auth/login', { body: { workspace: 'demo', email, password: pw } }); return a; };
const admin = await login('admin@demo.in');
const exec = await login('karthik@demo.in');
const kaveri = (await admin.call('/clients?q=Kaveri'))[0];
const open = async () => (await admin.call(`/obligations?clientId=${kaveri.id}&bucket=open`)).filter((o: any) => !['Board meeting', 'AGM'].includes(o.form));
const move = (a: Agent, id: string, action: string, extra: any = {}, expect?: number) => a.call(`/obligations/${id}/move`, { body: { action, ...extra }, expect });

ok((await admin.call('/admin/settings')).requireReview === true, 'review before filing is on by default');
const [f1, f2] = await open();
await admin.call(`/obligations/${f1.id}`, { method: 'PATCH', body: { status: 'FILED', filedOn: '2026-11-20' }, expect: 400 });
ok(true, `${f1.form}: can't skip review by marking it filed directly`);

// 1. Maker (CS Executive) → checker (Firm Admin)
await move(exec, f1.id, 'start');
await move(exec, f1.id, 'drafted');
let d = await exec.call(`/obligations/${f1.id}`);
ok(d.obligation.stage === 'DRAFTED' && d.preparedBy === 'Karthik S', 'drafted by the executive');
await move(exec, f1.id, 'submit', { note: 'Please check the outstanding loans figure' });
ok((await exec.call(`/obligations/${f1.id}`)).moves.every((m: any) => m.action !== 'review_ok' || m.blocked), 'executive can’t approve (no reviewer rights)');
await move(exec, f1.id, 'review_ok', {}, 403);
ok((await admin.call('/obligations/dashboard')).all.review >= 1, 'dashboard counts it under “waiting for review”');
await move(admin, f1.id, 'return', {}, 400);
await move(admin, f1.id, 'return', { note: 'Use the audited figure' });
ok((await admin.call(`/obligations/${f1.id}`)).obligation.stage === 'DRAFTED', 'returned with a note → back to drafted');
await move(exec, f1.id, 'submit');
await move(admin, f1.id, 'review_ok');
d = await admin.call(`/obligations/${f1.id}`);
ok(d.obligation.stage === 'READY' && d.reviewedBy === 'Lakshmi Rao', 'reviewed by the Firm Admin → ready to file');
await move(exec, f1.id, 'start', {}, 409);
ok(true, 'stale step refused (409)');
await move(exec, f1.id, 'filed', { srn: '123', filedOn: '2026-11-24' }, 400);
await move(exec, f1.id, 'filed', { srn: 'f12345678', filedOn: '2026-11-24' });
d = await exec.call(`/obligations/${f1.id}`);
ok(d.obligation.stage === 'FILED' && d.obligation.status === 'FILED' && d.obligation.srn === 'F12345678', 'filed with SRN → done on the calendar');
await move(exec, f1.id, 'resubmit', { note: 'MCA: attach board resolution' });
ok((await exec.call(`/obligations/${f1.id}`)).obligation.status === 'IN_PROGRESS', 'resubmission → back in progress');
await move(exec, f1.id, 'drafted'); await move(exec, f1.id, 'submit'); await move(admin, f1.id, 'review_ok');
await move(exec, f1.id, 'filed', { srn: 'F12345679', filedOn: '2026-11-25' });
await move(exec, f1.id, 'approved');
d = await exec.call(`/obligations/${f1.id}`);
ok(d.obligation.stage === 'APPROVED' && d.history.length >= 12, `approved by MCA; ${d.history.length} steps in the history`);

// 2. The reviewer can't approve their own work
await move(admin, f2.id, 'drafted'); await move(admin, f2.id, 'submit');
const own = await move(admin, f2.id, 'review_ok', {}, 403);
ok(/another reviewer/.test(own.error), 'maker-checker: preparer can’t approve their own filing');

// 3. Client approval
await admin.call('/admin/settings', { method: 'PUT', body: { requireClientApproval: true } });
const roles = await admin.call('/admin/roles');
await admin.call('/admin/users', { body: { name: 'Anita (client)', email: 'anita@kaveri.in', password: 'Kaveri#Pass1', roleIds: [roles.find((r: any) => r.key === 'CLIENT_ADMIN').id], clientIds: [kaveri.id] } });
const client = await login('anita@kaveri.in', 'Kaveri#Pass1');
const [, , f3] = await open();
await move(exec, f3.id, 'drafted'); await move(exec, f3.id, 'submit'); await move(admin, f3.id, 'review_ok');
ok((await admin.call(`/obligations/${f3.id}`)).obligation.stage === 'CLIENT', 'after review → with the client');
const cm = (await client.call(`/obligations/${f3.id}`)).moves.map((m: any) => m.action).sort().join(',');
ok(cm === 'client_ok,client_return', `client sees only approve / send back (${cm})`);
ok((await client.call('/obligations/dashboard')).all.client === 1, 'client’s dashboard: 1 waiting for approval');
await move(client, f3.id, 'start', {}, 409);
await move(client, f3.id, 'client_ok', { note: 'OK to file' });
d = await admin.call(`/obligations/${f3.id}`);
ok(d.obligation.stage === 'READY' && d.clientApprovedBy === 'Anita (client)', 'client approved from their login → ready to file');
const [, , , f4] = await open();
await move(exec, f4.id, 'drafted'); await move(exec, f4.id, 'submit'); await move(admin, f4.id, 'review_ok');
await move(exec, f4.id, 'client_ok', {}, 400);
await move(exec, f4.id, 'client_ok', { note: 'Approved by Ms. Rao by email, 25 Nov' });
ok((await admin.call(`/obligations/${f4.id}`)).obligation.stage === 'READY', 'staff record an emailed approval (note required)');
await admin.call('/admin/settings', { method: 'PUT', body: { requireClientApproval: false } });

// 4. Documents
const pdf = Buffer.from('%PDF-1.4\n% ComplyDesk test\n');
const fd = () => { const f = new FormData(); f.append('entity', 'obligation'); f.append('entityId', f3.id); f.append('file', new Blob([pdf], { type: 'application/pdf' }), 'DPT-3 draft.pdf'); return f; };
const up = await exec.call('/files', { body: fd(), expect: 201 });
const list = await client.call(`/files?entity=obligation&entityId=${f3.id}`);
ok(list.length === 1 && list[0].fileName === 'DPT-3 draft.pdf', 'file attached; the client sees it');
ok((await client.call(`/files/${up.id}`, { raw: true })).equals(pdf), 'download returns the same bytes');
const bad = new FormData(); bad.append('entity', 'obligation'); bad.append('entityId', f3.id); bad.append('file', new Blob(['x'], { type: 'application/x-msdownload' }), 'x.exe');
await exec.call('/files', { body: bad, expect: 400 });
ok(true, 'executables refused');
const marina = (await admin.call('/clients?q=Marina'))[0];
await admin.call('/admin/users', { body: { name: 'Marina person', email: 'm@marina.in', password: 'Marina#Pass1', roleIds: [roles.find((r: any) => r.key === 'CLIENT_VIEWER').id], clientIds: [marina.id] } });
const other = await login('m@marina.in', 'Marina#Pass1');
await other.call(`/files/${up.id}`, { expect: 404 });
await other.call(`/obligations/${f3.id}`, { expect: 404 });
ok(true, 'another company’s user can’t see the file or the filing');
await client.call(`/files/${up.id}`, { method: 'DELETE', expect: 403 });
await exec.call(`/files/${up.id}`, { method: 'DELETE' });
ok((await exec.call(`/files?entity=obligation&entityId=${f3.id}`)).length === 0, 'removed by staff');

// 5. Reminders
// Clients are "handled by" Karthik in the demo, so unassigned items go to him, not the admin.
const execPrev = await exec.call('/admin/reminders/preview');
ok(execPrev.some((i: any) => i.group === 'overdue'), `executive’s digest has the overdue items of his clients (${execPrev.length} items)`);
ok(!execPrev.some((i: any) => i.group === 'review'), 'executive (not a reviewer) isn’t asked to review');
const adminPrev = await admin.call('/admin/reminders/preview');
ok(!adminPrev.some((i: any) => i.group === 'review' && i.text.includes(f2.form)), 'admin isn’t asked to review the filing he prepared');
await admin.call(`/obligations/${execPrev.find((i: any) => i.group === 'overdue') ? (await admin.call(`/obligations?bucket=overdue`))[0].id : ''}`, { method: 'PATCH', body: { assigneeId: (await admin.call('/auth/me')).user.id } });
ok((await admin.call('/admin/reminders/preview')).some((i: any) => i.group === 'overdue'), 'assigning an overdue item to the admin puts it in the admin’s digest');
const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.slug, 'demo'));
const first = await runWorkspace(t, '2026-11-25');
const again = await runWorkspace(t, '2026-11-25');
ok(first.sent >= 1 && again.sent === 0, `daily run sent ${first.sent}; a second run the same day sends 0`);
await exec.call('/admin/reminders/send-me', { method: 'POST' });
ok(true, '“send it to me now” works');
await admin.call('/admin/settings', { method: 'PUT', body: { reminderDays: [30, 'x'] }, expect: 400 });
ok((await admin.call('/admin/settings', { method: 'PUT', body: { reminderDays: [1, 15, 7, 7] } })).reminderDays.join() === '15,7,1', 'reminder days cleaned and sorted');
await exec.call('/admin/settings', { method: 'PUT', body: { requireReview: false }, expect: 403 });
ok(true, 'only Firm Admins change settings');
await pool.end();
console.log('\nAll Sprint 4 checks passed');
