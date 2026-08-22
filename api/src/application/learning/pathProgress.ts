/**
 * ENROLLING IN A PATH, AND HOW FAR THROUGH IT SOMEBODY IS.
 *
 * ── ENROLLING IN A PATH IS ENROLLING IN A COURSE ─────────────────────────────
 * Because a path IS a `courses` row (1112), a path enrolment is a
 * `course_enrollments` row whose `course_id` is the path. No second table, no
 * second unique index, no second progress column that can disagree with the
 * first — `uq_course_enrollments_learner` already stops the same person enrolling
 * twice, whichever kind they enrolled in.
 *
 * The member courses get their own enrolments with `path_ref` set to the path's
 * id. That column shipped unused in 0420 and this is what it was for: it marks
 * an enrolment as taken AS PART OF a path, which is the difference between
 * finishing a course on its own and advancing through a curriculum.
 *
 * ── PROGRESS IS DERIVED, AND WRITTEN ONCE ────────────────────────────────────
 * A path's percentage is a fold over its members' enrolments. It is COMPUTED on
 * read rather than kept in step by every writer that could move it — and then
 * written back to the path's own `progress`/`status` in the same call, by this
 * one function, so there is exactly one writer for the stored copy.
 *
 * That is the denormalisation this platform permits and the condition it attaches:
 * a written reason and a single writer. The reason is that a due-date sweep and a
 * manager's dashboard both need to filter and sort by progress across thousands of
 * learners, and neither can fold per row.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { courseEnrollments, courses } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { listRelatedFrom } from '../kernel/ObjectRelations';
import { loadCourse } from './learningPaths';

/** 'enrolled' — has not started. 'in_progress' — at least one member started.
 *  'completed' — every member finished. */
export type EnrollmentStatus = 'enrolled' | 'in_progress' | 'completed' | 'expired' | 'withdrawn';

export interface PathProgress {
  pathId: number;
  learnerRef: string;
  status: EnrollmentStatus;
  /** Whole percent, 0–100. */
  percent: number;
  completedCourses: number;
  totalCourses: number;
  /** The next course to take: the first member the learner has not completed. */
  nextCourseId: number | null;
}

export type EnrollRefusal =
  | { ok: false; reason: 'not_a_path'; detail: string }
  | { ok: false; reason: 'not_published'; detail: string };

const progressCacheKey = (tenantId: number, pathId: number, learnerRef: string) =>
  `learning:path-progress:${tenantId}:${pathId}:${learnerRef}`;

/**
 * Enrol a learner in a path and in every course it sequences.
 *
 * Both halves in one call, deliberately: a path enrolment with no member
 * enrolments behind it is a row that reports 0% forever, because there is nothing
 * for the rollup to fold over. Upserted, so re-enrolling somebody who already
 * holds one of the member courses keeps their existing progress rather than
 * resetting a course they already finished.
 */
export async function enrollInPath(
  db: Db, env: Env,
  input: { tenantId: number; pathId: number; learnerRef: string; dueAt?: Date | null },
): Promise<{ ok: true; progress: PathProgress } | EnrollRefusal> {
  const path = await loadCourse(db, input.tenantId, input.pathId);
  if (!path || path.kind !== 'path' || !path.objectId) {
    return { ok: false, reason: 'not_a_path', detail: 'that id is not a learning path in this workspace' };
  }
  if (path.status !== 'published') {
    return { ok: false, reason: 'not_published', detail: 'a draft path cannot be enrolled in' };
  }

  const memberIds = await pathMemberIds(db, env, input.tenantId, path.objectId);
  const pathRef = String(input.pathId);

  await db.insert(courseEnrollments).values([
    {
      tenantId: input.tenantId,
      courseId: input.pathId,
      learnerRef: input.learnerRef,
      dueAt: input.dueAt ?? null,
    },
    ...memberIds.map((courseId) => ({
      tenantId: input.tenantId,
      courseId,
      pathRef,
      learnerRef: input.learnerRef,
      dueAt: input.dueAt ?? null,
    })),
  ]).onConflictDoUpdate({
    target: [courseEnrollments.tenantId, courseEnrollments.courseId, courseEnrollments.learnerRef],
    // Only the path link and the due date. Never `status` or `progress`: those
    // are the learner's record, and re-enrolment must not erase what they did.
    set: { pathRef: sql`excluded.path_ref`, dueAt: sql`excluded.due_at`, updatedAt: new Date() },
  });

  return { ok: true, progress: await recomputePathProgress(db, env, input.tenantId, input.pathId, input.learnerRef) };
}

/**
 * Fold the member enrolments into the path's own progress, and store the result.
 *
 * The single writer for the stored copy. Called after an enrolment and after any
 * member's status moves, so the two can only ever disagree for the length of one
 * request.
 */
export async function recomputePathProgress(
  db: Db, env: Env, tenantId: number, pathId: number, learnerRef: string,
): Promise<PathProgress> {
  const rows = await db.select({ courseId: courseEnrollments.courseId, status: courseEnrollments.status })
    .from(courseEnrollments)
    .where(scopedToTenant(courseEnrollments, tenantId, and(
      eq(courseEnrollments.pathRef, String(pathId)),
      eq(courseEnrollments.learnerRef, learnerRef),
    ))!);

  const progress = summarisePath(pathId, learnerRef, rows.map((r) => ({
    courseId: r.courseId,
    status: r.status as EnrollmentStatus,
  })));

  await db.update(courseEnrollments)
    .set({
      progress: String(progress.percent),
      status: progress.status,
      completedAt: progress.status === 'completed' ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(scopedToTenant(courseEnrollments, tenantId, and(
      eq(courseEnrollments.courseId, pathId),
      eq(courseEnrollments.learnerRef, learnerRef),
    ))!);

  await invalidateCached(env, progressCacheKey(tenantId, pathId, learnerRef));
  return progress;
}

/**
 * The arithmetic, separated from the query.
 *
 * Pure, and exported for the test: the two rules worth asserting rather than
 * eyeballing are that an EMPTY path is 0% and not 100% (dividing by its own zero
 * members is how an empty curriculum certifies everybody), and that `nextCourseId`
 * is the first UNFINISHED member rather than the first member.
 */
export function summarisePath(
  pathId: number,
  learnerRef: string,
  members: Array<{ courseId: number | null; status: EnrollmentStatus }>,
): PathProgress {
  const total = members.length;
  const completed = members.filter((m) => m.status === 'completed').length;
  const started = members.some((m) => m.status === 'in_progress' || m.status === 'completed');
  const next = members.find((m) => m.status !== 'completed')?.courseId ?? null;

  const status: EnrollmentStatus = total > 0 && completed === total
    ? 'completed'
    : started ? 'in_progress' : 'enrolled';

  return {
    pathId,
    learnerRef,
    status,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
    completedCourses: completed,
    totalCourses: total,
    nextCourseId: next,
  };
}

/** Where this learner has got to. Not cached: it is read on the learner's own
 *  screen right after they finished something, where the freshest answer is the
 *  entire point, and it is one indexed read. */
export async function pathProgressFor(
  db: Db, tenantId: number, pathId: number, learnerRef: string,
): Promise<PathProgress> {
  const rows = await db.select({ courseId: courseEnrollments.courseId, status: courseEnrollments.status })
    .from(courseEnrollments)
    .where(scopedToTenant(courseEnrollments, tenantId, and(
      eq(courseEnrollments.pathRef, String(pathId)),
      eq(courseEnrollments.learnerRef, learnerRef),
    ))!);
  return summarisePath(pathId, learnerRef, rows.map((r) => ({
    courseId: r.courseId, status: r.status as EnrollmentStatus,
  })));
}

/**
 * Mark one course finished and carry the consequence up.
 *
 * The consequence is the point: finishing a course inside a path is what moves
 * the path, and leaving that to a nightly job is how a learner sees "2 of 5"
 * after finishing the third.
 */
export async function completeCourse(
  db: Db, env: Env, tenantId: number, courseId: number, learnerRef: string,
): Promise<{ pathIds: number[] }> {
  const [row] = await db.update(courseEnrollments)
    .set({ status: 'completed', progress: '100', completedAt: new Date(), updatedAt: new Date() })
    .where(scopedToTenant(courseEnrollments, tenantId, and(
      eq(courseEnrollments.courseId, courseId),
      eq(courseEnrollments.learnerRef, learnerRef),
    ))!)
    .returning({ pathRef: courseEnrollments.pathRef });

  const pathId = row?.pathRef ? Number(row.pathRef) : null;
  if (pathId === null || !Number.isFinite(pathId)) return { pathIds: [] };

  await recomputePathProgress(db, env, tenantId, pathId, learnerRef);
  return { pathIds: [pathId] };
}

/** The `courses.id` of every member of a path, in author order. */
async function pathMemberIds(db: Db, env: Env, tenantId: number, pathObjectId: string): Promise<number[]> {
  const members = await listRelatedFrom(db, env, tenantId, pathObjectId, 'contains');
  const refs = members.map((m) => Number(m.refId)).filter((n) => Number.isFinite(n));
  if (refs.length === 0) return [];

  // Confirm they are still courses in this tenant. An edge survives a course
  // being retired, and enrolling somebody into a row that is gone would fail on
  // the foreign key with a message about nothing in particular.
  const rows = await db.select({ id: courses.id })
    .from(courses)
    .where(scopedToTenant(courses, tenantId, inArray(courses.id, refs))!);
  const live = new Set(rows.map((r) => r.id));
  return refs.filter((id) => live.has(id));
}
