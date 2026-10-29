/**
 * agentReplyState — what an addressed-agent reply learned while it ran (PRD 35 WS3): the reply
 * text, the model/vendor/funding of the final turn, the connected-account failure and the
 * buffered step trace. Read by the Evermind regeneration, the empty-reply diagnostic and the
 * persist step. Split out of the retired `agentReplyLoop.ts`; the loop itself is now the one agent
 * (`agentReplyRun.ts` builds its ports).
 */
import type { StepRowInput } from '@builderforce/agent-loop';
import type { RunPolicyState } from '@builderforce/run-policy';

export const readModel = (r: unknown): string => (r as { resolvedModel?: string } | undefined)?.resolvedModel ?? '';
// The vendor + whether the tenant's OWN account served the turn — captured per
// completion so the FINAL turn's values drive both the empty-reply diagnostic and
// the per-reply provenance chip persisted on a successful turn.
export const readVendor = (r: unknown): string => (r as { resolvedVendor?: string } | undefined)?.resolvedVendor ?? '';
export const readByoFunded = (r: unknown): boolean => (r as { byoFunded?: boolean } | undefined)?.byoFunded === true;

/** What the loop learned, read by the Evermind regeneration and the outcome step. */
export interface ReplyTurnState {
  text: string;
  lastModel: string;
  lastVendor: string;
  lastByoFunded: boolean;
  lastFinish: string;
  /** The connected-account attempt's failure, when the cascade moved off it. */
  byoFailure: { vendor: string; code: number; detail?: string } | null;
  toolCallCount: number;
  iterations: number;
  policy: RunPolicyState;
  /**
   * The reply's STEPS, persisted at the end of the turn as `role:'tool'` step rows in
   * `brain_chat_messages` — the one store for run steps, the same rows the client-driven
   * Brain run loop writes (see `stepRow`).
   *
   * This loop used to leave no server-side record of what it did: steps were
   * written only by the client-driven Brain run loop, so an addressed-agent reply — the
   * ONLY path the manager's accountability chat uses — was unauditable. When the manager
   * answered "the required tools have not returned results" there was literally nothing
   * to inspect: no tool rows, no errors, no way to tell "the model never called anything"
   * from "every call failed". Those two have completely different fixes, and the surface
   * could not distinguish them.
   *
   * Buffered rather than written per tool because a Worker should not pay a round-trip
   * inside the loop; one bounded append at the end is enough for a diagnostic and cannot
   * slow the reply. Best-effort throughout — a trace failure must never cost an answer.
   *
   * Buffering is exactly why every step is stamped on the way in (see `record`):
   * the single append at the end gives all of them the same `created_at`, which cannot
   * order them and used to leave a reopened chat's timeline regrouped by kind.
   */
  trace: StepRowInput[];
}
