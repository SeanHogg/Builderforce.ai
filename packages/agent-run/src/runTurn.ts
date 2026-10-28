/**
 * One model turn and one tool dispatch: the policy picks the tools and the model, the
 * transport answers, and every call goes through the core registry so the capability
 * gate holds at call time.
 */

import { buildCoreToolRegistry, type ToolSchema } from "@builderforce/agent-tools";
import type { LoopDispatchResult, LoopTurn, ParsedToolCall, TurnContext } from "@builderforce/agent-loop";
import type { ModelCompletion, ModelRequest, RunMessage, RunPorts, RunState } from "./contract.js";
import type { PolicyHooks } from "./policy/index.js";
import { currentView, policyContext, type RunAgentInput } from "./runContext.js";

/** The registry the agent dispatches through. Built once: the catalog does not change per run. */
const REGISTRY = buildCoreToolRegistry();

/** The schemas the model is offered, before the tools policy narrows them. */
export function offeredSchemas(ports: RunPorts): ToolSchema[] {
  return REGISTRY.schemasFor(ports.capabilities);
}

/** One model turn: the policy picks the model, the transport answers. */
export async function completeTurn(
  input: RunAgentInput,
  state: RunState,
  hooks: PolicyHooks,
  ctx: TurnContext<RunMessage>,
  offered: ToolSchema[],
  transcript: RunMessage[],
): Promise<LoopTurn | { failed: string }> {
  const view = currentView(transcript, offered);
  const pctx = policyContext(input, state, view, ctx.step, ctx.stepInCall);
  const selected = await hooks.tools.select(pctx, offered);
  // An empty selection is a decision, not an absence: a module that returns `[]` has
  // chosen that this run may call nothing. Only `undefined` means "not my concern",
  // which is what the no-op returns until WS2f lands.
  const tools = selected ? [...selected] : offered;
  const decision = await hooks.model.resolve(pctx);
  const model = decision?.model ?? state.model.model ?? input.policy.pinnedModel;

  const request: ModelRequest = {
    messages: transcript,
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
  return {
    content: completion.content ?? "",
    toolCalls: (completion.toolCalls ?? []).map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })),
    meta: { model: completion.model, usage: completion.usage },
  };
}

/**
 * Dispatch one tool call through the registry, so the capability gate holds at call
 * time and not only at advertisement. The registry owns the alias remap and the
 * "available tools" list in the unknown-tool error; calling `execute` directly would
 * skip both, and a model that hallucinates `list_dir` would be told the tool does
 * not exist instead of having it run.
 */
export async function dispatchCall(ports: RunPorts, call: ParsedToolCall, signal: AbortSignal | undefined): Promise<LoopDispatchResult> {
  try {
    const result = await REGISTRY.dispatch(call.name, call.args, { caps: ports.capabilities, ...(signal ? { signal } : {}) });
    return { data: result.data, ...(result.control ? { control: result.control } : {}), ...(result.data && (result.data as { ok?: unknown }).ok === false ? { isError: true } : {}) };
  } catch (err) {
    if (signal?.aborted) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    return { data: { ok: false, error: reason }, isError: true };
  }
}

