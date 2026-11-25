/**
 * Fees and billing end to end. Needs the API running and a fresh demo seed.
 * Run: npx tsx scripts/smoke-billing.ts
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
const kaveri = (await admin.call('/clients?q=Kaveri'))[0];

await exec.call('/billing/summary', { expect: 403 });
ok(true, 'CS Executive can\'t see billing');
// Firm details and fees
const bad = await admin.call('/billing/profile', { method: 'PUT', body: { gstin: '33ABCDE1234F1Z5', stateCode: '29' }, expect: 400 });
ok(bad.details?.stateCode, 'GSTIN state must match the firm state');
const prof = await admin.call('/billing/profile', { method: 'PUT', body: { legalName: 'Rao & Associates', gstin: '33ABCDE1234F1Z5', address: 'Chennai', invoicePrefix: 'RAO', sac: '998399', billFrom: '2026-04-01' } });
ok(prof.stateCode === '33' && prof.gstRate === 18, 'state taken from the GSTIN; GST 18%');
await admin.call('/billing/fees', { method: 'PUT', body: { fees: [{ ruleCode: 'AOC4', amount: '5,000' }, { ruleCode: 'MGT7', amount: 6000 }, { ruleCode: 'DIR3KYC', amount: 750 }] } });
let work = await admin.call(`/billing/unbilled?clientId=${kaveri.id}`);
const pick = work[0];
await admin.call(`/billing/fees?clientId=${kaveri.id}`, { method: 'PUT', body: { fees: [{ ruleCode: pick.ruleCode, amount: 8000 }] } });
const fl = await admin.call(`/billing/fees?clientId=${kaveri.id}`);
ok(fl.find((f: any) => f.ruleCode === pick.ruleCode).clientFee === 8000 && fl.find((f: any) => f.ruleCode === 'MGT7').firmFee === 6000, 'firm fees and a client\'s own fee');

// Work to bill
work = await admin.call(`/billing/unbilled?clientId=${kaveri.id}`);
const aoc = work.find((w: any) => w.id === pick.id);
ok(aoc && aoc.fee === 8000, `${aoc.form} filed this year is to be billed at the client's fee (${work.length} items)`);
const before = await admin.call('/billing/summary');
const lastSeq = Math.max(0, ...(await admin.call('/billing/invoices')).filter((i: any) => i.number).map((i: any) => Number(i.number.split('/')[2])));
const cb = await admin.call(`/billing/clients/${kaveri.id}`);
ok(cb.placeOfSupply === '33' && cb.stateFromCin, 'place of supply from the CIN (Tamil Nadu)');

// Draft → issue
let inv = await admin.call('/billing/invoices', { body: { clientId: kaveri.id, obligationIds: [aoc.id], lines: [{ description: 'MCA filing fee paid on your behalf', amount: 600, taxable: false }] }, expect: 201 });
ok(inv.status === 'DRAFT' && !inv.number && Number(inv.total) === 8000 * 1.18 + 600, `draft: ₹${inv.total} = 8,000 + CGST/SGST + 600 government fee`);
ok(Number(inv.cgst) === 720 && Number(inv.igst) === 0, 'same state: CGST + SGST');
await admin.call('/billing/invoices', { body: { clientId: kaveri.id, obligationIds: [aoc.id] }, expect: 400 });
ok(true, 'a filing can\'t go on two invoices');
work = await admin.call(`/billing/unbilled?clientId=${kaveri.id}`);
ok(!work.some((w: any) => w.id === aoc.id), 'billed filing drops off the to-be-billed list');
inv = await admin.call(`/billing/invoices/${inv.id}`, { method: 'PUT', body: { date: inv.date, dueDate: inv.date, notes: 'Thank you', lines: [...inv.lines.map((l: any) => ({ description: l.description, amount: l.amount, taxable: l.taxable, obligationId: l.obligationId })), { description: 'Drafting board resolutions', amount: 1500, taxable: true }] } });
ok(Number(inv.taxable) === 9500, 'draft edited: item added');
inv = await admin.call(`/billing/invoices/${inv.id}/issue`, { body: {} });
ok(Number(inv.number.split('/')[2]) === lastSeq + 1 && /^RAO\/\d\d-\d\d\/\d{3}$/.test(inv.number) && inv.words.startsWith('Rupees'), `issued as ${inv.number}, next in the series`);
await admin.call(`/billing/invoices/${inv.id}`, { method: 'PUT', body: { date: inv.date, dueDate: inv.dueDate, lines: [{ description: 'x', amount: 1 }] }, expect: 400 });
ok(true, 'issued invoice can\'t be edited');

// Payments with TDS
const total = Number(inv.total);
await admin.call(`/billing/invoices/${inv.id}/payments`, { body: { date: inv.date, amount: total + 1 }, expect: 400 });
inv = await admin.call(`/billing/invoices/${inv.id}/payments`, { body: { date: inv.date, amount: 5000, tds: 950, mode: 'UPI', reference: 'UTR123' }, expect: 201 });
ok(inv.state === 'PART_PAID' && inv.balance === Math.round((total - 5950) * 100) / 100, 'part payment with TDS');
let sum = await admin.call('/billing/summary');
ok(Math.abs(sum.outstanding - before.outstanding - inv.balance) < 0.01 && Math.abs(sum.collectedThisFy - before.collectedThisFy - 5950) < 0.01, 'summary: outstanding and collected');
inv = await admin.call(`/billing/invoices/${inv.id}/payments`, { body: { date: inv.date, amount: inv.balance }, expect: 201 });
ok(inv.state === 'PAID', 'paid in full');
await admin.call(`/billing/invoices/${inv.id}/cancel`, { body: { reason: 'x' }, expect: 400 });
ok(true, 'paid invoice can\'t be cancelled until payments are removed');

// Another state, IGST; numbering continues
const nimbus = (await admin.call('/clients?q=Nimbus'))[0];
let i2 = await admin.call('/billing/invoices', { body: { clientId: nimbus.id, lines: [{ description: 'Incorporation follow-up', amount: 10000 }] }, expect: 201 });
ok(Number(i2.igst) === 1800 && i2.placeOfSupply === '29', 'Karnataka client: IGST');
i2 = await admin.call(`/billing/invoices/${i2.id}/issue`, { body: {} });
ok(Number(i2.number.split('/')[2]) === lastSeq + 2, 'numbers run on');
i2 = await admin.call(`/billing/invoices/${i2.id}/cancel`, { body: { reason: 'Raised on the wrong company' } });
ok(i2.status === 'CANCELLED', 'cancelled with a reason');
const d3 = await admin.call('/billing/invoices', { body: { clientId: nimbus.id, lines: [{ description: 'Advisory', amount: 2000 }] }, expect: 201 });
await admin.call(`/billing/invoices/${d3.id}`, { method: 'DELETE' });
ok(!(await admin.call('/billing/invoices')).some((i: any) => i.id === d3.id) && (await admin.call('/billing/invoices?status=CANCELLED')).length === 1, 'draft deleted; cancelled invoice kept');
ok((await admin.call('/billing/unbilled')).length > 0, 'invoices with only typed-in items don\'t hide work to be billed');
console.log('Billing smoke passed');
