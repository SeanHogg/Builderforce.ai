/**
 * REVIEWS — a rating with a body, on anything the object registry knows about.
 *
 * ── WHY THERE IS NO `reviews` TABLE, AND WHY THAT IS AN UPGRADE ──────────────
 * The source product's `reviews` was polymorphic the hard way: a
 * `(subject_type varchar, subject_id uuid)` pair with, in its own words, "NOT a
 * real FK — the target table varies per subjectType. The route layer enforces
 * that `subject_id` actually exists in the table the descriptor names." So
 * referential integrity was a convention held by whichever route remembered it,
 * and a review of a deleted company simply stayed there pointing at nothing.
 *
 * This platform already solved that: `objects` IS the polymorphic key, and
 * `annotations.object_id` is a real foreign key into it with `ON DELETE CASCADE`.
 * A review is an `annotations` row — `kind='rating'`, `value` = the score,
 * `label` = the headline, `body` = the prose — and it inherits threading (replies
 * are `parentId`), soft delete, and the moderation state migration 1106 added.
 *
 * ── THIS MODULE IS SUBJECT-AGNOSTIC ON PURPOSE ───────────────────────────────
 * Employer reviews are the reason it exists, and it does not mention employers.
 * The source product's descriptor registry covered companies, marketplace
 * services, voice clones and promo projects; here a new reviewable thing is an
 * object KIND that already exists, so it needs no code at all. That is the
 * open/closed rule as data rather than as branches.
 *
 * ── ONE REVIEW PER PERSON, AND THE DATABASE SAYS SO ──────────────────────────
 * Migration 1110 carries the partial unique index. {@link submitReview} upserts
 * onto it rather than reading first: two concurrent submits both read "none" and
 * both insert, which is how a rating average gets quietly stuffed.
 *
 * ── SUB-RATINGS AND METADATA LIVE IN `anchor` ────────────────────────────────
 * They vary per subject — culture/leadership for an employer, quality/value for
 * a service — so they are validated JSON, not columns. `anchor` is the
 * annotation's existing "where/what this refers to" bag; nothing new is added to
 * the table for a shape that changes per subject.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { annotations } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { invalidateObject } from '../kernel/ObjectRegistry';

export const RATING_KIND = 'rating';

/** 'published' — visible. 'pending' — awaiting a decision. 'rejected' — refused,
 *  and still stored so the author can be told why rather than left wondering. */
export type ReviewStatus = 'published' | 'pending' | 'rejected';

/** The bounds every score on this platform is held to. Stated once so the
 *  writer, the aggregate and the UI cannot disagree about what 5 means. */
export const RATING_MIN = 1;
export const RATING_MAX = 5;

export interface ReviewAnchor {
  /** Per-axis scores — `{ culture: 4, leadership: 5 }`. Keys are the subject's
   *  business, not this module's. */
  subRatings?: Record<string, number>;
  /** Subject-specific free text — `{ pros, cons, advice, jobTitle }`. */
  metadata?: Record<string, string>;
  /** Set by the CALLER from something it verified (an email domain, a completed
   *  purchase). Never accepted from a request body — see `submitReview`. */
  verifiedAs?: string;
}

export interface ObjectReview {
  id: number;
  objectId: string;
  authorRef: string | null;
  authorName: string | null;
  rating: number;
  title: string;
  body: string;
  status: ReviewStatus;
  verifiedAs: string | null;
  subRatings: Record<string, number>;
  metadata: Record<string, string>;
  createdAt: string;
}

export interface RatingSummary {
  count: number;
  /** Mean of published ratings, to one decimal. Null when there are none —
   *  distinct from 0, which would render as "rated zero out of five". */
  average: number | null;
  /** How many reviews sit at each score, 1..5. The shape a histogram needs, and
   *  the shape that shows an average of 4.2 built from forty 5s and ten 1s. */
  distribution: Record<number, number>;
}

export type ReviewRefusal =
  | { ok: false; reason: 'rating_out_of_range'; detail: string }
  | { ok: false; reason: 'title_required' };

/**
 * Write (or replace) one person's review of one object.
 *
 * `moderated` decides whether it lands visible. It is a PARAMETER rather than a
 * per-subject lookup because the policy belongs to the caller: a review of a
 * NAMED third-party employer publishes claims about somebody who did not consent
 * and is held pending (operator decision, 2026-08-22), while a rating of a
 * template in this workspace's own catalogue is not that.
 *
 * `verifiedAs` is taken from the trusted argument, never from the anchor a
 * client sent — a request that can set its own verification badge is a request
 * that can award itself one.
 */
export async function submitReview(
  db: Db, env: Env,
  input: {
    tenantId: number; objectId: string;
    authorRef: string; authorName?: string | null;
    rating: number; title: string; body?: string | null;
    subRatings?: Record<string, number>;
    metadata?: Record<string, string>;
    verifiedAs?: string | null;
    moderated: boolean;
  },
): Promise<{ ok: true; review: ObjectReview } | ReviewRefusal> {
  if (!Number.isFinite(input.rating) || input.rating < RATING_MIN || input.rating > RATING_MAX) {
    return { ok: false, reason: 'rating_out_of_range', detail: `rating must be ${RATING_MIN}–${RATING_MAX}` };
  }
  const title = input.title.trim();
  if (!title) return { ok: false, reason: 'title_required' };

  const anchor: ReviewAnchor = {
    ...(input.subRatings ? { subRatings: clampAxes(input.subRatings) } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    ...(input.verifiedAs ? { verifiedAs: input.verifiedAs } : {}),
  };

  const status: ReviewStatus = input.moderated ? 'pending' : 'published';

  const [row] = await db.insert(annotations).values({
    tenantId: input.tenantId,
    objectId: input.objectId,
    kind: RATING_KIND,
    authorKind: 'user',
    authorRef: input.authorRef,
    authorName: input.authorName ?? null,
    body: input.body ?? null,
    value: String(input.rating),
    label: title.slice(0, 120),
    anchor: anchor as never,
    status,
  }).onConflictDoUpdate({
    // The partial unique index from 1110. A re-submit REPLACES — the source
    // product's rule, and the right one: an edited opinion is not a second one.
    target: [annotations.objectId, annotations.authorRef],
    targetWhere: sql`kind = ${RATING_KIND} and deleted_at is null and author_ref is not null`,
    set: {
      body: input.body ?? null,
      value: String(input.rating),
      label: title.slice(0, 120),
      anchor: anchor as never,
      // An EDIT re-enters moderation. Publishing an approved review and then
      // rewriting its body into something else is the obvious way around a
      // moderation queue, and it only has to work once.
      status,
      updatedAt: new Date(),
    },
  }).returning();

  if (!row) throw new Error('review was not written');
  await invalidateObject(env, input.tenantId, input.objectId);
  return { ok: true, review: toReview(row) };
}

/** Withdraw a review. Soft delete, so the unique slot is freed (1110's predicate)
 *  and the person can review the subject again later. */
export async function withdrawReview(
  db: Db, env: Env, tenantId: number, objectId: string, authorRef: string,
): Promise<boolean> {
  const removed = await db.update(annotations)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(scopedToTenant(annotations, tenantId, and(
      eq(annotations.objectId, objectId),
      eq(annotations.kind, RATING_KIND),
      eq(annotations.authorRef, authorRef),
      isNull(annotations.deletedAt),
    )!))
    .returning({ id: annotations.id });

  if (removed.length === 0) return false;
  await invalidateObject(env, tenantId, objectId);
  return true;
}

/** The reviews a visitor may see. Published only — `pending` and `rejected` are
 *  the moderation queue's business, and leaking them here would defeat the whole
 *  point of holding them. */
export async function listPublishedReviews(
  db: Db, tenantId: number, objectId: string, limit = 50,
): Promise<ObjectReview[]> {
  const rows = await db.select()
    .from(annotations)
    .where(scopedToTenant(annotations, tenantId, and(
      eq(annotations.objectId, objectId),
      eq(annotations.kind, RATING_KIND),
      eq(annotations.status, 'published'),
      isNull(annotations.deletedAt),
    )!))
    .orderBy(sql`${annotations.createdAt} desc`)
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map(toReview);
}

/** One person's own review, whatever its state — so the form can be pre-filled
 *  and a pending or rejected author can see what happened to theirs. */
export async function myReview(
  db: Db, tenantId: number, objectId: string, authorRef: string,
): Promise<ObjectReview | null> {
  const [row] = await db.select()
    .from(annotations)
    .where(scopedToTenant(annotations, tenantId, and(
      eq(annotations.objectId, objectId),
      eq(annotations.kind, RATING_KIND),
      eq(annotations.authorRef, authorRef),
      isNull(annotations.deletedAt),
    )!))
    .limit(1);
  return row ? toReview(row) : null;
}

/**
 * Count, mean and distribution for one subject — computed in the DATABASE.
 *
 * Pulling every review to average them in the isolate is the shape that works
 * for the first employer with four reviews and falls over on the one with four
 * thousand. The partial index from 1110 covers `(object_id, value)` for exactly
 * this query.
 */
export async function ratingSummary(
  db: Db, tenantId: number, objectId: string,
): Promise<RatingSummary> {
  const rows = await db.select({
    value: annotations.value,
    n: sql<string>`count(*)`,
  })
    .from(annotations)
    .where(scopedToTenant(annotations, tenantId, and(
      eq(annotations.objectId, objectId),
      eq(annotations.kind, RATING_KIND),
      eq(annotations.status, 'published'),
      isNull(annotations.deletedAt),
    )!))
    .groupBy(annotations.value);

  return summarise(rows.map((r) => ({ score: Math.round(Number(r.value ?? 0)), n: Number(r.n) })));
}

/** The count/mean/distribution arithmetic, separated from the query so it is
 *  testable without a database and shared by the per-subject and bulk paths. */
export function summarise(buckets: Array<{ score: number; n: number }>): RatingSummary {
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let count = 0;
  let total = 0;

  for (const { score, n } of buckets) {
    if (score < RATING_MIN || score > RATING_MAX || n <= 0) continue;
    distribution[score] = (distribution[score] ?? 0) + n;
    count += n;
    total += score * n;
  }

  return { count, average: count === 0 ? null : Math.round((total / count) * 10) / 10, distribution };
}

/** Axis scores are held to the same 1–5 bounds as the headline, and an axis with
 *  a nonsense value is DROPPED rather than clamped: clamping 900 to 5 invents a
 *  perfect score somebody did not give. */
function clampAxes(axes: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(axes).filter(([, v]) => Number.isFinite(v) && v >= RATING_MIN && v <= RATING_MAX),
  );
}

function toReview(row: typeof annotations.$inferSelect): ObjectReview {
  const anchor = (row.anchor ?? {}) as ReviewAnchor;
  return {
    id: Number(row.id),
    objectId: row.objectId,
    authorRef: row.authorRef,
    authorName: row.authorName,
    rating: Math.round(Number(row.value ?? 0)),
    title: row.label ?? '',
    body: row.body ?? '',
    status: row.status as ReviewStatus,
    verifiedAs: anchor.verifiedAs ?? null,
    subRatings: anchor.subRatings ?? {},
    metadata: anchor.metadata ?? {},
    createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
  };
}
