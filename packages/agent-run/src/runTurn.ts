/**
 * One model turn and one tool dispatch: the policy picks the tools and the model, the
 * transport answers, and every call goes through the core registry so the capability
 * gate holds at call time. Plus the one forced no-tools turn a run that never answered
 * gets before it settles.
 */

import { buildCoreToolRegistry, type ToolSchema } from "@builderforce/agent-tools";
import type { LoopDispatchResult, LoopTurn, ParsedToolCall, TurnContext } from "@builderforce/agent-loop";
import type { ContextPack, ModelCompletion, ModelRequest, RunMessage, RunPorts, RunState } from "./contract.js";
import type { PolicyHooks } from "./policy/index.js";
import { runToolWithWatch, type InterruptWatch } from "./policy/steering/index.js";
import { capToolResult, resultCapFor } from "./policy/tools/index.js";
import { currentView, emit, policyContext, type RunAgentInput, type TurnTally } from "./runContext.js";
import { withVolatileTail } from "./turnContext.js";

/** The registry the agent dispatches through. Built once: the catalog does not change per run. */
const REGISTRY = buildCoreToolRegistry();

/** The hard cap on the forced synthesis turn's answer — the source's bounded extra call. */
const SYNTHESIS_MAX_TOKENS = 1_000;

/** The schemas the model is offered, before the tools policy narrows them. */
export function offeredSchemas(ports: RunPorts): ToolSchema[] {
  return REGISTRY.schemasFor(ports.capabilities);
}

/**
 * One model turn: the policy picks the tools and the model, the memory policy writes the
 * brief, and the transport answers. The request carries the transcript plus this turn's
 * volatile tail (the pack and the brief) LAST — the tail is never written into the
 * transcript, so the cached prefix and the saved state never hold it.
 */
export async function completeTurn(
  input: RunAgentInput,
  state: RunState,
  hooks: PolicyHooks,
  ctx: TurnContext<RunMessage>,
  offered: ToolSchema[],
  transcript: RunMessage[],
  pack: ContextPack,
): Promise<LoopTurn | { failed: string }> {
  const view = currentView(transcript, offered);
  const pctx = policyContext(input, state, view, ctx.step, ctx.stepInCall);
  const selected = await hooks.tools.select(pctx, offered);
  // An empty selection is a decision, not an absence: a module that returns `[]` has
  // chosen that this run may call nothing. Only `undefined` means "not my concern".
  const tools = selected ? [...selected] : offered;
  const decision = await hooks.model.resolve(pctx);
  // The model ASKED for: the policy's pick, else the pin — never the model a previous turn
  // was served, which would read every later turn as a downgrade from it.
  const model = decision?.model ?? input.policy.pinnedModel;
  const brief = await hooks.memory.brief(pctx);

  const request: ModelRequest = {
    messages: withVolatileTail(transcript, pack, brief ?? null),
    ...(model ? { model } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    ...(decision?.maxTokens !== undefined ? { maxTokens: decision.maxTokens } : {}),
  };

  let completion: ModelCompletion;
  try {
    completion = await input.ports.model.complete(request, input.signal);
  } catch (err) {
    if (input.signal?.aborted) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    return { failed: reason };
  }

  if (completion.model) state.model = { ...state.model, model: completion.model };
  // A turn answered by another model than it asked for — or an auto-routed turn that
  // landed on a degraded one — is said, never silent (E7).
  const downgrade = hooks.model.downgrade?.(pctx, model, completion.model);
  if (downgrade) await emit(input.ports.events, downgrade);
  return {
    content: completion.content ?? "",
    toolCalls: (completion.toolCalls ?? []).map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })),
    meta: { model: completion.model, usage: completion.usage },
  };
}

/**
 * The forced no-tools final synthesis (PRD 35 §6.2): a run that ended without an answer
 * gets ONE bounded extra call, with the stall policy's prompt and no tools, so the agent
 * always speaks (`brain/agentReplyLoop.ts`). The answer is shaped by the stall policy's
 * `settle` and recorded in the transcript. Returns null when the policy has no prompt,
 * the transport fails, or the model still says nothing — the caller keeps the outcome
 * it had.
 */
export async function synthesizeFinal(
  input: RunAgentInput,
  state: RunState,
  hooks: PolicyHooks,
  transcript: RunMessage[],
  pack: ContextPack,
  tally: TurnTally,
): Promise<string | null> {
  if (input.signal?.aborted) return null;
  const pctx = policyContext(input, state, currentView(transcript, []), state.step, 0);
  const prompt = hooks.stall.synthesis?.(pctx);
  if (!prompt) return null;

  const decision = await hooks.model.resolve(pctx);
  // The model ASKED for: the policy's pick, else the pin — never the model a previous turn
  // was served, which would read every later turn as a downgrade from it.
  const model = decision?.model ?? input.policy.pinnedModel;
  const ask: RunMessage = { role: "user", content: prompt };
  let completion: ModelCompletion;
  try {
    completion = await input.ports.model.complete(
      {
        messages: [...withVolatileTail(transcript, pack, null), ask],
        ...(model ? { model } : {}),
        maxTokens: SYNTHESIS_MAX_TOKENS,
      },
      input.signal,
    );
  } catch {
    return null;
  }
  if (completion.model) {
    state.model = { ...state.model, model: completion.model };
    tally.model = completion.model;
  }
  if (completion.usage) tally.usage = completion.usage;
  await emit(input.ports.events, {
    kind: "model.completed",
    step: state.step,
    ...(completion.model ? { model: completion.model } : {}),
    ...(completion.usage ? { usage: completion.usage } : {}),
  });

  const raw = completion.content ?? "";
  const output = hooks.stall.settle ? hooks.stall.settle(pctx, raw) : raw.trim();
  if (!output) return null;
  transcript.push(ask, { role: "assistant", content: output });
  return output;
}

/**
 * Dispatch one tool call through the registry, so the capability gate holds at call
 * time and not only at advertisement. The registry owns the alias remap and the
 * "available tools" list in the unknown-tool error; calling `execute` directly would
 * skip both, and a model that hallucinates `list_dir` would be told the tool does
 * not exist instead of having it run.
 *
 * A foreground command runs under a step signal that the run's Stop and an interrupting
 * steer both abort (`runToolWithWatch`, §6.3). The result is capped ONCE, to the serving
 * model's window (`resultCapFor`, §6.10) — what the model is served is what the read
 * coverage records.
 */
export async function dispatchCall(input: RunAgentInput, state: RunState, call: ParsedToolCall, watch: InterruptWatch): Promise<LoopDispatchResult> {
  const { ports, signal } = input;
  try {
    const box: { control?: LoopDispatchResult["control"] } = {};
    const data = await runToolWithWatch(
      async (name, args, stepSignal) => {
        const run = stepSignal ?? signal;
        const result = await REGISTRY.dispatch(name, args as Record<string, unknown>, { caps: ports.capabilities, ...(run ? { signal: run } : {}) });
        box.control = result.control;
        return result.data;
      },
      watch,
      signal,
      call.name,
      call.args,
    );
    const capped = capToolResult(call.name, data, resultCapFor(call.name, ports.model, state.model.model));
    return { data: capped, ...(box.control ? { control: box.control } : {}), ...(capped && (capped as { ok?: unknown }).ok === false ? { isError: true } : {}) };
  } catch (err) {
    if (signal?.aborted) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    return { data: { ok: false, error: reason }, isError: true };
  }
}
