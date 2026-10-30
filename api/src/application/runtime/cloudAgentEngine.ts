/**
 * Cloud agent ENGINE SEAM — "run a cloud agent against a ticket" (PRD 35 WS3).
 *
 * This used to be the 2,400-line cloud loop: the model→tools→model skeleton, the compaction,
 * stall, steering, finish, guard, verify and memory policy, the provider, the PR finalize, the
 * prompt prep and the affect layer in one file. The POLICY is now the one agent
 * (`@builderforce/agent-run`) — the cloud only supplies ports, in `cloudAdapter.ts`. What stayed
 * host work moved to its own module and is re-exported here, so every importer keeps working:
 *
 *   cloudAdapter.ts   — builds the ports and runs the agent (one step per Durable Object tick)
 *   cloudRunHost.ts   — the once-per-run resolution (repo, routing, accounts, pick, identity, provider)
 *   cloudPrepare.ts   — the PRD + prompts a run is handed, and the RUNNING transition
 *   cloudFinalize.ts  — landing a finished run (PR, merge, summary)
 *   cloudLimbic.ts    — the affective state
 *   cloudProvider.ts  — the capability backing (git API, static check, memory, web, PRD)
 *
 * What is left is the {@link AgentEngine} the dispatch sites resolve (`resolveAgentEngine`): the V3
 * engine, which seeds the affect the adapter injects per turn and hands the run to the adapter.
 * Framework-free (no Hono), so it is unit-testable against a mocked gateway/DB.
 */
import type { ArcStage } from '@builderforce/workload';
import type { RunTally } from '@builderforce/agent-run';
import {
  CURRENT_ENGINE_ID, type AgentEngine, type AgentExecParams, type AgentRunInput, type AgentRunResult, type CapabilityProvider,
} from '@builderforce/agent-tools';
import { buildLimbicBlock, type LimbicState } from '@seanhogg/builderforce-memory-engine/limbic';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { ResolvedArtifacts } from '../../domain/shared/types';
import { loadPersonaSetpoints } from '../artifact/capabilityContext';
import { runCloudAgent } from './cloudAdapter';
import { initialCloudLimbicState, recordLimbicState } from './cloudLimbic';
import { isChildDelegation, type CloudRunDelegation } from './cloudRunDelegation';
import type { RequiredReviewSignoff } from './cloudAgent/finishGates';
import type { RunSandbox } from './sandbox/runSandbox';
import type { CloudLoopState } from './cloudRunState';

// The engine's identity and model-routing slices live in their own modules (cloudAgent/agent.ts, routing.ts);
// re-exported because existing importers reference them through this module.
export {
  DEFAULT_CLOUD_REF, agentAllowsHostExecution,
  resolveCloudAgent,
} from './cloudAgent/agent';
export type { ResolvedCloudAgent } from './cloudAgent/agent';
export {
  emitCodingModelDegraded, emitModelSelection, isCodingModelDegraded,
} from './cloudAgent/routing';
export type { CloudRouting, LearnedRoutingInputs } from './cloudAgent/routing';
export { matchesRequiredReviewSignoff, missingReviewVerdictMessage, type RequiredReviewSignoff } from './cloudAgent/finishGates';
export { recordPrdDirective } from './cloudAgent/prd';
export { recordCloudToolEvent } from './cloudToolEvents';
export { parseLlmChoice, recordCloudUsage } from './cloudAgent/cloudLlmTurn';
export { prepareCloudRun, markCloudExecutionRunning } from './cloudPrepare';
export { initialCloudLimbicState, evolveCloudLimbicState, recordLimbicState } from './cloudLimbic';
export type { CloudLoopState } from './cloudRunState';
export type { CloudLoopOpts, CloudLoopResult } from './cloudRunOpts';

/** The runtime context an engine is constructed with (the surface-specific wiring
 *  that {@link AgentRunInput} deliberately omits). */
export interface CloudEngineContext {
  env: Env;
  db: Db;
  executionId: number;
  taskRow: { id: number; title: string; description: string | null };
  tenantId: number;
  projectId: number;
  agentLabel: string;
  cloudAgentRef?: string;
  isCancelled: () => Promise<boolean>;
  /** Learned Model Routing (PRD 13 §6.6): the interactive-launch SSM recall nudge
   *  parsed off the run payload. Absent on headless runs. Threaded to the first-tick model seed. */
  routingBias?: Record<string, number>;
  /** The launching canvas session's arc stage, threaded into the run options on every tick. */
  arcStage?: ArcStage;
  /** Brain chat that launched the execution, when this is a conversation-originated run. */
  originatingChatId?: number;
  /** Resolved assigned artifacts (skills/personas/content). Used by V3 to derive
   *  limbic setpoints from the assigned personas' psychometric profiles. */
  artifacts?: ResolvedArtifacts;
  /** Execution levers compiled from the personas + the agent's own personality (from `prepareCloudRun`). */
  execParams?: AgentExecParams;
  /** The agent's OWN psychometric JSON (ide_agents.psychometric). Folded into the limbic setpoints. */
  agentPsychometric?: string | null;
  /** Exact accountability slot a reviewer run must sign before it may finish. */
  requiredSignoff?: RequiredReviewSignoff;
  /** The execution's dispatch payload: the board's provenance (`dispatch.source`, `dispatch.approvalId`) rides it (§6.9). */
  dispatchPayload?: string;
  /** How this surface drives the engine. Absent ⇒ `worker` (whole loop, one call). */
  surface?: CloudEngineSurface;
  /** Its place in a delegation tree (durable surface only) — see {@link CloudRunDelegation}. */
  delegation?: CloudRunDelegation;
}

/**
 * The surface a cloud run executes on — the ONE place a caller says how many steps
 * an invocation may take and what happens at the end of it.
 *  - `worker`: the whole loop in one call, finalized (PR/merge) at the end.
 *  - `durable`: `maxSteps` per alarm tick; the resume state is handed back instead of
 *    finalizing, and the tick runs under the cursor-held affective state (the DO
 *    evolves it between ticks). No state ⇒ a pre-affect cursor: no directive.
 *  - `rehearsal`: the real run with every effect shadowed by `decorateProvider`,
 *    nothing finalized, reads optionally pinned to `frozenReadRef`.
 */
export type CloudEngineSurface =
  | { kind: 'worker' }
  | { kind: 'durable'; maxSteps: number; limbicState?: LimbicState; sandbox?: RunSandbox }
  | { kind: 'rehearsal'; maxSteps: number; decorateProvider: (provider: CapabilityProvider) => CapabilityProvider; frozenReadRef?: string };

/** The engine's result: the generic one, plus the run's final tally on a TERMINAL result (`RunState.telemetry`) for the outcome-row writer. */
export type CloudEngineResult = AgentRunResult & { readonly telemetry?: RunTally };

/**
 * The cloud agent engine behind the shared {@link AgentEngine} seam — THE current engine (V3).
 * It hands the run to the cloud adapter (the one agent) with the limbic affective layer ALWAYS
 * composed on top: it derives a task-appropriate affective state via the shared, Worker-safe
 * limbic compiler and passes the affect block as the adapter's per-turn `dynamicSystem` — NOT by
 * mutating the persisted prompt/conversation. That decoupling lets affect evolve across DO ticks
 * (see {@link CloudRunnerDO}). Dispatch sites depend on the INTERFACE via
 * {@link resolveAgentEngine}, so the NEXT engine (a future V4) is a one-line wiring change.
 */
export class CloudLimbicEngine implements AgentEngine {
  readonly id = CURRENT_ENGINE_ID;
  constructor(private readonly rc: CloudEngineContext) {}

  async run(input: AgentRunInput): Promise<CloudEngineResult> {
    const rc = this.rc;
    const surface: CloudEngineSurface = rc.surface ?? { kind: 'worker' };
    // Affect: a durable tick runs under the state its cursor carries (evolved tick to tick by the DO);
    // every other surface seeds it here from the personas' setpoints appraised against the task.
    const limbicState = surface.kind === 'durable' ? surface.limbicState : await this.seedLimbicState();
    const directive = limbicState ? buildLimbicBlock(limbicState) : '';
    const r = await runCloudAgent(
      rc,
      { model: input.model, systemPrompt: input.systemPrompt, userContent: input.userContent },
      {
        routingBias: rc.routingBias,
        arcStage: rc.arcStage,
        ...(rc.originatingChatId != null ? { originatingChatId: rc.originatingChatId } : {}),
        ...(rc.requiredSignoff ? { requiredSignoff: rc.requiredSignoff } : {}),
        ...(directive ? { dynamicSystem: directive } : {}),
        ...(input.policy?.gates ? { policyGates: [...input.policy.gates] } : {}),
        ...(rc.execParams ? { execParams: rc.execParams } : {}),
        ...(input.genParams ? { genParams: { ...input.genParams } } : {}),
        ...(input.resume ? { resume: input.resume as CloudLoopState } : {}),
        ...(surface.kind === 'durable' ? { maxSteps: surface.maxSteps, deferFinalize: true, ...(surface.sandbox ? { sandbox: surface.sandbox } : {}) } : {}),
        // A child's parent opens the pull request for the whole tree.
        ...(rc.delegation ? { delegation: rc.delegation, ...(isChildDelegation(rc.delegation) ? { suppressFinalize: true } : {}) } : {}),
        ...(surface.kind === 'rehearsal'
          ? { maxSteps: surface.maxSteps, suppressFinalize: true, decorateProvider: surface.decorateProvider, ...(surface.frozenReadRef ? { frozenReadRef: surface.frozenReadRef } : {}) }
          : {}),
      },
    );
    return { ok: r.ok, output: r.output, cancelled: r.cancelled, finished: r.finished, awaitingInput: r.awaitingInput, state: r.state, ...(r.telemetry ? { telemetry: r.telemetry } : {}) };
  }

  /** Personality = setpoints (from the assigned personas' psychometric profiles);
   *  dynamics = the task-appraised affect around those setpoints. Recorded on the
   *  Observability timeline once per seed. */
  private async seedLimbicState(): Promise<LimbicState> {
    const rc = this.rc;
    const setpoints = await loadPersonaSetpoints(rc.env, rc.db, rc.artifacts?.personas ?? [], rc.agentPsychometric);
    const state = initialCloudLimbicState(rc.taskRow, setpoints);
    await recordLimbicState(rc.db, { tenantId: rc.tenantId, cloudAgentRef: rc.cloudAgentRef, executionId: rc.executionId }, state);
    return state;
  }
}

/**
 * The single composition root for the cloud engine. There is ONE engine (the current
 * V3 = the one agent + limbic); every run resolves to it regardless of any legacy engine
 * value. The seam stays a function so the NEXT engine is a one-line swap here, never a
 * branch at the call sites. (Surface routing — durable DO / container / worker — is a
 * separate decision in `runtimeRoutes.ts`.)
 */
export function resolveAgentEngine(rc: CloudEngineContext): CloudLimbicEngine {
  return new CloudLimbicEngine(rc);
}
