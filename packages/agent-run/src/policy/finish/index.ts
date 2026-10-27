/**
 * policy/finish — the placeholder, no-deliverable, CI-pending, source-quality,
 * review-verdict (sign-off) and honesty finish gates, and the @-reply verify pin.
 *
 * Owned by WS2d. Ports `api/src/application/runtime/cloudAgent/finishGates.ts` behind
 * the `FinishHook.gate` contract `policy/hooks.ts` names. The engine's repo/db couplings
 * (branch-CI polling, the placeholder scan, the structural completion-claim record,
 * live-child tracking) arrive as optional PORTS a surface supplies through
 * `PolicyContext`; absent, that gate is an honest no-op rather than an invented check.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser and
 * Node.
 */

import type { PolicyContext } from "../hooks.js";
import { evaluateFinishGates } from "./gates.js";
import { applyVerifyPhase } from "../verify/runEndMemory.js";
import type { FinishHook } from "../hooks.js";

/** The optional engine ports a surface may thread through `PolicyContext` extras. */
export interface FinishPorts {
  read?: (path: string) => Promise<string | null>;
  pollBranchCi?: () => Promise<import("./ciGate.js").CiFinishDecision>;
  scanPlaceholders?: (paths: readonly string[]) => Promise<{ flagged: Array<{ path: string; markers: string[] }> }>;
}

/**
 * Read the run's written paths. `runAgent.ts` maintains `state.writtenPaths`; the @-reply
 * path carried its own set — both arrive here through the state, never by recomputing.
 */
function writtenPathsOf(ctx: PolicyContext): readonly string[] {
  return ctx.state.writtenPaths ?? [];
}

/** The finish hook the composition calls. `ctx.content` is the finish summary. */
export const finishHook: FinishHook = {
  async gate(ctx: PolicyContext): Promise<string | null> {
    const ports = (ctx as { finishPorts?: FinishPorts }).finishPorts ?? {};
    let blockedFlag = false;
    const verdict = await evaluateFinishGates({
      writtenPaths: writtenPathsOf(ctx),
      requiredSignoff: ctx.policy.signoff,
      delegated: ctx.task.dispatch.parentRunId !== undefined,
      summary: typeof ctx.content === "string" ? ctx.content : "",
      output: "",
      gates: ctx.state.finish,
      enterVerify: () => {
        ctx.state.model = applyVerifyPhase(ctx.state.model);
      },
      ports,
    });
    if (verdict.block) {
      ctx.state.finish = { ...ctx.state.finish, finishBlockedOnce: true };
      blockedFlag = true;
    }
    return verdict.block;
  },
};
