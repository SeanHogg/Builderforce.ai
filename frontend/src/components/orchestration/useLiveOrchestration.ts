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
  // Loading flags are derived from WHICH read last finished, never set at the top of an
  // effect: the list is loading until a read for this project lands, the graph until
  // the first tick for this selection does.
  const projectKey = projectId == null ? '' : String(projectId);
  const [listLoadedFor, setListLoadedFor] = useState<string | null>(null);
  const loading = listLoadedFor !== projectKey;
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Workflow | null>(null);
  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [graphLoadedFor, setGraphLoadedFor] = useState<string | null>(null);
  const graphLoading = selectedId != null && graphLoadedFor !== selectedId;

  /** Apply one list read: the runs, a cleared error, and a selection that still exists. */
  const applyList = useCallback((list: Workflow[]) => {
    setRuns(list);
    setError(null);
    setSelectedId((prev) => {
      if (prev && list.some((r) => r.id === prev)) return prev;
      return list[0]?.id ?? null;
    });
  }, []);

  const refreshList = useCallback(async () => {
    applyList(await fetchInFlightWorkflows(projectId));
  }, [projectId, applyList]);

  useEffect(() => {
    let cancelled = false;
    // The first read sets state only in its callbacks, never in the effect body.
    void fetchInFlightWorkflows(projectId)
      .then((list) => { if (!cancelled) applyList(list); })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setRuns([]);
      })
      .finally(() => {
        if (!cancelled) setListLoadedFor(projectKey);
      });

    const timer = setInterval(() => {
      void refreshList().catch((err: unknown) => {
        void reportBackgroundFailure({
          message: err instanceof Error ? err.message : String(err),
          level: 'warning',
          context: { operation: 'liveOrchestration.listPoll' },
        });
      });
    }, LIVE_WORKFLOW_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refreshList, applyList, projectId, projectKey]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    let reported = false;
    let stop = false;
    let timer: ReturnType<typeof setInterval> | undefined;

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
            message: error instanceof Error ? error.message : String(error),
            level: 'warning',
            context: { operation: 'liveOrchestration.livePoll', workflowId: selectedId },
          });
        }
      } finally {
        if (!cancelled) setGraphLoadedFor(selectedId);
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
    // No selection shows nothing, whatever the last poll left behind.
    selected: selectedId ? selected : null,
    graph: selectedId ? graph : null,
    graphLoading,
    select,
    refresh,
  };
}
