import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseManual, searchManual, sectionForPage, suggestionsFor } from '../src/help/manual.js';
import { manualForModel, searchAnswer, tidyHistory } from '../src/help/assistant.js';

const m = parseManual(fs.readFileSync(path.resolve(__dirname, '../../help/manual.md'), 'utf8'));

describe('help manual', () => {
  it('splits into sections with unique ids', () => {
    expect(m.sections.length).toBeGreaterThan(20);
    const ids = m.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('working-a-filing');
    expect(m.sections.find((s) => s.id === 'pre-filing-check')?.parent).toBe('working-a-filing');
  });
  it('every page maps to a real section', () => {
    for (const p of ['/dashboard', '/calendar', '/meetings', '/extension', '/clients', '/clients/import', '/clients/abc', '/filings/x/form', '/admin/settings', '/admin/users', '/admin/rules', '/platform'])
      expect(sectionForPage(m, p), p).not.toBeNull();
    expect(suggestionsFor('/meetings').length).toBeGreaterThan(0);
  });
  it('search finds the right section', () => {
    expect(searchManual(m, 'pre-filing check')[0].id).toBe('pre-filing-check');
    expect(searchManual(m, 'SRN wrong').map((h) => h.id)).toContain('faq-and-troubleshooting');
    expect(searchManual(m, 'the and of')).toEqual([]);
  });
  it('answers without AI from the best section, and admits a miss', () => {
    const a = searchAnswer({ question: 'how do I connect the chrome extension' }, m);
    expect(a.covered).toBe(true);
    expect(a.sections[0]).toMatch(/extension|form-filler/);
    const miss = searchAnswer({ question: 'zzqx', page: '/meetings' }, m);
    expect(miss.covered).toBe(false);
    expect(miss.sections).toEqual(['meetings']);
  });
  it('answers common questions from the FAQ', () => {
    const a = searchAnswer({ question: "Why can't I approve a filing?" }, m);
    expect(a.answer).toMatch(/prepared it/);
    expect(searchAnswer({ question: 'Why does a due date show est.?' }, m).answer).toMatch(/AGM/);
  });
  it('gives the model section ids and no images', () => {
    const t = manualForModel(m);
    expect(t).toContain('[pre-filing-check]');
    expect(t).not.toContain('](/help/');
  });
  it('keeps history alternating and ending with an answer', () => {
    const h = tidyHistory([{ role: 'assistant', text: 'x' }, { role: 'user', text: 'a' }, { role: 'user', text: 'b' }, { role: 'assistant', text: 'c' }, { role: 'user', text: 'd' }]);
    expect(h.map((t) => t.role)).toEqual(['user', 'assistant']);
    expect(h[0].content).toContain('a\n\nb');
  });
});
