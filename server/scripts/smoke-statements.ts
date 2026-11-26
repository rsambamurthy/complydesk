/**
 * Financial statements → AOC-4 (AI reads, code checks, a person saves) and AOC-4 XBRL on the calendar.
 * Needs the API running (EXTRACT_DRIVER=mock) and a fresh demo seed. Run: npx tsx scripts/smoke-statements.ts
 */
const BASE = process.env.BASE ?? 'http://localhost:4000/api';
let cookie = '';
async function call(path: string, opts: { method?: string; body?: any; expect?: number } = {}) {
  const isForm = opts.body instanceof FormData;
  const r = await fetch(BASE + path, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers: { 'X-Requested-With': 'fetch', ...(cookie ? { cookie } : {}), ...(opts.body && !isForm ? { 'Content-Type': 'application/json' } : {}) }, body: opts.body ? (isForm ? opts.body : JSON.stringify(opts.body)) : undefined });
  const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  const data: any = await r.json().catch(() => ({}));
  if (opts.expect ? r.status !== opts.expect : !r.ok) throw new Error(`${opts.method ?? 'GET'} ${path} → ${r.status} ${JSON.stringify(data)}`);
  return data;
}
const ok = (c: unknown, m: string) => { if (!c) throw new Error('FAILED: ' + m); console.log('✓', m); };
await call('/auth/login', { body: { workspace: 'demo', email: 'admin@demo.in', password: 'Demo@12345' } });

const [kaveri] = await call('/clients?q=Kaveri');
const all = await call(`/obligations?clientId=${kaveri.id}&bucket=all`);
const aoc4 = all.find((o: any) => o.form === 'AOC-4' && o.fy === 2025);
ok(aoc4, 'Kaveri has AOC-4 for FY 2025-26');

const fd = new FormData(); fd.append('docType', 'FIN_STATEMENTS'); fd.append('obligationId', aoc4.id);
fd.append('file', new Blob([Buffer.from('%PDF-1.4 statements')], { type: 'application/pdf' }), 'Kaveri FS 2025-26.pdf');
const read = await call('/extract', { body: fd, expect: 201 });
ok(read.values.figures.totalAssets.cy === 3000000 && read.values.roundedTo === 1000, 'figures read in rupees, rounding noted');
ok(read.values.issues.some((i: any) => i.level === 'fix' && i.keys[0] === 'totalExpenses' && i.text.includes('previous year')), 'checks: previous-year expenses don’t add up');
const paidUp = Number((await call(`/clients/${kaveri.id}`)).client.paidUpCapital);
ok(read.values.issues.some((i: any) => i.keys[0] === 'shareCapital') === (paidUp !== 500000), `checks: share capital vs paid-up capital on file (₹${paidUp})`);
ok(read.check['fs.otherExpenses'], 'the hard-to-read line is highlighted');
ok(read.values.xbrl.required === false, 'XBRL not required at these figures');

const lines = await call('/extract/statement-lines');
ok(lines.groups.length === 3 && lines.groups[0].lines[0].key === 'shareCapital', 'line layout for the review screen');
const fixed = { ...read.values.figures, otherExpenses: { cy: 3600000, py: 3080000 } };
const re = await call('/extract/statement-check', { body: { obligationId: aoc4.id, roundedTo: 1000, figures: fixed } });
ok(!re.issues.some((i: any) => i.level === 'fix'), 'after correcting other expenses the statements add up');

await call(`/extract/${read.id}/apply`, { body: { obligationId: aoc4.id, figures: fixed, filesXbrl: false } });
const pack = await call(`/obligations/${aoc4.id}/form`);
const field = (k: string) => pack.parts.flatMap((p: any) => p.fields).find((f: any) => f.key === k);
ok(field('fs.totalAssets.cy').value === '3000000' && field('fs.otherExpenses.py').value === '3080000' && field('fs.inventories.cy').value === null, 'saved into the AOC-4 form data (both years)');
const files = await call(`/files?entity=obligation&entityId=${aoc4.id}`).catch(() => null);
if (files) ok(files.some((f: any) => f.fileName.includes('Kaveri FS')), 'the statements are kept on the filing');

// XBRL: mark the client → AOC-4 XBRL replaces AOC-4 on the calendar.
const detail = await call(`/clients/${kaveri.id}`);
await call(`/clients/${kaveri.id}`, { method: 'PATCH', body: { ...detail.client, flags: { ...detail.client.flags, xbrl: true } } });
const after = await call(`/obligations?clientId=${kaveri.id}&bucket=all`);
const xb = after.find((o: any) => o.form === 'AOC-4 XBRL' && o.fy === 2026);
ok(xb && !after.some((o: any) => o.form === 'AOC-4' && o.fy === 2026 && !o.stale), 'AOC-4 XBRL on the calendar instead of AOC-4');
const xpack = await call(`/obligations/${xb.id}/form`);
const working = xpack.parts.flatMap((p: any) => p.tables).find((t: any) => t.key === 'xbrlWorking');
ok(working && working.rows.length > 40 && xpack.attachments[0].name.startsWith('XBRL instance document'), 'AOC-4 XBRL pack: XBRL working paper and instance document attachment');
console.log('\nFinancial statements smoke passed');
