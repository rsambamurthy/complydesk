/**
 * XBRL instance documents for AOC-4 XBRL — pure. Facts are built from plain data (xbrl/aoc4.ts), checked against
 * MCA's C&I taxonomy 2016 (element names, types, period types, dimensions, axis defaults and calculation linkbases are
 * generated from the official package into ci2016.generated.ts), and written as XML. Tested in tests/xbrl.test.ts.
 *
 * Filing Manual rules followed: one CIN entity with scheme http://www.mca.gov.in/CIN, dimensions in the scenario,
 * no duplicate or unused contexts / units, no precision attribute, default members never written, V3 schemaRef.
 */
import { AXIS_DEFAULTS, CALC, CONCEPTS, TYPES } from './ci2016.generated.js';

export const SCHEMA_REF = 'https://www.mca.gov.in/V3XBRL/2016/07/26/Taxonomy/CnI/in-ci-ent-2016-03-31.xsd';
const NS: Record<string, string> = {
  'in-gaap': 'http://www.icai.org/xbrl/taxonomy/2016-03-31/in-gaap',
  'in-ca': 'http://www.icai.org/xbrl/taxonomy/2016-03-31/in-ca',
};

export type Period = 'CY' | 'PY' | 'PY0';            // PY0 = the start of the previous year (opening balances only)
export interface Dim { axis: string; member?: string; typed?: string }
export interface Fact { concept: string; period: Period; value: string | number | boolean; dims?: Dim[]; section: string }
export interface Issue { level: 'fix' | 'look'; section: string; text: string; concept?: string }

export interface Concept { name: string; prefix: string; type: string; periodType: 'i' | 'd' | ''; balance: string; abstract: boolean; dimension: boolean; typedDomain: string }
export function concept(name: string): Concept | null {
  const raw = CONCEPTS[name];
  if (!raw) return null;
  const [prefix, type, pt, balance, flags, typedDomain] = raw.split('|');
  return { name, prefix, type, periodType: pt as Concept['periodType'], balance, abstract: flags.includes('a'), dimension: flags.includes('d'), typedDomain };
}

/** Reporting periods for a financial year starting 1 April `fy`. */
export function periods(fy: number) {
  return {
    CY: { start: `${fy}-04-01`, end: `${fy + 1}-03-31` },
    PY: { start: `${fy - 1}-04-01`, end: `${fy}-03-31` },
    PY0: { start: `${fy - 1}-04-01`, end: `${fy - 1}-03-31` }, // instant only: the day before the previous year starts
  };
}

const NUMERIC = new Set(['monetary', 'shares', 'perShare', 'decimal', 'percent', 'pure', 'integer']);
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** Checks one fact against the taxonomy: the element, its type, period type and dimensions. */
export function checkFact(f: Fact): string | null {
  const c = concept(f.concept);
  if (!c) return `${f.concept} is not in the C&I 2016 taxonomy`;
  if (c.abstract) return `${f.concept} is an abstract element`;
  if (f.period === 'PY0' && c.periodType !== 'i') return `${f.concept} is a ${c.periodType === 'd' ? 'duration' : '?'} element; the opening date can only carry balances`;
  for (const d of f.dims ?? []) {
    const ax = concept(d.axis);
    if (!ax?.dimension) return `${d.axis} is not an axis`;
    if (ax.typedDomain) { if (!d.typed) return `${d.axis} needs a typed value`; continue; }
    const m = d.member ? concept(d.member) : null;
    if (!m || m.type !== 'member') return `${d.member ?? '(none)'} is not a member of ${d.axis}`;
    if (AXIS_DEFAULTS[d.axis] === d.member) return `${d.member} is the default of ${d.axis} and must not be written`;
  }
  const v = f.value;
  if (NUMERIC.has(c.type)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return `${f.concept} needs a number`;
    if (c.type === 'monetary' && Math.round(v * 100) !== v * 100) return `${f.concept}: at most 2 decimal places`;
    if ((c.type === 'shares' || c.type === 'integer') && !Number.isInteger(v)) return `${f.concept}: whole shares only`;
    return null;
  }
  if (c.type === 'boolean') return typeof v === 'boolean' ? null : `${f.concept} needs true / false`;
  if (c.type === 'date') return typeof v === 'string' && isDate(v) ? null : `${f.concept} needs a date (yyyy-mm-dd)`;
  if (typeof v !== 'string' || !v.trim()) return `${f.concept} needs text`;
  const t = TYPES[c.type];
  if (t?.enum && !t.enum.includes(v)) return `${f.concept} must be one of: ${t.enum.join(', ')}`;
  if (t?.pattern && !t.pattern.some((p) => new RegExp(`^(?:${p})$`).test(v))) return `${f.concept}: “${v}” is not in the required format`;
  return null;
}

const ctxKey = (f: Fact, pt: string) => `${pt}|${f.period}|${(f.dims ?? []).map((d) => `${d.axis}=${d.member ?? `#${d.typed}`}`).sort().join(',')}`;
const factKey = (f: Fact, pt: string) => `${f.concept}@${ctxKey(f, pt)}`;
const unitOf = (type: string) => (type === 'monetary' ? 'INR' : type === 'shares' ? 'shares' : type === 'perShare' ? 'INRPerShare' : NUMERIC.has(type) ? 'pure' : null);
const decimalsOf = (type: string, v: number) => (type === 'perShare' || type === 'percent' ? '2' : Number.isInteger(v) ? '0' : '2');

/**
 * Calculation linkbase checks for the facts given (no dimensions): every parent equals its weighted children (when any
 * child is reported), and — MCA generic business rule 1 — a non-zero parent needs at least one child and a child its parent.
 */
export function checkCalculations(facts: Fact[], roles: string[], tolerance = 1, only: Period[] = ['CY', 'PY']): Issue[] {
  const out: Issue[] = [];
  const val = new Map<string, number>();
  for (const f of facts) if (!f.dims?.length && typeof f.value === 'number') val.set(`${f.concept}|${f.period}`, f.value);
  const periodsSeen = [...new Set(facts.map((f) => f.period))].filter((p) => only.includes(p));
  for (const role of roles) {
    const arcs = CALC[role] ?? [];
    const kids = new Map<string, [string, number][]>();
    for (const [p, ch, w] of arcs) kids.set(p, [...(kids.get(p) ?? []), [ch, w]]);
    for (const [parent, children] of kids) for (const p of periodsSeen) {
      const pv = val.get(`${parent}|${p}`);
      const present = children.filter(([ch]) => val.has(`${ch}|${p}`));
      if (pv === undefined) {
        if (present.some(([ch]) => val.get(`${ch}|${p}`) !== 0)) out.push({ level: 'fix', section: role, concept: parent, text: `${parent} (${p}) is missing but its parts are reported` });
        continue;
      }
      if (!present.length) { if (pv !== 0) out.push({ level: 'fix', section: role, concept: parent, text: `${parent} (${p}) needs at least one of its parts (e.g. ${children[0][0]})` }); continue; }
      const sum = present.reduce((s, [ch, w]) => s + w * val.get(`${ch}|${p}`)!, 0);
      if (Math.abs(sum - pv) > tolerance) out.push({ level: 'fix', section: role, concept: parent, text: `${parent} (${p}) is ${pv}; its parts add up to ${Math.round(sum * 100) / 100}` });
    }
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Writes the instance document. Facts that fail `checkFact` are left out (and reported); duplicates are refused. */
export function writeInstance(cin: string, fy: number, facts: Fact[]): { xml: string; issues: Issue[]; written: number } {
  const issues: Issue[] = [];
  const P = periods(fy);
  const contexts = new Map<string, { id: string; period: Period; pt: string; dims: Dim[] }>();
  const units = new Set<string>();
  const seen = new Map<string, Fact>();
  const lines: string[] = [];
  let n = 0;
  for (const f of facts) {
    const bad = checkFact(f);
    if (bad) { issues.push({ level: 'fix', section: f.section, concept: f.concept, text: bad }); continue; }
    const c = concept(f.concept)!;
    const k = factKey(f, c.periodType);
    const dup = seen.get(k);
    if (dup) { if (dup.value !== f.value) issues.push({ level: 'fix', section: f.section, concept: f.concept, text: `${f.concept} (${f.period}) is reported twice with different values (${dup.value} / ${f.value})` }); continue; }
    seen.set(k, f);
    const ck = ctxKey(f, c.periodType);
    if (!contexts.has(ck)) {
      const dims = [...(f.dims ?? [])].sort((a, b) => a.axis.localeCompare(b.axis));
      const id = `${c.periodType === 'i' ? 'I' : 'D'}_${f.period}${dims.map((d) => `_${d.axis.replace(/Axis$/, '')}${d.member ? `_${d.member.replace(/Member$/, '')}` : `_${d.typed}`}`).join('')}`.replace(/[^A-Za-z0-9_]/g, '');
      contexts.set(ck, { id, period: f.period, pt: c.periodType, dims });
    }
    const ctx = contexts.get(ck)!;
    const unit = unitOf(c.type);
    const tag = `${c.prefix}:${f.concept}`;
    if (unit && typeof f.value === 'number') {
      units.add(unit);
      lines.push(`  <${tag} contextRef="${ctx.id}" unitRef="${unit}" decimals="${decimalsOf(c.type, f.value)}">${f.value}</${tag}>`);
    } else {
      lines.push(`  <${tag} contextRef="${ctx.id}">${esc(String(f.value))}</${tag}>`);
    }
    n++;
  }
  const ctxXml = [...contexts.values()].map((c) => {
    const p = P[c.period];
    const period = c.pt === 'i' ? `<xbrli:instant>${p.end}</xbrli:instant>` : `<xbrli:startDate>${p.start}</xbrli:startDate><xbrli:endDate>${p.end}</xbrli:endDate>`;
    const scen = c.dims.length ? `<xbrli:scenario>${c.dims.map((d) => {
      const ax = concept(d.axis)!;
      return d.member ? `<xbrldi:explicitMember dimension="${ax.prefix}:${d.axis}">${concept(d.member)!.prefix}:${d.member}</xbrldi:explicitMember>`
        : `<xbrldi:typedMember dimension="${ax.prefix}:${d.axis}"><${ax.prefix}:${ax.typedDomain}>${esc(d.typed!)}</${ax.prefix}:${ax.typedDomain}></xbrldi:typedMember>`;
    }).join('')}</xbrli:scenario>` : '';
    return `  <xbrli:context id="${c.id}"><xbrli:entity><xbrli:identifier scheme="http://www.mca.gov.in/CIN">${esc(cin)}</xbrli:identifier></xbrli:entity><xbrli:period>${period}</xbrli:period>${scen}</xbrli:context>`;
  });
  const UNIT_XML: Record<string, string> = {
    INR: '<xbrli:unit id="INR"><xbrli:measure>iso4217:INR</xbrli:measure></xbrli:unit>',
    shares: '<xbrli:unit id="shares"><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unit>',
    pure: '<xbrli:unit id="pure"><xbrli:measure>xbrli:pure</xbrli:measure></xbrli:unit>',
    INRPerShare: '<xbrli:unit id="INRPerShare"><xbrli:divide><xbrli:unitNumerator><xbrli:measure>iso4217:INR</xbrli:measure></xbrli:unitNumerator><xbrli:unitDenominator><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unitDenominator></xbrli:divide></xbrli:unit>',
  };
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<!-- AOC-4 XBRL instance document prepared with ComplyDesk. C&I taxonomy 2016. Validate with MCA's XBRL validation tool before filing. -->`,
    `<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xbrldi="http://xbrl.org/2006/xbrldi" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:in-gaap="${NS['in-gaap']}" xmlns:in-ca="${NS['in-ca']}">`,
    `  <link:schemaRef xlink:type="simple" xlink:href="${SCHEMA_REF}"/>`,
    ...ctxXml,
    ...[...units].map((u) => `  ${UNIT_XML[u]}`),
    ...lines,
    '</xbrli:xbrl>',
    '',
  ].join('\n');
  return { xml, issues, written: n };
}
