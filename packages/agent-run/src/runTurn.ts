/**
 * One model turn and one tool dispatch: the policy picks the tools and the model, the
 * transport answers, and every call goes through the core registry so the capability
 * gate holds at call time. Plus the one forced no-tools turn a run that never answered
 * gets before it settles.
 */

import { SKILL_TOOLS, SUBAGENT_TOOLS, buildCoreToolRegistry, type ToolRegistry, type ToolSchema } from "@builderforce/agent-tools";
import type { LoopDispatchResult, LoopTurn, ParsedToolCall, TurnContext } from "@builderforce/agent-loop";
import { ModelTransportError, type ContextPack, type ModelCompletion, type ModelRequest, type RunMessage, type RunPorts, type RunState } from "./contract.js";
import type { PolicyHooks } from "./policy/index.js";
import { routeAround, turnSucceeded, type TurnAsk } from "./policy/model/handoff.js";
import { runToolWithWatch, type InterruptWatch } from "./policy/steering/index.js";
import { toolsTokensOf } from "./policy/compaction/compact.js";
import { capToolResult, resultCapFor } from "./policy/tools/index.js";
import { currentView, emit, policyContext, type RunAgentInput } from "./runContext.js";
import { tallyTurn, type RunTally } from "./telemetry/runTally.js";
import { withVolatileTail } from "./turnContext.js";

/** The registry the agent dispatches through. Built once: the catalog does not change per run. */
const CORE_REGISTRY = buildCoreToolRegistry();
// Skill authoring and delegation are capability-gated (`skill.author` / `orchestrate`), so a surface gets them only by backing them.
for (const tool of [...SKILL_TOOLS, ...SUBAGENT_TOOLS]) CORE_REGISTRY.register(tool);
/** The registries of entry points that bring tools of their own (skill authoring, delegation), built once per tool list. */
const REGISTRIES = new WeakMap<readonly object[], ToolRegistry>();

/** The registry THIS run dispatches through: the core catalog, plus whatever the entry point supplied as data. */
function registryOf(ports: RunPorts): ToolRegistry {
  const extra = ports.tools;
  if (!extra || extra.length === 0) return CORE_REGISTRY;
  let registry = REGISTRIES.get(extra);
  if (!registry) {
    registry = buildCoreToolRegistry();
    for (const tool of extra) registry.register(tool);
    REGISTRIES.set(extra, registry);
  }
  return registry;
}

/** Non-transport exceptions that failed a turn, per run: the surface decides whether they are a failure or an eviction. */
const causes = new WeakMap<object, unknown>();

/** Whether the SURFACE says an exception a port threw is a resumable interruption (it re-arms the run) rather than the run's failure. A transport failure is never one. */
export function isResumable(input: RunAgentInput, err: unknown): boolean {
  return !(err instanceof ModelTransportError) && input.ports.store.isResumable?.(err) === true;
}
export function causeOf(state: object): unknown {
  return causes.get(state);
}

/** The hard cap on the forced synthesis turn's answer — the source's bounded extra call. */
const SYNTHESIS_MAX_TOKENS = 1_000;

/** The schemas the model is offered, before the tools policy narrows them: the registry's, then the surface's own. */
export function offeredSchemas(ports: RunPorts): ToolSchema[] {
  const seen = new Set<string>();
  return [...registryOf(ports).schemasFor(ports.capabilities), ...(ports.extensions?.schemas() ?? [])].filter((schema) => {
    const name = schema.function?.name;
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

/** What a request carries beyond the transcript and the tools: the turn's ask of the transport. */
function askFields(ask: TurnAsk | undefined): Partial<ModelRequest> {
  if (!ask) return {};
  return {
    role: ask.role,
    phase: ask.phase,
    ...(ask.toolChoice ? { toolChoice: ask.toolChoice } : {}),
    ...(ask.strict ? { strict: true } : {}),
    ...(ask.excludeModels && ask.excludeModels.length > 0 ? { excludeModels: ask.excludeModels } : {}),
  };
}

/**
 * One model turn: the policy picks the tools and the model, the memory policy writes the
 * brief, and the transport answers. The request carries the transcript plus this turn's
 * volatile tail (the pack, the brief and the surface's own sections) LAST — the tail is
 * never written into the transcript, so the cached prefix and the saved state never hold it.
 *
 * A transport that answers a failure the model policy routes around (a rate limit, a
 * window refusal, an outage — `ModelTransportError`) is asked ONCE more on the cascade
 * the policy chose (`completeUnderRunPolicy`, ported in `policy/model/handoff.ts`).
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
  const advertisedSet = tools.map((t) => t.function?.name ?? "").join(",");
  if (state.advertisedSignature !== advertisedSet) {
    state.advertisedSignature = advertisedSet;
    await emit(input.ports.events, { kind: "context.tools", step: ctx.step, advertised: tools.length, catalog: offered.length, toolsTokens: toolsTokensOf(tools), loaded: state.loadedTools ?? [] });
  }
  const decision = await hooks.model.resolve(pctx);
  // The model ASKED for: the policy's pick, else the pin — never the model a previous turn
  // was served, which would read every later turn as a downgrade from it.
  const model = decision ? decision.model : input.policy.pinnedModel;
  const brief = await hooks.memory.brief(pctx);
  const messages = withVolatileTail(transcript, pack, brief ?? null, input.ports.context.turnSections?.() ?? []);
  const fields = hooks.model.turnFields?.(pctx);
  const reasoning = hooks.guards.reasoning?.(pctx);

  const requestFor = (askedModel: string | undefined, ask: TurnAsk | undefined): ModelRequest => ({
    messages,
    ...(askedModel ? { model: askedModel } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    ...(decision?.maxTokens !== undefined ? { maxTokens: decision.maxTokens } : {}),
    ...askFields(ask),
    ...(reasoning ? { reasoning } : {}),
  });

  let asked = model;
  let completion: ModelCompletion;
  try {
    completion = await input.ports.model.complete(requestFor(model, fields), input.signal);
  } catch (err) {
    if (input.signal?.aborted) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    if (isResumable(input, err)) causes.set(state, err);
    const routed = err instanceof ModelTransportError && err.routable ? routeAround(state, err.status) : null;
    if (!routed) return { failed: reason };
    await emit(input.ports.events, { kind: "model.cascade", step: ctx.step, from: routed.from, status: err instanceof ModelTransportError ? err.status ?? null : null, released: routed.released });
    asked = routed.retry.model;
    try {
      completion = await input.ports.model.complete(requestFor(routed.retry.model, routed.retry), input.signal);
    } catch (retryErr) {
      if (input.signal?.aborted) throw retryErr;
      if (isResumable(input, retryErr)) causes.set(state, retryErr);
      return { failed: retryErr instanceof Error ? retryErr.message : String(retryErr) };
    }
  }

  // The turn succeeded: the policy locks onto what served it (when configured to) and
  // records it proven when it acted; the served model is then the run's current one.
  turnSucceeded(state, { acted: (completion.toolCalls ?? []).length > 0, ...(completion.model ? { model: completion.model } : {}) });
  if (completion.model) state.model = { ...state.model, model: completion.model };
  // A turn answered by another model than it asked for — or an auto-routed turn that
  // landed on a degraded one — is said, never silent (E7).
  const downgrade = hooks.model.downgrade?.(pctx, asked, completion.model);
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
  tally: RunTally,
): Promise<string | null> {
  if (input.signal?.aborted) return null;
  const pctx = policyContext(input, state, currentView(transcript, []), state.step, 0);
  const prompt = hooks.stall.synthesis?.(pctx);
  if (!prompt) return null;

  const decision = await hooks.model.resolve(pctx);
  // The model ASKED for: the policy's pick, else the pin — never the model a previous turn
  // was served, which would read every later turn as a downgrade from it.
  const model = decision ? decision.model : input.policy.pinnedModel;
  const fields = hooks.model.turnFields?.(pctx);
  const ask: RunMessage = { role: "user", content: prompt };
  let completion: ModelCompletion;
  try {
    completion = await input.ports.model.complete(
      {
        messages: [...withVolatileTail(transcript, pack, null, input.ports.context.turnSections?.() ?? []), ask],
        ...(model ? { model } : {}),
        maxTokens: SYNTHESIS_MAX_TOKENS,
        ...askFields(fields),
      },
      input.signal,
    );
  } catch (err) {
    // A resumable interruption (an eviction) is not "the model said nothing": it ends this tick and the host re-arms the run.
    if (isResumable(input, err)) throw err;
    return null;
  }
  if (completion.model) state.model = { ...state.model, model: completion.model };
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
 * not exist instead of having it run. A tool the surface runs itself (`ports.extensions`)
 * is dispatched by the surface, under the same step signal, cap and coverage.
 *
 * A foreground command runs under a step signal that the run's Stop and an interrupting
 * steer both abort (`runToolWithWatch`, §6.3). The result is capped ONCE, to the serving
 * model's window (`resultCapFor`, §6.10) — what the model is served is what the read
 * coverage records.
 */
export async function dispatchCall(input: RunAgentInput, state: RunState, call: ParsedToolCall, watch: InterruptWatch): Promise<LoopDispatchResult> {
  const { ports, signal } = input;
  try {
    const box: { control?: LoopDispatchResult["control"]; failed?: boolean } = {};
    const data = await runToolWithWatch(
      async (name, args, stepSignal) => {
        const run = stepSignal ?? signal;
        const extension = ports.extensions;
        if (extension?.handles(name)) {
          const ran = await extension.dispatch(name, args as Record<string, unknown>, run);
          if (ran.isError) box.failed = true;
          if (ran.control) box.control = ran.control;
          return ran.data;
        }
        const result = await registryOf(ports).dispatch(name, args as Record<string, unknown>, { caps: ports.capabilities, ...(run ? { signal: run } : {}) });
        box.control = result.control;
        return extension?.shape ? extension.shape(name, result.data) : result.data;
      },
      watch,
      signal,
      call.name,
      call.args,
    );
    const capped = capToolResult(call.name, data, resultCapFor(call.name, ports.model, state.model.model));
    const failed = box.failed || Boolean(capped && (capped as { ok?: unknown }).ok === false);
    return { data: capped, ...(box.control ? { control: box.control } : {}), ...(failed ? { isError: true } : {}) };
  } catch (err) {
    // A resumable interruption (a platform eviction) is not the tool's failure to hand the model: it ends this tick and the host re-arms.
    if (signal?.aborted || isResumable(input, err)) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    return { data: { ok: false, error: reason }, isError: true };
  }
}
