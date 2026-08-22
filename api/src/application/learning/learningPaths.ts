/**
 * LEARNING PATHS — a curated sequence of courses.
 *
 * ── A PATH IS A COURSE, AND THAT IS THE WHOLE DESIGN ─────────────────────────
 * `courses.kind` is `'course'` or `'path'` (migration 1112). The source product
 * had `learning_paths` beside `courses` with the same columns — slug, title,
 * summary, status, published_at, author_ref, price — and then needed
 * `learning_path_enrollments` beside `course_enrollments` to go with it.
 *
 * Folding the two together is not a saving of one table. It is what makes a path
 * enrollable, certifiable and sellable for nothing: `course_enrollments`,
 * `course_certificates` and `course_checkouts` all key on `course_id`, so a path
 * that IS a course row inherits every one of them. The thing that genuinely
 * differs — what it contains — is an edge, not a column.
 *
 * ── MEMBERSHIP AND PREREQUISITES ARE THE SAME PRIMITIVE ──────────────────────
 * Both are `relations` edges (`ObjectRelations`), which is what that table shipped
 * for. `contains` is the ordered display sequence; `depends_on` is the DAG that
 * decides what a learner may START. The source product kept these apart on
 * purpose and its header says why — "ordered display sequence (not unlock order
 * — that comes from the DAG)" — and they stay apart here for the same reason: a
 * path's author chooses the order it READS in, and the prerequisite graph decides
 * the order it may be TAKEN in. Conflating them makes one of the two a lie.
 *
 * This module owns paths. Progress over a path lives in `pathProgress.ts` and
 * prerequisite gating in `coursePrerequisites.ts`, because a path that cannot be
 * created is a different failure from a path a learner cannot advance through.
 */

import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { courses } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { registerObject } from '../kernel/ObjectRegistry';
import {
  countRelatedFrom,
  listRelatedFrom,
  listRelatedTo,
  setOrderedMembers,
  type RelationRefusal,
} from '../kernel/ObjectRelations';

/** The two things a `courses` row can be. */
export const COURSE_KINDS = ['course', 'path'] as const;
export type CourseKind = (typeof COURSE_KINDS)[number];

/** The registry kind. Both spellings register as `course` deliberately: the
 *  registry addresses a navigable THING, and a path is a course-shaped one —
 *  `courses.kind` is what tells them apart, in the one place that owns it. */
export const COURSE_OBJECT_KIND = 'course';

/** 'draft' — invisible to learners. 'published' — enrollable. 'retired' — kept
 *  for the people already in it, hidden from everyone else. */
export type CourseStatus = 'draft' | 'published' | 'retired';

export interface CourseSummary {
  id: number;
  objectId: string | null;
  kind: CourseKind;
  slug: string;
  title: string;
  summary: string | null;
  level: string | null;
  durationMin: number | null;
  status: CourseStatus;
  priceCents: number | null;
  currency: string | null;
  publishedAt: string | null;
}

export interface PathSummary extends CourseSummary {
  /** How many courses it sequences. Counted in ONE grouped query for the whole
   *  listing — asking per row is the N+1 a directory page always grows. */
  courseCount: number;
}

export interface PathDetail extends CourseSummary {
  courses: CourseSummary[];
}

export type PathRefusal =
  | RelationRefusal
  | { ok: false; reason: 'slug_taken'; detail: string }
  | { ok: false; reason: 'not_a_path'; detail: string };

const pathsCacheKey = (tenantId: number) => `learning:paths:${tenantId}`;
const pathCacheKey = (tenantId: number, id: number) => `learning:path:${tenantId}:${id}`;

/**
 * Create a path.
 *
 * `slug` is unique per tenant across BOTH kinds, which the existing
 * `uq_courses_slug` already enforces — and correctly: a path and a course cannot
 * share a URL, because a URL resolves to one of them.
 */
export async function createPath(
  db: Db, env: Env,
  input: {
    tenantId: number; slug: string; title: string;
    summary?: string | null; level?: string | null; authorRef?: string | null;
  },
): Promise<{ ok: true; path: PathSummary } | PathRefusal> {
  const slug = normaliseSlug(input.slug);
  if (!slug) return { ok: false, reason: 'slug_taken', detail: 'a path needs a url-safe slug' };

  const [existing] = await db.select({ id: courses.id })
    .from(courses)
    .where(scopedToTenant(courses, input.tenantId, eq(courses.slug, slug))!)
    .limit(1);
  if (existing) return { ok: false, reason: 'slug_taken', detail: `"${slug}" is already in use` };

  const [row] = await db.insert(courses).values({
    tenantId: input.tenantId,
    kind: 'path',
    slug,
    title: input.title.trim().slice(0, 300),
    summary: input.summary ?? null,
    level: input.level ?? null,
    authorRef: input.authorRef ?? null,
  }).returning();
  if (!row) throw new Error('createPath: no row returned');

  // Registered so it can be an edge endpoint at all — `relations` takes object
  // ids, not table ids, which is what stops an edge outliving its target.
  const object = await registerObject(db, env, {
    tenantId: input.tenantId, kind: COURSE_OBJECT_KIND, refId: row.id, domain: 'people', title: row.title,
  });
  await db.update(courses).set({ objectId: object.id }).where(eq(courses.id, row.id));
  await invalidateCached(env, pathsCacheKey(input.tenantId));

  return { ok: true, path: { ...toSummary({ ...row, objectId: object.id }), courseCount: 0 } };
}

/** Every path in the workspace, newest first, with its member count. Cached —
 *  a catalogue changes when somebody edits it, and every writer here drops it. */
export async function listPaths(db: Db, env: Env, tenantId: number): Promise<PathSummary[]> {
  return getOrSetCached(env, pathsCacheKey(tenantId), async () => {
    const rows = await db.select()
      .from(courses)
      .where(scopedToTenant(courses, tenantId, eq(courses.kind, 'path'))!)
      .orderBy(asc(courses.title))
      .limit(200);

    const objectIds = rows.map((r) => r.objectId).filter((id): id is string => id !== null);
    const counts = await countRelatedFrom(db, tenantId, objectIds, 'contains');
    return rows.map((row) => ({
      ...toSummary(row),
      courseCount: row.objectId ? counts.get(row.objectId) ?? 0 : 0,
    }));
  }, { kvTtlSeconds: 120 });
}

/** One path with its courses in author order. */
export async function getPath(db: Db, env: Env, tenantId: number, id: number): Promise<PathDetail | null> {
  return getOrSetCached(env, pathCacheKey(tenantId, id), async () => {
    const row = await loadCourse(db, tenantId, id);
    if (!row || row.kind !== 'path' || !row.objectId) return null;

    const members = await listRelatedFrom(db, env, tenantId, row.objectId, 'contains');
    const refs = members.map((m) => Number(m.refId)).filter((n) => Number.isFinite(n));
    const memberRows = refs.length === 0 ? [] : await db.select()
      .from(courses)
      .where(scopedToTenant(courses, tenantId, inArray(courses.id, refs))!);

    // Reordered to the EDGE's order, not the database's: `position` is the fact
    // the author set, and an `IN (…)` returns rows in whatever order it likes.
    const byId = new Map(memberRows.map((c) => [c.id, c]));
    return {
      ...toSummary(row),
      courses: refs.map((ref) => byId.get(ref)).filter((c): c is typeof memberRows[number] => Boolean(c)).map(toSummary),
    };
  }, { kvTtlSeconds: 120 });
}

/**
 * Replace a path's courses with exactly this sequence.
 *
 * Whole-list rather than add/remove/move: the client holds the order the author
 * just dragged into place, and three endpoints that each mutate one edge is how
 * two people reordering at once produce an order neither of them chose.
 */
export async function setPathCourses(
  db: Db, env: Env, tenantId: number, pathId: number, courseIds: number[],
): Promise<{ ok: true; count: number } | PathRefusal> {
  const path = await loadCourse(db, tenantId, pathId);
  if (!path || path.kind !== 'path' || !path.objectId) {
    return { ok: false, reason: 'not_a_path', detail: 'that id is not a learning path in this workspace' };
  }

  const memberRows = courseIds.length === 0 ? [] : await db.select({ id: courses.id, objectId: courses.objectId })
    .from(courses)
    .where(scopedToTenant(courses, tenantId, and(inArray(courses.id, courseIds), eq(courses.kind, 'course')))!);

  const byId = new Map(memberRows.map((r) => [r.id, r.objectId]));
  const ordered = courseIds
    .map((id) => byId.get(id))
    .filter((objectId): objectId is string => Boolean(objectId));

  if (ordered.length !== courseIds.length) {
    // Either an id that is not a course in this workspace, or a course that was
    // never registered. Both are the caller sending something it did not read
    // from us, and both would otherwise fail on a foreign key.
    return { ok: false, reason: 'unknown_object', detail: 'one or more courses are not courses in this workspace' };
  }

  const result = await setOrderedMembers(db, env, {
    tenantId, fromId: path.objectId, kind: 'contains', toIds: ordered,
  });
  if (!result.ok) return result;

  await Promise.all([
    invalidateCached(env, pathCacheKey(tenantId, pathId)),
    invalidateCached(env, pathsCacheKey(tenantId)),
  ]);
  return result;
}

/** Which paths include this course — the reverse edge, for a course page that
 *  wants to say "part of 3 paths". */
export async function pathsContaining(
  db: Db, env: Env, tenantId: number, courseObjectId: string,
): Promise<Array<{ objectId: string; refId: string; title: string | null }>> {
  const rows = await listRelatedTo(db, env, tenantId, courseObjectId, 'contains');
  return rows.map((r) => ({ objectId: r.objectId, refId: r.refId, title: r.title }));
}

/** Publish or retire. Separate from a generic PATCH because it is the one edit
 *  that changes who can SEE the row, and `publishedAt` must be stamped once. */
export async function setPathStatus(
  db: Db, env: Env, tenantId: number, pathId: number, status: CourseStatus,
): Promise<CourseSummary | null> {
  const [row] = await db.update(courses)
    .set({
      status,
      publishedAt: status === 'published' ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(scopedToTenant(courses, tenantId, and(eq(courses.id, pathId), eq(courses.kind, 'path')))!)
    .returning();
  if (!row) return null;

  await Promise.all([
    invalidateCached(env, pathCacheKey(tenantId, pathId)),
    invalidateCached(env, pathsCacheKey(tenantId)),
  ]);
  return toSummary(row);
}

/** One `courses` row of either kind. Shared by every function here so the tenant
 *  predicate is written once. */
export async function loadCourse(db: Db, tenantId: number, id: number) {
  const [row] = await db.select()
    .from(courses)
    .where(scopedToTenant(courses, tenantId, eq(courses.id, id))!)
    .limit(1);
  return row ?? null;
}

/** Every publishable course in the workspace — what a path editor picks from. */
export async function listCourses(db: Db, tenantId: number, limit = 200): Promise<CourseSummary[]> {
  const rows = await db.select()
    .from(courses)
    .where(scopedToTenant(courses, tenantId, eq(courses.kind, 'course'))!)
    .orderBy(asc(courses.title))
    .limit(Math.min(Math.max(limit, 1), 500));
  return rows.map(toSummary);
}

function toSummary(row: typeof courses.$inferSelect): CourseSummary {
  return {
    id: row.id,
    objectId: row.objectId,
    kind: (row.kind === 'path' ? 'path' : 'course'),
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    level: row.level,
    durationMin: row.durationMin,
    status: (row.status as CourseStatus),
    priceCents: row.priceCents,
    currency: row.currency,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
  };
}

/** Lowercase, hyphenated, url-safe. A slug is part of a URL, so it is normalised
 *  at the door rather than trusted and escaped at every render. */
export function normaliseSlug(raw: string): string {
  return raw.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}
