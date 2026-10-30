/**
 * One model turn and one tool dispatch: the policy picks the tools and the model, the
 * transport answers, and every call goes through the core registry so the capability
 * gate holds at call time. Plus the one forced no-tools turn a run that never answered
 * gets before it settles.
 */

import { buildCoreToolRegistry, SKILL_TOOLS, SUBAGENT_TOOLS, type ToolSchema } from "@builderforce/agent-tools";
import { malformedCallOutcome, type LoopDispatchResult, type LoopTurnResult, type ParsedToolCall, type TurnContext } from "@builderforce/agent-loop";
import { reduceRunPolicy } from "@builderforce/run-policy";
import type { ContextPack, ModelCompletion, ModelRequest, RunMessage, RunPorts, RunState } from "./contract.js";
import { isTransportFailure } from "./surface.js";
import type { PolicyHooks } from "./policy/index.js";
import { runToolWithWatch, type InterruptWatch } from "./policy/steering/index.js";
import { capToolResult, resultCapFor } from "./policy/tools/index.js";
import { currentView, emit, policyContext, type RunAgentInput, type TurnFacts } from "./runContext.js";
import { tallyTurn, type RunTally } from "./telemetry/runTally.js";
import { withVolatileTail } from "./turnContext.js";

/**
 * The registry the agent dispatches through. Built once: the catalog does not change per run.
 * Delegation and skill authoring are not core task tools, so they are registered on top of the
 * core set on the same terms as the cloud's registry: a surface is offered them only by granting
 * `orchestrate` / `skill.author`. Without them a parent could never delegate — and a child, being a
 * clone of its parent, could not either.
 */
const REGISTRY = buildCoreToolRegistry();
for (const tool of [...SUBAGENT_TOOLS, ...SKILL_TOOLS]) REGISTRY.register(tool);

/** The hard cap on the forced synthesis turn's answer — the source's bounded extra call. */
const SYNTHESIS_MAX_TOKENS = 1_000;

/**
 * Does the surface's own tool provider run this call? It runs the names the shared
 * registry does not — all of them, when it declares its catalog closed.
 */
export function ownsCall(ports: RunPorts, name: string): boolean {
  const platform = ports.platform;
  return platform !== undefined && (platform.closed === true || !REGISTRY.has(name));
}

/** The schemas the model is offered, before the tools policy narrows them. */
export function offeredSchemas(ports: RunPorts): ToolSchema[] {
  return [...REGISTRY.schemasFor(ports.capabilities), ...(ports.platform?.schemas({ rungs: {} }) ?? [])];
}

/**
 * What served a turn is what the next one asks for — except `default` (the gateway's own
 * auto label, not a model) and under a strict pin, which the policy keeps. The ONE write of
 * the served model, for the turn and for the closing synthesis alike.
 */
function adoptServedModel(state: RunState, served: string | undefined): void {
  if (served && served !== "default" && !state.model.strictPin) state.model = { ...state.model, model: served };
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
  /** The step's tool selection when `beforeTurn` already made it (compaction charged those schemas). */
  made?: { tools: readonly ToolSchema[] | void },
): Promise<LoopTurnResult> {
  const view = currentView(transcript, offered);
  const pctx = policyContext(input, state, view, ctx.step, ctx.stepInCall);
  const selected = made ? made.tools : await hooks.tools.select(pctx, offered);
  // An empty selection is a decision, not an absence: a module that returns `[]` has
  // chosen that this run may call nothing. Only `undefined` means "not my concern".
  const tools = selected ? [...selected] : offered;
  // The model policy is asked about the tools this turn will ADVERTISE: a turn with none
  // is conversation, and asks for the `chat` role.
  const decision = await hooks.model.resolve({ ...pctx, tools });
  // The model ASKED for: the policy's pick — absent on purpose after a pin was released —
  // else, only when no policy spoke, the pin. Never the model a previous turn was served,
  // which would read every later turn as a downgrade from it.
  const model = decision ? decision.model : input.policy.pinnedModel;
  const brief = await hooks.memory.brief(pctx);

  const request: ModelRequest = {
    messages: withVolatileTail(transcript, pack, brief ?? null),
    ...(model ? { model, strict: decision?.strict ?? false } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    ...(decision?.maxTokens !== undefined ? { maxTokens: decision.maxTokens } : {}),
    ...(decision?.role ? { role: decision.role } : {}),
    ...(decision?.excludeModels && decision.excludeModels.length > 0 ? { excludeModels: decision.excludeModels } : {}),
  };

  let completion: ModelCompletion;
  try {
    completion = await input.ports.model.complete(request, input.signal);
  } catch (err) {
    if (input.signal?.aborted) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    // A provider that broke is routed around — a model that already acted takes over, or
    // the gateway's pool is asked again without the broken one — before the turn is lost.
    if (isTransportFailure(err) && hooks.model.recoverFailure) {
      const route = hooks.model.recoverFailure(pctx, err.failure, err.failure.model ?? model, reason);
      if (route.kind === "retry") {
        if (route.note) transcript.push({ role: "system", content: route.note });
        return { skip: true };
      }
      return { failed: `provider failed: ${reason}` };
    }
    return { failed: reason };
  }

  // The turn answered: the policy locks onto what served it and records it proven when it
  // acted — the hand-off a later stall or failure draws on.
  state.model = reduceRunPolicy(state.model, {
    type: "turn_succeeded",
    ...(completion.model ? { model: completion.model } : {}),
    acted: (completion.toolCalls?.length ?? 0) > 0,
  });
  adoptServedModel(state, completion.model);
  // A turn answered by another model than it asked for — or an auto-routed turn that
  // landed on a degraded one — is said, never silent (E7).
  const downgrade = hooks.model.downgrade?.(pctx, model, completion.model);
  if (downgrade) await emit(input.ports.events, downgrade);
  return {
    content: completion.content ?? "",
    toolCalls: (completion.toolCalls ?? []).map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })),
    meta: { model: completion.model, usage: completion.usage, interrupted: completion.interrupted },
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
  tally: RunTally,
): Promise<string | null> {
  if (input.signal?.aborted) return null;
  const pctx = policyContext(input, state, currentView(transcript, []), state.step, 0);
  const prompt = hooks.stall.synthesis?.(pctx);
  if (!prompt) return null;

  const decision = await hooks.model.resolve(pctx);
  // As in `completeTurn`: the policy's pick (absent on purpose after a pin was released),
  // else — only when no policy spoke — the pin.
  const model = decision ? decision.model : input.policy.pinnedModel;
  const ask: RunMessage = { role: "user", content: prompt };
  let completion: ModelCompletion;
  try {
    completion = await input.ports.model.complete(
      {
        messages: [...withVolatileTail(transcript, pack, null), ask],
        ...(model ? { model, strict: decision?.strict ?? false } : {}),
        maxTokens: SYNTHESIS_MAX_TOKENS,
      },
      input.signal,
    );
  } catch {
    return null;
  }
  adoptServedModel(state, completion.model);
  tallyTurn(tally, completion.model, completion.usage);
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
 * A call whose arguments never parsed is DECLINED, not run with none: the kernel hands it
 * over as `args: {}`, and running it is how a file got written with no path. A surface's
 * own tools (`RunPorts.platform`) run the calls the shared registry does not, and the
 * first one that begins the work hands the run from analysis to code.
 *
 * A foreground command runs under a step signal that the run's Stop and an interrupting
 * steer both abort (`runToolWithWatch`, §6.3). The result is capped ONCE, to the serving
 * model's window (`resultCapFor`, §6.10) — what the model is served is what the read
 * coverage records.
 */
export async function dispatchCall(input: RunAgentInput, state: RunState, call: ParsedToolCall, watch: InterruptWatch, facts: TurnFacts = { refused: false }): Promise<LoopDispatchResult> {
  const { ports, signal } = input;
  if (call.malformed) return declineMalformedCall(ports, call, facts);
  const platform = ports.platform;
  const own = ownsCall(ports, call.name);
  if (platform && own && platform.handsOff?.(call.name) && state.model.phase === "plan") {
    state.model = reduceRunPolicy(state.model, { type: "hand_off" });
  }
  try {
    const box: { control?: LoopDispatchResult["control"]; failed?: boolean } = {};
    const data = await runToolWithWatch(
      async (name, args, stepSignal) => {
        const run = stepSignal ?? signal;
        if (platform && own) {
          const result = await platform.execute(name, args as Record<string, unknown>, { ...(run ? { signal: run } : {}), progress: { rungs: state.stall?.rungs ?? {} } });
          box.failed = result.isError === true;
          return result.data;
        }
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
    // A surface's own tool says for itself whether it failed; a registry tool says so with `ok: false`.
    const failed = own ? box.failed === true : !!capped && (capped as { ok?: unknown }).ok === false;
    return { data: capped, ...(box.control ? { control: box.control } : {}), ...(failed ? { isError: true } : {}) };
  } catch (err) {
    if (signal?.aborted) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    return { data: { ok: false, error: reason }, isError: true };
  }
}

/**
 * The result a call with unusable arguments gets INSTEAD of being run. The wording, and the
 * cut-off-vs-unparseable decision, belong to the kernel that sets the flag; the surface adds
 * only its own retry advice (`PlatformTools.malformed`). The tool never ran, but the kernel
 * counts the declined call as a failed dispatch, as it always has.
 */
function declineMalformedCall(ports: RunPorts, call: ParsedToolCall, facts: TurnFacts): LoopDispatchResult {
  const truncated = facts.interruption === "truncated";
  const policy = ports.platform?.malformed;
  const outcome = malformedCallOutcome(call, truncated, truncated ? policy?.retryHint : undefined);
  facts.refused = true;
  policy?.refused?.({ name: call.name, arguments: call.raw.arguments }, truncated, outcome);
  return { data: outcome, isError: true };
}
