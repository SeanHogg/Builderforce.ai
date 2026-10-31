/**
 * policy/model/reask — the analysis → code hand-off, at the exact turn it matters.
 *
 * Ports `brain-embedded/src/runStore/completeTurn.ts`'s coder re-ask: the analysis model has just decided to change
 * code, and that edit is the first line of the deliverable, so the turn is re-asked of the coding model rather than
 * written by the model that planned it. The coder is handed the transcript AND a brief naming the change the planner was
 * about to make (`coderHandoffBrief`) - given the transcript alone, it started the analysis over.
 *
 * The rule is the model policy's (`code_change_attempted`): a pinned or locked model is the user's choice and is never
 * re-asked, but the run is coding all the same, so the phase moves and planning cannot outlive the edit. Which tools
 * change code is DATA (`RunPolicy.codeChangeTools`); a run that names none is never re-asked. Never branches on
 * `RunPolicy.entryPoint`.
 *
 * No `node:*` imports, no DOM.
 */

import { coderHandoffBrief, nextTurn, reduceRunPolicy } from "@builderforce/run-policy";
import type { ModelCompletion, RunMessage, RunPolicy, RunState } from "../../contract.js";
import type { TurnAsk } from "./handoff.js";

/** What a re-ask is to ask: the coder's turn, and the brief that rides it. */
export interface CoderReask {
  /** The model, role, phase and strictness the coder's turn asks for. */
  ask: TurnAsk;
  /** The untagged user turn the coder's request carries before its volatile tail (never persisted). */
  brief: RunMessage;
}

/** Whether a turn that just answered called a tool that changes code. */
function changedCode(policy: Pick<RunPolicy, "codeChangeTools">, completion: ModelCompletion): boolean {
  const tools = policy.codeChangeTools;
  return !!tools && tools.length > 0 && (completion.toolCalls ?? []).some((call) => tools.includes(call.name));
}

/**
 * The re-ask an analysis turn earns, or nothing. Reports `code_change_attempted` to the model policy (so a pin or lock
 * still moves the phase) and, when the policy asks for the coder, returns what to ask. `askedRole` is the role the turn
 * that just answered asked for: only an analysis turn is re-asked.
 */
export function reaskAsCoder(
  state: RunState,
  policy: Pick<RunPolicy, "codeChangeTools">,
  completion: ModelCompletion,
  asked: { role?: string; hasTools: boolean },
): CoderReask | undefined {
  if (asked.role !== "plan" || !changedCode(policy, completion)) return undefined;
  state.model = reduceRunPolicy(state.model, { type: "code_change_attempted" });
  if (state.model.outcome.kind !== "reask_as_coder") return undefined;
  const next = nextTurn(state.model, { hasTools: asked.hasTools });
  const calls = (completion.toolCalls ?? []).map((call) => ({ name: call.name, args: call.arguments }));
  return {
    ask: {
      ...(next.model ? { model: next.model } : {}),
      role: next.role,
      phase: state.model.phase,
      ...(next.strict ? { strict: true } : {}),
      ...(next.excludeModels.length > 0 ? { excludeModels: next.excludeModels } : {}),
    },
    brief: { role: "user", content: coderHandoffBrief(completion.content ?? "", calls) },
  };
}
