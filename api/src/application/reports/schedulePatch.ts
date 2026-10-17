import { parseBoardPackSubject } from '../finance/boardPackReport';
import {
  REPORT_CADENCES,
  REPORT_TYPES,
  isReportCadence,
  isReportType,
  type ReportCadence,
  type ReportType,
} from '../../domain/reports/reportTypes';

export type SchedulePatchBody = {
  reportType?: string;
  subjectKind?: string | null;
  subjectRef?: string | null;
  deliveryHour?: number;
  recipients?: string[];
  isEnabled?: boolean;
};

export type ScheduleCreateBody = {
  reportType?: string | null;
  schedule?: string | null;
  deliveryHour?: number | null;
  recipients?: string[];
  subjectKind?: string | null;
  subjectRef?: string | null;
};

export type ExistingReportSchedule = {
  reportType: string;
  subjectKind: string | null;
  subjectRef: string | null;
};

/** Columns `PATCH /api/reports/schedules/:id` will `.set()`. Omitted keys stay as they are. */
export type ReportSchedulePatchSet = {
  reportType?: ReportType;
  subjectKind?: string | null;
  subjectRef?: string | null;
  deliveryHour?: number;
  recipients?: string;
  isEnabled?: boolean;
};

/** Columns `POST /api/reports/schedules` inserts (tenant is the caller's to add). */
export type ReportScheduleCreateValues = ReportSchedulePatchSet & {
  reportType: ReportType;
  schedule: ReportCadence;
  deliveryHour: number;
  recipients: string;
};

export type SchedulePatchResult =
  | { set: ReportSchedulePatchSet }
  | { error: string };

export type ScheduleCreateResult =
  | { values: ReportScheduleCreateValues }
  | { error: string };

export const BOARD_PACK_SUBJECT_ERROR =
  'A board_pack schedule needs subjectKind "canvas_frame" and subjectRef "<sessionId>:<frameId>"';

export const FRAME_NOT_READABLE_ERROR = 'That frame is not on a board this workspace can read';

const DEFAULT_DELIVERY_HOUR = 8;

/**
 * Decide the column set for a schedule write — the ONE rule for both create
 * (`existing === null`) and PATCH.
 *
 * Delivery hour / recipients / enabled pass through. `reportType` and the
 * board-pack subject are accepted too, so changing what a schedule sends does not
 * mean delete-and-recreate.
 *
 * A `board_pack` row needs a parseable canvas-frame subject. Leaving `board_pack`
 * clears the subject so a later tick does not try to render a frame the new type
 * does not use.
 */
export function reportSchedulePatchSet(
  existing: ExistingReportSchedule | null,
  body: SchedulePatchBody,
): SchedulePatchResult {
  if (body.reportType !== undefined && !isReportType(body.reportType)) {
    return { error: `reportType must be one of ${REPORT_TYPES.join(', ')}` };
  }
  if (!existing && body.reportType === undefined) {
    return { error: 'reportType is required' };
  }

  const nextType = body.reportType ?? existing?.reportType;
  const nextKind = body.subjectKind !== undefined ? body.subjectKind : existing?.subjectKind ?? null;
  const nextRef = body.subjectRef !== undefined ? body.subjectRef : existing?.subjectRef ?? null;
  const subjectTouched = body.subjectKind !== undefined || body.subjectRef !== undefined;
  const typeTouched = body.reportType !== undefined;

  if (nextType === 'board_pack') {
    if (!parseBoardPackSubject(nextKind, nextRef)) return { error: BOARD_PACK_SUBJECT_ERROR };
  } else if (subjectTouched) {
    return { error: 'subjectKind/subjectRef only apply to board_pack schedules' };
  }

  const set: ReportSchedulePatchSet = {};
  if (body.deliveryHour !== undefined) set.deliveryHour = body.deliveryHour;
  if (body.recipients !== undefined) set.recipients = JSON.stringify(body.recipients);
  if (body.isEnabled !== undefined) set.isEnabled = body.isEnabled;
  if (typeTouched) set.reportType = body.reportType as ReportType;
  if (nextType === 'board_pack' && (typeTouched || subjectTouched)) {
    set.subjectKind = 'canvas_frame';
    set.subjectRef = nextRef as string;
  } else if (typeTouched && existing?.reportType === 'board_pack' && nextType !== 'board_pack') {
    set.subjectKind = null;
    set.subjectRef = null;
  }
  return { set };
}

/**
 * Decide the row for a schedule create: the required fields, then the same
 * decision PATCH runs, with no existing row. An unknown type or cadence is a 400
 * here rather than a 500 from the enum column.
 */
export function reportScheduleCreateValues(body: ScheduleCreateBody): ScheduleCreateResult {
  if (!body.reportType || !body.schedule || !Array.isArray(body.recipients)) {
    return { error: 'reportType, schedule, and recipients[] are required' };
  }
  if (!isReportCadence(body.schedule)) {
    return { error: `schedule must be one of ${REPORT_CADENCES.join(', ')}` };
  }
  const decided = reportSchedulePatchSet(null, {
    reportType: body.reportType,
    recipients: body.recipients,
    // A create that names no subject (null or absent) is not "touching" it.
    ...(body.subjectKind != null ? { subjectKind: body.subjectKind } : {}),
    ...(body.subjectRef != null ? { subjectRef: body.subjectRef } : {}),
  });
  if ('error' in decided) return decided;
  return {
    values: {
      ...decided.set,
      reportType: body.reportType as ReportType,
      schedule: body.schedule,
      deliveryHour: body.deliveryHour ?? DEFAULT_DELIVERY_HOUR,
      recipients: JSON.stringify(body.recipients),
    },
  };
}

/**
 * When the decided columns name a new (or newly board_pack) frame, the caller still
 * has to prove that frame is on a board this workspace can read.
 */
export function boardPackSubjectToVerify(
  set: ReportSchedulePatchSet,
): { sessionId: string; frameId: string } | null {
  if (typeof set.subjectRef !== 'string') return null;
  return parseBoardPackSubject(set.subjectKind ?? null, set.subjectRef);
}
