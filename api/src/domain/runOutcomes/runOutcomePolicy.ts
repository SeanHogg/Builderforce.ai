/**
 * Run outcomes — the server's pure decisions (PRD 41 §D1, §12.8). No I/O, no clock.
 *
 *   • {@link labelSupersedes}: which of two rows for the same (run, repository, kind) is kept.
 *     Every writer of `run_outcome_labels` (the sync importer, the label sweep) decides by it.
 *   • {@link crossTenantConsent}: whether a tenant's runs may feed the cross-tenant model.
 */

/**
 * Whether `incoming` replaces `existing` — THE rule shared with the device record
 * (`@builderforce/run-delta/predict` `labelSupersedes`), re-exported so the server and the
 * device can never disagree:
 *
 *   1. No row yet ⇒ write it.
 *   2. A FINAL row is never replaced by a CENSORED one (a closed window cannot reopen).
 *   3. A final row replaces a censored one whatever the clocks say: it knows strictly more.
 *   4. Otherwise (same status) the newer `computedAt` wins; a tie keeps the stored row, so a
 *      replayed write is a no-op.
 *   5. A stored `value: true` (an observed event) is never replaced by null/false; a final row
 *      closing a censored-true one wins, but the writer carries the stored event over
 *      (`runOutcomeStore.carryStoredEvent`).
 */
export { labelSupersedes, type LabelPrecedence } from '@builderforce/run-delta/predict';
import type { LabelPrecedence } from '@builderforce/run-delta/predict';

/**
 * A stored or parsed label row (Date times, null for absent) as what {@link labelSupersedes}
 * decides on: status, `computedAt`, and the observed event (`value`, `eventAt`), so a stored
 * `value: true` is never replaced by null/false.
 */
export function labelPrecedenceOf(row: { status: string; computedAt: Date; value: boolean | null; eventAt: Date | null }): LabelPrecedence {
  return {
    status: row.status as LabelPrecedence['status'],
    computedAt: row.computedAt,
    value: row.value,
    ...(row.eventAt ? { eventAt: row.eventAt.toISOString() } : {}),
  };
}

/**
 * The plan default for cross-tenant training (§12.8): ON for the free plan, OFF for every
 * paid plan. This codebase's plans are `free | pro | teams`; every paid plan takes the
 * enterprise default (off). Read from the SUBSCRIBED plan (`tenants.plan`), not the effective
 * one, so a paid tenant whose billing lapses is never silently opted in. Unknown or missing
 * ⇒ treated as paid (off): the default that cannot leak.
 */
export function crossTenantConsentDefault(plan: string | null | undefined): boolean {
  return plan === 'free';
}

/** A tenant's cross-tenant training consent: its explicit decision, else the plan default. */
export function crossTenantConsent(explicit: boolean | null | undefined, plan: string | null | undefined): boolean {
  return typeof explicit === 'boolean' ? explicit : crossTenantConsentDefault(plan);
}
