/**
 * THE MODERATION QUEUE — deciding what a review published about a named third
 * party is allowed to say.
 *
 * ── WHY THIS EXISTS AT ALL ───────────────────────────────────────────────────
 * An employer review is a user-authored factual claim about a REAL, NAMED
 * organisation that never agreed to be described. That is a different risk from
 * every other annotation on this platform — a comment on your own ticket, a
 * rating of a template you installed — and it is why migration 1106 gave
 * `annotations` a `status` at all. The operator decision (2026-08-22) is
 * pending-until-approved.
 *
 * ── WHY A SEPARATE MODULE FROM `objectReviews` ───────────────────────────────
 * One reason to change each. `objectReviews` is the author's path: submit, edit,
 * withdraw, read what is public. This is the reviewer's: a cross-subject queue,
 * an approve, a reject with a reason. They share a table and nothing else — the
 * queue does not care what a sub-rating is, and the author's path must never be
 * able to set its own status.
 *
 * ── A REJECTION IS KEPT, NOT DELETED ─────────────────────────────────────────
 * The source product's table says why: "Excluded reviews are still stored so
 * authors see why they're hidden but never appear on public lists / aggregates."
 * A review that vanishes silently reads as a bug in submission and gets
 * re-submitted; one that says "rejected, because…" does not. The reason goes in
 * `anchor.moderation`, beside the review rather than in a second table.
 */

import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { annotations, objects } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { invalidateObject } from '../kernel/ObjectRegistry';
import { recordActivity, SYSTEM_ACTOR } from '../activity/activityLog';
import { RATING_KIND, type ReviewStatus } from './objectReviews';

/** The verb a moderation decision is filed under. Every decision is auditable
 *  because "who approved this claim about a named company" is a question that
 *  gets asked exactly once, under pressure, and must have an answer. */
export const MODERATION_VERB = 'review.moderated';

export interface PendingReview {
  id: number;
  objectId: string;
  /** What is being reviewed, resolved from the registry — a queue of opaque
   *  UUIDs is a queue nobody can work. */
  subjectKind: string;
  subjectTitle: string;
  authorRef: string | null;
  authorName: string | null;
  rating: number;
  title: string;
  body: string;
  status: ReviewStatus;
  submittedAt: string;
}

/**
 * Everything awaiting a decision in one workspace, oldest first.
 *
 * Oldest first, deliberately: a queue worked newest-first starves its tail, and
 * the tail is where the review somebody has been waiting a fortnight on sits.
 *
 * One join to the registry rather than N lookups — the queue is a list and
 * resolving each subject separately is the N+1 that makes a moderation page slow
 * exactly when there is a backlog.
 */
export async function pendingReviews(
  db: Db, tenantId: number, limit = 50,
): Promise<PendingReview[]> {
  const rows = await db.select({
    id: annotations.id,
    objectId: annotations.objectId,
    authorRef: annotations.authorRef,
    authorName: annotations.authorName,
    value: annotations.value,
    label: annotations.label,
    body: annotations.body,
    status: annotations.status,
    createdAt: annotations.createdAt,
    subjectKind: objects.kind,
    subjectTitle: objects.title,
  })
    .from(annotations)
    .innerJoin(objects, eq(objects.id, annotations.objectId))
    .where(scopedToTenant(annotations, tenantId, and(
      eq(annotations.kind, RATING_KIND),
      ne(annotations.status, 'published'),
      isNull(annotations.deletedAt),
    )!))
    .orderBy(annotations.createdAt)
    .limit(Math.min(Math.max(limit, 1), 200));

  return rows.map((row) => ({
    id: Number(row.id),
    objectId: row.objectId,
    subjectKind: row.subjectKind,
    subjectTitle: row.subjectTitle ?? '',
    authorRef: row.authorRef,
    authorName: row.authorName,
    rating: Math.round(Number(row.value ?? 0)),
    title: row.label ?? '',
    body: row.body ?? '',
    status: row.status as ReviewStatus,
    submittedAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
  }));
}

/** How many are waiting. Its own count query so a badge does not have to fetch
 *  and discard the whole queue to render a number. */
export async function pendingReviewCount(db: Db, tenantId: number): Promise<number> {
  const [row] = await db.select({ n: sql<string>`count(*)` })
    .from(annotations)
    .where(scopedToTenant(annotations, tenantId, and(
      eq(annotations.kind, RATING_KIND),
      eq(annotations.status, 'pending'),
      isNull(annotations.deletedAt),
    )!));
  return Number(row?.n ?? 0);
}

/**
 * Approve or reject one review.
 *
 * Returns false when the id is not this tenant's or is not a rating — a
 * moderation endpoint that can flip the status of an arbitrary annotation id is
 * a way to unpublish somebody's comment through the reviews API.
 */
export async function decideReview(
  db: Db, env: Env,
  input: {
    tenantId: number; reviewId: number;
    decision: 'published' | 'rejected';
    reason?: string | null;
    moderatorRef: string;
  },
): Promise<boolean> {
  const [existing] = await db.select({
    id: annotations.id, objectId: annotations.objectId, anchor: annotations.anchor,
    label: annotations.label, authorRef: annotations.authorRef,
  })
    .from(annotations)
    .where(scopedToTenant(annotations, input.tenantId, and(
      eq(annotations.id, input.reviewId),
      eq(annotations.kind, RATING_KIND),
      isNull(annotations.deletedAt),
    )!))
    .limit(1);
  if (!existing) return false;

  const anchor = {
    ...((existing.anchor ?? {}) as Record<string, unknown>),
    moderation: {
      decision: input.decision,
      reason: input.reason ?? null,
      by: input.moderatorRef,
      at: new Date().toISOString(),
    },
  };

  await db.update(annotations)
    .set({ status: input.decision, anchor: anchor as never, updatedAt: new Date() })
    .where(scopedToTenant(annotations, input.tenantId, eq(annotations.id, input.reviewId)));

  await invalidateObject(env, input.tenantId, existing.objectId);

  await recordActivity(env, db, {
    tenantId: input.tenantId,
    actor: SYSTEM_ACTOR,
    verb: MODERATION_VERB,
    targetType: 'review',
    targetId: String(input.reviewId),
    targetLabel: existing.label ?? '',
    summary: input.decision === 'published'
      ? `Review approved${input.reason ? `: ${input.reason}` : ''}`
      : `Review rejected${input.reason ? `: ${input.reason}` : ''}`,
    metadata: {
      decision: input.decision,
      reason: input.reason ?? null,
      moderatorRef: input.moderatorRef,
      objectId: existing.objectId,
      authorRef: existing.authorRef,
    },
  });

  return true;
}

/** The moderation verdict on one review, for the author's own view of it. */
export function moderationNote(anchor: unknown): { decision: string; reason: string | null; at: string } | null {
  const note = (anchor as { moderation?: { decision?: string; reason?: string | null; at?: string } } | null)?.moderation;
  if (!note?.decision) return null;
  return { decision: note.decision, reason: note.reason ?? null, at: note.at ?? '' };
}
