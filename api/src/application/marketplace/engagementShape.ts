/**
 * What SHAPE an engagement was hired under — the single writer for
 * `freelancer_engagements.engagement_type`.
 *
 * ── WHY THIS MODULE EXISTS AT ALL ────────────────────────────────────────────────
 * The shape is also on `job_postings.engagement_type`, so this column is a copy, and
 * migration 0930 argues why: the direct-hire path (`POST /api/engagements`) takes no
 * job, so for those rows there is nothing to join back to and the question is otherwise
 * unanswerable. The 3NF rule permits a denormalisation with a written reason AND a
 * single writer. This module is that single writer — the reason is in the migration,
 * and the enforcement is that `engagementType` is set from `hireShape()` on the two
 * creation paths and nowhere else.
 *
 * ── WHY THE VALUE IS FROZEN AT HIRE ─────────────────────────────────────────────
 * It records what somebody was hired AS, not what the posting says today. Repointing it
 * later — by re-reading a posting that has since been edited — would retroactively
 * change whether work that has already been done was authorised, which is the one thing
 * a gate must never do.
 */

/** The vocabulary, shared with `job_postings.engagement_type` (0293) so the two are
 *  comparable without a mapping table that would be a third place the shape is stated. */
export const ENGAGEMENT_SHAPES = ['fixed_bid', 'hourly', 'fte'] as const;

export type EngagementShape = typeof ENGAGEMENT_SHAPES[number];

/**
 * Normalise a claimed shape, or null when nothing was stated.
 *
 * Null is a real answer and not a failure: engagements created before 0930 have no
 * recorded shape, and the gate reads "not stated" as not-fixed-price — which is exactly
 * how those rows behaved before the column existed, so applying the migration changes
 * nothing about them.
 */
export function hireShape(value: unknown): EngagementShape | null {
  const text = String(value ?? '').trim().toLowerCase();
  return (ENGAGEMENT_SHAPES as readonly string[]).includes(text) ? (text as EngagementShape) : null;
}

/**
 * Is escrow the thing that governs this engagement?
 *
 * One predicate rather than `=== 'fixed_bid'` written at each call site: the work gate,
 * the schedule view and any future surface that decides whether to show escrow all ask
 * the same question, and three spellings of it is how one of them comes to disagree the
 * day a fourth shape is added.
 */
export function isEscrowGoverned(shape: unknown): boolean {
  return hireShape(shape) === 'fixed_bid';
}
