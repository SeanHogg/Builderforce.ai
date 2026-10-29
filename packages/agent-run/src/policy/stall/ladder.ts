/**
 * policy/stall/ladder — the delivery ladder (PRD 35 §6.2; the Creation Canvas's
 * `onNoToolCalls` escalation, extracted).
 *
 * A turn that ended WITHOUT calling a tool is not accepted as the answer until the task's
 * deliverables have had their say. The surface declares them as {@link LadderRung}s
 * (`DeliveryLedger.rungs`) — an interrupted turn, an empty or echoed reply, a build that
 * was provisioned and never written, a canvas command answered in prose — and this walks
 * them in order. The first rung that holds for the turn acts, hardest-available remedy
 * first:
 *
 *   1. RESTATE the directive (the first `free` re-statements);
 *   2. hand the turn to a model that already emitted valid tool calls in this run (the
 *      run policy's stall failover, proven models only) — every non-sticky rung's counter resets;
 *   3. RESTATE harder, while directives remain;
 *   4. SPENT: fail the turn, settle on the rung's answer, or fall through to the next rung.
 *
 * Counters live in `RunState.stall.rungs`, so a stepped run (`maxSteps: 1`) resumes on the
 * same ladder a continuous one climbs. The ladder decides; the kernel hook applies the
 * rows it returns. Every word the model reads comes from the surface. Never branches on
 * `RunPolicy.entryPoint`.
 */

import { reduceRunPolicy } from "@builderforce/run-policy";
import type { RunMessage, RunState } from "../../contract.js";
import type { DeliveryLedger, LadderRung } from "../../surface.js";
import type { PolicyContext, StallDecision } from "../hooks.js";

/** Re-statements spent so far, per rung. */
function spentOf(state: RunState): Record<string, number> {
  return { ...(state.stall?.rungs ?? {}) };
}

/** Write the ladder's slice back, keeping whatever the generic stall budget holds. */
function save(state: RunState, patch: { rungs?: Record<string, number>; said?: string[]; spent?: number }): void {
  const total = (state.stall?.recoveriesTotal ?? 0) + (patch.spent ?? 0);
  state.stall = {
    ...(state.stall ?? { recoveriesUsed: 0 }),
    ...(patch.rungs ? { rungs: patch.rungs } : {}),
    ...(patch.said ? { said: patch.said } : {}),
    ...(total > 0 ? { recoveriesTotal: total } : {}),
  };
}

/**
 * A hand-off to another model clears the ladder: the new model starts it fresh. Rungs the
 * ledger names `sticky` keep their counters (a one-shot rung is not offered again to the
 * model that took over).
 */
export function resetRungs(state: RunState, keep: readonly string[] = []): void {
  const spent = state.stall?.rungs;
  if (!spent || Object.keys(spent).length === 0) return;
  save(state, { rungs: Object.fromEntries(Object.entries(spent).filter(([id]) => keep.includes(id))) });
}

/**
 * Move the run to a model that already acted, or nothing when none can take over. The ONE
 * hand-off: the stall ladder and the provider-failure route both take it, in the order
 * `preferProvenFailover` defines. `failed` names the model that just failed, as the
 * gateway resolved it.
 *
 * The reduced policy state stands whether or not anyone took over: with nobody left the
 * policy has returned the run to its pin, which is where the next turn must start.
 */
export function handOffToProven(ctx: PolicyContext, ledger: DeliveryLedger | undefined, failed: string | undefined): string | undefined {
  const next = reduceRunPolicy(ctx.state.model, { type: "stalled", ...(failed ? { resolvedModel: failed } : {}) });
  ctx.state.model = next;
  if (next.outcome.kind !== "failed_over") return undefined;
  resetRungs(ctx.state, ledger?.sticky);
  ledger?.handedOff?.(failed, next.outcome.to);
  return next.outcome.to;
}

/** The transcript rows a re-statement adds: what the model said (when quoted), the directive, a one-time note. */
function restatement(ctx: PolicyContext, rung: LadderRung, attempt: number): RunMessage[] {
  const rows: RunMessage[] = [];
  const said = ctx.content?.trim() ? ctx.content : "";
  if (rung.quote && said) rows.push({ role: "assistant", content: said });
  rows.push({ role: "system", content: rung.restate[attempt - 1] ?? "" });
  const notes = ctx.state.stall?.said ?? [];
  if (rung.once && !notes.includes(rung.id)) {
    rows.push({ role: "system", content: rung.once });
    save(ctx.state, { said: [...notes, rung.id] });
  }
  return rows;
}

/**
 * Walk the ledger's rungs for a turn that ended without a tool call. Returns what the
 * kernel should do about it, or nothing when every rung is cleared and the turn is the
 * answer.
 */
export function walkLadder(ctx: PolicyContext, ledger: DeliveryLedger): StallDecision | undefined {
  const turn = {
    content: ctx.content ?? "",
    ...(ctx.served?.interruption ? { interruption: ctx.served.interruption } : {}),
    ...(ctx.served?.model ? { model: ctx.served.model } : {}),
  };
  for (const rung of ledger.rungs(turn)) {
    rung.reached?.();
    if (!rung.applies) continue;

    const counters = spentOf(ctx.state);
    const used = counters[rung.id] ?? 0;
    const max = rung.restate.length;
    const restate = (): StallDecision => {
      counters[rung.id] = used + 1;
      save(ctx.state, { rungs: counters, spent: 1 });
      rung.onRestate?.(used + 1);
      return { action: "steer", rows: restatement(ctx, rung, used + 1) };
    };

    if (used < Math.min(rung.free ?? 1, max)) return restate();
    if (rung.handoff) {
      const to = handOffToProven(ctx, ledger, ctx.served?.model);
      if (to) {
        save(ctx.state, { spent: 1 });
        return { action: "escalate", rows: [{ role: "system", content: rung.handoff(to) }] };
      }
    }
    if (used < max) return restate();
    if (rung.spent === "fall") continue;
    if (rung.spent === "fail") return { action: "fail", note: rung.id };
    return { action: "settle", note: rung.spent.settle };
  }
  return undefined;
}
