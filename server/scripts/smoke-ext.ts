/**
 * Browser-extension API end to end. Needs the API running and a fresh demo seed.
 * Run: npx tsx scripts/smoke-ext.ts
 */
const BASE = process.env.BASE ?? 'http://localhost:4000/api';
class Agent {
  cookie = ''; bearer = '';
  async call(path: string, opts: { method?: string; body?: any; expect?: number; raw?: boolean } = {}) {
    const r = await fetch(BASE + path, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers: { 'X-Requested-With': 'fetch', ...(this.cookie ? { cookie: this.cookie } : {}), ...(this.bearer ? { Authorization: `Bearer ${this.bearer}` } : {}), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) this.cookie = set.split(';')[0];
    const data: any = opts.raw ? { type: r.headers.get('content-type'), size: (await r.arrayBuffer()).byteLength } : await r.json().catch(() => ({}));
    if (opts.expect ? r.status !== opts.expect : !r.ok) throw new Error(`${opts.method ?? 'GET'} ${path} → ${r.status} ${JSON.stringify(data)}`);
    return data;
  }
}
const ok = (c: unknown, m: string) => { if (!c) throw new Error('FAILED: ' + m); console.log('✓', m); };
const exec = new Agent(); await exec.call('/auth/login', { body: { workspace: 'demo', email: 'karthik@demo.in', password: 'Demo@12345' } });
const ext = new Agent();
await ext.call('/ext/me', { expect: 401 });
ok(true, 'no token, no access');
const made = await exec.call('/auth/extension-tokens', { body: { name: 'Chrome test' } });
ok(/^cdx_/.test(made.token), 'connection code created');
ext.bearer = made.token;
const me = await ext.call('/ext/me');
ok(me.user.name === 'Karthik S' && /Rao & Associates/.test(me.workspace), 'extension knows who it is');
const list = await ext.call('/ext/filings?q=Kaveri');
ok(list.length > 0 && list.every((f: any) => ['MGT-7', 'MGT-7A', 'AOC-4', 'DIR-12', 'ADT-1', 'PAS-3'].includes(f.form) && f.clientName.startsWith('Kaveri')), `filings with form data: ${list.map((f: any) => f.form).join(', ')}`);
const pack = await ext.call(`/ext/filings/${list[0].id}/form`);
ok(pack.parts[0].fields[0].aliases?.includes('CIN'), 'form data with portal aliases');
await ext.call('/clients', { expect: 401 });
ok(true, 'token can’t use the rest of the API');
// Filing status read from the MCA portal
const filed = await ext.call('/ext/filed');
ok(filed.length >= 3 && filed.every((f: any) => f.stage === 'FILED' && f.srn), `${filed.length} filings awaiting MCA, with SRNs`);
const st = await ext.call('/ext/srn-status', { body: { updates: [
  { obligationId: filed[0].id, srn: filed[0].srn, status: 'APPROVED', phrase: 'Approved', date: '2026-11-01' },
  { obligationId: filed[1].id, srn: filed[1].srn, status: 'RESUBMIT', phrase: 'Marked for Resubmission' },
  { obligationId: filed[2].id, srn: 'X00000000', status: 'APPROVED', phrase: 'Approved' },
] } });
ok(st.updated === 2 && st.results[2].error.includes('SRN'), 'approved and resubmission applied; wrong SRN refused');
const hist = (await exec.call(`/obligations/${filed[0].id}`)).history;
ok(hist.some((h: any) => h.action === 'approved' && h.note.includes('read by the ComplyDesk extension') && h.userName === 'Karthik S'), 'history: approved, by whom, read from the portal');
const again = await ext.call('/ext/srn-status', { body: { updates: [{ obligationId: filed[0].id, srn: filed[0].srn, status: 'APPROVED' }] } });
ok(again.updated === 0, 'already approved: nothing to do');
ok(!(await ext.call('/ext/filed')).some((f: any) => f.id === filed[0].id || f.id === filed[1].id), 'they drop off the awaiting-MCA list');
const conns = await exec.call('/auth/extension-tokens');
ok(conns.length === 1 && conns[0].lastUsedAt, 'connection listed with last use');
const zip = await exec.call('/extension.zip', { raw: true });
ok(zip.type === 'application/zip' && zip.size > 2000, 'extension download');
await exec.call(`/auth/extension-tokens/${made.id}`, { method: 'DELETE' });
await ext.call('/ext/me', { expect: 401 });
ok(true, 'disconnected browser is refused');
console.log('\nAll extension API checks passed.');
