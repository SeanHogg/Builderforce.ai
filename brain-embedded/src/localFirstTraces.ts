/**
 * The timeline step the Brain run loop records when a LOCAL-FIRST turn did not end
 * where it started — an on-device model was tried and the turn fell over to the next
 * attempt (usually the cloud gateway).
 *
 * The served model already reaches the provenance chip as the turn's `resolvedModel`
 * (`local/<runtime>/<model>` for a local answer). What would otherwise be invisible is
 * the fallback itself: "why did this turn go to the cloud when I have Synapse running?"
 * must have an answer in a copied diagnostics report and a reopened chat. Same shape and
 * category as the other `llm.*` self-reports (see `runPolicyTraces.ts`). Pure: the
 * caller stamps `ts`.
 *
 * Attempts are carried as SUMMARIES (`target` + outcome), never as the plan's attempts:
 * those hold the runtime endpoint, and its bearer must never reach a persisted step.
 */

import { GATEWAY_ATTEMPT_TARGET, type LocalFirstAttemptRecord } from '@builderforce/local-inference';
import type { BrainTraceEvent } from './brainTriage';

/** One attempt as a trace may record it — no endpoint, no credential. */
export interface LocalFirstAttemptSummary {
  /** `local/<runtime>/<model>` for a local attempt; `gateway` (or the cloud model) otherwise. */
  target: string;
  outcome: LocalFirstAttemptRecord['outcome'];
  detail?: string;
}

/** Project a runner record onto what a trace may hold. */
export function summarizeLocalFirstAttempt(record: LocalFirstAttemptRecord): LocalFirstAttemptSummary {
  const { attempt } = record;
  return {
    target: attempt.kind === 'local' ? attempt.ref : (attempt.model ?? GATEWAY_ATTEMPT_TARGET),
    outcome: record.outcome,
    ...(record.detail ? { detail: record.detail } : {}),
  };
}

/**
 * The `llm.local_fallback` step for a turn's attempts, or null when the first attempt
 * served (nothing fell over, so there is nothing to explain).
 */
export function localFallbackTrace(
  ts: string,
  step: number,
  attempts: readonly LocalFirstAttemptSummary[] | undefined,
): BrainTraceEvent | null {
  if (!attempts || attempts.length < 2) return null;
  const served = attempts.find((a) => a.outcome === 'served');
  const skipped = attempts.filter((a) => a.outcome !== 'served');
  if (!served || skipped.length === 0) return null;
  const why = skipped.map((a) => `${a.target} ${a.outcome}${a.detail ? ` (${a.detail})` : ''}`).join('; ');
  return {
    ts,
    category: 'message',
    label: 'llm.local_fallback',
    args: { step, from: skipped[0]!.target, to: served.target, attempts: attempts.map((a) => ({ ...a })) },
    result: `Local-first: ${why} — this turn was answered by ${served.target}.`,
  };
}
