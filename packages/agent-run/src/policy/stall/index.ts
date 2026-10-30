/**
 * policy/stall — `policy/stall/**` (PRD 35 WS2b).
 *
 * Stall recovery: a turn that ended WITHOUT calling a tool is not accepted as the
 * answer until the ladder has had its say. It is narration (an announced call never
 * made, a promise, a pseudo-call, a missing-data claim, work handed back to the
 * user, a permission menu, an empty turn), a repetition loop, or a genuine stop —
 * and a model that spends its whole budget fails over to another, then stops and
 * says so.
 *
 * This is a BINDING, not a rewrite: the detection, the re-prompt budget, the
 * failover budget, the notices and the repetition trim all live in the shared pure
 * packages they were extracted into, and are imported here rather than copied —
 *   - `@builderforce/agent-stall` — `stallShape`, `shouldRecoverStalledTurn`,
 *     `isExhaustedStall`, `stallRecoveryNudge`, `stallExhaustedNotice`,
 *     `modelFailoverNotice`, `MAX_ANNOUNCEMENT_RECOVERIES`, `MAX_MODEL_FAILOVERS`;
 *   - `@builderforce/run-policy` — `resolveStallStep`, the ONE stall step every loop
 *     takes (spend the re-prompt budget on THIS model, then a policy-driven failover,
 *     then an explained stop), plus `initialRunPolicy` / `nextTurn` for the model
 *     hand-off state;
 *   - `@builderforce/agent-loop` — `trimRepetitionLoop` (cut a turn stuck on one
 *     block) and `liftProseAskUser` (a prose question with options → the canonical
 *     ```ask-user block).
 *
 * What is PORTED here is the loop glue those packages deliberately leave to hosts,
 * each documented at the point it is bound:
 *   - the re-prompt budget the cloud loop kept on its durable model state
 *     (`api/.../cloudAgent/cloudRunModelPolicy.ts`, `CloudRunModelState.stallRecoveries`)
 *     — kept here on the hook, keyed by the model it was spent against, reset on a
 *     failover and on a turn that called a tool;
 *   - applying the returned `RunPolicyState` to `state.model` on a failover, so the
 *     swap the policy chose actually takes effect next turn;
 *   - the forced no-tools final-synthesis prompt, so an agent whose every turn only
 *     called tools still speaks (`brain/agentReplyLoop.ts`);
 *   - the prose ask-lift on a settled final answer
 *     (`brain-embedded/.../finalAnswerHook.ts`);
 *   - the canvas escalation ladder — restate, then hand to a proven model, then stop —
 *     generalised and walked in `ladder.ts` over the surface's `DeliveryLedger` (the canvas
 *     supplies the rungs: `frontend/src/lib/canvasDelivery.ts`);
 *   - the exhausted-stall notice surfaced when nothing is left to try
 *     (`agent-runtime/.../agent-loop/stall-recovery.ts`).
 *
 * No `node:*` imports, no DOM: this module is compiled into the Worker, the browser
 * and Node. Never branches on `RunPolicy.entryPoint`.
 */

import { nextTurn, reduceRunPolicy, resolveStallStep } from "@builderforce/run-policy";
import {
  isExhaustedStall,
  modelFailoverNotice,
  stallRecoveryNudge,
  stallRecoveryToolChoice,
  stallShape,
  stallExhaustedNotice,
  MAX_ANNOUNCEMENT_RECOVERIES,
  MAX_MODEL_FAILOVERS,
  type StallShape,
} from "@builderforce/agent-stall";
import { liftProseAskUser, trimRepetitionLoop } from "@builderforce/agent-loop";
import type { StallState } from "../../contract.js";
import { walkLadder } from "./ladder.js";
import type { PolicyContext, StallDecision, StallHook } from "../hooks.js";

// ── The re-prompt budget (WS2b's slice of the run) ───────────────────────────
//
// `resolveStallStep` is stateless about how many re-prompts the CURRENT model has
// already spent — the host keeps that count. The cloud loop kept it on its durable
// model state (`CloudRunModelState.stallRecoveries`, reset on a failover); here it
// lives on the run's state (`RunState.stall`), keyed by the model it was spent
// against, so a stepped (`maxSteps: 1`) run resumes on the same budget, a failover (or
// any other model change) starts the new model with a full one, and a turn that acted
// resets it — exactly as the cloud loop's `cloudStallStep` did.

/** The model the run is on now, as the budget keys it. */
function currentModel(ctx: PolicyContext): string | undefined {
  return ctx.state.model?.model ?? undefined;
}

/** Read the budget: the saved one when it was spent against the CURRENT model, else full. */
function budgetOf(ctx: PolicyContext): StallState {
  const slot = ctx.state.stall;
  const model = currentModel(ctx);
  if (slot && typeof slot.recoveriesUsed === "number" && slot.model === model) return { ...slot };
  return model !== undefined ? { model, recoveriesUsed: 0 } : { recoveriesUsed: 0 };
}

/**
 * Persist the budget back onto the run's state, keyed by the model it now belongs to.
 * `spent` adds to the run's cumulative recovery count, which no reset ever clears.
 */
function saveBudget(ctx: PolicyContext, budget: StallState, spent = 0): void {
  const model = currentModel(ctx);
  const total = (ctx.state.stall?.recoveriesTotal ?? 0) + spent;
  // The slot also holds the delivery ladder's counters; only the budget's own keys are rewritten.
  const kept: Partial<StallState> = { ...ctx.state.stall };
  delete kept.model;
  delete kept.recoveriesTotal;
  ctx.state.stall = {
    ...kept,
    ...(model !== undefined ? { model } : {}),
    recoveriesUsed: budget.recoveriesUsed,
    ...(total > 0 ? { recoveriesTotal: total } : {}),
  };
}

// ── The ported glue ──────────────────────────────────────────────────────────

/**
 * The forced no-tools final synthesis — the prompt the @-reply loop appends so an
 * agent whose every turn only called tools still speaks (`brain/agentReplyLoop.ts`).
 * Bound here, word for word, so the one agent ends an all-tool run the same way.
 */
export const FORCED_SYNTHESIS_PROMPT =
  "Now write your reply to the team AS the agent: plain prose, first person, no tool calls. " +
  "Summarise what you found or did.";

// ── The hook ─────────────────────────────────────────────────────────────────

/**
 * The stall hook. `recover` judges a turn that ended without acting and returns what
 * the kernel should do: `steer` (re-prompt — the note is the correction), `escalate`
 * (hand to a different model), or `pause` (nothing left — stop with the explanation).
 * It returns nothing to accept the turn as the answer. `settle` shapes the answer it
 * accepted, `acted` resets the budget after a turn that called a tool, and `synthesis`
 * is the prompt for the one forced no-tools turn a run that never spoke gets.
 */
export const stallHook = {
  recover(ctx: PolicyContext): StallDecision | void {
    // A surface that declares its deliverables has them enforced, rung by rung
    // (`ladder.ts`). The narration heuristics below still run unless the ledger says its
    // rungs ARE the stall judgement (`owns.narration`).
    const delivery = ctx.ports?.delivery;
    if (delivery) {
      const owed = walkLadder(ctx, delivery);
      if (owed || delivery.owns?.narration) return owed;
    }
    const text = typeof ctx.content === "string" ? ctx.content : "";
    const toolNames = (ctx.tools ?? []).map((t) => t.function?.name ?? "").filter(Boolean);

    // The whole stall step, in one place (`resolveStallStep`): a turn that called a
    // tool is never a stall; a stalled turn is re-prompted until the budget is spent;
    // then the model hand-off policy swaps models until the failover budget is spent;
    // then the run stops and says so.
    const budget = budgetOf(ctx);
    // A failover moved the run to a new model: the old budget says nothing about it,
    // so it starts full (`resolveStallStep` returns `recoveriesUsed: 0` on a failover
    // and we adopt it below).
    const { policy, step } = resolveStallStep(
      ctx.state.model,
      {
        text,
        toolCallCount: 0,
        availableToolNames: toolNames,
        // Whether the user asked for a change decides what handing the work back means.
        requestText: ctx.task.request ?? ctx.task.prompt,
        ...(ctx.state.model.model && ctx.state.model.model !== "default" ? { resolvedModel: ctx.state.model.model } : {}),
      },
      budget.recoveriesUsed,
      // The failover source rides the run policy's proven/tried set; the transport names
      // the models a failover may land on (the tenant's connected flagships, the coding
      // pool). Without one the default never returns the model that just failed, never
      // more than MAX_MODEL_FAILOVERS deep.
      { surface: ctx.ports.model?.fallbackSurface?.() ?? undefined },
    );

    switch (step.kind) {
      case "none":
        // Not a stall: the turn is the answer. A repetition loop in it is trimmed when it
        // settles (`settle`), as every source does — never re-prompted, which would spend
        // turns with no budget bounding them.
        return undefined;
      case "nudge": {
        budget.recoveriesUsed = step.recoveriesUsed;
        saveBudget(ctx, budget, 1);
        if (step.toolChoice) ctx.state.forceToolChoice = step.toolChoice;
        // `step.nudge` already forces ONE structured call (it embeds the tool-choice
        // directive), so the re-prompt cannot be answered with another prose promise.
        return { action: "steer", note: step.nudge, detail: { model: ctx.state.model.model ?? null, attempt: step.recoveriesUsed, shape: step.shape ?? null } };
      }
      case "failover": {
        budget.recoveriesUsed = step.recoveriesUsed;
        saveBudget(ctx, budget, 1);
        // The policy moved the run onto `step.to` — apply it so the kernel asks for
        // that model next turn, and carry the swap's user-facing notice with the
        // first-chance nudge the incoming model gets.
        ctx.state.model = policy;
        if (step.toolChoice) ctx.state.forceToolChoice = step.toolChoice;
        return {
          action: "escalate",
          note: `${step.notice}\n\n${step.nudge}`,
          detail: { from: step.from ?? null, to: step.to, attempt: step.attempt, of: step.of, shape: step.shape ?? null, notice: step.notice },
        };
      }
      case "exhausted": {
        saveBudget(ctx, budget);
        // Nothing left to try: stop, and carry the exhausted notice so the run's
        // emptiness is explained (`agent-runtime/.../agent-loop/stall-recovery.ts`).
        return { action: "pause", note: step.notice, detail: { model: ctx.state.model.model ?? null, tried: step.tried, shape: step.shape ?? null } };
      }
    }
  },

  /**
   * The settled answer, shaped the way every source shapes it: a reply stuck on one
   * block posts that block once (`trimRepetitionLoop`, `brain/agentReplyLoop.ts`), and a
   * prose question with options becomes the canonical ```ask-user block the surfaces
   * render as a choice (`liftProseAskUser`, `brain-embedded/.../finalAnswerHook.ts`).
   */
  settle(ctx: PolicyContext, text: string): string {
    // A surface with a ledger shapes its own accepted answer (a copied speaker label, a
    // claim the board does not back); its transport already cuts a looping stream.
    const delivery = ctx.ports?.delivery;
    if (delivery?.owns?.settle && delivery.accept) return delivery.accept(text);
    return liftProseAskUser(trimRepetitionLoop(text.trim()));
  },

  /** A turn that called a tool is never a stall: the current model's budget starts full again. */
  acted(ctx: PolicyContext): void {
    if (ctx.state.stall && ctx.state.stall.recoveriesUsed > 0) saveBudget(ctx, { recoveriesUsed: 0 });
  },

  /**
   * The forced no-tools final synthesis: a run that ended without speaking (every turn
   * only called tools, a budget ran out, a breaker tripped) gets ONE bounded extra call
   * with this prompt and no tools, so the agent always answers (`brain/agentReplyLoop.ts`).
   */
  synthesis(ctx: PolicyContext): string | null {
    // The team-reply prompt is for an agent that speaks to a team. A surface with a ledger
    // composes its closing answer from what the board holds, so it forces no extra call.
    if (ctx.ports?.delivery?.owns?.synthesis) return null;
    // A run that answers AS a named agent says so; any other keeps the generic prompt.
    return ctx.task.agentName
      ? FORCED_SYNTHESIS_PROMPT.replace("AS the agent", `AS ${ctx.task.agentName}`)
      : FORCED_SYNTHESIS_PROMPT;
  },
} satisfies StallHook;

// ── Re-exported so a host can drive the same step without re-deriving it ─────

export {
  isExhaustedStall,
  liftProseAskUser,
  modelFailoverNotice,
  nextTurn,
  reduceRunPolicy,
  resolveStallStep,
  stallExhaustedNotice,
  stallRecoveryNudge,
  stallRecoveryToolChoice,
  stallShape,
  trimRepetitionLoop,
  MAX_ANNOUNCEMENT_RECOVERIES,
  MAX_MODEL_FAILOVERS,
};
export { FORCED_SYNTHESIS_PROMPT as forcedSynthesisPrompt };
export type { StallShape };

export type { StallDecision } from "../hooks.js";
