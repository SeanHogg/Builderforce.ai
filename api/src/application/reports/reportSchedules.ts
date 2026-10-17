/**
 * Report schedule use cases — what `/api/reports/schedules` does, minus the HTTP.
 *
 * Every write runs through ONE decision (`schedulePatch.ts`): create is that
 * decision with no existing row, PATCH is it with the stored row. Both then prove a
 * named board-pack frame is on a board this workspace can read before writing.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { reportSchedules } from '../../infrastructure/database/schema';
import { boardPackSubjectRef, listSchedulableFrames } from '../finance/boardPackReport';
import {
  FRAME_NOT_READABLE_ERROR,
  boardPackSubjectToVerify,
  reportScheduleCreateValues,
  reportSchedulePatchSet,
  type ReportSchedulePatchSet,
  type ScheduleCreateBody,
  type SchedulePatchBody,
} from './schedulePatch';

export type ReportScheduleRow = typeof reportSchedules.$inferSelect;

export type ScheduleWriteResult =
  | { ok: true; row: ReportScheduleRow }
  | { ok: false; status: 400 | 404; error: string };

const notFound = { ok: false, status: 404, error: 'Schedule not found' } as const;
const refused = (error: string) => ({ ok: false, status: 400, error }) as const;

const ownRow = (tenantId: number, id: string) =>
  and(eq(reportSchedules.id, id), eq(reportSchedules.tenantId, tenantId));

/** A frame the decided columns name must be one this tenant can read. */
async function frameIsReadable(db: Db, tenantId: number, set: ReportSchedulePatchSet): Promise<boolean> {
  const frame = boardPackSubjectToVerify(set);
  if (!frame) return true;
  const frames = await listSchedulableFrames(db, tenantId, frame.sessionId);
  return frames.some((f) => f.id === frame.frameId);
}

export function listReportSchedules(db: Db, tenantId: number): Promise<ReportScheduleRow[]> {
  return db.select().from(reportSchedules).where(eq(reportSchedules.tenantId, tenantId));
}

/** The frames on a board that could back a `board_pack` schedule, with the subject each would post. */
export async function listBoardPackFrameSubjects(db: Db, tenantId: number, sessionId: string) {
  const frames = await listSchedulableFrames(db, tenantId, sessionId);
  return frames.map((frame) => ({
    ...frame,
    subjectKind: 'canvas_frame' as const,
    subjectRef: boardPackSubjectRef(sessionId, frame.id),
  }));
}

export async function createReportSchedule(db: Db, tenantId: number, body: ScheduleCreateBody): Promise<ScheduleWriteResult> {
  const decided = reportScheduleCreateValues(body);
  if ('error' in decided) return refused(decided.error);
  if (!(await frameIsReadable(db, tenantId, decided.values))) return refused(FRAME_NOT_READABLE_ERROR);

  const [row] = await db.insert(reportSchedules).values({ tenantId, ...decided.values }).returning();
  return { ok: true, row: row! };
}

export async function patchReportSchedule(db: Db, tenantId: number, id: string, body: SchedulePatchBody): Promise<ScheduleWriteResult> {
  const [existing] = await db.select().from(reportSchedules).where(ownRow(tenantId, id)).limit(1);
  if (!existing) return notFound;

  const decided = reportSchedulePatchSet(existing, body);
  if ('error' in decided) return refused(decided.error);
  if (!(await frameIsReadable(db, tenantId, decided.set))) return refused(FRAME_NOT_READABLE_ERROR);

  const [updated] = await db.update(reportSchedules)
    .set({ ...decided.set, updatedAt: new Date() })
    .where(ownRow(tenantId, id))
    .returning();
  return updated ? { ok: true, row: updated } : notFound;
}

export async function deleteReportSchedule(db: Db, tenantId: number, id: string): Promise<void> {
  await db.delete(reportSchedules).where(ownRow(tenantId, id));
}
