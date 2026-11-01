/**
 * What the kernel does with a turn that ended WITHOUT calling a tool: whether it is the answer, or the run goes on. Split out of
 * `kernelHooks.ts` (PRD 35 §5 rule 4): the WHEN is the kernel's, every judgement (a live child, a stall, an owed sign-off) is a
 * policy module's. Never branches on `RunPolicy.entryPoint`.
 *
 * A turn the run does NOT accept is sent back: what the model said joins the transcript as its own row, then the correction. The
 * surface is told first (`DeliveryLedger.sentBack`), so what the person already watched stream in is kept as its own durable block
 * and the next turn's stream cannot erase it.
 */

import type { LoopHooks } from "@builderforce/agent-loop";

import type { RunMessage } from "./contract.js";
import type { PolicyContext } from "./policy/index.js";
import { emit } from "./runContext.js";
import type { KernelRun } from "./kernelHooks.js";

type StepAt = { step: number; stepInCall: number };

/** What the hook reads of the kernel's other parts: the policy context at a step, the transcript, and the steering takers. */
export interface NoToolCallsDeps {
  contextAt(step: number, turn: number): PolicyContext;
  append(...rows: RunMessage[]): void;
  takeSteers(ctx: StepAt): Promise<"none" | "stop" | "applied">;
  takeFollowUps(ctx: { step: number }): Promise<boolean>;
}

export function noToolCallsHook(run: KernelRun, deps: NoToolCallsDeps): NonNullable<LoopHooks<RunMessage>["onNoToolCalls"]> {
  const { input, hooks } = run;
  const { ports, policy } = input;
  const { append } = deps;

  /** The turn goes on: tell the surface what the model said (as its own block, or as the reply it was) before the rows join the transcript. */
  const sentBack = async (step: number, content: string, kept: "block" | "reply" = "block"): Promise<void> => {
    await ports.delivery?.sentBack?.({ step, content, kept });
  };

  /**
   * Send a turn back instead of accepting it: what the model said stays in the
   * transcript as its own row, then the correction — so the next turn reads both, never
   * two user rows in a row with the model's words lost.
   */
  const requeue = async (step: number, said: string, note: string, kept: "block" | "reply" = "block"): Promise<void> => {
    await sentBack(step, said, kept);
    if (said.trim()) append({ role: "assistant", content: said, ...run.turnNative });
    append({ role: "user", content: note });
  };

  return async (ctx, turn) => {
    // A turn with no tool calls is the model's answer — unless the stall policy says it
    // is narration, or the run may not settle yet.
    const pctx = deps.contextAt(ctx.step, ctx.stepInCall);
    pctx.content = turn.content;
    pctx.served = { ...(run.facts.model ? { model: run.facts.model } : {}), ...(run.facts.interruption ? { interruption: run.facts.interruption } : {}) };
    // A surface that judges a stall against the menu the turn advertised, not everything it could run, says so (`DeliveryLedger.stall.menu`).
    if (ports.delivery?.stall?.menu && run.selection?.tools) pctx.tools = [...run.selection.tools];
    // An owner never ends with children still working: their reports would strand.
    const children = await hooks.finish.liveChildren?.(pctx);
    if (children) {
      await requeue(ctx.step, turn.content, children);
      return { action: "continue" };
    }
    // A turn the person interrupted is not judged: what they steered in is taken first (below), so a steer is never lost to a stall
    // that ends the run, and never spends a re-prompt.
    const stalled = run.watch.hasInterrupt() ? undefined : await (hooks.stall.recoverAsync ? hooks.stall.recoverAsync(pctx) : hooks.stall.recover(pctx));
    if (stalled) await emit(ports.events, { kind: "stall.recovered", step: ctx.step, action: stalled.action, ...(stalled.note ? { note: stalled.note } : {}), ...(stalled.detail ? { detail: stalled.detail } : {}) });
    if (stalled && stalled.action === "pause") {
      const notice = stalled.note ?? "paused";
      // A surface that lands runs ends it with what it said and why it stopped (a finish, not a failure — whatever it
      // committed still ships); any other stops it unfinished.
      if (policy.stallExhausted === "finish") return { action: "finish", output: turn.content.trim() ? `${turn.content}\n\n${notice}` : notice };
      // A conversation that shows the model's own reply and the reason beside it settles on what the model said, shaped as any accepted
      // answer is; the notice is on the `stall.recovered` event the surface renders.
      if (policy.stallExhausted === "settle") {
        const settled = hooks.stall.settle ? hooks.stall.settle(pctx, turn.content) : turn.content;
        if (settled.trim()) append({ role: "assistant", content: settled, ...run.turnNative });
        return { action: "finish", output: settled };
      }
      // A surface whose conversation outlives the run records why it produced nothing: the notice joins the transcript.
      if (policy.stallExhausted === "note") await requeue(ctx.step, turn.content, notice);
      return { action: "stop", ok: false, output: notice, finished: true };
    }
    if (stalled && stalled.action === "fail") {
      return { action: "stop", ok: false, output: stalled.note ?? "failed", finished: true };
    }
    if (stalled && stalled.action === "settle") {
      // The ladder ended the run on an answer of its own (a shortfall, a build never written).
      const answer = stalled.note ?? "";
      if (answer.trim()) append({ role: "assistant", content: answer });
      return { action: "finish", output: answer };
    }
    if (stalled) {
      // A model that stalled out and was handed over is a reply the person read; any other correction keeps what it said as a block.
      const kept = stalled.action === "escalate" ? "reply" : "block";
      if (stalled.rows) {
        await sentBack(ctx.step, turn.content, kept);
        append(...stalled.rows);
      } else await requeue(ctx.step, turn.content, stalled.note ?? "Continue: do the work, do not describe it.", kept);
      return { action: "continue" };
    }
    // A prose answer is a finish too: the sign-off a reviewer owes and the sub-agents
    // the user asked for hold it exactly as they hold the `finish` tool.
    const owed = hooks.finish.settleBlock(pctx);
    if (owed) await emit(ports.events, { kind: "finish.blocked", step: ctx.step, reason: "review_verdict_missing", block: owed, detail: { ...policy.signoff } });
    const block = owed ?? hooks.subagents.backstop(pctx);
    if (block) {
      await requeue(ctx.step, turn.content, block);
      return { action: "continue" };
    }
    const output = hooks.stall.settle ? hooks.stall.settle(pctx, turn.content) : turn.content;
    if (output.trim()) append({ role: "assistant", content: output, ...run.turnNative });
    // A message steered in while this last turn was in flight is never lost (§6.3): the
    // run takes one more turn for it instead of finishing past it. What the model said stays as its own block.
    const late = await deps.takeSteers(ctx);
    if (late === "stop") return { action: "stop", ok: false, output: "cancelled", finished: true };
    if (late === "applied") {
      await sentBack(ctx.step, turn.content);
      return { action: "continue" };
    }
    // What the person queued to be taken once the run would stop: the run continues on it instead of finishing.
    if (await deps.takeFollowUps(ctx)) {
      await sentBack(ctx.step, turn.content);
      return { action: "continue" };
    }
    return { action: "finish", output };
  };
}
