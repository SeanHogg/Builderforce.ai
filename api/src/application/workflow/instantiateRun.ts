/**
 * Shared workflow-run instantiation.
 *
 * Lowers a workflow definition into a `workflows` execution record plus its
 * `workflow_tasks`, exactly as the manual `POST .../run` endpoint always did —
 * extracted here so every entry point that starts a run (the route, the
 * scheduler cron, the webhook endpoint, the inbound-email handler) shares one
 * implementation and one contract. Supports both run targets: a self-hosted
 * agentHost (`runtime: 'host'`) and the builderforce-hosted cloud runtime
 * (`runtime: 'cloud'`).
 */

import { workflows, workflowTasks } from '../../infrastructure/database/schema';
import {
  compileDefinition,
  validateDefinition,
  type CompiledStep,
  type WorkflowDefinition,
} from '../../domain/workflowGraph';
import type { Db } from '../../infrastructure/database/connection';

export type WorkflowRuntime = 'host' | 'cloud';

export interface RunTarget {
  runtime: WorkflowRuntime;
  agentHostId?: number | null;
  cloudAgentRef?: string | null;
}

export interface InstantiateRunParams {
  tenantId: number;
  segmentId?: string | null;
  definition: WorkflowDefinition;
  /** Workflow run description (usually the definition name). */
  name: string;
  /** Project the run belongs to (inherited from the definition); null = tenant-wide. */
  projectId?: number | null;
  /** Source definition this run is instantiated from; null for ad-hoc runs. */
  definitionId?: string | null;
  target: RunTarget;
  /**
   * Payload from the trigger that started the run (webhook body, rss item,
   * inbound email, …). Merged into the entry trigger node's task input so
   * downstream nodes can consume it via {{input}}.
   */
  triggerPayload?: unknown;
  /** How the run was started — recorded on the trigger task input for tracing. */
  triggerSource?: string;
  /** Reliability linkage: the incident/monitor whose event fired this run (or the
   *  incident a manual runbook was launched from). Persisted on the `workflows` row
   *  so the incident detail can list its runs. */
  sourceIncidentId?: string | null;
  sourceMonitorId?: string | null;
}

export type InstantiateRunResult =
  | { ok: true; workflowId: string; taskCount: number }
  | { ok: false; error: string };

/** Build a {@link RunTarget} from a workflow_definitions row's saved target. */
export function runTargetFromDefinition(row: {
  runTargetRuntime: string;
  runTargetAgentHostId: number | null;
  runTargetCloudAgentRef: string | null;
}): RunTarget {
  return row.runTargetRuntime === 'cloud'
    ? { runtime: 'cloud', cloudAgentRef: row.runTargetCloudAgentRef }
    : { runtime: 'host', agentHostId: row.runTargetAgentHostId };
}

/** Validate the run target: host runs need a host; cloud runs need the flag. */
export function validateRunTarget(target: RunTarget): string | null {
  if (target.runtime === 'host') {
    if (!target.agentHostId) return 'A self-hosted agentHost is required to run this workflow (runtime=host).';
    return null;
  }
  if (target.runtime === 'cloud') return null;
  return `Unknown run target runtime "${target.runtime}".`;
}

/**
 * Compile + persist a run. Returns the new workflow id and task count, or an
 * error string for any precondition failure (invalid graph / missing target).
 */
export async function instantiateWorkflowRun(
  db: Db,
  params: InstantiateRunParams,
): Promise<InstantiateRunResult> {
  const targetError = validateRunTarget(params.target);
  if (targetError) return { ok: false, error: targetError };

  const invalid = validateDefinition(params.definition);
  if (invalid) return { ok: false, error: invalid };

  const steps = compileDefinition(params.definition);
  return persistCompiledRun(db, steps, params);
}

/**
 * Persist a run from ALREADY-COMPILED steps — the shared tail of
 * {@link instantiateWorkflowRun} (which compiles a definition first) AND the entry
 * point for the compile primitive's `deploy()` of a step-bearing `AgentSpec`, whose
 * steps are already `CompiledStep[]`. Inserts the `workflows` row + one
 * `workflow_tasks` row per step. Run-target precondition is the caller's to validate.
 */
export async function persistCompiledRun(
  db: Db,
  steps: CompiledStep[],
  params: Omit<InstantiateRunParams, 'definition'>,
): Promise<InstantiateRunResult> {
  const nodeToTaskId = new Map(steps.map((s) => [s.nodeId, crypto.randomUUID()]));

  const workflowId = crypto.randomUUID();
  const now = new Date();

  await db.insert(workflows).values({
    id: workflowId,
    tenantId: params.tenantId,
    segmentId: params.segmentId ?? null,
    projectId: params.projectId ?? null,
    workflowDefinitionId: params.definitionId ?? null,
    sourceIncidentId: params.sourceIncidentId ?? null,
    sourceMonitorId: params.sourceMonitorId ?? null,
    agentHostId: params.target.runtime === 'host' ? params.target.agentHostId! : null,
    runtime: params.target.runtime,
    cloudAgentRef: params.target.runtime === 'cloud' ? params.target.cloudAgentRef ?? null : null,
    workflowType: 'custom',
    status: 'pending',
    description: params.name,
    createdAt: now,
    updatedAt: now,
  });

  if (steps.length > 0) {
    await db.insert(workflowTasks).values(
      steps.map((s) => {
        // Seed the entry trigger node with the firing payload so the run carries
        // its inbound context; other nodes carry only their kind + config.
        const isTrigger = s.kind === 'trigger';
        const input = {
          kind: s.kind,
          config: s.config,
          ...(isTrigger && params.triggerPayload !== undefined
            ? { payload: params.triggerPayload }
            : {}),
          ...(isTrigger && params.triggerSource ? { triggerSource: params.triggerSource } : {}),
        };
        return {
          id: nodeToTaskId.get(s.nodeId)!,
          workflowId,
          agentRole: s.role,
          description: s.description,
          input: JSON.stringify(input),
          dependsOn: JSON.stringify(s.dependsOnNodeIds.map((nid) => nodeToTaskId.get(nid)).filter(Boolean)),
          status: 'pending' as const,
          createdAt: now,
          updatedAt: now,
        };
      }),
    );
  }

  return { ok: true, workflowId, taskCount: steps.length };
}
