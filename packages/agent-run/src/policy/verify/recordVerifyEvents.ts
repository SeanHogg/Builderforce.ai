/**
 * policy/verify/recordVerifyEvents.ts — the events a verify phase emits, ported from
 * `api/src/application/runtime/cloudAgent/runEndMemory.ts` (`recordRunVerifyEvents`).
 *
 * Every verify action records its events in ORDER:
 *   1. `run_policy` with `{event:'verify_started'}` — the run-policy reducer's DECLARED
 *      phase-transition event, so a trace observes the policy actually entering `verify`;
 *   2. `in_run_verify` with the surface/kind/reason/commands/failedCommands/mayFinish —
 *      the outcome itself.
 *
 * The DB-backed row a cloud run writes (`recordCloudToolEvent` → Drizzle) stays on the
 * host; this module returns the events for the port to emit, so a Worker, a browser and
 * Node all record the same pair in the same order.
 *
 * No `node:*` imports, no DOM.
 */

import type { InRunVerifyOutcome } from "./inRunVerify.js";

/** The pair of events a verify action emits, in order. */
export interface VerifyEvents {
  /** The run-policy phase transition: the DECLARED `verify_started` event name. */
  started: { type: "verify_started" };
  /** The outcome itself, for the timeline. */
  completed: {
    tool: "in_run_verify";
    category: "tool";
    detail: {
      surface: string;
      kind: string;
      reason?: string;
      commands: string[];
      failedCommands: string[];
      mayFinish: boolean;
    };
    result: string;
  };
}

/**
 * Build the ordered event pair for one verify outcome. The caller emits these through
 * its event port; the `verify_started` half is what `applyVerifyPhase` already moved
 * the policy state with, so trace and state agree.
 */
export function recordVerifyEvents(outcome: InRunVerifyOutcome): VerifyEvents {
  return {
    started: { type: "verify_started" },
    completed: {
      tool: "in_run_verify",
      category: "tool",
      detail: {
        surface: outcome.surface,
        kind: outcome.kind,
        ...(outcome.reason ? { reason: outcome.reason } : {}),
        commands: outcome.commands,
        failedCommands: outcome.failedCommands,
        mayFinish: outcome.mayFinish,
      },
      result: describeVerifyResult(outcome),
    },
  };
}

function describeVerifyResult(outcome: InRunVerifyOutcome): string {
  if (outcome.kind === "skipped") return `verify skipped (${outcome.reason})`;
  if (outcome.commands.length === 0) return `verify ${outcome.kind}, no commands`;
  const failed = outcome.failedCommands.length;
  return `verify ${outcome.kind}: ${outcome.commands.join("; ")}${failed > 0 ? ` — ${failed} failed` : ""}`;
}
