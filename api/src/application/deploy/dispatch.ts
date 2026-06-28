/**
 * `deployAndDispatch` — the live counterpart to the pure {@link deploy} resolver
 * (compile primitive Phase C4). Where `deploy()` returns a ready-to-dispatch
 * {@link DeployPlan}, this actually STARTS the run on the resolved surface, reusing
 * machinery that already exists:
 *
 *  - `workflow-node` (a step-bearing spec) → `persistCompiledRun` creates the
 *    `workflows` + `workflow_tasks` rows; the existing claim/relay + cloud-workflow
 *    cron advance them. This is a real, running workflow — no second build.
 *  - `cloud-durable` / `cloud-container` → the injected `dispatchCloudRun` (the
 *    runtime execution dispatcher) starts a cloud run against a caller-supplied task,
 *    carrying the spec's governance gates in the payload so the cloud loop enforces
 *    them (`parsePolicyGates` → `evaluatePolicyGate`).
 *  - `ide` / `desktop` → returned as a plan for the client (the VS Code / desktop
 *    relay) to drive; there is no server-initiated transport for these.
 *
 * The cloud dispatcher is injected (not imported) so this application-layer module
 * never depends on the presentation layer.
 */
import type { AgentSpec, AgentSurface } from '@builderforce/agent-tools';
import type { CompiledStep } from '../../domain/workflowGraph';
import type { Db } from '../../infrastructure/database/connection';
import { persistCompiledRun } from '../workflow/instantiateRun';
import { deploy, type DeployOptions, type DeployPlan } from './index';

/** Starts a cloud run against an existing task; returns the execution id (or null). */
export type CloudRunDispatcher = (params: {
  taskId: number;
  tenantId: number;
  payload?: string;
}) => Promise<number | null>;

export interface DispatchContext {
  db: Db;
  tenantId: number;
  segmentId?: string | null;
  projectId?: number | null;
  /** The cloud agent this run is attributed to (for workflow + cloud surfaces). */
  cloudAgentRef?: string | null;
  /** Required for `cloud-durable`/`cloud-container`: the task to run against. */
  taskId?: number;
  /** Required for cloud surfaces: the runtime execution dispatcher (injected). */
  dispatchCloudRun?: CloudRunDispatcher;
  deployOptions?: DeployOptions;
}

export type DispatchResult =
  | { ok: true; kind: 'workflow'; plan: DeployPlan; workflowId: string; taskCount: number }
  | { ok: true; kind: 'cloud'; plan: DeployPlan; executionId: number | null }
  | { ok: true; kind: 'plan-only'; plan: DeployPlan; reason: string }
  | { ok: false; error: string };

export async function deployAndDispatch(
  spec: AgentSpec,
  surface: AgentSurface,
  ctx: DispatchContext,
): Promise<DispatchResult> {
  let plan: DeployPlan;
  try {
    plan = deploy(spec, surface, ctx.deployOptions ?? {});
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'deploy failed' };
  }

  // Step-bearing spec on the workflow surface → instantiate a real run.
  if (surface === 'workflow-node') {
    const steps = (spec.steps ?? []) as CompiledStep[];
    if (steps.length === 0) {
      return { ok: true, kind: 'plan-only', plan, reason: 'no steps to run on the workflow surface' };
    }
    const res = await persistCompiledRun(ctx.db, steps, {
      tenantId: ctx.tenantId,
      segmentId: ctx.segmentId ?? null,
      projectId: ctx.projectId ?? null,
      name: spec.identity?.name || 'Compiled workflow',
      target: { runtime: 'cloud', cloudAgentRef: ctx.cloudAgentRef ?? null },
    });
    return res.ok
      ? { ok: true, kind: 'workflow', plan, workflowId: res.workflowId, taskCount: res.taskCount }
      : { ok: false, error: res.error };
  }

  // Cloud surfaces → start a run against the caller's task, carrying the spec's
  // governance gates + pinned model in the payload (the cloud loop enforces them).
  if (plan.cloudDispatchable && ctx.dispatchCloudRun && ctx.taskId != null) {
    const payload = JSON.stringify({
      ...(ctx.cloudAgentRef ? { cloudAgentRef: ctx.cloudAgentRef } : {}),
      ...(plan.runInput.model ? { model: plan.runInput.model } : {}),
      ...(spec.policy?.gates?.length ? { policyGates: spec.policy.gates } : {}),
    });
    const executionId = await ctx.dispatchCloudRun({ taskId: ctx.taskId, tenantId: ctx.tenantId, payload });
    return { ok: true, kind: 'cloud', plan, executionId };
  }

  // IDE / desktop (or a cloud surface with no task) → hand the plan back; the client
  // relay drives it. There is no server-initiated transport for these surfaces.
  return {
    ok: true,
    kind: 'plan-only',
    plan,
    reason: plan.cloudDispatchable
      ? 'cloud dispatch needs a taskId + dispatcher in the context'
      : `${surface} runs are driven by the client relay`,
  };
}
