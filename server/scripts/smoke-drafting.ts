/**
 * AI drafting for meetings end to end (EXTRACT_DRIVER=mock: stand-in drafts, real checks). Needs the API running and a fresh seed.
 * Run: npx tsx scripts/smoke-drafting.ts
 */
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
const a = new Agent();
await a.call('/auth/login', { body: { workspace: 'demo', email: 'admin@demo.in', password: 'Demo@12345' } });
const kaveri = (await a.call('/clients?q=Kaveri'))[0];
ok((await a.call('/meetings/ai/status')).enabled, 'AI drafting is on (mock)');

// Board meeting: an item drafted from a description
const bm = await a.call('/meetings', { body: { clientId: kaveri.id, type: 'BOARD', date: '2026-11-20', time: '11:00 AM', mode: 'PHYSICAL' }, expect: 201 });
await a.call(`/meetings/${bm.id}/items/draft`, { body: { description: 'short' }, expect: 400 });
const dr = await a.call(`/meetings/${bm.id}/items/draft`, { body: { description: 'allot 5,000 equity shares of ₹10 each at ₹100 to Anita Rao on private placement' } });
ok(dr.resolutionType === 'BOARD' && dr.filings.includes('PAS3') && dr.text.startsWith('RESOLVED THAT'), 'drafted: board resolution that creates PAS-3');
ok(dr.explanatory === '', 'no explanatory statement for a board meeting');
const item = await a.call(`/meetings/${bm.id}/items`, { body: { title: dr.title, resolutionType: dr.resolutionType, text: dr.text, filings: dr.filings }, expect: 201 });
ok(item.filings.includes('PAS3'), 'added with its filing');
await a.call(`/meetings/${bm.id}/items`, { body: { title: 'X item', filings: ['NOPE'] }, expect: 400 });
ok(true, 'unknown filings refused');

// Attendance, outcomes, held, notes → AI minutes
let d = await a.call(`/meetings/${bm.id}`);
await a.call(`/meetings/${bm.id}/attendance`, { method: 'PUT', body: d.attendance.map((x: any, i: number) => ({ personId: x.personId, status: i === 0 ? 'PRESENT' : 'VIDEO' })) });
await a.call(`/meetings/${bm.id}`, { method: 'PATCH', body: { chairpersonId: d.attendance[0].personId } });
await a.call(`/meetings/${bm.id}/minutes-ai`, { body: { notes: 'x' }, expect: 400 });
ok(true, 'minutes need the meeting held first');
for (const i of d.items) await a.call(`/meetings/items/${i.id}`, { method: 'PATCH', body: { outcome: i.resolutionType === 'NONE' ? 'NOTED' : 'PASSED', ...(i.id === item.id ? { notes: 'Anita Rao abstained being interested. Share application money received.' } : {}) } });
await a.call(`/meetings/${bm.id}/held`, { body: { on: '2026-11-20' } });
const mins = await a.call(`/meetings/${bm.id}/minutes-ai`, { body: { notes: 'Meeting ended at 12:30 PM.' } });
ok(mins.text.includes(item.text) && mins.text.includes('abstained'), 'AI minutes keep the resolution word for word and use the notes');
ok(!mins.issues.some((i: any) => i.level === 'fix'), `checked: nothing to fix (${mins.issues.length} to look at)`);
d = await a.call(`/meetings/${bm.id}`);
ok(d.meeting.notes === 'Meeting ended at 12:30 PM.' && !d.meeting.minutes, 'notes saved; minutes not saved until the CS saves them');

// EGM: explanatory statement for an existing item
const egm = await a.call('/meetings', { body: { clientId: kaveri.id, type: 'EGM', date: '2026-12-20', mode: 'PHYSICAL' }, expect: 201 });
const sp = await a.call(`/meetings/${egm.id}/items`, { body: { templateKey: 'ALTER_ARTICLES' }, expect: 201 });
const ex = await a.call(`/meetings/items/${sp.id}/explanatory-ai`, { body: {} });
ok(ex.explanatory.length > 20, 'explanatory statement drafted for a general meeting item');
await a.call(`/meetings/items/${item.id}/explanatory-ai`, { body: {}, expect: 400 });
ok(true, 'no explanatory statement for board items');
await a.call(`/meetings/items/${sp.id}`, { method: 'PATCH', body: { explanatory: ex.explanatory } });
ok((await a.call(`/meetings/${egm.id}`)).items.find((i: any) => i.id === sp.id).explanatory === ex.explanatory, 'saved on the item (printed with the notice)');
console.log('Drafting smoke passed');
