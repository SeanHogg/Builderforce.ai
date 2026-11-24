/**
 * openRun — THE one entry into the agent runtime. Every surface (VSIX, Brain, cloud, @-reply, runtime) opens a run
 * through here with its PORTS and its facts; none of them replaces a policy module whole or calls `runAgent` itself
 * (`check:one-execution` enforces it). openRun does four things, in this order:
 *
 *   1. refuses a run whose `policy.entryPoint` is missing (never defaults it);
 *   2. restores the admitted route on resume or decides it from the task and host settings, then seeds the model policy;
 *   3. composes ONE module set from the surface's ports through the existing factories — an absent port is the
 *      module's honest default;
 *   4. calls `runAgent`.
 */
import { ALL_ENTRY_POINTS } from "@builderforce/learned-routing";
import { RUN_CANCELLED_REASON, type RunOutcome, type RunPolicy } from "./contract.js";
import { createCompactionHook, type CompactionHookOptions } from "./policy/compaction/index.js";
import { createFinishHook, type FinishPorts } from "./policy/finish/index.js";
import { createGuardsHook, type GuardPorts } from "./policy/guards/index.js";
import { withShipGate, type PublishGatePort } from "./policy/guards/shipGate.js";
import type { FinishHook, PolicyContext } from "./policy/hooks.js";
import type { PolicyModules } from "./policy/index.js";
import { createModelHook, type RecordedModelPreflight } from "./policy/model/index.js";
import { createVerifyHook, type VerifyPorts } from "./policy/verify/index.js";
import { defaultPipelineRouting, routeRun, type RouteDecision, type RouteInput } from "./route/routeRun.js";
import { currentView, emit, policyContext, type RunAgentInput } from "./runContext.js";
import { runAgent } from "./runAgent.js";
import { tapEvents } from "./tapEvents.js";
import { measureWorkflowSync, workflowScope } from "./telemetry/workflowMetrics.js";

export type { RouteDecision, RouteInput } from "./route/routeRun.js";
export type { PublishGatePort } from "./policy/guards/shipGate.js";

/** What a surface supplies: ports only. Each is optional; absent ⇒ the module's honest default. */
export interface SurfacePorts {
  /** The finish gate's couplings (`openWork`, `liveChildren`, CI / placeholder ports). */
  finish?: FinishPorts;
  /**
   * Runs before the finish gate. A throw is traced (`finish.close_out_error`) and NEVER refuses the finish — the gate that
   * follows is the authority.
   */
  closeOut?: CloseOutPort;
  guards?: GuardPorts;
  verify?: VerifyPorts;
  /** Shared compaction strategy inputs: transport, native history storage and observations. */
  compaction?: CompactionHookOptions;
  /** Facts from a host preflight that already emitted its notices; the shared factory owns the verdict and event. */
  preflight?: RecordedModelPreflight;
  /** Refuse the model's raw publish calls under the run's ship policy (PRD 48 §4.2), reporting each refusal. */
  publishGate?: PublishGatePort;
}

/** What a surface hands openRun: the run's input minus the modules, plus its ports and the facts to route by. */
export interface OpenRunInput extends Omit<RunAgentInput, "modules" | "pipeline"> {
  surface?: SurfacePorts;
  /**
   * The facts to route by, or a route a surface already DECIDED (`{ input, decided }`: the Brain decides once, up front, to size its
   * turn budget by it). A decided route is used as handed — `routeRun` is not run again — and is traced as the same one `run.routed`.
   */
  route?: RouteInput | { input: RouteInput; decided: RouteDecision };
}

/**
 * Which close-out this is. `finish`: the run reached the finish gate (upkeep AND the finish-only work: review, move to done).
 * `settled`: the run ended WITHOUT passing the gate (failed, paused on a question, stopped by the breaker): the always-on upkeep
 * only (attach/mint the ticket for late edits, advance in_progress) — never the finish-only work.
 */
export type CloseOutMode = "finish" | "settled";

/** The run's close-out port: ONE per run, told which case it is. */
export type CloseOutPort = (ctx: PolicyContext, mode: CloseOutMode) => Promise<void>;

/** Run the port, tracing (never rethrowing) a failure: a close-out never refuses a finish or a settle. */
async function runCloseOut(closeOut: CloseOutPort, ctx: PolicyContext, mode: CloseOutMode): Promise<void> {
  try {
    await closeOut(ctx, mode);
  } catch (err) {
    await emit(ctx.ports.events, { kind: "finish.close_out_error", step: ctx.step, reason: err instanceof Error ? err.message : String(err) });
  }
}

function withCloseOut(finish: FinishHook, closeOut: CloseOutPort, ran: { value: boolean }): FinishHook {
  return {
    ...finish,
    async openWork(ctx) {
      ran.value = true;
      await runCloseOut(closeOut, ctx, "finish");
      return finish.openWork?.(ctx) ?? null;
    },
    async gate(ctx) {
      ran.value = true;
      await runCloseOut(closeOut, ctx, "finish");
      return finish.gate(ctx);
    },
  };
}

/** The ONE module set a surface's ports compose into. */
function composeModules(surface: SurfacePorts, ran: { value: boolean }): Partial<PolicyModules> {
  const modules: Partial<PolicyModules> = {};
  if (surface.finish || surface.closeOut) {
    const finish = createFinishHook(surface.finish);
    modules.finish = surface.closeOut ? withCloseOut(finish, surface.closeOut, ran) : finish;
  }
  if (surface.guards || surface.publishGate) modules.guards = withShipGate(createGuardsHook(surface.guards), surface.publishGate);
  if (surface.verify) modules.verify = createVerifyHook(surface.verify);
  if (surface.compaction) modules.compaction = createCompactionHook(surface.compaction);
  if (surface.preflight) modules.model = createModelHook({ recordedPreflight: surface.preflight });
  return modules;
}

/**
 * Fold the route into the host's existing model policy. Hosts without a modelStart seed keep
 * their model options, with the phase and pins supplied by the route. Unscored runs keep
 * their selection, while a configured child seed starts in code.
 */
export function routedPolicy(policy: RunPolicy, route: RouteInput, decision: RouteDecision): RunPolicy {
  const { pipeline, start, skipsVerify } = decision;
  const prior = policy.modelStart;
  const folded: RunPolicy = skipsVerify ? { ...policy, skipVerifyStage: true } : policy;
  if (!prior) {
    if (!pipeline) return folded;
    return {
      ...folded,
      ...(start.pinnedModel ? { pinnedModel: start.pinnedModel } : {}),
      modelOptions: { ...policy.modelOptions, startPhase: start.startPhase, ...(start.phaseModels ? { phaseModels: start.phaseModels } : {}) },
    };
  }
  // An unrouted run still carries the host's stage models (they reach the run through the route input, the ONE path), and a sub-agent starts in `code`.
  if (!pipeline) {
    if (!route.child && !start.phaseModels) return folded;
    return { ...folded, modelStart: { ...prior, ...(route.child ? { startPhase: "code" as const } : {}), ...(start.phaseModels ? { phaseModels: start.phaseModels } : {}) } };
  }
  const model = start.pinnedModel ?? prior.model;
  return {
    ...folded,
    modelStart: {
      ...prior,
      ...(model ? { model } : {}),
      ...(route.modelStrict !== undefined ? { strict: route.modelStrict } : {}),
      ...(start.startPhase && !prior.delegatedRole ? { startPhase: start.startPhase } : {}),
      ...(start.phaseModels ? { phaseModels: start.phaseModels } : {}),
    },
  };
}

/** Open one run through the one entry. See the file header. */
export async function openRun(input: OpenRunInput): Promise<RunOutcome> {
  measureWorkflowSync(input.ports.events, workflowScope(input), 'start', () => {
    if (!input.policy?.entryPoint) throw new Error("openRun: policy.entryPoint is required");
    if (!ALL_ENTRY_POINTS.includes(input.policy.entryPoint)) throw new Error("openRun: policy.entryPoint must be registered");
    if (!input.ports.capabilities && !input.ports.platform?.closed) {
      throw new Error("openRun: a registry provider or a closed native catalog is required");
    }
  });
  const { surface = {}, route: requested, ...rest } = input;
  const route = requested && "decided" in requested ? requested : {
    request: rest.task.request ?? rest.task.prompt,
    child: rest.task.dispatch.source === "subagent",
    modelStrict: rest.policy.modelStart?.strict ?? rest.policy.modelOptions?.strictPin,
    ...requested,
    routing: requested?.routing ?? defaultPipelineRouting(),
  };
  const closeOutRan = { value: false };
  let run: RunAgentInput = { ...rest, modules: measureWorkflowSync(rest.ports.events, workflowScope(input), 'compose', () => composeModules(surface, closeOutRan)) };
  if (run.resume?.pipeline !== undefined) {
    if (run.resume.pipeline?.route === "quick") run = { ...run, policy: { ...run.policy, skipVerifyStage: true } };
  } else {
    const input: RouteInput = "decided" in route ? route.input : route;
    // A supplied decision was measured where it was made; intake is not a second route decision.
    const decision: RouteDecision = "decided" in route ? route.decided : measureWorkflowSync(run.ports.events, workflowScope(run), 'route', () => routeRun(route), (r) => ({ quick: Number(r.pipeline?.route === 'quick'), full: Number(r.pipeline?.route === 'full') }));
    run = { ...run, policy: routedPolicy(run.policy, input, decision) };
    // The route is traced once per run, right after `run.started`; a resumed tick is not a start.
    const { pipeline } = decision;
    run.pipeline = pipeline ? { route: pipeline.route, score: pipeline.score } : null;
    if (pipeline && !run.resume) {
      let said = false;
      run = {
        ...run,
        ports: {
          ...run.ports,
          events: tapEvents(run.ports.events, {
            after: async (event, sink) => {
              if (said || event.kind !== "run.started") return;
              said = true;
              await sink?.emit({ kind: "run.routed", step: event.step, route: pipeline.route, score: pipeline.score });
            },
          }),
        },
      };
    }
  }
  const outcome = await runAgent(run);
  // A run that settled without passing the finish gate (failed, paused on a question, stopped by the breaker) still gets the
  // always-on upkeep, once, in `settled` mode. A user Stop never had a close-out, and a yield resumes later (it has not settled).
  const stoppedByUser = outcome.kind === "failed" && outcome.reason === RUN_CANCELLED_REASON;
  const settledUnfinished = outcome.kind === "paused" || (outcome.kind === "failed" && !stoppedByUser);
  if (surface.closeOut && settledUnfinished && !closeOutRan.value) {
    closeOutRan.value = true;
    await runCloseOut(surface.closeOut, policyContext(run, outcome.state, currentView([], []), outcome.state.step, 0), "settled");
  }
  return outcome;
}
