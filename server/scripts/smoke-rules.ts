/**
 * Configurable rules, end to end: Integrata's built-in rules for every firm, a firm's own changes and own rules,
 * full editing (who it applies to, kind of due date), history, and that a deploy keeps Integrata's edits.
 * Needs the API running with PLATFORM_ADMINS=admin@demo.in and a fresh demo seed. Run: npx tsx scripts/smoke-rules.ts
 */
import { seedCatalogue } from '../src/db/migrate.js';
import { pool } from '../src/lib/core.js';
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
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const edit = (r: any, patch: any) => ({ form: r.form, title: r.title, law: r.law, applies: r.applies, due: r.due, lateFee: r.lateFee, event: r.event, notes: r.notes, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, active: r.active, ...patch });

const admin = new Agent(); // demo firm admin, also a platform admin
await admin.call('/auth/login', { body: { workspace: 'demo', email: 'admin@demo.in', password: 'Demo@12345' } });
const exec = new Agent();
await exec.call('/auth/login', { body: { workspace: 'demo', email: 'karthik@demo.in', password: 'Demo@12345' } });
const other = new Agent(); // a second firm
await other.call('/auth/signup', { body: { firmName: 'Other Firm', workspace: `other-${Date.now().toString(36)}`, city: 'Pune', adminName: 'Other Admin', email: `o${Date.now()}@x.in`, mobile: '9876543210', password: 'Strong#Pass1', accept: true }, expect: 201 });
const otherClient = await other.call('/clients', { body: { cin: 'U72900MH2018PTC300001', name: 'Other Client Pvt Ltd', companyType: 'PRIVATE', smallCompany: false, incorporationDate: '2018-04-10' } });

const kaveri = (await admin.call('/clients?q=Kaveri'))[0];
// MGT-7 (not yet filed for Kaveri; AGM held 22 Sep 2026). Filed items keep their dates, so an open one is used.
const aoc4Due = async (a = admin, clientId = kaveri.id) => (await a.call(`/obligations?clientId=${clientId}&bucket=all&fy=2025`)).find((o: any) => o.ruleCode === 'MGT7')?.dueDate;
ok(await aoc4Due() === '2026-11-21', 'Kaveri MGT-7 due 21 Nov (AGM 22 Sep + 60)');
const platRules = async () => admin.call('/platform/rules');
const aoc4 = (await platRules()).find((r: any) => r.code === 'MGT7');

// 1. Integrata changes a built-in rule → every firm gets it
await admin.call('/platform/rules/MGT7', { method: 'PUT', body: edit(aoc4, { due: { ...aoc4.due, days: 75 } }) });
await wait(2500);
ok(await aoc4Due() === '2026-12-06', 'Integrata: MGT-7 75 days → demo firm recalculated (6 Dec)');
const otherAoc = (await other.call(`/obligations?clientId=${otherClient.id}&bucket=all&fy=2025`)).find((o: any) => o.ruleCode === 'MGT7');
ok(otherAoc.dueDate === '2026-12-14' && otherAoc.provisional, 'other firm too (30 Sep + 75, estimated)');
ok((await admin.call('/admin/rules')).find((r: any) => r.code === 'MGT7').origin === 'INTEGRATA', 'firm sees “Updated by Integrata”');

// 2. A deploy (catalogue refresh) keeps Integrata's edit
await seedCatalogue();
ok((await platRules()).find((r: any) => r.code === 'MGT7').due.days === 75, 'deploy refresh leaves Integrata’s edit alone');

// 3. A firm's own version wins for that firm only
const fAoc = (await admin.call('/admin/rules')).find((r: any) => r.code === 'MGT7');
await admin.call('/admin/rules/MGT7', { method: 'PUT', body: edit(fAoc, { due: { ...fAoc.due, days: 20 } }) });
ok(await aoc4Due() === '2026-10-12', 'firm’s own MGT-7 (20 days) → 12 Oct');
await admin.call('/platform/rules/MGT7', { method: 'PUT', body: edit(aoc4, { due: { ...aoc4.due, days: 70 } }) });
await wait(2500);
ok(await aoc4Due() === '2026-10-12', 'Integrata change does not override the firm’s version');
ok((await platRules()).find((r: any) => r.code === 'MGT7').firmsChanged === 1, 'console shows 1 firm has its own version');
await admin.call('/admin/rules/MGT7', { method: 'DELETE' });
ok(await aoc4Due() === '2026-12-01', 'firm goes back to built-in → Integrata’s 70 days (1 Dec)');

// 4. History
const hist = await admin.call('/admin/rules/MGT7/history');
ok(hist.length >= 4 && hist.some((h: any) => h.tenantId === null) && hist.some((h: any) => h.tenantId), 'history shows Integrata’s and the firm’s changes');
ok(hist.every((h: any) => h.by), 'every change records who made it');

// 5. Integrata resets to as shipped
await admin.call('/platform/rules/MGT7', { method: 'DELETE' });
await wait(2500);
ok(await aoc4Due() === '2026-11-21' && (await platRules()).find((r: any) => r.code === 'MGT7').source === 'CATALOGUE', 'back to the rule as shipped');

// 6. Integrata adds a new rule for all firms
const ben2 = { code: 'BEN2', form: 'BEN-2', title: 'Return of significant beneficial owners', law: 'Sec 90', applies: { types: ['PRIVATE'] }, due: { kind: 'AFTER_EVENT', days: 30 }, event: 'Declaration in BEN-1 received', lateFee: null, active: true };
await admin.call('/platform/rules', { body: ben2, expect: 201 });
await admin.call('/platform/rules', { body: ben2, expect: 409 });
ok((await other.call('/clients/meta')).eventRules.some((r: any) => r.code === 'BEN2'), 'new Integrata event rule offered to every firm');
const annual = { code: 'TEST_ANNUAL', form: 'TEST-1', title: 'Annual test filing', applies: {}, due: { kind: 'FIXED', date: { day: 15, month: 1, yearOffset: 1 } }, active: true };
await admin.call('/platform/rules', { body: annual, expect: 201 });
await wait(2500);
ok((await other.call(`/obligations?clientId=${otherClient.id}&bucket=all&fy=2025`)).some((o: any) => o.form === 'TEST-1' && o.dueDate === '2026-01-15'), 'new Integrata annual rule on every firm’s calendar');
await admin.call('/platform/rules/TEST_ANNUAL', { method: 'DELETE' });
await wait(2500);
ok(!(await other.call(`/obligations?clientId=${otherClient.id}&bucket=open`)).some((o: any) => o.form === 'TEST-1'), 'deleting it takes it off the calendars');

// 7. A firm's own rule stays in that firm
await admin.call('/admin/rules', { body: { code: 'FIRM_REVIEW', form: 'Internal review', title: 'Half-yearly secretarial health check', applies: { types: ['PRIVATE'] }, due: { kind: 'PERIODS', periods: [{ label: 'H1', date: { day: 15, month: 10, yearOffset: 0 } }, { label: 'H2', date: { day: 15, month: 4, yearOffset: 1 } }] }, active: true }, expect: 201 });
const kav = await admin.call(`/obligations?clientId=${kaveri.id}&bucket=all&fy=2026`);
ok(kav.filter((o: any) => o.ruleCode === 'FIRM_REVIEW').length === 2, 'firm’s own half-yearly rule → 2 items per client');
ok(!(await other.call('/admin/rules')).some((r: any) => r.code === 'FIRM_REVIEW'), 'other firm doesn’t see it');

// 8. Change who a rule applies to and its kind of due date
const marina = (await admin.call('/clients?q=Marina'))[0];
ok(!(await admin.call(`/obligations?clientId=${marina.id}&bucket=all`)).some((o: any) => o.ruleCode === 'DPT3'), 'Marina has no DPT-3 (loans flag off)');
const dpt3 = (await admin.call('/admin/rules')).find((r: any) => r.code === 'DPT3');
await admin.call('/admin/rules/DPT3', { method: 'PUT', body: edit(dpt3, { applies: {} }) });
ok((await admin.call(`/obligations?clientId=${marina.id}&bucket=all`)).some((o: any) => o.ruleCode === 'DPT3'), 'DPT-3 for all companies → Marina gets it');
const msme = (await admin.call('/admin/rules')).find((r: any) => r.code === 'MSME1');
await admin.call('/admin/rules/MSME1', { method: 'PUT', body: edit(msme, { due: { kind: 'FIXED', date: { day: 31, month: 5, yearOffset: 1 } } }) });
const m = (await admin.call(`/obligations?clientId=${kaveri.id}&bucket=all&fy=2026`)).filter((o: any) => o.ruleCode === 'MSME1' && o.status !== 'FILED');
ok(m.length === 1 && m[0].dueDate === '2027-05-31', 'MSME-1 turned into one annual date');

// 9. Validation and permissions
const bad = await admin.call('/admin/rules/DPT3', { method: 'PUT', body: edit(dpt3, { due: { kind: 'FIXED', date: { day: 30, month: 2, yearOffset: 1 } } }), expect: 400 });
ok(JSON.stringify(bad.details).includes('doesn’t exist'), '30 Feb refused');
const noEvent = await admin.call('/admin/rules', { body: { code: 'X1', form: 'XX-1', title: 'X rule', due: { kind: 'AFTER_EVENT', days: 10 } }, expect: 400 });
ok(noEvent.details.event, 'event rule needs an event name');
await admin.call('/admin/rules', { body: { code: 'bad code', form: 'XX-1', title: 'X rule', due: { kind: 'AGM_LAST_DATE' } }, expect: 400 });
await admin.call('/admin/rules', { body: { code: 'AOC4', form: 'XX-1', title: 'X rule', due: { kind: 'AGM_LAST_DATE' } }, expect: 409 });
ok(true, 'bad and duplicate codes refused');
await exec.call('/admin/rules/DPT3', { method: 'PUT', body: edit(dpt3, {}), expect: 403 });
ok(true, 'CS Executive (no rules.manage) cannot change rules');
await other.call('/platform/rules', { expect: 403 });
ok(true, 'a firm cannot open the built-in rules console');

await pool.end();
console.log('\nAll rule checks passed');
