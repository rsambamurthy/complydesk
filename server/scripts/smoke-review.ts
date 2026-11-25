/**
 * Reviewer check end to end (EXTRACT_DRIVER=mock on the API). Needs the API running and a fresh demo seed.
 * Run: npx tsx scripts/smoke-review.ts
 */
const BASE = process.env.BASE ?? 'http://localhost:4000/api';
class Agent {
  cookie = '';
  async call(path: string, opts: { method?: string; body?: any; expect?: number } = {}) {
    const isForm = opts.body instanceof FormData;
    const r = await fetch(BASE + path, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers: { 'X-Requested-With': 'fetch', cookie: this.cookie, ...(opts.body && !isForm ? { 'Content-Type': 'application/json' } : {}) }, body: opts.body ? (isForm ? opts.body : JSON.stringify(opts.body)) : undefined });
    const set = r.headers.get('set-cookie'); if (set) this.cookie = set.split(';')[0];
    const data: any = await r.json().catch(() => ({}));
    if (opts.expect ? r.status !== opts.expect : !r.ok) throw new Error(`${opts.method ?? 'GET'} ${path} → ${r.status} ${JSON.stringify(data)}`);
    return data;
  }
}
const ok = (c: unknown, m: string) => { if (!c) throw new Error('FAILED: ' + m); console.log('✓', m); };
const login = async (email: string) => { const a = new Agent(); await a.call('/auth/login', { body: { workspace: 'demo', email, password: 'Demo@12345' } }); return a; };
const admin = await login('admin@demo.in');
const exec = await login('karthik@demo.in');
const kaveri = (await admin.call('/clients?q=Kaveri'))[0];
const mgt7 = (await exec.call(`/obligations?clientId=${kaveri.id}&bucket=open`)).find((o: any) => o.form === 'MGT-7' && o.fy === 2025);

let r = await exec.call(`/obligations/${mgt7.id}/review`);
const t = (l: string) => r.records.filter((f: any) => f.level === l).map((f: any) => f.text).join(' | ');
ok(t('ok').includes('Shareholding matches paid-up capital'), 'records: shareholding matches paid-up capital');
ok(t('ok').includes('Can be signed by'), 'records: a director can sign');
ok(t('warn').includes('days late'), 'records: late filing flagged');
ok(r.latest === null && r.checkable.length === 0 && r.aiEnabled, 'no draft attached yet');

const pdf = Buffer.from('%PDF-1.4\n%%EOF');
const fd = new FormData(); fd.append('entity', 'obligation'); fd.append('entityId', mgt7.id); fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'MGT-7 draft FY 2025-26.pdf');
const file = await exec.call('/files', { body: fd });
await exec.call(`/obligations/${mgt7.id}/review`, { body: {}, expect: 400 });
ok(true, 'must pick the draft');
const chk = await exec.call(`/obligations/${mgt7.id}/review`, { body: { attachmentId: file.id } });
const e = chk.findings.filter((f: any) => f.level === 'error').map((f: any) => f.text).join(' | ');
ok(/AGM date: draft says 21 Sept 2026, records say 22 Sept 2026/.test(e), 'draft check: AGM date mismatch found');
ok(/Ravi Kumar/.test(e), 'draft check: director not in our records found');
ok(chk.findings.some((f: any) => f.level === 'ok' && /Total shares match/.test(f.text)), 'draft check: total shares match confirmed');
r = await admin.call(`/obligations/${mgt7.id}/review`);
ok(r.latest?.fileName === 'MGT-7 draft FY 2025-26.pdf' && r.latest.userName === 'Karthik S', 'reviewer sees the latest check');
const d = await admin.call(`/obligations/${mgt7.id}`);
ok(d.history.some((h: any) => h.action === 'checked' && /to fix/.test(h.note)), 'check recorded in the history');
const other = (await admin.call(`/obligations?clientId=${kaveri.id}&bucket=all`)).find((o: any) => o.id !== mgt7.id && o.form === 'DPT-3');
await exec.call(`/obligations/${other.id}/review`, { body: { attachmentId: file.id }, expect: 404 });
ok(true, 'a file from another filing can’t be checked here');
const meeting = (await admin.call(`/obligations?clientId=${kaveri.id}&bucket=all`)).find((o: any) => o.form === 'Board meeting');
await exec.call(`/obligations/${meeting.id}/review`, { expect: 400 });
ok(true, 'meetings aren’t checked here');
console.log('\nAll reviewer-check checks passed.');
