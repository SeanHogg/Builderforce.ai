/**
 * The ONE construction of a {@link SwimlaneCoordinator}.
 *
 * The same four-argument `new SwimlaneCoordinator(store, dispatcher, workflowRunner,
 * prdEnsurer)` was written out in four places (boardRoutes, agentRuntimeRoutes,
 * agentHostRoutes, resumeParkedWorkflows) and they did NOT agree: two of them passed
 * `undefined` for the workflow runner, so whether a lane's `run_workflow` action fired
 * depended on which entry point happened to settle the stage — a host-reported dispatch
 * result silently skipped the lane action that the board API would have run. One factory
 * makes that impossible by construction.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { SwimlaneCoordinator } from './SwimlaneCoordinator';
import { DrizzleCoordinatorStore } from './DrizzleCoordinatorStore';
import { AgentHostStageDispatcher } from './agentHostStageDispatcher';
import { DrizzleStageWorkflowRunner } from './stageWorkflowRunner';
import { DrizzlePrdEnsurer } from './DrizzlePrdEnsurer';

/** The single env capability the coordinator's dispatcher needs. */
export interface CoordinatorEnv {
  AGENT_HOST_RELAY?: unknown;
}

/**
 * Build a fully-wired coordinator. Per-request: the dispatcher binds to THIS request's
 * relay binding, so it must not be hoisted to module scope.
 */
export function makeSwimlaneCoordinator(db: Db, env: unknown): SwimlaneCoordinator {
  return new SwimlaneCoordinator(
    new DrizzleCoordinatorStore(db),
    new AgentHostStageDispatcher((env as CoordinatorEnv | undefined)?.AGENT_HOST_RELAY as never),
    new DrizzleStageWorkflowRunner(db),
    new DrizzlePrdEnsurer(db, env as Env),
  );
}
