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

// Approval waits for the things to fix (setting on by default)
ok((await admin.call('/admin/settings')).blockOnCheckErrors === true, 'holding back approval is on by default');
await exec.call(`/obligations/${mgt7.id}/move`, { body: { action: 'drafted' } });
await exec.call(`/obligations/${mgt7.id}/move`, { body: { action: 'submit' } });
const dd = await admin.call(`/obligations/${mgt7.id}`);
const appr = dd.moves.find((m: any) => m.action === 'review_ok');
ok(!appr.blocked && appr.override === 2, 'partner: approve is open, but needs a reason (2 issues to fix)');
const ed = await exec.call(`/obligations/${mgt7.id}`);
ok(!ed.moves.some((m: any) => m.action === 'review_ok' && !m.blocked), 'executive can’t approve');
await admin.call(`/obligations/${mgt7.id}/move`, { body: { action: 'review_ok' }, expect: 400 });
ok(true, 'approving over the check without a reason is refused');
ok(dd.moves.find((m: any) => m.action === 'return' && !m.blocked), 'returning for changes is still allowed');
await admin.call(`/obligations/${mgt7.id}/move`, { body: { action: 'review_ok', override: true, note: 'AGM date in draft is correct — records to be fixed; Ravi Kumar appointed 20 Nov' } });
const h = (await admin.call(`/obligations/${mgt7.id}`)).history;
ok(h.some((x: any) => x.action === 'override' && /Approved despite 2 issues to fix: AGM date/.test(x.note)), 'the reason is kept in the history');
await exec.call(`/obligations/${mgt7.id}/move`, { body: { action: 'filed', srn: 'AB1234567', filedOn: '2026-11-25' } });
ok(true, 'after the partner’s approval the executive can file — a V3 SRN (2 letters + 7 digits) is accepted');
console.log('\nAll reviewer-check checks passed.');
