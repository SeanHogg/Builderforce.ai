/**
 * Validator-review run marker — the ONE place the "this run is a Validator acceptance
 * review, not real work" signal is defined, so the dispatcher that stamps it and the
 * runtime that must treat it as NON-MUTATING agree without an import cycle.
 *
 * A Validator review runs AGAINST an already-Done ticket to record a review verdict
 * (and mint GAP tickets); it must NOT move the ticket's lane when it completes.
 * Without this guard, a review run completing on a Done ticket falls through the
 * normal COMPLETED→next-lane path and knocks the ticket back to in_review — which then
 * re-triggers a review, i.e. the completion loop that kept the on-Done fast trigger
 * off. The runtime checks {@link isValidatorReviewPayload} and skips the status
 * transition + lane chaining for these runs.
 */

/** Distinct lane key stamped on a Validator review dispatch (never a real board lane). */
export const VALIDATOR_REVIEW_LANE_KEY = '__validator_review__';

/** True when an execution payload marks it as a Validator acceptance review. */
export function isValidatorReviewPayload(payload: string | null | undefined): boolean {
  if (!payload) return false;
  try {
    const obj = JSON.parse(payload) as { laneKey?: unknown; validatorReview?: unknown };
    return obj.validatorReview === true || obj.laneKey === VALIDATOR_REVIEW_LANE_KEY;
  } catch {
    return false;
  }
}
