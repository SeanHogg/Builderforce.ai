/**
 * openRun — THE one entry into the agent runtime. Every surface (VSIX, Brain, cloud, @-reply, runtime) opens a run
 * through here with its PORTS and its facts; none of them replaces a policy module whole or calls `runAgent` itself
 * (`check:one-execution` enforces it). openRun does four things, in this order:
 *
 *   1. refuses a run whose `policy.entryPoint` is missing (never defaults it);
 *   2. routes the run (`routeRun`) when the surface handed a {@link RouteInput}, and folds the start into the run's
 *      initial model policy — so a surface hands the request, never a pre-built start;
 *   3. composes ONE module set from the surface's ports through the existing factories — an absent port is the
 *      module's honest default;
 *   4. calls `runAgent`.
 */
import type { RunOutcome, RunPolicy, RunState } from "./contract.js";
import { createCompactionHook, type CompactionHookOptions } from "./policy/compaction/index.js";
import { createFinishHook, type FinishPorts } from "./policy/finish/index.js";
import { createGuardsHook, type GuardPorts } from "./policy/guards/index.js";
import { withShipGate, type PublishGatePort } from "./policy/guards/shipGate.js";
import type { CompactionHook, FinishHook, GuardsHook, ModelHook, PolicyContext } from "./policy/hooks.js";
import { defaultPolicyModules, type PolicyModules } from "./policy/index.js";
import { createVerifyHook, type VerifyPorts } from "./policy/verify/index.js";
import { routeRun, type RouteInput } from "./route/routeRun.js";
import { emit, type RunAgentInput } from "./runContext.js";
import { runAgent } from "./runAgent.js";

export type { RouteInput } from "./route/routeRun.js";
export type { PublishGatePort } from "./policy/guards/shipGate.js";

/** What a surface supplies: ports only. Each is optional; absent ⇒ the module's honest default. */
export interface SurfacePorts {
  /** The finish gate's couplings (`openWork`, `liveChildren`, CI / placeholder ports). */
  finish?: FinishPorts;
  /**
   * Runs before the finish gate. A throw is traced (`finish.close_out_error`) and NEVER refuses the finish — the gate that
   * follows is the authority.
   */
  closeOut?: (ctx: PolicyContext) => Promise<void>;
  guards?: GuardPorts;
  verify?: VerifyPorts;
  /** Summarizer options for the agent's compaction, or a surface's own fold. */
  // TODO(ROADMAP 'One pipeline' item 6): the `{ hook }` form is transitional (the VSIX brainFold) — retire it once the fold is the agent's.
  compaction?: CompactionHookOptions | { hook: CompactionHook };
  /** The model preflight the run records before turn 1. */
  preflight?: ModelHook["preflight"];
  /** Refuse the model's raw publish calls under the run's ship policy (PRD 48 §4.2), reporting each refusal. */
  publishGate?: PublishGatePort;
  /** Called with the run's live state whenever a guard hook runs, so the surface's guard ports can read it. */
  onState?: (state: RunState) => void;
}

/** What a surface hands openRun: the run's input minus the modules, plus its ports and the facts to route by. */
export interface OpenRunInput extends Omit<RunAgentInput, "modules"> {
  surface?: SurfacePorts;
  route?: RouteInput;
}

/** The guards hook that names the run's live state to the surface before every method runs. */
function withStateBound(guards: GuardsHook, onState: (state: RunState) => void): GuardsHook {
  const bound: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(guards)) {
    bound[key] = typeof member === "function"
      ? (ctx: PolicyContext, ...rest: unknown[]) => { onState(ctx.state); return (member as (...a: unknown[]) => unknown).call(guards, ctx, ...rest); }
      : member;
  }
  return bound as unknown as GuardsHook;
}

function withCloseOut(finish: FinishHook, closeOut: (ctx: PolicyContext) => Promise<void>): FinishHook {
  return {
    ...finish,
    async gate(ctx) {
      try {
        await closeOut(ctx);
      } catch (err) {
        await emit(ctx.ports.events, { kind: "finish.close_out_error", step: ctx.step, reason: err instanceof Error ? err.message : String(err) });
      }
      return finish.gate(ctx);
    },
  };
}

/** The ONE module set a surface's ports compose into. */
function composeModules(surface: SurfacePorts): Partial<PolicyModules> {
  const modules: Partial<PolicyModules> = {};
  if (surface.finish || surface.closeOut) {
    const finish = createFinishHook(surface.finish);
    modules.finish = surface.closeOut ? withCloseOut(finish, surface.closeOut) : finish;
  }
  if (surface.guards || surface.publishGate || surface.onState) {
    let guards = withShipGate(createGuardsHook(surface.guards), surface.publishGate);
    if (surface.onState) guards = withStateBound(guards, surface.onState);
    modules.guards = guards;
  }
  if (surface.verify) modules.verify = createVerifyHook(surface.verify);
  if (surface.compaction) modules.compaction = "hook" in surface.compaction ? surface.compaction.hook : createCompactionHook(surface.compaction);
  if (surface.preflight) modules.model = { ...defaultPolicyModules().model, preflight: surface.preflight };
  return modules;
}

/** The policy with the route's start folded into its initial model policy (`modelStart`) and pins. */
function routedPolicy(policy: RunPolicy, route: RouteInput, start: ReturnType<typeof routeRun>["start"]): RunPolicy {
  const prior = policy.modelStart;
  const model = start.pinnedModel ?? prior?.model;
  return {
    ...policy,
    modelStart: {
      plain: true,
      ...prior,
      ...(model ? { model } : {}),
      ...(route.modelStrict !== undefined ? { strict: route.modelStrict } : {}),
      ...(start.startPhase ? { startPhase: start.startPhase } : {}),
      ...(start.phaseModels ? { phaseModels: start.phaseModels } : {}),
    },
  };
}

/** Open one run through the one entry. See the file header. */
export async function openRun(input: OpenRunInput): Promise<RunOutcome> {
  if (!input.policy?.entryPoint) throw new Error("openRun: policy.entryPoint is required");
  const { surface = {}, route, ...rest } = input;
  let run: RunAgentInput = { ...rest, modules: composeModules(surface) };
  if (route) {
    const { pipeline, start } = routeRun(route);
    run = { ...run, policy: routedPolicy(run.policy, route, start) };
    // The route is traced once per run, right after `run.started`; a resumed tick is not a start.
    if (pipeline && !run.resume) {
      const events = run.ports.events;
      let said = false;
      run = {
        ...run,
        ports: {
          ...run.ports,
          events: {
            ...(events.outcome ? { outcome: (row) => events.outcome!(row) } : {}),
            emit: async (event, meta) => {
              await events.emit(event, meta);
              if (!said && event.kind === "run.started") {
                said = true;
                await events.emit({ kind: "run.routed", step: event.step, route: pipeline.route, score: pipeline.score });
              }
            },
          },
        },
      };
    }
  }
  return runAgent(run);
}
