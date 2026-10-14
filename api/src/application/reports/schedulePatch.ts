import { parseBoardPackSubject } from '../finance/boardPackReport';

export const SCHEDULE_REPORT_TYPES = [
  'standup',
  'code_review',
  'project_status',
  'executive_summary',
  'portfolio_rollup',
  'board_pack',
] as const;

export type ScheduleReportType = (typeof SCHEDULE_REPORT_TYPES)[number];

export type SchedulePatchBody = {
  reportType?: string;
  subjectKind?: string | null;
  subjectRef?: string | null;
  deliveryHour?: number;
  recipients?: string[];
  isEnabled?: boolean;
};

export type ExistingReportSchedule = {
  reportType: string;
  subjectKind: string | null;
  subjectRef: string | null;
};

/** Columns `PATCH /api/reports/schedules/:id` will `.set()`. Omitted keys stay as they are. */
export type ReportSchedulePatchSet = {
  reportType?: ScheduleReportType;
  subjectKind?: string | null;
  subjectRef?: string | null;
  deliveryHour?: number;
  recipients?: string;
  isEnabled?: boolean;
};

export type SchedulePatchResult =
  | { set: ReportSchedulePatchSet }
  | { error: string };

const KNOWN_TYPES = new Set<string>(SCHEDULE_REPORT_TYPES);

/**
 * Decide the column set for a schedule PATCH.
 *
 * Delivery hour / recipients / enabled stay as they were (the handler already
 * wrote those). This also accepts `reportType` and the board-pack subject, so
 * changing what a schedule sends does not mean delete-and-recreate.
 *
 * A `board_pack` row still needs a parseable canvas-frame subject — same rule
 * as create. Leaving `board_pack` clears the subject so a later tick does not
 * try to render a frame the new type does not use.
 */
export function reportSchedulePatchSet(
  existing: ExistingReportSchedule,
  body: SchedulePatchBody,
): SchedulePatchResult {
  if (body.reportType !== undefined && !KNOWN_TYPES.has(body.reportType)) {
    return { error: `reportType must be one of ${SCHEDULE_REPORT_TYPES.join(', ')}` };
  }

  const nextType = body.reportType ?? existing.reportType;
  const nextKind = body.subjectKind !== undefined ? body.subjectKind : existing.subjectKind;
  const nextRef = body.subjectRef !== undefined ? body.subjectRef : existing.subjectRef;
  const subjectTouched = body.subjectKind !== undefined || body.subjectRef !== undefined;
  const typeTouched = body.reportType !== undefined;

  if (nextType === 'board_pack') {
    if (!parseBoardPackSubject(nextKind, nextRef)) {
      return {
        error: 'A board_pack schedule needs subjectKind "canvas_frame" and subjectRef "<sessionId>:<frameId>"',
      };
    }
  } else if (subjectTouched) {
    return { error: 'subjectKind/subjectRef only apply to board_pack schedules' };
  }

  const set: ReportSchedulePatchSet = {};
  if (body.deliveryHour !== undefined) set.deliveryHour = body.deliveryHour;
  if (body.recipients !== undefined) set.recipients = JSON.stringify(body.recipients);
  if (body.isEnabled !== undefined) set.isEnabled = body.isEnabled;
  if (typeTouched) set.reportType = body.reportType as ScheduleReportType;
  if (nextType === 'board_pack' && (typeTouched || subjectTouched)) {
    set.subjectKind = 'canvas_frame';
    set.subjectRef = nextRef as string;
  } else if (typeTouched && existing.reportType === 'board_pack' && nextType !== 'board_pack') {
    set.subjectKind = null;
    set.subjectRef = null;
  }
  return { set };
}

/**
 * When the patch names a new (or newly board_pack) frame, the route still has
 * to prove that frame is on a board this workspace can read — same as POST.
 */
export function boardPackSubjectToVerify(
  set: ReportSchedulePatchSet,
): { sessionId: string; frameId: string } | null {
  if (typeof set.subjectRef !== 'string') return null;
  return parseBoardPackSubject(set.subjectKind ?? null, set.subjectRef);
}
