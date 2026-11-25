/**
 * Team workload and time entries end to end. Needs the API running and a fresh seed.
 * Run: npx tsx scripts/smoke-team.ts
 */
const BASE = process.env.BASE ?? 'http://localhost:4000/api';
class Agent {
  cookie = '';
  async call(path: string, opts: { method?: string; body?: any; expect?: number; raw?: boolean } = {}) {
    const r = await fetch(BASE + path, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers: { 'X-Requested-With': 'fetch', cookie: this.cookie, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) this.cookie = set.split(';')[0];
    const data: any = opts.raw ? { status: r.status, type: r.headers.get('content-type'), size: (await r.arrayBuffer()).byteLength } : await r.json().catch(() => ({}));
    if (opts.expect ? r.status !== opts.expect : !r.ok) throw new Error(`${opts.method ?? 'GET'} ${path} → ${r.status} ${JSON.stringify(data)}`);
    return data;
  }
}
const ok = (c: unknown, m: string) => { if (!c) throw new Error('FAILED: ' + m); console.log('✓', m); };
const login = async (email: string) => { const a = new Agent(); await a.call('/auth/login', { body: { workspace: 'demo', email, password: 'Demo@12345' } }); return a; };
const admin = await login('admin@demo.in');
const exec = await login('karthik@demo.in');
const kaveri = (await admin.call('/clients?q=Kaveri'))[0];

await exec.call('/team/workload', { expect: 403 });
ok(true, 'workload is for Firm Admins and Partners');
let w = await admin.call('/team/workload?period=month');
const k = w.people.find((p: any) => p.name === 'Karthik S');
ok(k && k.hours === 6 && w.totals.hours === 7, `hours this month: Karthik ${k.hours}, team ${w.totals.hours}`);
ok(w.clients[0].name.startsWith('Kaveri') && w.clients[0].hours === 5, 'time by client, most first');
ok(w.totals.open > 0 && w.totals.unassigned >= 0, `${w.totals.open} open, ${w.totals.unassigned} unassigned`);

// Assign and log time on a filing
const ob = (await exec.call(`/obligations?clientId=${kaveri.id}&bucket=open`)).find((o: any) => !['AGM', 'Board meeting'].includes(o.form));
await exec.call(`/obligations/${ob.id}`, { method: 'PATCH', body: { assigneeId: (await exec.call('/auth/me')).user.id } });
await exec.call('/team/time', { body: { obligationId: ob.id, date: '2099-01-01', hours: 1 }, expect: 400 });
await exec.call('/team/time', { body: { obligationId: ob.id, date: new Date().toISOString().slice(0, 10) }, expect: 400 });
const t1 = await exec.call('/team/time', { body: { obligationId: ob.id, date: new Date().toISOString().slice(0, 10), hours: 1.5, note: 'Drafting' }, expect: 201 });
ok(t1.minutes === 90 && t1.clientId === kaveri.id, 'time logged on a filing (client taken from it)');
ok((await exec.call(`/team/time?obligationId=${ob.id}`)).length === 1, 'listed on the filing');
const mine = await exec.call('/team/time');
ok(mine.every((x: any) => x.userName === 'Karthik S'), 'without team.view you see your own time');
w = await admin.call('/team/workload?period=month');
ok(w.people.find((p: any) => p.name === 'Karthik S').open >= 1 && w.people.find((p: any) => p.name === 'Karthik S').hours === 7.5, 'workload shows the assignment and the new hours');
const other = (await admin.call('/team/time')).find((x: any) => x.userName === 'Lakshmi Rao');
await exec.call(`/team/time/${other.id}`, { method: 'DELETE', expect: 403 });
await exec.call(`/team/time/${t1.id}`, { method: 'DELETE' });
ok(true, 'remove your own entry, not someone else’s');
console.log('Team smoke passed');
