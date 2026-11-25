/** Filing stages and how they map to the coarse status (shared by obligations.ts and workflow.ts). */
export const STAGES = ['TODO', 'DATA', 'DRAFTED', 'REVIEW', 'CLIENT', 'READY', 'FILED', 'RESUBMIT', 'APPROVED', 'NA'] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_STATUS: Record<Stage, string> = {
  TODO: 'OPEN', DATA: 'IN_PROGRESS', DRAFTED: 'IN_PROGRESS', REVIEW: 'IN_PROGRESS', CLIENT: 'IN_PROGRESS', READY: 'IN_PROGRESS',
  RESUBMIT: 'IN_PROGRESS', FILED: 'FILED', APPROVED: 'FILED', NA: 'NOT_APPLICABLE',
};
/** When only a status is set (meetings, the old status field): the matching stage. */
export const statusToStage = (status: string, current: string): Stage =>
  status === 'FILED' ? (current === 'APPROVED' ? 'APPROVED' : 'FILED') : status === 'NOT_APPLICABLE' ? 'NA' : status === 'OPEN' ? 'TODO'
    : STAGE_STATUS[current as Stage] === 'IN_PROGRESS' ? (current as Stage) : 'DATA';
/** Meetings are held, not filed — they don't use the filing workflow. */
export const isMeeting = (form: string) => form === 'Board meeting' || form === 'AGM';
