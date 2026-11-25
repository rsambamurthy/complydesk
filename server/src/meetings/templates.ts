/**
 * Built-in agenda items and resolutions. Placeholders: {{company}}, {{person}}, {{designation}}, {{date}}, {{fy}}.
 * `filings` are event-based rule codes put on the calendar when the item is passed (dated the meeting day);
 * `completes` are annual calendar items this item takes care of for the FY.
 * Drafts for a CS to adapt — wording to be confirmed by a practising Company Secretary.
 */
export type MeetingType = 'BOARD' | 'AGM' | 'EGM';
export interface AgendaTemplate {
  key: string; title: string; for: MeetingType[]; resolutionType: 'NONE' | 'BOARD' | 'ORDINARY' | 'SPECIAL';
  text: string; person?: boolean; filings?: string[]; completes?: string[]; standard?: boolean;
}

const GM: MeetingType[] = ['AGM', 'EGM'];

export const AGENDA_TEMPLATES: AgendaTemplate[] = [
  // ---- Standard board items ---------------------------------------------------------------------------------
  { key: 'CHAIR', title: 'Chairperson of the meeting', for: ['BOARD', ...GM], resolutionType: 'NONE', standard: true,
    text: 'The directors present elected the Chairperson of the meeting, who confirmed that the quorum was present.' },
  { key: 'LEAVE', title: 'Leave of absence', for: ['BOARD'], resolutionType: 'NONE', standard: true,
    text: 'Leave of absence was granted to the directors who could not attend the meeting.' },
  { key: 'PREV_MINUTES', title: 'Minutes of the previous meeting', for: ['BOARD'], resolutionType: 'NONE', standard: true,
    text: 'The minutes of the previous meeting of the Board, circulated to the directors, were taken as read and confirmed.' },
  { key: 'MBP1', title: 'Disclosure of interest (MBP-1) and non-disqualification (DIR-8)', for: ['BOARD'], resolutionType: 'NONE', completes: ['MBP1_DIR8'],
    text: 'The Board took note of the disclosures of interest in Form MBP-1 under Section 184(1) and the declarations of non-disqualification in Form DIR-8 under Section 164(2) received from the directors for the financial year {{fy}}.' },
  { key: 'ACCOUNTS', title: 'Approval of financial statements and Board’s report', for: ['BOARD'], resolutionType: 'BOARD',
    text: 'RESOLVED THAT the audited financial statements of {{company}} for the financial year {{fy}}, together with the Auditor’s report and the Board’s report, be and are hereby approved, and that any director be authorised to sign them on behalf of the Board.' },
  { key: 'CALL_AGM', title: 'Convening the Annual General Meeting', for: ['BOARD'], resolutionType: 'BOARD',
    text: 'RESOLVED THAT the Annual General Meeting of {{company}} be held on a date to be fixed, and that the draft notice placed before the Board be approved and sent to the members, directors and auditors.' },
  { key: 'CALL_EGM', title: 'Convening an Extraordinary General Meeting', for: ['BOARD'], resolutionType: 'BOARD',
    text: 'RESOLVED THAT an Extraordinary General Meeting of {{company}} be convened, and that the draft notice with the explanatory statement placed before the Board be approved and sent to the members.' },
  // ---- Directors and KMP ---------------------------------------------------------------------------------
  { key: 'APPOINT_ADDL_DIRECTOR', title: 'Appointment of additional director', for: ['BOARD'], resolutionType: 'BOARD', person: true, filings: ['DIR12'],
    text: 'RESOLVED THAT pursuant to Section 161(1) of the Companies Act, 2013, {{person}} be and is hereby appointed as an Additional Director of {{company}} with effect from {{date}}, to hold office up to the date of the next Annual General Meeting, and that any director be authorised to file Form DIR-12 with the Registrar.' },
  { key: 'DIRECTOR_RESIGNATION', title: 'Resignation of a director', for: ['BOARD'], resolutionType: 'NONE', person: true, filings: ['DIR12'],
    text: 'The Board took note of the resignation of {{person}} as a director of {{company}} with effect from {{date}} and placed on record its appreciation of the services rendered. Any director was authorised to file Form DIR-12 with the Registrar.' },
  { key: 'APPOINT_KMP', title: 'Appointment of Key Managerial Personnel', for: ['BOARD'], resolutionType: 'BOARD', person: true, filings: ['DIR12'],
    text: 'RESOLVED THAT pursuant to Section 203 of the Companies Act, 2013, {{person}} be and is hereby appointed as {{designation}} of {{company}} with effect from {{date}}, and that any director be authorised to file the necessary forms with the Registrar.' },
  { key: 'REGULARISE_DIRECTOR', title: 'Regularisation of additional director', for: GM, resolutionType: 'ORDINARY', person: true, filings: ['DIR12'],
    text: 'RESOLVED THAT {{person}}, appointed as an Additional Director, be and is hereby appointed as a Director of {{company}}, liable to retire by rotation.' },
  // ---- Capital, borrowing, office ------------------------------------------------------------------------
  { key: 'ALLOTMENT', title: 'Allotment of shares', for: ['BOARD'], resolutionType: 'BOARD', filings: ['PAS3'],
    text: 'RESOLVED THAT ___ equity shares of ₹___ each be and are hereby allotted, credited as fully paid up, to the persons listed in the statement placed before the Board, and that any director be authorised to file the return of allotment in Form PAS-3.' },
  { key: 'BORROWING_CHARGE', title: 'Borrowing and creation of charge', for: ['BOARD'], resolutionType: 'BOARD', filings: ['CHG1'],
    text: 'RESOLVED THAT {{company}} borrow up to ₹___ from ___ and create a charge on its assets as security, and that any director be authorised to sign the documents and file Form CHG-1 with the Registrar.' },
  { key: 'CHARGE_SATISFIED', title: 'Satisfaction of charge', for: ['BOARD'], resolutionType: 'NONE', filings: ['CHG4'],
    text: 'The Board noted that the loan secured by the charge in favour of ___ has been repaid in full, and authorised any director to file Form CHG-4 with the Registrar.' },
  { key: 'SHIFT_RO_LOCAL', title: 'Shifting of registered office (within the city)', for: ['BOARD'], resolutionType: 'BOARD', filings: ['INC22'],
    text: 'RESOLVED THAT the registered office of {{company}} be shifted to ___ with effect from {{date}}, and that any director be authorised to file Form INC-22 with the Registrar.' },
  { key: 'INCREASE_CAPITAL', title: 'Increase in authorised share capital', for: GM, resolutionType: 'ORDINARY', filings: ['SH7'],
    text: 'RESOLVED THAT pursuant to Section 61 of the Companies Act, 2013, the authorised share capital of {{company}} be increased from ₹___ to ₹___, and that Clause V of the Memorandum of Association be altered accordingly.' },
  { key: 'ALTER_ARTICLES', title: 'Alteration of Articles of Association', for: GM, resolutionType: 'SPECIAL', filings: ['MGT14'],
    text: 'RESOLVED THAT pursuant to Section 14 of the Companies Act, 2013, the Articles of Association of {{company}} be altered as set out in the explanatory statement.' },
  { key: 'SHIFT_RO_STATE', title: 'Shifting of registered office (outside the city)', for: GM, resolutionType: 'SPECIAL', filings: ['MGT14', 'INC22'],
    text: 'RESOLVED THAT pursuant to Section 12 of the Companies Act, 2013, the registered office of {{company}} be shifted from ___ to ___.' },
  // ---- Annual general meeting --------------------------------------------------------------------------------
  { key: 'ADOPT_ACCOUNTS', title: 'Adoption of financial statements', for: ['AGM'], resolutionType: 'ORDINARY', standard: true,
    text: 'RESOLVED THAT the audited financial statements of {{company}} for the financial year {{fy}}, together with the reports of the Board and the Auditors, be and are hereby received, considered and adopted.' },
  { key: 'APPOINT_AUDITOR', title: 'Appointment / ratification of statutory auditor', for: ['AGM'], resolutionType: 'ORDINARY',
    text: 'RESOLVED THAT pursuant to Section 139 of the Companies Act, 2013, ___ (Firm Registration No. ___) be and are hereby appointed as Statutory Auditors of {{company}} to hold office from the conclusion of this meeting until the conclusion of the ___ Annual General Meeting, at a remuneration to be fixed by the Board.' },
  { key: 'SPECIAL_OTHER', title: 'Special resolution (other)', for: GM, resolutionType: 'SPECIAL', filings: ['MGT14'], text: 'RESOLVED THAT ___' },
  // ---- Anything else ---------------------------------------------------------------------------------------------
  { key: 'OTHER', title: 'Any other business', for: ['BOARD', ...GM], resolutionType: 'NONE', text: '' },
];

export const templateByKey = (key: string) => AGENDA_TEMPLATES.find((t) => t.key === key);
