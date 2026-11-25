/**
 * Client compliance report end to end. Needs the API running and a fresh demo seed (uses the same DATABASE_URL for the monthly run).
 * Run: npx tsx scripts/smoke-report.ts
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
const R = `/clients/${kaveri.id}/report`;

let r = await exec.call(R);
ok(['ON_TRACK', 'DUE_SOON', 'ATTENTION'].includes(r.status) && r.client.cin === kaveri.cin, `report built: ${r.status}, ${r.counts.overdue} overdue, ${r.counts.upcoming} coming up`);
ok(r.overdue.every((i: any) => i.dueDate < r.asOf) && r.upcoming.every((i: any) => i.dueDate >= r.asOf), 'overdue and upcoming split by date');
ok(r.counts.fyTotal >= r.counts.fyDone, `progress ${r.counts.fyDone}/${r.counts.fyTotal}`);
await exec.call(`${R}/send`, { body: {}, expect: 400 });
ok(true, 'no address on file: asks for one');
await exec.call(`${R}/send`, { body: { to: 'not-an-email' }, expect: 400 });
const s1 = await exec.call(`${R}/send`, { body: { to: 'accounts@kaveri.example, ceo@kaveri.example' } });
ok(s1.to.length === 2, 'sent to two typed addresses');
r = await exec.call(R);
ok(r.log[0]?.sentTo.length === 2 && r.log[0].by === 'Karthik S', 'sent log shows who and to whom');

// Monthly run (service called directly): only firms that switched it on, once per client and month
const { runMonthlyReports } = await import('../src/services/clientReport.js');
ok(await runMonthlyReports('2026-12-02') === 0, 'not the 1st: nothing sent');
ok(await runMonthlyReports('2026-12-01') === 0, 'setting off: nothing sent');
await admin.call('/admin/settings', { method: 'PUT', body: { monthlyClientReport: true } });
await admin.call(`/billing/clients/${kaveri.id}`, { method: 'PUT', body: { email: 'accounts@kaveri.example' } });
const n1 = await runMonthlyReports('2026-12-01');
ok(n1 >= 1, `monthly: ${n1} client(s) with an address emailed`);
ok(await runMonthlyReports('2026-12-01') === 0, 'running again the same month sends nothing');
await admin.call('/admin/settings', { method: 'PUT', body: { monthlyClientReport: false } });
console.log('Client report smoke passed');
process.exit(0);
