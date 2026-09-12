/**
 * Late steers on the self-hosted relay — a steer that reaches this host after the run
 * it was sent to can no longer take it.
 *
 * Two windows produce one:
 *   - `run_finishing`: the SDK runner closes its input stream the moment a turn returns
 *     with nothing queued, so the steering channel refuses the push while the run is
 *     still reporting, committing and settling;
 *   - `no_live_run`: this host holds no run for the execution at all (a cloud fallback,
 *     a restart, a run that already ended and left).
 *
 * Operator decision 2026-09-12: spend the tokens. The steer is handed back to the API,
 * which starts a follow-up run on the same branch (`dispatchLateSteerFollowUp`). A
 * `run_finishing` steer is HELD until the run has reported its terminal state, so the
 * API sees a finished run and the follow-up never starts beside the run it follows;
 * a `no_live_run` steer is reported at once (there is nothing to wait for — and if the
 * run is in fact live elsewhere, the API re-queues it for that run).
 *
 * Pure (no sockets, no fetch) so the hold/drain semantics are unit-testable.
 */

import { normalizeSteeringText } from "./relay-steering.js";

export type LateSteerReason = "run_finishing" | "no_live_run";

/** One undelivered steer. `messageId` is the API's row id — the follow-up's idempotency key. */
export interface LateSteer {
  messageId?: number;
  text: string;
}

/** Read an undelivered steer off an `execution.message` frame; null when it has no text. */
export function lateSteerFromFrame(msg: { text?: unknown; messageId?: unknown }): LateSteer | null {
  const text = normalizeSteeringText(msg.text);
  if (!text) return null;
  const messageId =
    typeof msg.messageId === "number" && Number.isSafeInteger(msg.messageId) && msg.messageId > 0
      ? msg.messageId
      : undefined;
  return messageId != null ? { messageId, text } : { text };
}

export interface LateSteerRegistry {
  /** A run on this host started: from now until {@link drain}, late steers for it are held. */
  open(executionId: number): void;
  /** Hold a steer for a run this host owns. False when it owns no such run (report it now). */
  hold(executionId: number, steer: LateSteer): boolean;
  /** The run reported its terminal state: release its held steers, exactly once. */
  drain(executionId: number): LateSteer[];
}

export function createLateSteerRegistry(): LateSteerRegistry {
  const held = new Map<number, LateSteer[]>();
  return {
    open(executionId) {
      if (!held.has(executionId)) held.set(executionId, []);
    },
    hold(executionId, steer) {
      const list = held.get(executionId);
      if (!list) return false;
      list.push(steer);
      return true;
    },
    drain(executionId) {
      const list = held.get(executionId) ?? [];
      held.delete(executionId);
      return list;
    },
  };
}

/** The body POSTed to `/api/agent-hosts/:id/late-steers`. */
export function buildLateSteerReport(
  executionId: number,
  reason: LateSteerReason,
  steers: readonly LateSteer[],
): { executionId: number; reason: LateSteerReason; steers: LateSteer[] } {
  return { executionId, reason, steers: [...steers] };
}
