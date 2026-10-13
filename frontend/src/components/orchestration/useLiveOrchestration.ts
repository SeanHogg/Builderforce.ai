'use client';

import { useCallback, useEffect, useState } from 'react';
import { workflows, type Workflow, type WorkflowGraph } from '@/lib/builderforceApi';
import { reportBackgroundFailure } from '@/lib/reportError';
import { isLiveWorkflowStatus, LIVE_WORKFLOW_POLL_MS } from '@/components/workflowRunUi';

/** Merge pending+running list responses: live only, newest `updatedAt` first. */
export function mergeInFlightLists(pending: Workflow[], running: Workflow[]): Workflow[] {
  const seen = new Set<string>();
  const merged: Workflow[] = [];
  for (const wf of [...running, ...pending]) {
    if (!isLiveWorkflowStatus(wf.status)) continue;
    if (seen.has(wf.id)) continue;
    seen.add(wf.id);
    merged.push(wf);
  }
  merged.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return merged;
}

export async function fetchInFlightWorkflows(projectId?: number | null): Promise<Workflow[]> {
  const scope = projectId != null ? { projectId } : {};
  const [pending, running] = await Promise.all([
    workflows.list({ ...scope, status: 'pending' }),
    workflows.list({ ...scope, status: 'running' }),
  ]);
  return mergeInFlightLists(pending, running);
}

export interface LiveOrchestrationState {
  runs: Workflow[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  selected: Workflow | null;
  graph: WorkflowGraph | null;
  graphLoading: boolean;
  select: (id: string) => void;
  refresh: () => Promise<void>;
}

/**
 * Primary live-orchestration surface: list in-flight runs (pending + running)
 * and poll get + getGraph onto the DAG while the selection is live.
 * No workflow WebSocket exists; this is the same poll as run-history / canvas.
 */
export function useLiveOrchestration(projectId?: number | null): LiveOrchestrationState {
  const [runs, setRuns] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Workflow | null>(null);
  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);

  const refreshList = useCallback(async () => {
    const list = await fetchInFlightWorkflows(projectId);
    setRuns(list);
    setError(null);
    setSelectedId((prev) => {
      if (prev && list.some((r) => r.id === prev)) return prev;
      return list[0]?.id ?? null;
    });
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void refreshList()
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setRuns([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const timer = setInterval(() => {
      void refreshList().catch((err: unknown) => {
        void reportBackgroundFailure({
          error: err,
          context: { operation: 'liveOrchestration.listPoll' },
        });
      });
    }, LIVE_WORKFLOW_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refreshList]);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      setGraph(null);
      return;
    }
    let cancelled = false;
    let reported = false;
    let stop = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    setGraphLoading(true);

    const tick = async () => {
      if (cancelled || stop) return;
      try {
        const [next, nextGraph] = await Promise.all([
          workflows.get(selectedId),
          workflows.getGraph(selectedId),
        ]);
        if (cancelled) return;
        setSelected(next);
        setGraph(nextGraph);
        if (!isLiveWorkflowStatus(next.status)) {
          stop = true;
          if (timer) {
            clearInterval(timer);
            timer = undefined;
          }
        }
      } catch (error) {
        if (!reported) {
          reported = true;
          void reportBackgroundFailure({
            error,
            context: { operation: 'liveOrchestration.livePoll', workflowId: selectedId },
          });
        }
      } finally {
        if (!cancelled) setGraphLoading(false);
      }
    };

    void tick();
    timer = setInterval(() => {
      if (stop) {
        if (timer) {
          clearInterval(timer);
          timer = undefined;
        }
        return;
      }
      void tick();
    }, LIVE_WORKFLOW_POLL_MS);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [selectedId]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const refresh = useCallback(async () => {
    try {
      await refreshList();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [refreshList]);

  return {
    runs,
    loading,
    error,
    selectedId,
    selected,
    graph,
    graphLoading,
    select,
    refresh,
  };
}
