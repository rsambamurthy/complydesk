/**
 * The user manual as help content (help/manual.md — one source for the Help page and the assistant).
 * Pure functions: split into sections, keyword search, which section belongs to which page.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface HelpSection { id: string; title: string; level: 2 | 3; parent: string | null; body: string }
export interface HelpManual { title: string; sections: HelpSection[]; text: string }

export const slug = (s: string) => s.toLowerCase().replace(/^\d+\.\s*/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Splits the manual at ## and ### headings. Section ids are slugs of the titles, without the numbers. */
export function parseManual(md: string): HelpManual {
  const lines = md.replace(/\r/g, '').split('\n');
  const title = (lines.find((l) => l.startsWith('# ')) ?? '# Help').slice(2).trim();
  const sections: HelpSection[] = [];
  let cur: HelpSection | null = null;
  let parent: string | null = null;
  const seen = new Set<string>();
  for (const line of lines) {
    const h = /^(#{2,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length as 2 | 3;
      const t = h[2].trim();
      let id = slug(t);
      if (seen.has(id)) id = `${parent ?? 'x'}-${id}`;
      seen.add(id);
      cur = { id, title: t, level, parent: level === 3 ? parent : null, body: '' };
      if (level === 2) parent = id;
      sections.push(cur);
    } else if (cur) cur.body += `${line}\n`;
  }
  for (const s of sections) s.body = s.body.trim();
  return { title, sections, text: md };
}

const STOP = new Set('a an and are be can do does for from how i in is it my of on or the to what when where which who why with you your this that me we'.split(' '));
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\-]+/g, ' ').split(' ').filter((w) => w.length > 1 && !STOP.has(w));

export interface SearchHit { id: string; title: string; score: number; snippet: string }

/** Keyword search: title words count more than body words. */
export function searchManual(m: HelpManual, query: string, limit = 5): SearchHit[] {
  const q = [...new Set(words(query))];
  if (!q.length) return [];
  const hits: SearchHit[] = [];
  for (const s of m.sections) {
    const tw = words(s.title);
    const bw = words(s.body);
    let score = 0;
    for (const w of q) {
      const stem = w.replace(/(ing|es|s)$/, '');
      const has = (arr: string[]) => arr.filter((x) => x === w || (stem.length > 2 && x.startsWith(stem))).length;
      score += has(tw) * 5 + Math.min(has(bw), 4);
    }
    if (score > 0) hits.push({ id: s.id, title: s.title, score, snippet: snippetOf(s.body, q) });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** The FAQ table as question/answer pairs — the best no-AI answers. */
export function faqRows(m: HelpManual) {
  const faq = m.sections.find((s) => /faq/.test(s.id));
  if (!faq) return [];
  return faq.body.split('\n').filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l)).slice(1)
    .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
    .filter((c) => c.length >= 2).map(([q, a]) => ({ q, a, section: faq.id }));
}

/** Best FAQ row for a question (share of the row's question words the user used). */
export function matchFaq(m: HelpManual, query: string) {
  const qw = new Set(words(query).map((w) => w.replace(/(ing|es|s|'t)$/, '')));
  let best: { q: string; a: string; section: string; score: number } | null = null;
  for (const r of faqRows(m)) {
    const rw = [...new Set(words(r.q).map((w) => w.replace(/(ing|es|s|'t)$/, '')))];
    if (!rw.length) continue;
    const score = rw.filter((w) => qw.has(w)).length / rw.length;
    if (!best || score > best.score) best = { ...r, score };
  }
  return best && best.score >= 0.6 ? best : null;
}

/** The section's opening prose (no tables, images or headings). */
export function leadText(body: string, max = 400) {
  const prose = body.split(/\n\s*\n/).filter((p) => !/^\s*(\||!\[|#)/.test(p)).map(plainText).filter(Boolean);
  let out = '';
  for (const p of prose) { if (out.length + p.length > max && out) break; out += (out ? ' ' : '') + p; }
  return out.length > max ? `${out.slice(0, max).replace(/\s\S*$/, '')}…` : out;
}

export const plainText = (md: string) => md
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/[*_`#>|]/g, ' ')
  .replace(/-{3,}/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function snippetOf(body: string, q: string[]) {
  const t = plainText(body);
  const lower = t.toLowerCase();
  const at = q.map((w) => lower.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 60);
  return `${start ? '…' : ''}${t.slice(start, start + 200).trim()}${t.length > start + 200 ? '…' : ''}`;
}

/** Which manual section explains the page the user is on. */
const PAGES: [RegExp, string][] = [
  [/^\/dashboard/, 'dashboard-and-compliance-calendar'],
  [/^\/calendar/, 'dashboard-and-compliance-calendar'],
  [/^\/filings\/[^/]+\/form/, 'mca-form-data'],
  [/^\/meetings/, 'meetings'],
  [/^\/extension/, 'mca-form-filler-chrome-extension'],
  [/^\/clients\/import/, 'adding-clients-three-ways'],
  [/^\/clients\/[^/]+/, 'the-client-page'],
  [/^\/clients/, 'clients'],
  [/^\/admin\/settings/, 'firm-settings-administration-settings'],
  [/^\/admin\/users/, 'add-your-team'],
  [/^\/admin\/subscription/, 'plan-payment-your-complydesk-subscription'],
  [/^\/admin\/rules/, 'administration'],
  [/^\/admin\/audit/, 'administration'],
  [/^\/billing/, 'billing'],
  [/^\/platform/, 'integrata-platform-console-integrata-only'],
];
export function sectionForPage(m: HelpManual, page?: string | null): HelpSection | null {
  if (!page) return null;
  const hit = PAGES.find(([re]) => re.test(page));
  return (hit && m.sections.find((s) => s.id === hit[1])) || null;
}

/** Suggested questions per page, shown before the user types anything. */
const SUGGEST: [RegExp, string[]][] = [
  [/^\/(dashboard|calendar)/, ['Why does a due date show "est."?', 'How do I add an event-based filing?', 'What do the dashboard tiles mean?']],
  [/^\/filings/, ['How do I fill the MCA form with the extension?', 'Where does the form data come from?']],
  [/^\/meetings/, ['How do I mark the AGM as held?', 'How do meeting outcomes add filings?']],
  [/^\/extension/, ['How do I connect the extension?', 'The form filler didn\'t match a field — what now?']],
  [/^\/clients/, ['How do I add a client from MCA master data?', 'How do I record a charge in the register?', 'Why is a filing missing from the calendar?']],
  [/^\/admin\/settings/, ['What does "Reviewer checks every filing" do?', 'How do reminder emails work?']],
  [/^\/billing/, ['How do I raise an invoice?', 'How do I record a payment with TDS?', 'When is IGST charged instead of CGST and SGST?']],
  [/^\/admin\/users/, ['What can each role do?', 'How do I give a client access to their company?']],
];
export function suggestionsFor(page?: string | null): string[] {
  const hit = page ? SUGGEST.find(([re]) => re.test(page)) : null;
  return hit?.[1] ?? ['How does a filing move from preparation to MCA approval?', 'Why can\'t I approve a filing?', 'How do I read a document with AI?'];
}

let cached: HelpManual | null = null;
const HELP_DIR = () => process.env.HELP_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../help');
export function manual(): HelpManual {
  if (!cached) cached = parseManual(fs.readFileSync(path.join(HELP_DIR(), 'manual.md'), 'utf8'));
  return cached;
}
