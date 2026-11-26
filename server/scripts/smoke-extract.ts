/**
 * Reading documents end to end (mock reader: EXTRACT_DRIVER=mock on the API). Needs the API running and a fresh demo seed.
 * Run: npx tsx scripts/smoke-extract.ts
 */
import { readFileSync } from 'node:fs';
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
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const form = (fields: Record<string, string>, file = pdf, name = 'doc.pdf', type = 'application/pdf') => {
  const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append('file', new Blob([file], { type }), name); return fd;
};
const admin = await login('admin@demo.in');
const exec = await login('karthik@demo.in');

const types = await admin.call('/extract/types');
ok(types.enabled && types.types.length === 8, 'eight document kinds, reading switched on');

// 1. New client from MCA master data
await admin.call('/extract', { body: form({ docType: 'MCA_MASTER' }, Buffer.from('hello'), 'x.txt', 'text/plain'), expect: 400 });
ok(true, 'only PDFs and images are read');
const r1 = await admin.call('/extract', { body: form({ docType: 'MCA_MASTER' }, pdf, 'Aranya master data.pdf') });
ok(r1.values.client.cin === 'U01100TN2021PTC145678' && r1.values.directors.length === 3, 'master data read: company + 3 people');
ok(r1.check['directors.1.appointedOn'], 'unclear value flagged for checking');
const before = (await admin.call('/clients')).length;
const bad = { ...r1.values, directors: r1.values.directors.map((d: any, i: number) => (i === 0 ? { ...d, din: '123' } : d)) };
const e = await admin.call(`/extract/${r1.id}/apply`, { body: bad, expect: 400 });
ok(e.details['directors.0.din'] && (await admin.call('/clients')).length === before, 'a bad DIN stops the save — nothing half-saved');
const a1 = await admin.call(`/extract/${r1.id}/apply`, { body: r1.values });
ok(a1.created && a1.added === 3, 'client created with 3 directors / KMP');
const c1 = await admin.call(`/clients/${a1.clientId}`);
ok(c1.people.length === 3 && c1.client.incorporationDate === '2021-07-14', 'client master filled in');
ok((await admin.call(`/obligations?clientId=${a1.clientId}&bucket=open`)).length > 0, 'compliance calendar built for the new client');
const files = await admin.call(`/files?entity=client&entityId=${a1.clientId}`);
ok(files.length === 1 && files[0].fileName === 'Aranya master data.pdf', 'the master data PDF is kept on the client');
await admin.call(`/extract/${r1.id}/apply`, { body: r1.values, expect: 409 });
ok(true, 'a document is used once');
const r1b = await admin.call('/extract', { body: form({ docType: 'MCA_MASTER' }) });
await admin.call(`/extract/${r1b.id}/apply`, { body: r1b.values, expect: 409 });
ok(true, 'same CIN twice is refused');

// 2. Existing client: MGT-7 adds what's missing
const kaveri = (await admin.call('/clients?q=Kaveri'))[0];
const r2 = await admin.call('/extract', { body: form({ docType: 'MGT7', clientId: kaveri.id }) });
ok(r2.warnings.length === 0 && r2.values.fy === 2024, 'MGT-7 read for the right company');
const a2 = await admin.call(`/extract/${r2.id}/apply`, { body: { ...r2.values, clientId: kaveri.id, replaceShareholders: true } });
const k = await admin.call(`/clients/${kaveri.id}`);
ok(a2.added === 1 && k.people.some((p: any) => p.din === '08123456'), 'only the new director added (existing DINs skipped)');
ok(k.shareholders.length === 3 && k.shareholders.reduce((s: number, x: any) => s + x.shares, 0) === 50000, 'register of members replaced');
ok(k.auditors.length === 1, 'same auditor not added twice');
ok(k.years.find((y: any) => y.fy === 2024)?.agmDate === '2025-09-26', 'AGM date recorded for FY 2024-25');

// 3. Wrong company is called out
const marina = (await admin.call('/clients?q=Marina'))[0];
const r3 = await admin.call('/extract', { body: form({ docType: 'FINANCIALS', clientId: marina.id }) });
ok(r3.warnings[0]?.includes('not this client'), 'financials of another company: warned');
// Financials on the right client
const r4 = await admin.call('/extract', { body: form({ docType: 'FINANCIALS', clientId: kaveri.id }) });
ok(r4.values.smallCompany === true, 'small company worked out (₹10 cr / ₹100 cr limits)');
await admin.call(`/extract/${r4.id}/apply`, { body: { clientId: kaveri.id, paidUpCapital: r4.values.paidUpCapital, smallCompany: true, flags: r4.values.flags } });
ok((await admin.call(`/clients/${kaveri.id}`)).client.smallCompany === true, 'client marked small company → calendar re-synced');

// 4. Auditor appointment
const r5 = await admin.call('/extract', { body: form({ docType: 'AUDITOR', clientId: marina.id }) });
await admin.call(`/extract/${r5.id}/apply`, { body: { clientId: marina.id, auditor: r5.values.auditor } });
const m = await admin.call(`/clients/${marina.id}`);
ok(m.auditors.filter((a: any) => a.current).length === 1 && m.auditors.find((a: any) => a.current).termToFy === 2029, 'new auditor is the current one; old one kept as former');

// 5. Challan on a filing (executive)
const dpt = (await exec.call(`/obligations?clientId=${kaveri.id}&bucket=all`)).find((o: any) => o.form === 'DPT-3');
const r6 = await exec.call('/extract', { body: form({ docType: 'SRN_CHALLAN', obligationId: dpt.id }, pdf, 'DPT-3 challan.pdf') });
ok(r6.values.srn === 'AB1234567' && r6.warnings.length === 0, 'challan read: SRN, date, matches DPT-3');
await exec.call(`/extract/${r6.id}/attach`, { body: { obligationId: dpt.id } });
ok((await exec.call(`/files?entity=obligation&entityId=${dpt.id}`)).some((f: any) => f.fileName === 'DPT-3 challan.pdf'), 'challan kept on the filing');
await exec.call('/extract', { body: form({ docType: 'PASSPORT' }), expect: 400 });
ok(true, 'only the listed document kinds are read');

// 6. DSC files (no AI)
const anita = k.people.find((p: any) => p.name === 'Anita Rao');
const fd = new FormData(); fd.append('clientId', kaveri.id);
fd.append('files', new Blob([readFileSync(new URL('../tests/files/dsc_anita.pem', import.meta.url))]), 'anita.cer');
fd.append('files', new Blob([Buffer.from('nope')]), 'notes.txt');
const dsc = await admin.call('/extract/dsc', { body: fd });
ok(dsc[0].personId === anita.id && dsc[0].validTo === '2028-11-24' && dsc[1].error, 'DSC matched to Anita Rao, expiry read; a non-certificate is reported');
await admin.call('/extract/dsc/apply', { body: { clientId: kaveri.id, updates: [{ personId: anita.id, dscExpiry: dsc[0].validTo }] } });
ok((await admin.call(`/clients/${kaveri.id}`)).people.find((p: any) => p.id === anita.id).dscExpiry === '2028-11-24', 'DSC expiry updated');
await admin.call('/extract/dsc/apply', { body: { clientId: marina.id, updates: [{ personId: anita.id, dscExpiry: '2028-01-01' }] }, expect: 400 });
ok(true, 'can’t update another client’s director');

// 7. Board papers → filings (Marina: no Karan Mehta / Suresh Iyer — use a fresh client view of Kaveri before MGT-7? Kaveri now has Karan Mehta)
await admin.call('/extract', { body: form({ docType: 'BOARD_PAPERS' }), expect: 400 });
ok(true, 'board papers need a client');
const before7 = await admin.call(`/clients/${kaveri.id}`);
const bp = await exec.call('/extract', { body: form({ docType: 'BOARD_PAPERS', clientId: kaveri.id }, pdf, 'Board minutes 18 Nov 2026.pdf') });
const ev = bp.values.events;
ok(ev.length === 5 && bp.values.notFiled.length === 2, 'five filings found, two decisions needing none');
ok(ev[0].personAction === null && ev[0].personId, 'Karan Mehta already on file (added from MGT-7) — no duplicate person');
ok(ev[1].personAction === 'CEASE', 'Suresh Iyer’s resignation will mark him ceased');
const tick = ev.filter((e: any) => !e.onCalendar);
const bad7 = await exec.call(`/extract/${bp.id}/apply`, { body: { clientId: kaveri.id, events: tick.map((e: any, i: number) => (i === 2 ? { ...e, eventDate: '' } : e)) }, expect: 400 });
ok(bad7.details['events.2.eventDate'] && (await admin.call(`/clients/${kaveri.id}`)).people.length === before7.people.length, 'a missing date stops the save — nothing half-saved');
const a7 = await exec.call(`/extract/${bp.id}/apply`, { body: { clientId: kaveri.id, events: tick } });
ok(a7.added === 5 && a7.peopleCeased === 1, 'five event filings on the calendar; one director marked ceased');
const cal = await admin.call(`/obligations?clientId=${kaveri.id}&bucket=all`);
const pas3 = cal.find((o: any) => o.form === 'PAS-3' && o.eventDate === '2026-11-18');
ok(pas3 && pas3.dueDate === '2026-12-18', 'PAS-3 due 30 days after the allotment');
ok(cal.some((o: any) => o.form === 'DIR-12' && o.personName === 'Suresh Iyer'), 'DIR-12 linked to Suresh Iyer');
ok((await admin.call(`/clients/${kaveri.id}`)).people.find((p: any) => p.name === 'Suresh Iyer').ceasedOn === '2026-11-15', 'Suresh Iyer ceased 15 Nov 2026');
const again = await exec.call('/extract', { body: form({ docType: 'BOARD_PAPERS', clientId: kaveri.id }) });
ok(again.values.events.every((e: any) => e.onCalendar), 'reading the same minutes again: everything already on the calendar');
ok((await admin.call(`/files?entity=client&entityId=${kaveri.id}`)).some((f: any) => f.fileName === 'Board minutes 18 Nov 2026.pdf'), 'minutes kept in the client’s documents');

// New person from board papers (Nimbus: Karan Mehta not a director there)
const nimbus = (await admin.call('/clients?q=Nimbus'))[0];
const bp2 = await exec.call('/extract', { body: form({ docType: 'BOARD_PAPERS', clientId: nimbus.id }) });
ok(bp2.warnings.some((w: string) => w.includes('not this client')), 'minutes of another company: warned');
const add = bp2.values.events[0];
ok(add.personAction === 'ADD', 'appointment of someone new: offered to add them');
const a8 = await exec.call(`/extract/${bp2.id}/apply`, { body: { clientId: nimbus.id, events: [add] } });
const n = await admin.call(`/clients/${nimbus.id}`);
ok(a8.peopleAdded === 1 && n.people.some((p: any) => p.din === '08123456' && p.appointedOn === '2026-11-18'), 'new director added with appointment date');
ok((await admin.call(`/obligations?clientId=${nimbus.id}&bucket=all`)).some((o: any) => o.form === 'DIR-12' && o.personName === 'Karan Mehta'), 'DIR-12 linked to the new director');
console.log('\nAll document-reading checks passed.');
