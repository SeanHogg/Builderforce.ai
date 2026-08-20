/**
 * How much a recorded sign-off is actually WORTH as evidence. PURE.
 *
 * `ticket_role_signoffs.contribution` is a jsonb bag, and two different questions are
 * asked of it in three different places: "is anything linked to this approval at all?"
 * (the rubber-stamp audit) and "did a member judge this, or did the platform credit it
 * from a finished run?" (`autoAttested`, written by `attestRoleRun`). Both were answered
 * by ad-hoc object inspection, and one of them was answered WRONG: a bag containing
 * nothing but `autoAttested: true` counted as linked evidence, so the flag that marks an
 * approval as unjudged was itself satisfying the rubber-stamp check.
 *
 * The two predicates live here so the audit, the lifecycle ledger and the wire types all
 * read the same bag the same way.
 */

/** The `contribution` bag as any reader sees it: unknown-shaped jsonb. */
export type SignoffContributionBag = Record<string, unknown> | null | undefined;

/**
 * Keys that describe HOW the record was made rather than WHAT was linked.
 *
 * They must never count as contribution evidence — see the module header for the check
 * that `autoAttested` was quietly satisfying.
 */
const PROVENANCE_KEYS: ReadonlySet<string> = new Set(['autoAttested']);

/** True when the sign-off links at least one real piece of evidence (execution, PR,
 *  diff, review thread, tool run, PRD revision) — provenance flags excluded. */
export function hasLinkedEvidence(contribution: SignoffContributionBag): boolean {
  if (!contribution || typeof contribution !== 'object') return false;
  return Object.entries(contribution).some(([k, v]) =>
    !PROVENANCE_KEYS.has(k) && v != null && (!Array.isArray(v) || v.length > 0));
}

/**
 * True when the PLATFORM credited this record from a completed run rather than a member
 * recording a considered verdict (`attestRoleRun`'s `credited` outcome).
 *
 * A legitimate accountability record — it always carries the execution it was derived
 * from — but not a review. Every reader auditing "who actually judged this?" needs the
 * distinction, which is why it is flagged rather than hidden.
 */
export function isAutoAttestedContribution(contribution: SignoffContributionBag): boolean {
  return !!contribution && typeof contribution === 'object'
    && (contribution as { autoAttested?: unknown }).autoAttested === true;
}
