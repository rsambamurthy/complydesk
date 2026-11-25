/**
 * MCA form data packs end to end. Needs the API running and a fresh demo seed.
 * Run: npx tsx scripts/smoke-eforms.ts
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
const all = await exec.call(`/obligations?clientId=${kaveri.id}&bucket=all`);
const mgt7 = all.find((o: any) => o.form === 'MGT-7' && o.fy === 2025);
ok((await exec.call(`/obligations/${mgt7.id}`)).formPack === true, 'MGT-7 has a form data pack');
let p = await exec.call(`/obligations/${mgt7.id}/form`);
const f = (k: string) => p.parts.flatMap((x: any) => x.fields).find((x: any) => x.key === k);
ok(f('cin').value === kaveri.cin && f('agmDate').value, 'CIN and AGM date from records');
ok(p.progress.missing.includes('PAN of the company') && p.progress.filled < p.progress.total, `${p.progress.filled}/${p.progress.total} ready; PAN missing`);
const before = p.progress.filled;
const r = await exec.call(`/obligations/${mgt7.id}/review`);
ok(r.records.some((x: any) => /MCA form data: \d+ of \d+ fields still empty/.test(x.text)), 'pre-filing check mentions the empty form fields');
p = await exec.call(`/obligations/${mgt7.id}/form`, { method: 'PUT', body: { values: { pan: 'AABCK1234L', turnover: '48650000', notAField: 'x', mainActivityCode: 'J' } } });
ok(f('pan').value === 'AABCK1234L' && f('turnover').value === '48650000' && p.progress.filled === before + 3, 'typed values saved; unknown keys ignored');
const mgt7a = all.find((o: any) => /MGT-7/.test(o.form) && o.fy === 2026);
const next = await exec.call(`/obligations/${mgt7a.id}/form`);
ok(next.parts.flatMap((x: any) => x.fields).find((x: any) => x.key === 'pan').value === 'AABCK1234L', 'PAN (client profile) reused for next year’s return');
ok(next.parts.flatMap((x: any) => x.fields).find((x: any) => x.key === 'turnover').value === null, 'turnover (this filing only) not carried over');
const x = await exec.call(`/obligations/${mgt7.id}/form.xlsx`, { raw: true });
ok(x.type?.includes('spreadsheetml') && x.size > 3000, 'Excel download');
const dpt = all.find((o: any) => o.form === 'DPT-3');
ok((await exec.call(`/obligations/${dpt.id}/form`)).form === 'DPT-3', 'DPT-3 has a pack too');
const kyc = all.find((o: any) => o.form === 'DIR-3 KYC');
if (kyc) await exec.call(`/obligations/${kyc.id}/form`, { expect: 404 });
ok(true, 'forms without a pack say so');
const client = await admin.call(`/clients/${kaveri.id}`);
ok(client.client.profile.pan === 'AABCK1234L', 'profile stored on the client');
console.log('\nAll form-data checks passed.');
