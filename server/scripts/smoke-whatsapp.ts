/**
 * WhatsApp messages end to end (logged, not sent, without WHATSAPP_TOKEN). Needs the API running and a fresh seed.
 * Run: npx tsx scripts/smoke-whatsapp.ts
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
const kaveri = (await admin.call('/clients?q=Kaveri'))[0];
const roles = await admin.call('/admin/roles');
const clientAdmin = roles.find((r: any) => r.key === 'CLIENT_ADMIN');

// A client approver with a mobile and WhatsApp consent
await admin.call('/admin/users', { body: { name: 'Ravi Kaveri', email: 'ravi@kaveri.example', password: 'Demo@12345', roleIds: [clientAdmin.id], clientIds: [kaveri.id], mobile: '98400 12345', whatsappOptIn: true }, expect: 201 });
await admin.call('/admin/users', { body: { name: 'Bad Number', email: 'bad@kaveri.example', password: 'Demo@12345', roleIds: [clientAdmin.id], clientIds: [kaveri.id], mobile: '12345' }, expect: 400 });
ok(true, 'mobile numbers checked');
let wa = await admin.call('/admin/whatsapp');
ok(wa.configured === false && wa.templates.length === 3, 'WhatsApp not set up here: messages are logged; 3 templates listed');

// Off by default: nothing sent
await admin.call('/admin/settings', { method: 'PUT', body: { requireClientApproval: true } });
const exec = await login('karthik@demo.in');
const obs = await exec.call(`/obligations?clientId=${kaveri.id}&bucket=open`);
const f = obs.find((o: any) => o.stage === 'TODO' && !['AGM', 'Board meeting'].includes(o.form));
const walk = async (id: string, actions: string[]) => { for (const a of actions) await (a === 'review_ok' ? admin : exec).call(`/obligations/${id}/move`, { body: { action: a, ...(a === 'review_ok' ? { override: true, note: 'smoke' } : {}) } }); };
await walk(f.id, ['drafted', 'submit', 'review_ok']);
ok((await admin.call('/admin/whatsapp')).log.length === 0, 'WhatsApp off for the firm: nothing sent');

// On: the approver gets a WhatsApp when the next filing reaches the client
await admin.call('/admin/settings', { method: 'PUT', body: { whatsappEnabled: true } });
const g = obs.filter((o: any) => o.stage === 'TODO' && !['AGM', 'Board meeting'].includes(o.form))[1];
await walk(g.id, ['drafted', 'submit', 'review_ok']);
await new Promise((r) => setTimeout(r, 500));
wa = await admin.call('/admin/whatsapp');
ok(wa.log.some((m: any) => m.template === 'approval' && m.to === '919840012345' && m.status === 'LOGGED' && m.ref === `obligation:${g.id}`), 'approval request to the client approver (logged)');

// Document request: WhatsApp + email to the client's users
await exec.call(`/clients/${kaveri.id}/doc-requests`, { body: { items: [] }, expect: 400 });
const dr = await exec.call(`/clients/${kaveri.id}/doc-requests`, { body: { items: ['Audited financial statements FY 2025-26', 'Bank statement for March'], dueDate: '2026-11-27', note: 'Needed for AOC-4' }, expect: 201 });
ok(dr.sentTo.length === 1 && dr.sentTo[0].whatsapp === true, 'document request sent (WhatsApp + email)');
const client = await login('ravi@kaveri.example');
ok((await client.call(`/clients/${kaveri.id}/doc-requests`)).some((x: any) => x.id === dr.id && x.status === 'OPEN'), 'the client sees the open request');
await client.call(`/clients/doc-requests/${dr.id}`, { method: 'PATCH', body: { status: 'RECEIVED' }, expect: 403 });
await exec.call(`/clients/doc-requests/${dr.id}`, { method: 'PATCH', body: { status: 'RECEIVED' } });
ok((await exec.call(`/clients/${kaveri.id}/doc-requests`))[0].status === 'RECEIVED', 'the firm marks it received');

// Daily reminders: approvals waiting 2+ days (once every 3 days)
const { db, schema } = await import('../src/lib/core.js');
const { eq } = await import('drizzle-orm');
await db.update(schema.obligations).set({ updatedAt: new Date(Date.now() - 3 * 86400_000) }).where(eq(schema.obligations.id, g.id));
await db.delete(schema.messageLog).where(eq(schema.messageLog.ref, `obligation:${g.id}`));
const { runWhatsappReminders } = await import('../src/services/messaging.js');
ok(await runWhatsappReminders() >= 1, 'reminder for the approval waiting 3 days');
ok(await runWhatsappReminders() === 0, 'not again the same day');
await admin.call('/admin/settings', { method: 'PUT', body: { whatsappEnabled: false, requireClientApproval: false } });
console.log('WhatsApp smoke passed');
process.exit(0);
