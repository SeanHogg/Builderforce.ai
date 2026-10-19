/**
 * Which queued writes may be discarded, and which must not.
 *
 * User work — history, tickets, audits, facts — is durable: overflow never evicts it,
 * and a permanent refusal is a dead letter rather than a silent drop. Telemetry is
 * best-effort and may be dropped.
 */

import type { OutboxRetention } from "./types.js";

/** Canonical user-work kinds. Singular aliases classify the same way. */
export const DURABLE_USER_WORK = ["history", "tickets", "audits", "facts"] as const;

/** Discardable signals. Overflow and a permanent refusal may drop these. */
export const BEST_EFFORT_WORK = ["telemetry"] as const;

export type OutboxWorkKind = (typeof DURABLE_USER_WORK)[number] | (typeof BEST_EFFORT_WORK)[number];

const RETENTION_BY_WORK: Readonly<Record<string, OutboxRetention>> = {
  history: "durable",
  histories: "durable",
  ticket: "durable",
  tickets: "durable",
  audit: "durable",
  audits: "durable",
  fact: "durable",
  facts: "durable",
  telemetry: "best-effort",
};

/**
 * Retention for an enqueue path. Unknown or empty kinds are unclassified — the
 * outbox's own mode decides — so a name this table does not own is not guessed.
 */
export function classifyOutboxWork(work: string | undefined | null): OutboxRetention | undefined {
  if (typeof work !== "string") return undefined;
  const key = work.trim().toLowerCase();
  if (!key) return undefined;
  return RETENTION_BY_WORK[key];
}
