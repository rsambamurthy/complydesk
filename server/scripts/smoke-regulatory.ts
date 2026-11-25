/**
 * Regulatory updates end to end. Needs the API running (PLATFORM_ADMINS=admin@demo.in, EXTRACT_DRIVER=mock) and a fresh seed.
 * Run: npx tsx scripts/smoke-regulatory.ts
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

let list = await exec.call('/regulatory');
const seeded = list.find((u: any) => /Small company limits/.test(u.title));
ok(seeded && seeded.affected.some((c: any) => c.name.startsWith('Kaveri')) && !seeded.affected.some((c: any) => c.name.startsWith('Marina')), 'seeded update: affects Kaveri (not small), not Marina (small)');
ok((await exec.call('/regulatory/count')).unreviewed >= 1, 'counted as waiting for review');
await exec.call('/platform/reg-updates', { expect: 403 });
ok(true, 'only Integrata can draft and publish');

const d = await admin.call('/platform/reg-updates/draft', { body: { text: 'MSME-1 return now half-yearly by 30 April and 31 October for companies with MSME dues — effective 2026-12-01. Due date change.' } });
ok(d.title && d.effectiveFrom === '2026-12-01' && d.impact === 'HIGH', 'AI (mock) draft from pasted text');
await admin.call('/platform/reg-updates', { body: { title: 'x', summary: 'short' }, expect: 400 });
const u = await admin.call('/platform/reg-updates', { body: { ...d, actions: d.actions.join('\n'), applies: { types: ['PRIVATE'], flags: ['msmeDues'] }, forms: ['MSME1', 'NOPE'] }, expect: 201 });
ok(u.status === 'DRAFT' && u.forms.join() === 'MSME1', 'saved as draft; unknown forms dropped');
ok(!(await exec.call('/regulatory')).some((x: any) => x.id === u.id), 'drafts are not shown to firms');
const pub = await admin.call(`/platform/reg-updates/${u.id}/publish`, { body: {} });
ok(pub.update.status === 'PUBLISHED' && pub.emailed >= 1, `published; ${pub.emailed} Firm Admin email(s)`);
await admin.call(`/platform/reg-updates/${u.id}/publish`, { body: {}, expect: 400 });
list = await exec.call('/regulatory');
const mine = list.find((x: any) => x.id === u.id);
ok(mine.affected.length === 1 && mine.affected[0].name.startsWith('Kaveri') && mine.formNames.includes('MSME-1'), 'firm sees it: only Kaveri has MSME dues');
await exec.call(`/regulatory/${u.id}/review`, { body: { note: 'Checked MSME-1 dates' } });
const after = (await exec.call('/regulatory')).find((x: any) => x.id === u.id);
ok(after.reviewed.by === 'Karthik S' && after.reviewed.note === 'Checked MSME-1 dates', 'marked reviewed with a note');
console.log('Regulatory smoke passed');
