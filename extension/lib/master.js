/**
 * Reading MCA master data pages (View Company / LLP Master Data, View Director Master Data) into plain data.
 * Pure — tested in server/tests/master.test.ts. The page is given as its visible text (lines) and its tables
 * (header + rows of cell text); labels are matched after normalising, so layout changes on the portal don't matter
 * as long as the words stay. Nothing here talks to ComplyDesk or the portal.
 */
const norm = (s) => String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

/** Company fields: our key → the labels MCA uses (normalised). The first label seen on the page wins. */
const COMPANY_LABELS = {
  cin: ['cin', 'corporate identification number', 'cin fcrn'],
  name: ['company name', 'name of the company'],
  rocOffice: ['roc name', 'registrar of companies', 'roc'],
  registrationNumber: ['registration number'],
  incorporationDate: ['date of incorporation'],
  email: ['email id', 'email', 'e mail id'],
  registeredOffice: ['registered address', 'registered office address', 'address of registered office'],
  listed: ['listed in stock exchange s y n', 'listed in stock exchange s', 'whether listed or not'],
  category: ['category of company', 'company category'],
  subcategory: ['subcategory of the company', 'sub category of the company', 'company subcategory'],
  classOfCompany: ['class of company', 'company class'],
  activeCompliance: ['active compliance'],
  authorisedCapital: ['authorised capital rs', 'authorized capital rs', 'authorised capital', 'authorized capital'],
  paidUpCapital: ['paid up capital rs', 'paid up capital'],
  lastAgm: ['date of last agm', 'date of last annual general meeting'],
  balanceSheetDate: ['date of balance sheet', 'date of latest balance sheet'],
  status: ['company status for efiling', 'company status'],
};
const DIRECTOR_LABELS = {
  din: ['din', 'director identification number'],
  name: ['director name', 'name of the director', 'name'],
  dinStatus: ['din status', 'status of din'],
};

const COLS = {
  directors: { din: ['din pan', 'din', 'din dpin pan', 'din dpin'], name: ['name', 'director name', 'full name'], designation: ['designation'],
    appointedOn: ['date of appointment', 'appointment date', 'begin date'], ceasedOn: ['cessation date', 'date of cessation', 'end date'], signatory: ['signatory', 'signatory y n'] },
  charges: { chargeId: ['charge id'], holder: ['charge holder name', 'charge holder', 'name of charge holder'], createdOn: ['date of creation', 'creation date'],
    modifiedOn: ['date of modification', 'modification date'], satisfiedOn: ['date of satisfaction', 'satisfaction date'], amount: ['amount', 'amount rs', 'amount secured'], status: ['status'] },
  companies: { cin: ['cin fcrn', 'cin', 'cin fcrn llpin', 'llpin', 'cin llpin'], name: ['company name', 'company llp name', 'llp name', 'name of the company'],
    designation: ['designation'], beginOn: ['begin date', 'date of appointment', 'appointment date', 'original date of appointment'], endOn: ['end date', 'cessation date', 'date of cessation'], activeCompliance: ['active compliance'] },
};

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** dd/mm/yyyy, dd-mm-yyyy, dd Mon yyyy or yyyy-mm-dd → yyyy-mm-dd; anything else (e.g. "-") → null. */
export function isoDate(v) {
  const t = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s,-]+(\d{4})$/.exec(t);
  if (m && MON[m[2].toLowerCase()]) return `${m[3]}-${String(MON[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
/** "40,00,00,000" / "Rs. 1,00,000.00" → 4000000000 / 100000; blanks → null. */
export function rupees(v) {
  const t = String(v ?? '').replace(/rs\.?|inr|₹|,|\s/gi, '');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(Number(t));
}
const blank = (v) => { const t = String(v ?? '').replace(/\s+/g, ' ').trim(); return !t || /^[-–—]+$|^n\/?a$|^null$/i.test(t) ? null : t; };

/** Label → our key, longest label first (so "roc name" wins over "roc"). */
function labelIndex(map) {
  return Object.entries(map).flatMap(([key, labels]) => labels.map((l) => [l, key])).sort((a, b) => b[0].length - a[0].length);
}

/**
 * Label / value pairs from the page's visible text. A line is either "Label<TAB or : or spaces>Value" or a label alone,
 * with the value on the next line. Only the labels in `map` are taken; the first occurrence of each wins.
 */
export function pairsFromLines(lines, map) {
  const idx = labelIndex(map);
  const out = {};
  const L = lines.map((l) => String(l ?? '').replace(/ /g, ' ').trim()).filter(Boolean);
  for (let i = 0; i < L.length; i++) {
    const line = L[i];
    const parts = line.split(/\t|\s{2,}|:\s*/).map((p) => p.trim()).filter(Boolean);
    const head = norm(parts[0]);
    const hit = idx.find(([l]) => head === l);
    if (hit) {
      const [, key] = hit;
      if (key in out) continue;
      const value = parts.length > 1 ? parts.slice(1).join(' ') : (L[i + 1] && !idx.some(([l]) => norm(L[i + 1]) === l) ? L[i + 1] : null);
      out[key] = blank(value);
      continue;
    }
    // "CIN U68200DL2023PTC422421" (single space): label as a prefix, value the rest.
    const n = norm(line);
    const pre = idx.find(([l]) => n.startsWith(`${l} `) && l.split(' ').length >= 1);
    if (pre && !(pre[1] in out)) {
      const words = pre[0].split(' ').length;
      const raw = line.replace(/ /g, ' ').split(/\s+/);
      // Drop as many leading words as the label has (punctuation in the label, like "(Rs)", counts with its word).
      let taken = 0; let k = 0;
      while (k < raw.length && taken < words) { if (norm(raw[k])) taken += norm(raw[k]).split(' ').length; k++; }
      const value = blank(raw.slice(k).join(' ').replace(/^[:\-–]\s*/, ''));
      if (value) out[pre[1]] = value;
    }
  }
  return out;
}

/** Which of our columns each header is (or null), for one kind of table. */
function columnsOf(headers, spec) {
  const idx = labelIndex(spec);
  return headers.map((h) => { const n = norm(h); return idx.find(([l]) => n === l)?.[1] ?? null; });
}
function tableAs(table, spec, need) {
  const cols = columnsOf(table.headers ?? [], spec);
  if (!need.every((k) => cols.includes(k))) return null;
  return (table.rows ?? []).map((r) => Object.fromEntries(cols.map((k, i) => [k, blank(r[i])]).filter(([k]) => k))).filter((r) => Object.values(r).some(Boolean));
}

/** Reads a master data page. Returns { kind: 'COMPANY' | 'DIRECTOR', … } or null when the page isn't one. */
export function readMasterData({ lines = [], tables = [] }) {
  const co = pairsFromLines(lines, COMPANY_LABELS);
  const cin = co.cin ? String(co.cin).toUpperCase().replace(/\s/g, '').match(/[ULF]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}|[A-Z]{3}-\d{4}/)?.[0] ?? null : null;
  const find = (spec, need) => { for (const t of tables) { const r = tableAs(t, spec, need); if (r) return r; } return null; };

  if (cin && co.name) {
    const directors = (find(COLS.directors, ['din', 'name']) ?? []).map((d) => ({
      din: (d.din ?? '').replace(/\D/g, '').length === 8 ? d.din.replace(/\D/g, '') : null, pan: /^[A-Z]{5}\d{4}[A-Z]$/i.test(d.din ?? '') ? d.din.toUpperCase() : null,
      name: d.name, designation: d.designation ?? null, appointedOn: isoDate(d.appointedOn), ceasedOn: isoDate(d.ceasedOn),
      signatory: d.signatory ? /^y/i.test(d.signatory) : null,
    })).filter((d) => d.name);
    const charges = (find(COLS.charges, ['chargeId']) ?? find(COLS.charges, ['holder', 'amount']) ?? []).map((c) => ({
      chargeId: c.chargeId ?? null, holder: c.holder ?? null, amount: rupees(c.amount), createdOn: isoDate(c.createdOn), modifiedOn: isoDate(c.modifiedOn),
      satisfiedOn: isoDate(c.satisfiedOn), status: c.status ?? (isoDate(c.satisfiedOn) ? 'Satisfied' : null),
    }));
    return {
      kind: 'COMPANY',
      company: {
        cin, name: co.name, rocOffice: co.rocOffice ?? null, registrationNumber: co.registrationNumber ?? null, incorporationDate: isoDate(co.incorporationDate),
        email: co.email ? co.email.toLowerCase() : null, registeredOffice: co.registeredOffice ?? null, listed: co.listed ? /^y/i.test(co.listed) : null,
        category: co.category ?? null, subcategory: co.subcategory ?? null, classOfCompany: co.classOfCompany ?? null, activeCompliance: co.activeCompliance ?? null,
        authorisedCapital: rupees(co.authorisedCapital), paidUpCapital: rupees(co.paidUpCapital), lastAgm: isoDate(co.lastAgm),
        balanceSheetDate: isoDate(co.balanceSheetDate), status: co.status ?? null,
      },
      directors, charges,
    };
  }

  const dir = pairsFromLines(lines, DIRECTOR_LABELS);
  const din = String(dir.din ?? '').replace(/\D/g, '');
  const companies = find(COLS.companies, ['cin', 'name']);
  if (din.length === 8 && companies) {
    return {
      kind: 'DIRECTOR', din, name: dir.name ?? null, dinStatus: dir.dinStatus ?? null,
      companies: companies.map((c) => ({ cin: String(c.cin ?? '').toUpperCase().replace(/\s/g, ''), name: c.name, designation: c.designation ?? null, beginOn: isoDate(c.beginOn), endOn: isoDate(c.endOn), activeCompliance: c.activeCompliance ?? null })).filter((c) => c.cin),
    };
  }
  return null;
}
