/**
 * Matching ComplyDesk's form fields to the fields on the MCA page, by their labels. Pure — tested in
 * server/tests/extension.test.ts. MCA V3 field ids are not published, so labels (and aliases) are the contract.
 */
const STOP = new Set(['the', 'of', 'a', 'an', 'and', 'or', 'in', 'on', 'for', 'to', 'with', 'by', 'whether', 'if', 'any', 'as', 'is', 'please', 'enter', 'select']);

/** Lower-case words, without numbering like "(i)", "a)", "1.", stars and punctuation. */
export function norm(s) {
  return String(s ?? '').toLowerCase()
    .replace(/\*/g, ' ')
    .replace(/\(\s*(?:[ivx]+|[a-z]|\d+)\s*\)/g, ' ')
    .replace(/(^|\s)(?:[ivx]+|[a-z]|\d+)[.)](?=\s)/g, ' ')
    .replace(/e-?mail/g, 'email')
    .replace(/[^a-z0-9%₹ ]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
const words = (s) => new Set(norm(s).split(' ').filter((w) => w && !STOP.has(w)));

/** 0–1: how well a page label fits one of our labels. */
export function score(ours, theirs) {
  const A = words(ours); const B = words(theirs);
  if (!A.size || !B.size) return 0;
  let both = 0; for (const w of A) if (B.has(w)) both++;
  const s = both / Math.max(A.size, B.size);
  const na = norm(ours); const nb = norm(theirs);
  return na === nb ? 1 : (nb.includes(na) || na.includes(nb)) && Math.min(na.length, nb.length) >= 3 ? Math.max(s, 0.85) : s;
}

/**
 * pack: [{ key, label, aliases?, value }]; page: [{ ref, label }].
 * Returns [{ key, ref, score }] — each page field used once, best matches first, only above `min`.
 */
export function matchFields(pack, page, min = 0.6) {
  const pairs = [];
  for (const f of pack) {
    if (f.value === null || f.value === undefined || f.value === '') continue;
    for (const p of page) {
      const s = Math.max(...[f.label, ...(f.aliases ?? [])].map((l) => score(l, p.label)));
      if (s >= min) pairs.push({ key: f.key, ref: p.ref, score: Math.round(s * 100) / 100 });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const usedK = new Set(); const usedR = new Set(); const out = [];
  for (const x of pairs) { if (usedK.has(x.key) || usedR.has(x.ref)) continue; usedK.add(x.key); usedR.add(x.ref); out.push(x); }
  return out;
}

/** dd/mm/yyyy → yyyy-mm-dd for <input type=date>; other values unchanged. */
export const toIsoDate = (v) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v)); return m ? `${m[3]}-${m[2]}-${m[1]}` : String(v); };
/** Value as the portal wants it: numbers without Indian grouping commas. */
export const plain = (v, kind) => (kind === 'number' ? String(v).replace(/,/g, '') : String(v));
