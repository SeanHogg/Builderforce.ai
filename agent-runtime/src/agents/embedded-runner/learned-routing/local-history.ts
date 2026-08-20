/**
 * Learned Model Routing (PRD 13) — this host's own outcome history.
 *
 * A bounded, in-process ring of the terminal outcomes THIS host produced. It is the
 * input to {@link computeLocalBias} and nothing else: it never leaves the process,
 * is never read by the api, and holds no prompt text — only (model, action, outcome,
 * when). The durable copy of the same fact is the row the api writes from the
 * run-outcome report; this is the local read model, kept because the host cannot
 * query that table and would otherwise have to pay a round-trip to learn what it
 * itself just did.
 *
 * In-memory ON PURPOSE. A self-hosted host is a long-running daemon, so the ring
 * covers the sessions that matter; a restart costs the nudge, not correctness — the
 * fleet ranking is unaffected and the bias simply returns to neutral until the host
 * has watched a few runs again. Persisting it would buy little and add a file to
 * corrupt, lock and migrate.
 */

import type { LocalOutcome } from "./local-bias.js";

/** Ring capacity. Comfortably larger than {@link LOCAL_WINDOW_MS}'s worth of runs for
 *  a busy host, small enough that the whole thing is a rounding error in memory. */
export const HISTORY_CAPACITY = 500;

const ring: LocalOutcome[] = [];

/** Record one terminal outcome. Silently ignores an entry with no model — an outcome
 *  that cannot name a model teaches nothing and would only dilute the tally. */
export function recordLocalOutcome(outcome: LocalOutcome): void {
  if (!outcome.model) {
    return;
  }
  ring.push(outcome);
  if (ring.length > HISTORY_CAPACITY) {
    ring.splice(0, ring.length - HISTORY_CAPACITY);
  }
}

/** The current history, oldest-first. A copy: callers must not mutate the ring. */
export function readLocalOutcomes(): readonly LocalOutcome[] {
  return ring.slice();
}

/** Drop everything. For tests and for an explicit operator reset. */
export function clearLocalOutcomes(): void {
  ring.length = 0;
}
