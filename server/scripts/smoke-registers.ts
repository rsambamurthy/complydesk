/**
 * Statutory registers end to end. Needs the API running and a fresh demo seed.
 * Run: npx tsx scripts/smoke-registers.ts
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
const R = `/registers/${kaveri.id}`;

const list = await exec.call(R);
ok(list.length === 6 && list.find((r: any) => r.code === 'MEMBERS').count === 2, 'six registers; members from the Shareholders tab');
let mem = await exec.call(`${R}/MEMBERS`);
ok(!mem.warnings.length && mem.rows[0].cells.movements.includes('Allotted 30,000'), 'members register: allotments shown, holdings add up');
const dir = await exec.call(`${R}/DIRECTORS`);
ok(dir.rows[0].cells.shares === '30,000 equity', 'directors register shows shares held');

const bad = await exec.call(`${R}/CHARGES/entries`, { body: { createdOn: '2026-11-10', holder: '', amount: 'x' }, expect: 400 });
ok(bad.details?.holder && bad.details?.amount && bad.details?.property, 'charge: missing fields named');
const c = await exec.call(`${R}/CHARGES/entries`, { body: { createdOn: '2026-11-10', holder: 'State Bank of India', amount: '25,00,000', nature: 'MORTGAGE', property: 'Office at Guindy' }, expect: 201 });
ok(c.filings[0]?.form === 'CHG-1' && c.filings[0].dueDate === '2026-12-10', 'new charge adds CHG-1 due 30 days later');
const raw = (await exec.call(`${R}/CHARGES`)).raw[c.entry.id];
const s = await exec.call(`/registers/entries/${c.entry.id}`, { method: 'PUT', body: { ...raw, satisfiedOn: '2026-11-20' } });
ok(s.filings.map((f: any) => f.form).join() === 'CHG-4', 'satisfying it adds CHG-4 only');
ok((await exec.call(`${R}/CHARGES`)).rows.find((r: any) => r.id === c.entry.id).closed, 'satisfied charge shown as closed');

const anita = mem.rows.find((r: any) => r.cells.name === 'Anita Rao').id;
const a = await exec.call(`${R}/SHARE_LEDGER/entries`, { body: { kind: 'ALLOTMENT', date: '2026-11-15', toMember: anita, shareClass: 'EQUITY', shares: 5000, distinctiveFrom: 50001, distinctiveTo: 55000 }, expect: 201 });
ok(a.filings[0]?.form === 'PAS-3', 'allotment adds PAS-3');
mem = await exec.call(`${R}/MEMBERS`);
ok(mem.warnings.some((w: string) => /add up to 35,000/.test(w)), 'members register flags the holding not yet updated');
await exec.call(`/clients/shareholders/${anita}`, { method: 'DELETE', expect: 409 });
ok(true, 'a member in a register can\'t be deleted');

const x = await exec.call(`${R}/export.xlsx`, { raw: true });
ok(x.status === 200 && /spreadsheet/.test(x.type) && x.size > 5000, 'Excel of all registers');
await exec.call(`${R}/MEMBERS/entries`, { body: {}, expect: 400 });
ok(true, 'derived registers take no entries');
await exec.call(`/registers/entries/${a.entry.id}`, { method: 'DELETE' });
ok((await exec.call(`${R}/SHARE_LEDGER`)).rows.length === 2, 'entry deleted');
console.log('Registers smoke passed');
