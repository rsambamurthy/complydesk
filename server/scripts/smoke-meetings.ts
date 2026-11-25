/**
 * Meetings end to end: schedule, notice check, agenda from templates, attendance and quorum, held → calendar
 * ticked and filings created, outcome change removes an untouched filing, minutes drafted and signed, EGM
 * with a special resolution, 120-day gap, client users' scope. Needs the API running and a fresh demo seed.
 * Run: npx tsx scripts/smoke-meetings.ts
 */
const BASE = process.env.BASE ?? 'http://localhost:4000/api';
class Agent {
  cookie = '';
  async call(path: string, opts: { method?: string; body?: any; expect?: number } = {}) {
    const r = await fetch(BASE + path, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers: { 'X-Requested-With': 'fetch', cookie: this.cookie, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) this.cookie = set.split(';')[0];
    const data: any = await r.json().catch(() => ({}));
    if (opts.expect ? r.status !== opts.expect : !r.ok) throw new Error(`${opts.method ?? 'GET'} ${path} → ${r.status} ${JSON.stringify(data)}`);
    return data;
  }
}
const ok = (c: unknown, m: string) => { if (!c) throw new Error('FAILED: ' + m); console.log('✓', m); };
const a = new Agent();
await a.call('/auth/login', { body: { workspace: 'demo', email: 'admin@demo.in', password: 'Demo@12345' } });
const kaveri = (await a.call('/clients?q=Kaveri'))[0];
const det = await a.call(`/clients/${kaveri.id}`);
const meera = await a.call(`/clients/${kaveri.id}/people`, { body: { name: 'Meera Nair', designation: 'DIRECTOR', din: '09876543', appointedOn: '2026-11-20' } });

// 1. Schedule a board meeting
const bm = await a.call('/meetings', { body: { clientId: kaveri.id, type: 'BOARD', date: '2026-11-20', time: '11:00 AM', mode: 'HYBRID' }, expect: 201 });
ok(/Board Meeting — FY 2026-27/.test(bm.title), `titled “${bm.title}”`);
let d = await a.call(`/meetings/${bm.id}`);
ok(d.items.map((i: any) => i.templateKey).join(',') === 'CHAIR,LEAVE,PREV_MINUTES,MBP1', 'standard items + MBP-1 for the first board meeting of the FY');
ok(d.meeting.venue === det.client.registeredOffice, 'venue defaults to the registered office');

// 2. Notice
await a.call(`/meetings/${bm.id}/notice-sent`, { body: { on: '2026-11-16' } });
d = await a.call(`/meetings/${bm.id}`);
ok(d.checks.find((c: any) => c.key === 'notice').level === 'error', '4 days’ notice flagged (7 needed)');
await a.call(`/meetings/${bm.id}`, { method: 'PATCH', body: { shorterNotice: true } });
ok((await a.call(`/meetings/${bm.id}`)).checks.find((c: any) => c.key === 'notice').ok, 'shorter notice recorded → ok');

// 3. Agenda from templates
const appoint = await a.call(`/meetings/${bm.id}/items`, { body: { templateKey: 'APPOINT_ADDL_DIRECTOR', personId: meera.id }, expect: 201 });
ok(appoint.text.includes('Meera Nair') && appoint.text.includes('Kaveri Software') && appoint.filings.includes('DIR12'), 'appointment resolution filled in, will create DIR-12');
const allot = await a.call(`/meetings/${bm.id}/items`, { body: { templateKey: 'ALLOTMENT' }, expect: 201 });
await a.call(`/meetings/${bm.id}/items`, { body: { title: 'Bank account signatories', resolutionType: 'BOARD', text: 'RESOLVED THAT…' }, expect: 201 });
const noPerson = await a.call(`/meetings/${bm.id}/items`, { body: { templateKey: 'APPOINT_ADDL_DIRECTOR' }, expect: 400 });
ok(noPerson.details.personId, 'appointment without a person refused');
await a.call(`/meetings/items/${allot.id}/move`, { body: { dir: -1 } });
d = await a.call(`/meetings/${bm.id}`);
ok(d.items.findIndex((i: any) => i.id === allot.id) < d.items.findIndex((i: any) => i.id === appoint.id), 'items can be reordered');

// 4. Attendance and quorum
const anita = d.attendance.find((x: any) => x.name === 'Anita Rao'), suresh = d.attendance.find((x: any) => x.name === 'Suresh Iyer');
ok(d.attendance.length === 3, '3 directors in office on the day (incl. the new appointee)');
await a.call(`/meetings/${bm.id}/attendance`, { method: 'PUT', body: [{ personId: anita.personId, status: 'PRESENT' }, { personId: suresh.personId, status: 'ABSENT' }, { personId: meera.id, status: 'LEAVE' }] });
ok((await a.call(`/meetings/${bm.id}`)).checks.find((c: any) => c.key === 'quorum').level === 'error', '1 of 3 present → no quorum');
await a.call(`/meetings/${bm.id}/attendance`, { method: 'PUT', body: [{ personId: suresh.personId, status: 'VIDEO' }] });
ok((await a.call(`/meetings/${bm.id}`)).checks.find((c: any) => c.key === 'quorum').ok, '2 present (one by video) → quorum');

// 5. Outcomes, then held
for (const i of d.items) await a.call(`/meetings/items/${i.id}`, { method: 'PATCH', body: { outcome: i.resolutionType === 'NONE' ? 'NOTED' : 'PASSED' } });
let cal = await a.call(`/obligations?clientId=${kaveri.id}&bucket=all`);
ok(!cal.some((o: any) => o.form === 'DIR-12' && o.source === 'MANUAL' && o.eventDate === '2026-11-20'), 'nothing filed before the meeting is recorded as held');
await a.call(`/meetings/${bm.id}/held`, { body: { on: '2099-01-01' }, expect: 400 });
const held = await a.call(`/meetings/${bm.id}/held`, { body: { on: '2026-11-20' } });
ok(held.status === 'HELD' && held.obligationId, 'held; linked to a calendar item');
cal = await a.call(`/obligations?clientId=${kaveri.id}&bucket=all`);
const q3 = cal.find((o: any) => o.id === held.obligationId);
ok(q3.form === 'Board meeting' && q3.periodLabel.startsWith('Q3') && q3.status === 'FILED' && q3.filedOn === '2026-11-20', 'Q3 board meeting ticked off on the calendar');
const dir12 = cal.find((o: any) => o.form === 'DIR-12' && o.eventDate === '2026-11-20');
const pas3 = cal.find((o: any) => o.form === 'PAS-3' && o.eventDate === '2026-11-20');
ok(dir12?.dueDate === '2026-12-20' && dir12.personId === meera.id, 'DIR-12 for Meera Nair due 20 Dec (30 days)');
ok(pas3?.dueDate === '2026-12-20', 'PAS-3 due 20 Dec');

// 6. Changing an outcome back removes the untouched filing; started ones stay
await a.call(`/meetings/items/${allot.id}`, { method: 'PATCH', body: { outcome: 'NOT_PASSED' } });
cal = await a.call(`/obligations?clientId=${kaveri.id}&bucket=all`);
ok(!cal.some((o: any) => o.id === pas3.id), 'allotment not passed → PAS-3 taken off');
await a.call(`/obligations/${dir12.id}`, { method: 'PATCH', body: { status: 'IN_PROGRESS' } });
await a.call(`/meetings/items/${appoint.id}`, { method: 'PATCH', body: { outcome: 'DEFERRED' } });
ok((await a.call(`/obligations?clientId=${kaveri.id}&bucket=all`)).some((o: any) => o.id === dir12.id), 'DIR-12 already in progress → kept');
await a.call(`/meetings/items/${appoint.id}`, { method: 'PATCH', body: { outcome: 'PASSED' } });
ok((await a.call(`/obligations?clientId=${kaveri.id}&bucket=all`)).filter((o: any) => o.form === 'DIR-12' && o.eventDate === '2026-11-20').length === 1, 'passing again doesn’t duplicate DIR-12');

// 7. Minutes
const draft = (await a.call(`/meetings/${bm.id}/minutes-draft`)).text as string;
ok(draft.includes('PRESENT:') && draft.includes('Anita Rao') && draft.includes('Suresh Iyer (through video conferencing)') && draft.includes('LEAVE OF ABSENCE') && draft.includes('passed unanimously') && draft.includes('not passed'), 'minutes drafted from attendance and outcomes');
await a.call(`/meetings/${bm.id}/minutes-signed`, { body: { on: '2026-11-24' }, expect: 400 });
await a.call(`/meetings/${bm.id}/minutes`, { method: 'PUT', body: { text: draft } });
await a.call(`/meetings/${bm.id}/minutes-signed`, { body: { on: '2026-11-19' }, expect: 400 });
const signed = await a.call(`/meetings/${bm.id}/minutes-signed`, { body: { on: '2026-11-24' } });
ok(signed.status === 'MINUTES_SIGNED', 'minutes signed');
ok((await a.call(`/meetings/${bm.id}`)).checks.find((c: any) => c.key === 'minutes').ok, 'signed within 30 days');
await a.call(`/meetings/items/${appoint.id}`, { method: 'PATCH', body: { outcome: 'NOT_PASSED' }, expect: 400 });
ok(true, 'signed minutes lock the outcomes');

// 8. EGM with a special resolution
const egm = await a.call('/meetings', { body: { clientId: kaveri.id, type: 'EGM', date: '2026-11-23', mode: 'PHYSICAL' }, expect: 201 });
await a.call(`/meetings/${egm.id}/notice-sent`, { body: { on: '2026-11-02' } });
ok(!(await a.call(`/meetings/${egm.id}`)).checks.find((c: any) => c.key === 'notice').ok, '20 clear days for an EGM flagged (21 needed)');
await a.call(`/meetings/${egm.id}/items`, { body: { templateKey: 'ALTER_ARTICLES' }, expect: 201 });
const eg = await a.call(`/meetings/${egm.id}`);
await a.call(`/meetings/${egm.id}`, { method: 'PATCH', body: { membersPresent: 2, shorterNotice: true } });
ok((await a.call(`/meetings/${egm.id}`)).checks.find((c: any) => c.key === 'quorum').ok, '2 members present → quorum');
for (const i of eg.items) await a.call(`/meetings/items/${i.id}`, { method: 'PATCH', body: { outcome: i.resolutionType === 'NONE' ? 'NOTED' : 'PASSED' } });
await a.call(`/meetings/${egm.id}/held`, { body: { on: '2026-11-23' } });
ok((await a.call(`/obligations?clientId=${kaveri.id}&bucket=all`)).some((o: any) => o.form === 'MGT-14' && o.eventDate === '2026-11-23' && o.dueDate === '2026-12-23'), 'special resolution → MGT-14 due 23 Dec');

// 9. 120-day gap; list views
const next = await a.call('/meetings', { body: { clientId: kaveri.id, type: 'BOARD', date: '2027-04-05' }, expect: 201 });
ok(/2nd Board Meeting|1st Board Meeting — FY 2027/.test(next.title), `next one titled “${next.title}”`);
ok((await a.call(`/meetings/${next.id}`)).checks.find((c: any) => c.key === 'gap')?.level === 'error', '136 days after the last board meeting → flagged');
ok((await a.call('/meetings?view=upcoming')).some((r: any) => r.m.id === next.id), 'listed under “Coming up”');
ok((await a.call('/meetings?view=minutes')).some((r: any) => r.m.id === egm.id), 'EGM listed under “Minutes pending”');
await a.call(`/meetings/${next.id}/cancel`, { method: 'POST' });

// 10. A client user sees only their company's meetings
const roles = await a.call('/admin/roles');
const marina = (await a.call('/clients?q=Marina'))[0];
await a.call('/admin/users', { body: { name: 'Marina Viewer', email: 'viewer@marina.in', password: 'Marina#Pass1', roleIds: [roles.find((r: any) => r.key === 'CLIENT_VIEWER').id], clientIds: [marina.id] } });
const cu = new Agent();
await cu.call('/auth/login', { body: { workspace: 'demo', email: 'viewer@marina.in', password: 'Marina#Pass1' } });
await cu.call(`/meetings/${bm.id}`, { expect: 404 });
ok((await cu.call('/meetings?view=all')).every((r: any) => r.m.clientId === marina.id), 'client user sees only their company’s meetings');
await cu.call('/meetings', { body: { clientId: marina.id, type: 'BOARD', date: '2026-12-01' }, expect: 403 });
ok(true, 'client viewer cannot schedule meetings');
console.log('\nAll meeting checks passed');
