/**
 * MCA master data read by the extension → reviewed and saved in ComplyDesk. Needs the API running and a fresh demo seed.
 * Run: npx tsx scripts/smoke-master.ts
 */
const BASE = process.env.BASE ?? 'http://localhost:4000/api';
class Agent {
  cookie = ''; bearer = '';
  async call(path: string, opts: { method?: string; body?: any; expect?: number } = {}) {
    const r = await fetch(BASE + path, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers: { 'X-Requested-With': 'fetch', ...(this.cookie ? { cookie: this.cookie } : {}), ...(this.bearer ? { Authorization: `Bearer ${this.bearer}` } : {}), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) this.cookie = set.split(';')[0];
    const data: any = await r.json().catch(() => ({}));
    if (opts.expect ? r.status !== opts.expect : !r.ok) throw new Error(`${opts.method ?? 'GET'} ${path} → ${r.status} ${JSON.stringify(data)}`);
    return data;
  }
}
const ok = (c: unknown, m: string) => { if (!c) throw new Error('FAILED: ' + m); console.log('✓', m); };
const web = new Agent(); await web.call('/auth/login', { body: { workspace: 'demo', email: 'admin@demo.in', password: 'Demo@12345' } });
const ext = new Agent(); ext.bearer = (await web.call('/auth/extension-tokens', { body: { name: 'Master data test' } })).token;

const [kaveri] = await web.call('/clients?q=Kaveri');
const detail = await web.call(`/clients/${kaveri.id}`);
const inOffice = detail.people.filter((p: any) => !p.ceasedOn && p.din);
ok(inOffice.length >= 2, `${kaveri.name}: ${inOffice.length} directors on file`);
const keep = inOffice[0]; const dropped = inOffice[1];

// Company page: one director as on file, one new one, one left off (not on MCA), a charge not in the register.
const page = {
  kind: 'COMPANY',
  company: { cin: kaveri.cin, name: kaveri.name, rocOffice: 'ROC Chennai', incorporationDate: detail.client.incorporationDate, email: 'board@kaveri.example', registeredOffice: 'New address, Chennai 600002',
    authorisedCapital: 9900000, paidUpCapital: Number(detail.client.paidUpCapital), lastAgm: '2025-09-30', balanceSheetDate: '2025-03-31', status: 'Active', activeCompliance: null },
  directors: [
    { din: keep.din, name: keep.name, designation: 'Director', appointedOn: keep.appointedOn, ceasedOn: null, signatory: true },
    { din: '09876543', name: 'NEW PERSON', designation: 'Additional Director', appointedOn: '2025-04-01', ceasedOn: null, signatory: true },
  ],
  charges: [{ chargeId: '100567890', holder: 'HDFC BANK LIMITED', amount: 2500000, createdOn: '2022-02-15', modifiedOn: null, satisfiedOn: null, status: null }],
};
const r = await ext.call('/ext/mca-master', { body: page, expect: 201 });
ok(r.clientId === kaveri.id && r.directors === 2, 'matched to the client by CIN');
ok(r.notes.some((n: string) => n.includes(dropped.name) && n.includes('not on MCA')), 'flags a director in office here but not on MCA');
ok(r.notes.some((n: string) => n.includes('100567890')), 'flags an open charge missing from the register of charges');
const read = await web.call(`/extract/${r.id}`);
ok(read.docType === 'MCA_MASTER' && read.values.client.authorisedCapital === '9900000' && read.values.portal.lastAgm === '2025-09-30', 'review screen gets the read, with MCA’s AGM / status');
const out = await web.call(`/extract/${r.id}/apply`, { body: { clientId: kaveri.id, client: { authorisedCapital: '9900000' }, directors: [read.values.directors[1]] } });
ok(out.added === 1, 'saved: authorised capital and the new director');
const after = await web.call(`/clients/${kaveri.id}`);
ok(String(after.client.authorisedCapital).startsWith('9900000') && after.people.some((p: any) => p.din === '09876543'), 'client master updated');
await web.call(`/extract/${r.id}/apply`, { body: { clientId: kaveri.id }, expect: 409 });
ok(true, 'a read is used once');

// A company that isn't a client yet → added from the portal read.
const fresh = { ...page, company: { ...page.company, cin: 'U72900TN2020PTC199999', name: 'PORTAL NEW PRIVATE LIMITED', incorporationDate: '2020-01-15' }, directors: [{ din: '09111111', name: 'ASHA VARMA', designation: 'Director', appointedOn: '2020-01-15', ceasedOn: null, signatory: true }, { din: '09222222', name: 'RAVI VARMA', designation: 'Director', appointedOn: '2020-01-15', ceasedOn: null, signatory: true }], charges: [] };
const r2 = await ext.call('/ext/mca-master', { body: fresh, expect: 201 });
ok(r2.clientId === null, 'not a client yet');
const read2 = await web.call(`/extract/${r2.id}`);
const made = await web.call(`/extract/${r2.id}/apply`, { body: { client: { ...read2.values.client, ownerId: null }, directors: read2.values.directors } });
ok(made.created && made.added === 2, 'new client added with its two directors');

// Director page: DIN on two companies, one ended per MCA while in office here.
const dirPage = { kind: 'DIRECTOR', din: keep.din, name: keep.name, dinStatus: 'Approved', companies: [
  { cin: kaveri.cin, name: kaveri.name, beginOn: keep.appointedOn, endOn: '2026-10-31' },
  { cin: 'U74999MH2019PTC654321', name: 'OTHER CO PRIVATE LIMITED', beginOn: '2020-01-02', endOn: null },
] };
const d = await ext.call('/ext/mca-master', { body: dirPage });
ok(d.rows[0].clientId === kaveri.id && d.rows[0].issues.some((i: string) => i.includes('Ceased 2026-10-31')), 'director page: cessation on MCA not recorded here');
ok(d.rows[1].clientId === null, 'director page: other company is not a client');
await ext.call('/ext/mca-master', { body: { kind: 'OTHER' }, expect: 400 });
ok(true, 'other pages refused');
console.log('\nMCA master data smoke passed');
