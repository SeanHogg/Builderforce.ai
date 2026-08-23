/**
 * PREREQUISITES — the DAG that decides what a learner may START.
 *
 * ── WHY THIS IS NOT THE PATH'S ORDER ─────────────────────────────────────────
 * A path's `contains` edges are the sequence its author wants it READ in. These
 * `depends_on` edges are the sequence it may be TAKEN in, and they are a
 * different fact: a prerequisite holds wherever the course appears, including
 * outside any path and inside three of them at once. The source product drew the
 * same line in its own header — "ordered display sequence (not unlock order —
 * that comes from the DAG)" — and collapsing them would make one of the two a lie.
 *
 * ── THE CYCLE CHECK IS AT WRITE TIME AND IT IS NOT OPTIONAL ──────────────────
 * A prerequisite loop has no first course. Every read over it — "what can I start",
 * a topological sequence, a progress rollup — either loops forever or silently
 * drops the whole component. `ObjectRelations.linkObjects` refuses the edge that
 * would close one, so the graph is a DAG by construction rather than by a nightly
 * check that reports a problem long after somebody created it.
 *
 * ── GATING IS A READ, NOT A STORED FLAG ──────────────────────────────────────
 * "Is this course unlocked for this learner" is `every prerequisite completed`,
 * derived from `course_enrollments` on the request. Storing an `unlocked` column
 * would be a denormalisation with no single writer: it would have to be recomputed
 * whenever an enrolment completes, whenever an edge is added, and whenever a
 * prerequisite is removed — three writers for one derived fact is exactly the
 * update anomaly that makes a learner's screen disagree with their record.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { courseEnrollments, courses } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { linkObjects, listRelatedFrom, unlinkObjects, loadEdges, type RelationRefusal } from '../kernel/ObjectRelations';
import { listCourses } from './learningPaths';
import { topoOrder } from '../../domain/kernel/graphCycle';

/** A course, and whether this learner may start it. */
export interface CourseGate {
  courseId: number;
  objectId: string;
  title: string;
  /** True when every prerequisite is completed — or when there are none. */
  unlocked: boolean;
  /** The prerequisites still outstanding, so the UI can say WHICH one blocks
   *  rather than only that something does. */
  blockedBy: Array<{ courseId: number; title: string }>;
}

export type PrerequisiteRefusal = RelationRefusal;

/**
 * Declare "`courseObjectId` requires `prerequisiteObjectId` first".
 *
 * The edge points from the dependant to the dependency, matching the kernel's
 * `depends_on` reading, so a topological order over these edges puts a
 * prerequisite AFTER what needs it — which is why {@link sequenceCourses}
 * reverses the result rather than the edges.
 */
export async function addPrerequisite(
  db: Db, env: Env, tenantId: number, courseObjectId: string, prerequisiteObjectId: string,
): Promise<{ ok: true } | PrerequisiteRefusal> {
  const result = await linkObjects(db, env, {
    tenantId, fromId: courseObjectId, toId: prerequisiteObjectId, kind: 'depends_on',
  });
  return result.ok ? { ok: true } : result;
}

export async function removePrerequisite(
  db: Db, env: Env, tenantId: number, courseObjectId: string, prerequisiteObjectId: string,
): Promise<boolean> {
  return unlinkObjects(db, env, tenantId, courseObjectId, prerequisiteObjectId, 'depends_on');
}

/** What this course requires, resolved to titles. */
export async function prerequisitesOf(
  db: Db, env: Env, tenantId: number, courseObjectId: string,
): Promise<Array<{ courseId: number; objectId: string; title: string }>> {
  const rows = await listRelatedFrom(db, env, tenantId, courseObjectId, 'depends_on');
  return rows.map((r) => ({ courseId: Number(r.refId), objectId: r.objectId, title: r.title ?? '' }));
}

/**
 * Which of these courses this learner may start, and what blocks the rest.
 *
 * ONE query for the edges and ONE for the learner's completions, then the gate is
 * arithmetic. The obvious implementation — ask "are your prerequisites done" per
 * course while rendering the list — is an N+1 that gets slower exactly as a
 * curriculum gets richer.
 */
export async function gateCourses(
  db: Db, env: Env,
  input: { tenantId: number; learnerRef: string; courses: Array<{ courseId: number; objectId: string; title: string }> },
): Promise<CourseGate[]> {
  if (input.courses.length === 0) return [];

  const byObjectId = new Map(input.courses.map((c) => [c.objectId, c]));
  const [edges, completed] = await Promise.all([
    loadEdges(db, input.tenantId, 'depends_on'),
    completedCourseIds(db, input.tenantId, input.learnerRef),
  ]);

  // Prerequisites can name a course outside the list being gated (a path shows
  // three of five). Those are resolved from the edge's own endpoint, so a
  // prerequisite the learner cannot currently see still blocks correctly.
  const outside = edges
    .filter((e) => byObjectId.has(e.from) && !byObjectId.has(e.to))
    .map((e) => e.to);
  const titles = await titlesForObjects(db, input.tenantId, outside);

  return input.courses.map((course) => {
    const required = edges.filter((e) => e.from === course.objectId).map((e) => e.to);
    const blockedBy = required
      .map((objectId) => byObjectId.get(objectId) ?? titles.get(objectId))
      .filter((c): c is { courseId: number; title: string } => Boolean(c))
      .filter((c) => !completed.has(c.courseId));

    return {
      courseId: course.courseId,
      objectId: course.objectId,
      title: course.title,
      unlocked: blockedBy.length === 0,
      blockedBy: blockedBy.map(({ courseId, title }) => ({ courseId, title })),
    };
  });
}

/**
 * Order these courses so every prerequisite comes before what needs it.
 *
 * Returns the input order unchanged when the graph cannot be sequenced — which
 * the write path makes impossible, and which a reader must still survive rather
 * than render an empty curriculum because of one bad edge written directly to the
 * database.
 */
export async function sequenceCourses(
  db: Db, tenantId: number, objectIds: string[],
): Promise<string[]> {
  if (objectIds.length < 2) return objectIds;
  const edges = await loadEdges(db, tenantId, 'depends_on');
  // `depends_on` points dependant → dependency, so the topological order over
  // these edges lists a course before what it requires. Reversed, it reads the
  // way a curriculum does.
  const ordered = topoOrder(objectIds, edges);
  return ordered ? ordered.reverse() : objectIds;
}

/** The courses this learner has finished. One indexed read, used by the gate. */
async function completedCourseIds(db: Db, tenantId: number, learnerRef: string): Promise<Set<number>> {
  const rows = await db.select({ courseId: courseEnrollments.courseId })
    .from(courseEnrollments)
    .where(scopedToTenant(courseEnrollments, tenantId, and(
      eq(courseEnrollments.learnerRef, learnerRef),
      eq(courseEnrollments.status, 'completed'),
    ))!);
  return new Set(rows.map((r) => r.courseId).filter((id): id is number => id !== null));
}

async function titlesForObjects(
  db: Db, tenantId: number, objectIds: string[],
): Promise<Map<string, { courseId: number; title: string }>> {
  if (objectIds.length === 0) return new Map();
  const rows = await db.select({ id: courses.id, objectId: courses.objectId, title: courses.title })
    .from(courses)
    .where(scopedToTenant(courses, tenantId, inArray(courses.objectId, objectIds))!);
  return new Map(rows
    .filter((r): r is typeof r & { objectId: string } => r.objectId !== null)
    .map((r) => [r.objectId, { courseId: r.id, title: r.title }]));
}

// ---------------------------------------------------------------------------
// The id-shaped facade the HTTP surface uses.
//
// Everything above takes OBJECT ids, because that is what an edge endpoint is.
// A caller holds `courses.id`, and translating between the two at every route
// handler would put the same two-line lookup — and the same three ways of
// getting it wrong — into six places. These four are that translation, once.
// ---------------------------------------------------------------------------

export type PrerequisiteIdRefusal =
  | PrerequisiteRefusal
  | { ok: false; reason: 'unknown_course'; detail: string };

/** `courses.id` → its registry object id, for courses in this workspace only. */
async function objectIdsFor(
  db: Db, tenantId: number, ids: number[],
): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: courses.id, objectId: courses.objectId })
    .from(courses)
    .where(scopedToTenant(courses, tenantId, inArray(courses.id, ids))!);
  return new Map(rows
    .filter((r): r is typeof r & { objectId: string } => r.objectId !== null)
    .map((r) => [r.id, r.objectId]));
}

export async function addPrerequisiteByCourseId(
  db: Db, env: Env, tenantId: number, courseId: number, prerequisiteId: number,
): Promise<{ ok: true } | PrerequisiteIdRefusal> {
  if (courseId === prerequisiteId) {
    return { ok: false, reason: 'would_cycle', detail: 'a course cannot be its own prerequisite' };
  }
  const objectIds = await objectIdsFor(db, tenantId, [courseId, prerequisiteId]);
  const from = objectIds.get(courseId);
  const to = objectIds.get(prerequisiteId);
  if (!from || !to) {
    return { ok: false, reason: 'unknown_course', detail: 'both ids must be courses in this workspace' };
  }
  return addPrerequisite(db, env, tenantId, from, to);
}

export async function removePrerequisiteByCourseId(
  db: Db, env: Env, tenantId: number, courseId: number, prerequisiteId: number,
): Promise<boolean> {
  const objectIds = await objectIdsFor(db, tenantId, [courseId, prerequisiteId]);
  const from = objectIds.get(courseId);
  const to = objectIds.get(prerequisiteId);
  if (!from || !to) return false;
  return removePrerequisite(db, env, tenantId, from, to);
}

export async function prerequisitesOfCourseId(
  db: Db, env: Env, tenantId: number, courseId: number,
): Promise<Array<{ courseId: number; objectId: string; title: string }> | null> {
  const objectIds = await objectIdsFor(db, tenantId, [courseId]);
  const from = objectIds.get(courseId);
  if (!from) return null;
  return prerequisitesOf(db, env, tenantId, from);
}

/**
 * Every course in the workspace with this learner's lock state on it.
 *
 * The whole catalogue in one call, because that is how it is rendered: a course
 * list showing which are open is one gate computation over one edge load, and
 * asking per card is the N+1 {@link gateCourses} exists to avoid. Courses that
 * were never registered as objects cannot carry an edge and are therefore always
 * unlocked — they are included rather than hidden, since a missing registration
 * is our bug and must not remove a course from a learner's catalogue.
 */
export async function gatesForLearner(
  db: Db, env: Env, tenantId: number, learnerRef: string,
): Promise<CourseGate[]> {
  const all = await listCourses(db, tenantId);
  const registered = all.filter((c): c is typeof c & { objectId: string } => c.objectId !== null);

  const [gated, sequence] = await Promise.all([
    gateCourses(db, env, {
      tenantId,
      learnerRef,
      courses: registered.map((c) => ({ courseId: c.id, objectId: c.objectId, title: c.title })),
    }),
    // The order a curriculum is meant to be TAKEN in, which is the order a
    // catalogue showing locks should read in: a course listed above the one it
    // requires is a list that argues with its own badges. Alphabetical is what
    // `listCourses` gives, and it is the right default only where no edges exist —
    // `sequenceCourses` returns exactly that when the graph is empty.
    sequenceCourses(db, tenantId, registered.map((c) => c.objectId)),
  ]);

  const byId = new Map(gated.map((g) => [g.courseId, g]));
  const rank = new Map(sequence.map((objectId, index) => [objectId, index]));
  const fallback = (course: typeof all[number]): CourseGate => ({
    courseId: course.id, objectId: '', title: course.title, unlocked: true, blockedBy: [],
  });

  // Unregistered courses cannot carry an edge and so have no rank. They sort last
  // rather than being hidden — a missing registration is our bug, and it must not
  // remove a course from a learner's catalogue.
  return [...all]
    .sort((a, b) => (rank.get(a.objectId ?? '') ?? Number.MAX_SAFE_INTEGER)
      - (rank.get(b.objectId ?? '') ?? Number.MAX_SAFE_INTEGER))
    .map((c) => byId.get(c.id) ?? fallback(c));
}
