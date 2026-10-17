import { useCallback, useRef, useState } from 'react';
import { workflows, type Workflow, type WorkflowGraph } from '@/lib/builderforceApi';
import { reportBackgroundFailure } from '@/lib/reportError';
import { isLiveWorkflowStatus, LIVE_WORKFLOW_POLL_MS } from '@/components/workflowRunUi';
import { usePolledResource } from '@/hooks/usePolledResource';

/**
 * In-flight LIST cadence. The selected run's detail is what moves at
 * LIVE_WORKFLOW_POLL_MS; the list only discovers runs starting/finishing, so it is
 * slower while something is live and lazy when nothing is (the list is two reads —
 * pending + running — that used to fire every 2 s forever).
 */
const LIST_LIVE_MS = 10_000;
const LIST_IDLE_MS = 60_000;

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
  const listLoadedForRef = useRef<string | null>(null);
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

  // List poll — visibility-gated, non-overlapping, backs off on failure. The first
  // read of a project surfaces its error inline; later failures are background noise.
  usePolledResource(async (signal) => {
    const first = listLoadedForRef.current !== projectKey;
    try {
      const list = await fetchInFlightWorkflows(projectId);
      if (signal.aborted) return;
      applyList(list);
    } catch (err: unknown) {
      if (signal.aborted) return;
      if (first) {
        setError(err instanceof Error ? err.message : String(err));
        setRuns([]);
      } else {
        void reportBackgroundFailure({
          message: err instanceof Error ? err.message : String(err),
          level: 'warning',
          context: { operation: 'liveOrchestration.listPoll' },
        });
      }
      throw err;
    } finally {
      if (!signal.aborted && first) {
        listLoadedForRef.current = projectKey;
        setListLoadedFor(projectKey);
      }
    }
  }, { intervalMs: runs.length > 0 ? LIST_LIVE_MS : LIST_IDLE_MS, restartKey: projectKey });

  // Selected-run poll: get + getGraph while the selection is live; it stops once the
  // selected run has left pending/running (re-selecting another run restarts it).
  const selectedSettled = selectedId != null && selected?.id === selectedId && !isLiveWorkflowStatus(selected.status);
  const reportedFor = useRef<string | null>(null);
  usePolledResource(async (signal) => {
    if (!selectedId) return;
    const id = selectedId;
    try {
      const [next, nextGraph] = await Promise.all([workflows.get(id), workflows.getGraph(id)]);
      if (signal.aborted) return;
      setSelected(next);
      setGraph(nextGraph);
    } catch (error) {
      if (reportedFor.current !== id) {
        reportedFor.current = id;
        void reportBackgroundFailure({
          message: error instanceof Error ? error.message : String(error),
          level: 'warning',
          context: { operation: 'liveOrchestration.livePoll', workflowId: id },
        });
      }
      throw error;
    } finally {
      if (!signal.aborted) setGraphLoadedFor(id);
    }
  }, { intervalMs: LIVE_WORKFLOW_POLL_MS, enabled: selectedId != null && !selectedSettled, restartKey: selectedId });

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
