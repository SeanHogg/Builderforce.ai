'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  runtimeApi,
  isAwaitingApprovalExecution,
  type Task,
} from '@/lib/builderforceApi';
import { loadAgentPool, type PoolAgent } from '@/lib/agentPool';

/**
 * The run target a task defaults to — derived from its assignee, so "Run" reflects
 * who actually owns/executes it. A cloud agent (the swimlane's assigned agent) wins,
 * else a self-hosted host, else '' = Auto (any agent). A *human* assignee resolves
 * to '' too: the human owns/reviews, an agent executes on auto.
 *
 * Encoding: '' = auto, 'host:<id>' = a self-hosted executor, 'cloud:<ref>' = run AS
 * a cloud agent. Shared by {@link useTaskRunner} and the full RunAgentControl picker
 * so the one-click and the manual-pick paths agree on the default.
 */
export function defaultRunTarget(task: Pick<Task, 'assignedAgentRef' | 'assignedAgentHostId'>): string {
  if (task.assignedAgentRef) return `cloud:${task.assignedAgentRef}`;
  if (task.assignedAgentHostId != null) return `host:${task.assignedAgentHostId}`;
  return '';
}

export interface UseTaskRunnerArgs {
  task: Task;
  /** Called after a successful submit (so the parent can refresh executions). */
  onRan?: (executionId: number) => void;
  /** Called when execution is gated behind an approval. */
  onAwaitingApproval?: (g: { approvalId: string; taskId: number; reason: string }) => void;
}

/**
 * The single source of truth for submitting a task run. Resolves the run target
 * (host vs cloud agent) + model into an execution payload and dispatches it,
 * surfacing running/error state and the approval gate. Both the full
 * `RunAgentControl` picker and the one-click `RunTaskButton` call this — there is
 * exactly one submit implementation.
 *
 * `run()` with no args uses the task's {@link defaultRunTarget} (one-click). The
 * picker passes the user's explicit `{ target, model }`.
 */
export function useTaskRunner({ task, onRan, onAwaitingApproval }: UseTaskRunnerArgs) {
  const [cloudAgents, setCloudAgents] = useState<PoolAgent[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAgentPool()
      .then((p) => setCloudAgents(p.filter((a) => a.kind === 'workforce')))
      .catch(() => setCloudAgents([]));
  }, []);

  const run = useCallback(
    async (opts?: { target?: string; model?: string; repoId?: string }) => {
      const target = opts?.target ?? defaultRunTarget(task);
      const model = opts?.model ?? '';
      setRunning(true);
      setError(null);
      try {
        // A host runs as an executor; a cloud agent runs AS its model (no host —
        // the gateway/fleet executes it). Forward the chosen/own model + the cloud
        // ref so the API can resolve the runtime engine (V1/V2) and attribute the run.
        const isHost = target.startsWith('host:');
        const cloudRef = target.startsWith('cloud:') ? target.slice('cloud:'.length) : '';
        const cloudAgent = cloudRef ? cloudAgents.find((a) => a.ref === cloudRef) : null;
        const agentHostId = isHost ? Number(target.slice('host:'.length)) : undefined;
        const effectiveModel = model || cloudAgent?.baseModel || '';
        // repoId: a real id pins the run to that repo; '' explicitly clears the pin
        // (Auto). Only sent when the caller passed it, so a one-click run leaves any
        // existing pin untouched.
        const payloadObj: { model?: string; cloudAgentRef?: string; repoId?: string } = {};
        if (effectiveModel) payloadObj.model = effectiveModel;
        if (cloudRef) payloadObj.cloudAgentRef = cloudRef;
        if (opts?.repoId !== undefined) payloadObj.repoId = opts.repoId;
        const result = await runtimeApi.submitExecution({
          taskId: task.id,
          agentHostId,
          payload: Object.keys(payloadObj).length > 0 ? JSON.stringify(payloadObj) : undefined,
        });
        if (isAwaitingApprovalExecution(result)) {
          onAwaitingApproval?.({ approvalId: result.approvalId, taskId: result.taskId, reason: result.reason });
          return;
        }
        onRan?.(result.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to run');
      } finally {
        setRunning(false);
      }
    },
    [task, cloudAgents, onRan, onAwaitingApproval],
  );

  return { run, running, error, cloudAgents };
}
