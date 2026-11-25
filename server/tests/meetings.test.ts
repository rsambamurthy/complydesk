import { describe, expect, it } from 'vitest';
import { noticeCheck, quorumCheck, gapCheck, minutesCheck, boardQuorumNeeded, fill } from '../src/meetings/checks.js';
import { AGENDA_TEMPLATES } from '../src/meetings/templates.js';
import { CATALOGUE } from '../src/compliance/catalogue.js';

describe('notice', () => {
  it('board: 7 days', () => {
    expect(noticeCheck('BOARD', '2026-12-10', '2026-12-03', false).ok).toBe(true);
    expect(noticeCheck('BOARD', '2026-12-10', '2026-12-05', false).level).toBe('error');
    expect(noticeCheck('BOARD', '2026-12-10', '2026-12-05', true).ok).toBe(true);
  });
  it('general meeting: 21 clear days', () => {
    expect(noticeCheck('AGM', '2026-09-30', '2026-09-08', false).ok).toBe(true); // 21 clear days
    expect(noticeCheck('AGM', '2026-09-30', '2026-09-09', false).ok).toBe(false);
    expect(noticeCheck('EGM', '2026-09-30', null, false).text).toContain('2026-09-08');
  });
});

describe('quorum', () => {
  it('board: one-third or two, whichever is higher', () => {
    expect(boardQuorumNeeded(2)).toBe(2);
    expect(boardQuorumNeeded(6)).toBe(2);
    expect(boardQuorumNeeded(7)).toBe(3);
    expect(boardQuorumNeeded(12)).toBe(4);
    expect(quorumCheck('BOARD', 3, 1, null).ok).toBe(false);
    expect(quorumCheck('BOARD', 3, 2, null).ok).toBe(true);
  });
  it('general meeting of a private company: 2 members', () => {
    expect(quorumCheck('AGM', 3, 0, 2).ok).toBe(true);
    expect(quorumCheck('AGM', 3, 0, 1).ok).toBe(false);
    expect(quorumCheck('EGM', 3, 0, null).level).toBe('warn');
  });
});

describe('gap and minutes', () => {
  it('120-day gap for companies that are not small', () => {
    expect(gapCheck('2026-12-10', '2026-08-01', false)!.ok).toBe(false);
    expect(gapCheck('2026-12-10', '2026-08-15', false)!.ok).toBe(true);
    expect(gapCheck('2026-12-10', '2026-06-01', true)!.ok).toBe(true);
    expect(gapCheck('2026-12-10', null, false)).toBeNull();
  });
  it('minutes signed within 30 days', () => {
    expect(minutesCheck('2026-11-01', null, '2026-11-20')!.level).toBe('warn');
    expect(minutesCheck('2026-11-01', null, '2026-12-05')!.level).toBe('error');
    expect(minutesCheck('2026-11-01', '2026-11-25', '2026-12-05')!.ok).toBe(true);
  });
});

describe('templates', () => {
  it('every filing a template creates is an event rule in the catalogue', () => {
    const events = new Set(CATALOGUE.filter((r) => r.due.kind === 'AFTER_EVENT').map((r) => r.code));
    const all = new Set(CATALOGUE.map((r) => r.code));
    for (const t of AGENDA_TEMPLATES) {
      for (const f of t.filings ?? []) expect(events.has(f), `${t.key} → ${f}`).toBe(true);
      for (const c of t.completes ?? []) expect(all.has(c), `${t.key} completes ${c}`).toBe(true);
    }
  });
  it('fills placeholders', () => {
    expect(fill('{{person}} of {{company}} on {{date}}', { person: 'A', company: 'B' })).toBe('A of B on ___');
  });
});
