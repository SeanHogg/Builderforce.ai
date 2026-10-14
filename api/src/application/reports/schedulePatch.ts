/**
 * PATCH /api/reports/schedules/:id — field merge and board-pack admission.
 *
 * Create already accepts report, subject and a canvas-frame subjectRef. The
 * patch route used to ignore those, so changing a report or frame meant delete
 * and re-create. This module is the shared write-shape so omitted fields stay
 * undefined (drizzle skips them) and a board_pack still needs a readable frame.
 */

import { parseBoardPackSubject } from '../finance/boardPackReport';

export const BOARD_PACK_SUBJECT_ERROR =
  'A board_pack schedule needs subjectKind "canvas_frame" and subjectRef "<sessionId>:<frameId>"';
export const BOARD_PACK_FRAME_ERROR =
  'That frame is not on a board this workspace can read';

export type ReportSchedulePatchBody = {
  deliveryHour?: number;
  recipients?: string[];
  isEnabled?: boolean;
  reportType?: string;
  subjectKind?: string | null;
  subjectRef?: string | null;
};

export type ReportScheduleSubjectRow = {
  reportType: string;
  subjectKind: string | null;
  subjectRef: string | null;
};

/** True when the patch names the report or its subject — those need the existing row. */
export function reportOrSubjectChanging(body: ReportSchedulePatchBody): boolean {
  return body.reportType !== undefined
    || body.subjectKind !== undefined
    || body.subjectRef !== undefined;
}

/** Body fields overlay the stored row; omitted keys keep the existing values. */
export function resolvedReportSubject(
  body: ReportSchedulePatchBody,
  existing: ReportScheduleSubjectRow,
): ReportScheduleSubjectRow {
  return {
    reportType: body.reportType ?? existing.reportType,
    subjectKind: body.subjectKind !== undefined ? body.subjectKind : existing.subjectKind,
    subjectRef: body.subjectRef !== undefined ? body.subjectRef : existing.subjectRef,
  };
}

/**
 * Drizzle `set` payload. `undefined` means "leave the column alone"; `null` on
 * subjectKind/subjectRef is a deliberate clear.
 */
export function reportSchedulePatchSet(body: ReportSchedulePatchBody): {
  deliveryHour: number | undefined;
  recipients: string | undefined;
  isEnabled: boolean | undefined;
  reportType: 'standup' | undefined;
  subjectKind: string | null | undefined;
  subjectRef: string | null | undefined;
  updatedAt: Date;
} {
  return {
    deliveryHour: body.deliveryHour,
    recipients: body.recipients !== undefined ? JSON.stringify(body.recipients) : undefined,
    isEnabled: body.isEnabled,
    reportType: body.reportType as 'standup' | undefined,
    subjectKind: body.subjectKind === undefined ? undefined : body.subjectKind,
    subjectRef: body.subjectRef === undefined ? undefined : body.subjectRef,
    updatedAt: new Date(),
  };
}

/**
 * Same admission create uses: board_pack needs canvas_frame + session:frame,
 * and that frame has to be one `listFrames` says this workspace can read.
 * Other report types carry no subject and pass.
 */
export async function boardPackScheduleError(
  reportType: string,
  subjectKind: string | null | undefined,
  subjectRef: string | null | undefined,
  listFrames: (sessionId: string) => Promise<Array<{ id: string }>>,
): Promise<string | null> {
  if (reportType !== 'board_pack') return null;
  const parsed = parseBoardPackSubject(subjectKind ?? null, subjectRef ?? null);
  if (!parsed) return BOARD_PACK_SUBJECT_ERROR;
  const frames = await listFrames(parsed.sessionId);
  if (!frames.some((frame) => frame.id === parsed.frameId)) return BOARD_PACK_FRAME_ERROR;
  return null;
}
