/**
 * One model turn and one tool dispatch: the policy picks the tools and the model, the
 * transport answers, and every call goes through the core registry so the capability
 * gate holds at call time. Plus the one forced no-tools turn a run that never answered
 * gets before it settles.
 */

import { SKILL_TOOLS, SUBAGENT_TOOLS, buildCoreToolRegistry, type ToolRegistry, type ToolSchema } from "@builderforce/agent-tools";
import { malformedCallOutcome, type LoopDispatchResult, type LoopTurnResult, type ParsedToolCall, type TurnContext } from "@builderforce/agent-loop";
import { reduceRunPolicy } from "@builderforce/run-policy";
import { ModelTransportError, type ContextPack, type ModelCompletion, type ModelRequest, type RunMessage, type RunPorts, type RunState } from "./contract.js";
import { isTransportFailure } from "./surface.js";
import type { PolicyHooks } from "./policy/index.js";
import { routeAround, turnSucceeded, type TurnAsk } from "./policy/model/handoff.js";
import { runToolWithWatch, type InterruptWatch } from "./policy/steering/index.js";
import { toolsTokensOf } from "./policy/compaction/compact.js";
import { capToolResult, resultCapFor } from "./policy/tools/index.js";
import { currentView, emit, policyContext, type RunAgentInput, type TurnFacts } from "./runContext.js";
import { tallyTurn, type RunTally } from "./telemetry/runTally.js";
import { withVolatileTail } from "./turnContext.js";

/**
 * The registry the agent dispatches through. Built once: the catalog does not change per run.
 * Delegation and skill authoring are not core task tools, so they are registered on top of the
 * core set: a surface is offered them only by granting `orchestrate` / `skill.author`. Without
 * them a parent could never delegate - and a child, being a clone of its parent, could not either.
 */
const CORE_REGISTRY = buildCoreToolRegistry();
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

/**
 * Does the surface's own tool provider run this call? It runs the names the shared
 * registry does not - all of them, when it declares its catalog closed.
 */
export function ownsCall(ports: RunPorts, name: string): boolean {
  const platform = ports.platform;
  return platform !== undefined && (platform.closed === true || !registryOf(ports).has(name));
}

/** The schemas the model is offered, before the tools policy narrows them: the registry's, then the surface's own. */
export function offeredSchemas(ports: RunPorts): ToolSchema[] {
  const seen = new Set<string>();
  return [...registryOf(ports).schemasFor(ports.capabilities), ...(ports.extensions?.schemas() ?? []), ...(ports.platform?.schemas({ rungs: {} }) ?? [])].filter((schema) => {
    const name = schema.function?.name;
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

/**
 * What served a turn is what the next one asks for - except `default` (the gateway's own
 * auto label, not a model) and under a strict pin, which the policy keeps. The ONE write of
 * the served model, for the turn and for the closing synthesis alike.
 */
function adoptServedModel(state: RunState, served: string | undefined): void {
  if (served && served !== "default" && !state.model.strictPin) state.model = { ...state.model, model: served };
}

/** What a request carries beyond the transcript and the tools: the turn's ask of the transport. */
function askFields(ask: Partial<TurnAsk> | undefined): Partial<ModelRequest> {
  if (!ask) return {};
  return {
    ...(ask.role ? { role: ask.role } : {}),
    ...(ask.phase ? { phase: ask.phase } : {}),
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
  /** The step's tool selection when `beforeTurn` already made it (compaction charged those schemas). */
  made?: { tools: readonly ToolSchema[] | void },
): Promise<LoopTurnResult> {
  const view = currentView(transcript, offered);
  const pctx = policyContext(input, state, view, ctx.step, ctx.stepInCall);
  const selected = made ? made.tools : await hooks.tools.select(pctx, offered);
  // An empty selection is a decision, not an absence: a module that returns `[]` has
  // chosen that this run may call nothing. Only `undefined` means "not my concern".
  const tools = selected ? [...selected] : offered;
  const advertisedSet = tools.map((t) => t.function?.name ?? "").join(",");
  if (state.advertisedSignature !== advertisedSet) {
    state.advertisedSignature = advertisedSet;
    await emit(input.ports.events, { kind: "context.tools", step: ctx.step, advertised: tools.length, catalog: offered.length, toolsTokens: toolsTokensOf(tools), loaded: state.loadedTools ?? [] });
  }
  // The model policy is asked about the tools this turn will ADVERTISE: a turn with none
  // is conversation, and asks for the `chat` role.
  const mctx = { ...pctx, tools };
  const decision = await hooks.model.resolve(mctx);
  // The model ASKED for: the policy's pick - absent on purpose after a pin was released -
  // else, only when no policy spoke, the pin. Never the model a previous turn was served,
  // which would read every later turn as a downgrade from it.
  const model = decision ? decision.model : input.policy.pinnedModel;
  const brief = await hooks.memory.brief(pctx);
  const messages = withVolatileTail(transcript, pack, brief ?? null, input.ports.context.turnSections?.() ?? []);
  const fields = hooks.model.turnFields?.(mctx);
  const reasoning = hooks.guards.reasoning?.(pctx);

  // What the turn asks of the transport: the decision's role, strictness and exclusions, then the
  // policy's own turn fields (the run phase and a stall recovery's forced tool choice).
  const firstAsk: Partial<TurnAsk> = {
    ...(decision?.role ? { role: decision.role } : {}),
    ...(decision?.strict ? { strict: true } : {}),
    ...(decision?.excludeModels && decision.excludeModels.length > 0 ? { excludeModels: [...decision.excludeModels] } : {}),
    ...(fields ?? {}),
  };
  const requestFor = (askedModel: string | undefined, ask: Partial<TurnAsk> | undefined): ModelRequest => ({
    messages,
    ...(askedModel ? { model: askedModel, strict: ask?.strict ?? false } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    ...(decision?.maxTokens !== undefined ? { maxTokens: decision.maxTokens } : {}),
    ...askFields(ask),
    ...(reasoning ? { reasoning } : {}),
  });

  let asked = model;
  let completion: ModelCompletion;
  try {
    completion = await input.ports.model.complete(requestFor(model, firstAsk), input.signal);
  } catch (err) {
    if (input.signal?.aborted) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    if (isResumable(input, err)) causes.set(state, err);
    // A provider that broke is routed around - a model that already acted takes over, or
    // the gateway's pool is asked again without the broken one - before the turn is lost.
    if (isTransportFailure(err) && hooks.model.recoverFailure) {
      const route = hooks.model.recoverFailure(pctx, err.failure, err.failure.model ?? model, reason);
      if (route.kind === "retry") {
        if (route.note) transcript.push({ role: "system", content: route.note });
        return { skip: true };
      }
      return { failed: `provider failed: ${reason}` };
    }
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

  // The turn answered: the policy locks onto what served it (when configured to) and records it
  // proven when it acted - the hand-off a later stall or failure draws on; the served model is
  // then the run's current one.
  turnSucceeded(state, { acted: (completion.toolCalls ?? []).length > 0, ...(completion.model ? { model: completion.model } : {}) });
  adoptServedModel(state, completion.model);
  // A turn answered by another model than it asked for — or an auto-routed turn that
  // landed on a degraded one — is said, never silent (E7).
  const downgrade = hooks.model.downgrade?.(pctx, asked, completion.model);
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
  // else - only when no policy spoke - the pin.
  const model = decision ? decision.model : input.policy.pinnedModel;
  const fields = hooks.model.turnFields?.(pctx);
  const ask: RunMessage = { role: "user", content: prompt };
  let completion: ModelCompletion;
  try {
    completion = await input.ports.model.complete(
      {
        messages: [...withVolatileTail(transcript, pack, null, input.ports.context.turnSections?.() ?? []), ask],
        ...(model ? { model, strict: decision?.strict ?? false } : {}),
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
 * not exist instead of having it run. A tool the surface runs itself (`ports.extensions`)
 * is dispatched by the surface, under the same step signal, cap and coverage.
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
        const extension = ports.extensions;
        if (extension?.handles(name)) {
          const ran = await extension.dispatch(name, args as Record<string, unknown>, run);
          if (ran.isError) box.failed = true;
          if (ran.control) box.control = ran.control;
          return ran.data;
        }
        if (platform && own) {
          const result = await platform.execute(name, args as Record<string, unknown>, { ...(run ? { signal: run } : {}), progress: { rungs: state.stall?.rungs ?? {} } });
          box.failed = result.isError === true;
          return result.data;
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
    // A surface's own tool says for itself whether it failed; a registry tool says so with `ok: false`.
    const failed = box.failed === true || (!own && !!capped && (capped as { ok?: unknown }).ok === false);
    return { data: capped, ...(box.control ? { control: box.control } : {}), ...(failed ? { isError: true } : {}) };
  } catch (err) {
    // A resumable interruption (a platform eviction) is not the tool's failure to hand the model: it ends this tick and the host re-arms.
    if (signal?.aborted || isResumable(input, err)) throw err;
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
