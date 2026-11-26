/**
 * AOC-4 XBRL instance document end to end: statements read onto the filing, XBRL details typed on the form pack,
 * report and XML. Needs the API running (EXTRACT_DRIVER=mock) and a fresh demo seed. Run: npx tsx scripts/smoke-xbrl.ts
 * Writes the XML to XBRL_OUT (default /tmp/smoke-aoc4-xbrl.xml) for scripts/xbrl-schema-check.py.
 */
import { writeFileSync } from 'node:fs';
const BASE = process.env.BASE ?? 'http://localhost:4000/api';
let cookie = '';
async function call(path: string, opts: { method?: string; body?: any; expect?: number; raw?: boolean } = {}) {
  const isForm = opts.body instanceof FormData;
  const r = await fetch(BASE + path, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers: { 'X-Requested-With': 'fetch', ...(cookie ? { cookie } : {}), ...(opts.body && !isForm ? { 'Content-Type': 'application/json' } : {}) }, body: opts.body ? (isForm ? opts.body : JSON.stringify(opts.body)) : undefined });
  const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  if (opts.raw) return { status: r.status, text: await r.text(), type: r.headers.get('content-type'), disposition: r.headers.get('content-disposition') } as any;
  const data: any = await r.json().catch(() => ({}));
  if (opts.expect ? r.status !== opts.expect : !r.ok) throw new Error(`${opts.method ?? 'GET'} ${path} → ${r.status} ${JSON.stringify(data)}`);
  return data;
}
const ok = (c: unknown, m: string) => { if (!c) throw new Error('FAILED: ' + m); console.log('✓', m); };
await call('/auth/login', { body: { workspace: 'demo', email: 'admin@demo.in', password: 'Demo@12345' } });

const [kaveri] = await call('/clients?q=Kaveri');
const detail = await call(`/clients/${kaveri.id}`);
await call(`/clients/${kaveri.id}`, { method: 'PATCH', body: { ...detail.client, flags: { ...detail.client.flags, xbrl: true } } });
const xb = (await call(`/obligations?clientId=${kaveri.id}&bucket=all`)).find((o: any) => o.form === 'AOC-4 XBRL');
ok(xb, `AOC-4 XBRL filing (FY ${xb.fy})`);
const aoc = (await call(`/obligations?clientId=${kaveri.id}&bucket=all`)).find((o: any) => o.form === 'AOC-4');
const notXbrl = await call(`/obligations/${aoc.id}/xbrl`, { expect: 400 });
ok(notXbrl.error, 'only for AOC-4 XBRL filings');

// Statements onto the filing (the mock reader's figures), corrected and saved.
const fd = new FormData(); fd.append('docType', 'FIN_STATEMENTS'); fd.append('obligationId', xb.id);
fd.append('file', new Blob([Buffer.from('%PDF-1.4 statements')], { type: 'application/pdf' }), 'Kaveri FS.pdf');
const read = await call('/extract', { body: fd, expect: 201 });
await call(`/extract/${read.id}/apply`, { body: { obligationId: xb.id, figures: { ...read.values.figures, otherExpenses: { cy: 3600000, py: 3080000 } } } });

let r = await call(`/obligations/${xb.id}/xbrl`);
ok(r.fixes > 0 && r.issues.some((i: any) => /Split revenue/.test(i.text)) && r.issues.some((i: any) => /employees/.test(i.text)), `before the XBRL details: ${r.fixes} things to fix, e.g. revenue split, employees`);
ok(r.coverage.some((c: any) => c.status === 'todo'), 'coverage lists the notes not generated yet');

// XBRL details typed on the form pack.
const values: Record<string, string> = {
  'xbrl.employees': '42', 'xbrl.boardMeetingDate': `${xb.fy + 1}-08-20`, 'xbrl.rounding': 'Thousands',
  'xbrl.revServices.cy': '9000000', 'xbrl.revServices.py': '8000000', 'xbrl.epsBasic.cy': '4.5', 'xbrl.epsBasic.py': '4', 'xbrl.csr.cy': '0', 'xbrl.csr.py': '0',
  'xbrl.sharesPyOpening': '', 'xbrl.auditorSigner': 'Ramesh Kumar', 'xbrl.auditorMembership': '212345', 'xbrl.auditorPan': 'AAAFR1234K', 'xbrl.auditorAddress': 'Chennai 600002',
  'xbrl.auditReportDate': `${xb.fy + 1}-08-20`, 'xbrl.adt1Srn': 'AB1234567',
};
await call(`/obligations/${xb.id}/form`, { method: 'PUT', body: { values } });
r = await call(`/obligations/${xb.id}/xbrl`);
console.log('  remaining:', r.issues.map((i: any) => `${i.level}: ${i.text}`).join('\n             '));
ok(!r.issues.some((i: any) => /Split revenue|employees|earnings per share|Auditor:/.test(i.text)), 'details typed → those issues are gone');
ok(r.facts > 150, `${r.facts} facts`);

const x = await call(`/obligations/${xb.id}/xbrl.xml`, { raw: true });
ok(x.status === 200 && x.type.startsWith('application/xml') && /AOC-4_XBRL/.test(decodeURIComponent(x.disposition)), 'XML download');
ok(x.text.includes(`<xbrli:identifier scheme="http://www.mca.gov.in/CIN">${kaveri.cin}</xbrli:identifier>`) && x.text.includes('in-gaap:RevenueFromSaleOfServices'), 'the client’s CIN and figures are in it');
writeFileSync(process.env.XBRL_OUT ?? '/tmp/smoke-aoc4-xbrl.xml', x.text);
console.log('\nAOC-4 XBRL smoke passed');
