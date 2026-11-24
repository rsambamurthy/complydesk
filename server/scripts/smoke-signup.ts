/**
 * Self sign-up, trial and platform console, end to end. Needs the API running with PLATFORM_ADMINS=admin@demo.in
 * (logging to /tmp/api.log for the verification link) and the demo seed. Run: npx tsx scripts/smoke-signup.ts
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
const BASE = process.env.BASE ?? 'http://localhost:4000/api';
const DB = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/secretarial' });

class Agent {
  cookie = '';
  async call(path: string, opts: { method?: string; body?: any; expect?: number } = {}) {
    const r = await fetch(BASE + path, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers: { 'X-Requested-With': 'fetch', cookie: this.cookie, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const set = r.headers.get('set-cookie'); if (set) this.cookie = set.split(';')[0];
    const data: any = await r.json().catch(() => ({}));
    if (r.status !== (opts.expect ?? 200) && !(opts.expect === undefined && r.ok)) throw new Error(`${opts.method ?? 'GET'} ${path} → ${r.status} ${JSON.stringify(data)}`);
    return data;
  }
}
const ok = (c: unknown, m: string) => { if (!c) throw new Error('FAILED: ' + m); console.log('✓', m); };
const stamp = Date.now().toString(36);
const firm = (code: string, email: string) => ({ firmName: `Test Firm ${code}`, workspace: code, city: 'Chennai', adminName: 'Test Admin', email, mobile: '9876543210', password: 'Strong#Pass1', accept: true });

const platform = new Agent();
await platform.call('/auth/login', { body: { workspace: 'demo', email: 'admin@demo.in', password: 'Demo@12345' } });
ok((await platform.call('/auth/me')).platformAdmin, 'demo admin is a platform admin (PLATFORM_ADMINS)');
await platform.call('/platform/settings', { method: 'PUT', body: { requireApproval: false, trialDays: 30, trialClientLimit: 2 } });

// Workspace code checks
const anon = new Agent();
ok(!(await anon.call('/auth/workspace-available?code=demo')).available, 'taken code refused');
ok(!(await anon.call('/auth/workspace-available?code=admin')).available, 'reserved code refused');
ok((await anon.call('/auth/workspace-available?code=x&name=Rao%20%26%20Associates')).suggestion === 'rao-and-associates', 'code suggested from firm name');
const badSignup = await anon.call('/auth/signup', { body: { ...firm('ok-code', 'x@y.in'), mobile: '123', accept: false }, expect: 400 });
ok(badSignup.details.mobile && badSignup.details.accept, 'sign-up validation: mobile and terms');

// 1. Open sign-up → trial starts at once, signed in
const a = new Agent();
const codeA = `firm-a-${stamp}`;
const s1 = await a.call('/auth/signup', { body: firm(codeA, `a-${stamp}@firm.in`), expect: 201 });
ok(s1.status === 'TRIAL', 'sign-up with approval off → trial');
const meA = await a.call('/auth/me');
ok(meA.access.state === 'TRIAL' && meA.access.daysLeft === 30 && meA.access.clientLimit === 2, 'signed in straight away, 30 days left, 2-client limit');
ok(!meA.emailVerified, 'email not yet confirmed');
ok(meA.roles.some((r: any) => r.key === 'ADMIN'), 'sign-up user is Firm Admin');
await a.call('/auth/signup', { body: firm(codeA, `again-${stamp}@firm.in`), expect: 409 });
ok(true, 'same workspace code cannot sign up twice');

// Email verification link from the log
const link = [...readFileSync('/tmp/api.log', 'utf8').matchAll(/verify-email\?token=([\w-]+)/g)].pop()?.[1];
await a.call('/auth/verify-email', { body: { token: link } });
ok((await a.call('/auth/me')).emailVerified, 'email confirmed through the link');
await a.call('/auth/verify-email', { body: { token: link }, expect: 400 });
ok(true, 'link works only once');

// 2. Trial client limit
const client = (n: number) => ({ cin: `U72900TN20${10 + n}PTC1${stamp.slice(-2).replace(/\D/g, '0').padStart(2, '0')}${String(n).padStart(3, '0')}`.slice(0, 21), name: `Trial Client ${n} Pvt Ltd`, companyType: 'PRIVATE', smallCompany: true });
await a.call('/clients', { body: client(1) });
await a.call('/clients', { body: client(2) });
const third = await a.call('/clients', { body: client(3), expect: 402 });
ok(/up to 2 client/.test(third.error), 'third client refused during the trial');

// 3. Approval switched on
await platform.call('/platform/settings', { method: 'PUT', body: { requireApproval: true, trialDays: 14, trialClientLimit: 2 } });
const b = new Agent();
const codeB = `firm-b-${stamp}`;
const s2 = await b.call('/auth/signup', { body: firm(codeB, `b-${stamp}@firm.in`), expect: 201 });
ok(s2.status === 'PENDING_APPROVAL', 'sign-up with approval on → waiting');
const denied = await b.call('/auth/login', { body: { workspace: codeB, email: `b-${stamp}@firm.in`, password: 'Strong#Pass1' }, expect: 403 });
ok(/waiting for approval/.test(denied.error), 'cannot sign in before approval');
const list = await platform.call('/platform/tenants');
const tb = list.find((t: any) => t.slug === codeB);
ok(tb?.access.state === 'PENDING_APPROVAL', 'platform console lists it as awaiting approval');
await platform.call(`/platform/tenants/${tb.id}`, { body: { action: 'approve' } });
await b.call('/auth/login', { body: { workspace: codeB, email: `b-${stamp}@firm.in`, password: 'Strong#Pass1' } });
const meB = await b.call('/auth/me');
ok(meB.access.state === 'TRIAL' && meB.access.daysLeft === 14, 'approved → 14-day trial, can sign in');

// 4. Trial ends → read-only
await DB.query(`update tenants set trial_ends_at = now() - interval '1 day' where slug = $1`, [codeA]);
ok((await a.call('/auth/me')).access.state === 'TRIAL_ENDED', 'trial ended');
ok(Array.isArray(await a.call('/clients')), 'can still read');
const ro = await a.call('/clients', { body: client(9), expect: 402 });
ok(/read-only/.test(ro.error), 'changes blocked after the trial');
const ta = (await platform.call('/platform/tenants')).find((t: any) => t.slug === codeA);
await platform.call(`/platform/tenants/${ta.id}`, { body: { action: 'extend_trial', days: 10 } });
ok((await a.call('/auth/me')).access.daysLeft === 10, 'extend trial by 10 days → writable again');

// 5. Paid → no client limit
await platform.call(`/platform/tenants/${ta.id}`, { body: { action: 'activate', months: 12 } });
ok((await a.call('/auth/me')).access.state === 'ACTIVE', 'marked paid → active');
await a.call('/clients', { body: client(3) });
ok(true, 'active workspace can add more clients');

// 6. Suspend
await platform.call(`/platform/tenants/${ta.id}`, { body: { action: 'suspend' } });
await a.call('/auth/me', { expect: 401 });
const sus = await a.call('/auth/login', { body: { workspace: codeA, email: `a-${stamp}@firm.in`, password: 'Strong#Pass1' }, expect: 403 });
ok(/suspended/.test(sus.error), 'suspended → signed out, cannot sign in');
await platform.call(`/platform/tenants/${ta.id}`, { body: { action: 'reactivate' } });
await a.call('/auth/login', { body: { workspace: codeA, email: `a-${stamp}@firm.in`, password: 'Strong#Pass1' } });
ok((await a.call('/auth/me')).access.state === 'ACTIVE', 'reactivated');

// 7. Only platform admins see the console
await a.call('/platform/tenants', { expect: 403 });
ok(true, 'firm admin cannot open the platform console');
ok((await platform.call('/platform/events')).length >= 5, 'platform actions are logged');

await platform.call('/platform/settings', { method: 'PUT', body: { requireApproval: false, trialDays: 30, trialClientLimit: 10 } });
await DB.end();
console.log('\nAll sign-up checks passed');
