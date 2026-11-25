/**
 * Meeting rules, as pure functions (tested in tests/meetings.test.ts): notice period, quorum, gap between
 * board meetings and the minutes deadline. They warn; they never block — the CS decides.
 */
import { addDays, daysBetween } from '../compliance/dates.js';

export type MeetingType = 'BOARD' | 'AGM' | 'EGM';
export interface Check { key: string; ok: boolean; level: 'ok' | 'warn' | 'error'; text: string }

/** Days of notice the law asks for: 7 for a board meeting (Sec 173(3)), 21 clear days for a general meeting (Sec 101). */
export const noticeDaysRequired = (type: MeetingType) => (type === 'BOARD' ? 7 : 21);

/**
 * Notice given: board meetings count the days between sending and the meeting; general meetings need
 * 21 *clear* days (excluding both the day of sending and the meeting day).
 */
export function noticeCheck(type: MeetingType, meetingDate: string, noticeSentOn: string | null, shorterNotice: boolean): Check {
  const need = noticeDaysRequired(type);
  if (!noticeSentOn) {
    const sendBy = addDays(meetingDate, type === 'BOARD' ? -need : -(need + 1));
    return { key: 'notice', ok: false, level: 'warn', text: `Notice not sent yet — send by ${sendBy} for ${need}${type === 'BOARD' ? '' : ' clear'} days’ notice.` };
  }
  const given = type === 'BOARD' ? daysBetween(noticeSentOn, meetingDate) : daysBetween(noticeSentOn, meetingDate) - 1;
  if (given >= need) return { key: 'notice', ok: true, level: 'ok', text: `${given}${type === 'BOARD' ? '' : ' clear'} days’ notice given (${need} needed).` };
  if (shorterNotice) return { key: 'notice', ok: true, level: 'ok', text: `Shorter notice (${given} days) — consent recorded.` };
  return { key: 'notice', ok: false, level: 'error', text: `Only ${given}${type === 'BOARD' ? '' : ' clear'} days’ notice (${need} needed). Record consent for shorter notice or move the meeting.` };
}

/** Board quorum (Sec 174): one-third of the directors in office, or two, whichever is higher. Video attendance counts. */
export const boardQuorumNeeded = (directorsInOffice: number) => Math.max(2, Math.ceil(directorsInOffice / 3));

export function quorumCheck(type: MeetingType, directorsInOffice: number, directorsPresent: number, membersPresent: number | null): Check {
  if (type === 'BOARD') {
    const need = directorsInOffice < 2 ? 1 : boardQuorumNeeded(directorsInOffice);
    const ok = directorsPresent >= need;
    return { key: 'quorum', ok, level: ok ? 'ok' : 'error', text: `${directorsPresent} of ${directorsInOffice} directors present; quorum is ${need}.` };
  }
  // Private company: two members personally present (Sec 103(1)(b)), unless the Articles say more.
  if (membersPresent == null) return { key: 'quorum', ok: false, level: 'warn', text: 'Record the number of members present (quorum is 2 for a private company).' };
  const ok = membersPresent >= 2;
  return { key: 'quorum', ok, level: ok ? 'ok' : 'error', text: `${membersPresent} members present; quorum is 2.` };
}

/** Not more than 120 days between two board meetings (Sec 173(1)); small companies / OPCs: at least 90 days apart in a half-year (Sec 173(5)). */
export function gapCheck(meetingDate: string, previousBoardMeeting: string | null, smallOrOpc: boolean): Check | null {
  if (!previousBoardMeeting) return null;
  const gap = daysBetween(previousBoardMeeting, meetingDate);
  if (!smallOrOpc && gap > 120) return { key: 'gap', ok: false, level: 'error', text: `${gap} days since the last board meeting (${previousBoardMeeting}) — more than the 120 allowed.` };
  return { key: 'gap', ok: true, level: 'ok', text: `${gap} days since the last board meeting (${previousBoardMeeting}).` };
}

/** Minutes to be signed within 30 days of the meeting (SS-1 / SS-2). */
export function minutesCheck(heldOn: string | null, signedOn: string | null, today: string): Check | null {
  if (!heldOn) return null;
  const due = addDays(heldOn, 30);
  if (signedOn) return { key: 'minutes', ok: signedOn <= due, level: signedOn <= due ? 'ok' : 'warn', text: `Minutes signed on ${signedOn}${signedOn > due ? ` — after the 30-day limit (${due})` : ''}.` };
  return { key: 'minutes', ok: today <= due, level: today <= due ? 'warn' : 'error', text: today <= due ? `Minutes to be signed by ${due}.` : `Minutes not signed — were due by ${due}.` };
}

/** Fills a template's placeholders. */
export function fill(text: string, v: Record<string, string | null | undefined>) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k] ?? '___');
}
