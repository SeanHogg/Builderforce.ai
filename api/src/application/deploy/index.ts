/**
 * The `deploy()` primitive (compile primitive Phase C4, see
 * `PRD-agent-compile-primitive.md`).
 *
 *   deploy(spec, surface) → DeployPlan
 *
 * `deploy()` is the counterpart to `compile()`: it takes a finished {@link AgentSpec}
 * and resolves *where and how* it runs — the right engine (via the shared
 * `resolveEngineById` DI registry), the right transport for the surface, and the
 * lowered run input (system prompt + model + exec params) every engine consumes. It
 * reimplements nothing: a cloud plan is handed to the existing runtime dispatch, a
 * workflow plan to `instantiateWorkflowRun`, an IDE plan to the VS Code relay bridge.
 * One spec in; a ready-to-dispatch plan out, for any surface.
 *
 * A `surfaces` allow-list may be carried on the spec; deploying to a surface the spec
 * does not allow is rejected, so governance/authoring intent travels with the agent.
 */
import {
  DEFAULT_ENGINE_ID,
  ENGINE_IDS,
  lowerAgentSpec,
  type AgentRunInput,
  type AgentSpec,
  type AgentSurface,
} from '@builderforce/agent-tools';

/** How a surface receives a run — mirrors the existing dispatch transports. */
export type DeployTransport =
  | 'cloud-durable' // CloudRunnerDO alarm/tick
  | 'cloud-container' // AgentContainerDO
  | 'workflow-claim' // workflow_tasks claimed by a host or advanced by the cloud cron
  | 'ide-bridge' // VS Code relay
  | 'desktop-bridge'; // native-app relay

export interface DeployPlan {
  surface: AgentSurface;
  /** The engine that will drive the loop (resolved via the shared DI registry id). */
  engineId: string;
  transport: DeployTransport;
  /** The lowered run input every engine consumes (system prompt + model). */
  runInput: Omit<AgentRunInput, 'userContent'> & { userContent?: string };
  /** Persona execution levers the engine should apply (think/reasoning/temperature). */
  execParams: ReturnType<typeof lowerAgentSpec>['execParams'];
  /** True when this surface can be dispatched in-cloud today (vs. needs a host/IDE). */
  cloudDispatchable: boolean;
}

export interface DeployOptions {
  /** Engine override (e.g. select V3/limbic); defaults to the shared default. */
  engineId?: string;
}

const SURFACE_TRANSPORT: Record<AgentSurface, DeployTransport> = {
  'cloud-durable': 'cloud-durable',
  'cloud-container': 'cloud-container',
  'workflow-node': 'workflow-claim',
  ide: 'ide-bridge',
  desktop: 'desktop-bridge',
};

const CLOUD_DISPATCHABLE: ReadonlySet<AgentSurface> = new Set<AgentSurface>([
  'cloud-durable',
  'cloud-container',
  'workflow-node',
]);

/** Every surface `deploy()` can target — for the route to validate against. */
export const DEPLOY_SURFACES: readonly AgentSurface[] = Object.keys(SURFACE_TRANSPORT) as AgentSurface[];

/**
 * Resolve a spec onto a surface: pick the engine, choose the transport, and lower
 * the spec to the run input. Throws when the spec's `surfaces` allow-list excludes
 * the requested surface. Pure + synchronous — dispatch is the surface's job.
 */
export function deploy(spec: AgentSpec, surface: AgentSurface, opts: DeployOptions = {}): DeployPlan {
  if (spec.surfaces && spec.surfaces.length > 0 && !spec.surfaces.includes(surface)) {
    throw new Error(
      `Agent "${spec.identity?.name || spec.id || 'spec'}" is not allowed to deploy to "${surface}" (allowed: ${spec.surfaces.join(', ')})`,
    );
  }
  const lowered = lowerAgentSpec(spec);
  const engineId = opts.engineId ?? (spec.policy?.gates?.length ? DEFAULT_ENGINE_ID : DEFAULT_ENGINE_ID);
  // (V3/limbic is selectable via opts.engineId; default stays the consolidated V2.)
  void ENGINE_IDS;
  return {
    surface,
    engineId,
    transport: SURFACE_TRANSPORT[surface],
    runInput: { systemPrompt: lowered.systemPrompt, model: lowered.model },
    execParams: lowered.execParams,
    cloudDispatchable: CLOUD_DISPATCHABLE.has(surface),
  };
}
