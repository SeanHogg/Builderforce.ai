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
 *   - the canvas escalation ladder — restate, then hand to a proven model, then stop
 *     (`frontend/.../canvasNoToolCalls.ts`), generalised to the policy's failover;
 *   - the exhausted-stall notice surfaced when nothing is left to try
 *     (`agent-runtime/.../agent-loop/stall-recovery.ts`).
 *
 * No `node:*` imports, no DOM: this module is compiled into the Worker, the browser
 * and Node. Never branches on `RunPolicy.entryPoint`.
 */

import { initialRunPolicy, nextTurn, reduceRunPolicy, resolveStallStep } from "@builderforce/run-policy";
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
import type { PolicyContext, StallDecision } from "../hooks.js";

// ── The re-prompt budget (WS2b's slice of the run) ───────────────────────────
//
// `resolveStallStep` is stateless about how many re-prompts the CURRENT model has
// already spent — the host keeps that count. The cloud loop kept it on its durable
// model state (`CloudRunModelState.stallRecoveries`, reset on a failover); here it
// lives on the hook, keyed by the model it was spent against, so a stepped
// (`maxSteps: 1`) run resumes on the same budget and a failover starts the new model
// with a full one.

interface StallBudget {
  /** The model the budget below was spent against. */
  model?: string;
  /** Re-prompts already spent against `model`. */
  recoveriesUsed: number;
}

const freshBudget = (): StallBudget => ({ recoveriesUsed: 0 });

/** Read the budget the hook carries, tolerating an absent slot. */
function budgetOf(ctx: PolicyContext): StallBudget {
  const slot = (ctx.state as unknown as { stall?: unknown }).stall;
  if (slot && typeof slot === "object" && "recoveriesUsed" in slot) {
    return slot as StallBudget;
  }
  return freshBudget();
}

/** Persist the budget back onto the run's state, so a stepped resume keeps it. */
function saveBudget(ctx: PolicyContext, budget: StallBudget): void {
  (ctx.state as unknown as { stall?: StallBudget }).stall = budget;
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
 * It returns nothing to accept the turn as the answer.
 */
export const stallHook = {
  recover(ctx: PolicyContext): StallDecision | void {
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
      { text, toolCallCount: 0, availableToolNames: toolNames },
      budget.recoveriesUsed,
      // The failover source rides the run policy's proven/tried set — a host that
      // wires a picker can pass it through the context; the default never returns
      // the model that just failed, never more than MAX_MODEL_FAILOVERS deep.
      {},
    );

    switch (step.kind) {
      case "none": {
        // Not a stall — but the turn may be a repetition loop (one block said over
        // and over), which is not an answer either: steer back rather than settle on
        // a run to the output ceiling (`agent-loop/repetitionLoop.ts`).
        if (trimRepetitionLoop(text) !== text) {
          return { action: "steer", note: stallRecoveryNudge(false, "announced") };
        }
        return undefined;
      }
      case "nudge": {
        budget.recoveriesUsed = step.recoveriesUsed;
        saveBudget(ctx, budget);
        // `step.nudge` already forces ONE structured call (it embeds the tool-choice
        // directive), so the re-prompt cannot be answered with another prose promise.
        return { action: "steer", note: step.nudge };
      }
      case "failover": {
        budget.recoveriesUsed = step.recoveriesUsed;
        saveBudget(ctx, budget);
        // The policy moved the run onto `step.to` — apply it so the kernel asks for
        // that model next turn, and carry the swap's user-facing notice with the
        // first-chance nudge the incoming model gets.
        ctx.state.model = policy;
        return { action: "escalate", note: `${step.notice}\n\n${step.nudge}` };
      }
      case "exhausted": {
        saveBudget(ctx, budget);
        // Nothing left to try: stop, and carry the exhausted notice so the run's
        // emptiness is explained (`agent-runtime/.../agent-loop/stall-recovery.ts`).
        return { action: "pause", note: step.notice };
      }
    }
  },
};

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
