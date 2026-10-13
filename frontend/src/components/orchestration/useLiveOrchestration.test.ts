import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as api from '@/lib/builderforceApi';
import type { Workflow, WorkflowGraph } from '@/lib/builderforceApi';
import { LIVE_WORKFLOW_POLL_MS } from '@/components/workflowRunUi';
import { mergeInFlightLists, useLiveOrchestration } from './useLiveOrchestration';

vi.mock('@/lib/reportError', () => ({
  reportBackgroundFailure: vi.fn(),
}));

const NOW = '2026-10-13T00:00:00.000Z';

function wf(partial: Partial<Workflow> & Pick<Workflow, 'id' | 'status'>): Workflow {
  return {
    agentHostId: 1,
    workflowType: 'feature',
    description: partial.description ?? `Run ${partial.id}`,
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
}

const GRAPH: WorkflowGraph = {
  workflowId: 'run-1',
  status: 'running',
  nodes: [
    { id: 't1', label: 'Plan', role: 'planner', status: 'completed' },
    { id: 't2', label: 'Code', role: 'developer', status: 'running' },
  ],
  edges: [{ from: 't1', to: 't2' }],
};

describe('mergeInFlightLists', () => {
  it('keeps only pending and running, newest updatedAt first', () => {
    const olderRunning = wf({ id: 'r-old', status: 'running', updatedAt: '2026-10-13T00:00:00.000Z' });
    const newerPending = wf({ id: 'p-new', status: 'pending', updatedAt: '2026-10-13T01:00:00.000Z' });
    const completed = wf({ id: 'done', status: 'completed', updatedAt: '2026-10-13T02:00:00.000Z' });
    const failed = wf({ id: 'fail', status: 'failed', updatedAt: '2026-10-13T03:00:00.000Z' });
    const merged = mergeInFlightLists(
      [newerPending, completed, failed],
      [olderRunning, completed],
    );
    expect(merged.map((r) => r.id)).toEqual(['p-new', 'r-old']);
  });

  it('dedupes a run that appears in both lists', () => {
    const run = wf({ id: 'both', status: 'running' });
    const merged = mergeInFlightLists([run], [run]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('both');
  });
});

describe('useLiveOrchestration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('lists pending and running (not completed) and selects the first', async () => {
    const pending = wf({ id: 'p1', status: 'pending' });
    const running = wf({ id: 'r1', status: 'running', updatedAt: '2026-10-13T02:00:00.000Z' });
    vi.spyOn(api.workflows, 'list').mockImplementation(async (params) => {
      if (params?.status === 'pending') return [pending];
      if (params?.status === 'running') return [running];
      return [];
    });
    vi.spyOn(api.workflows, 'get').mockResolvedValue(running);
    vi.spyOn(api.workflows, 'getGraph').mockResolvedValue(GRAPH);

    const { result } = renderHook(() => useLiveOrchestration(7));
    await act(async () => { await Promise.resolve(); });

    expect(api.workflows.list).toHaveBeenCalledWith({ projectId: 7, status: 'pending' });
    expect(api.workflows.list).toHaveBeenCalledWith({ projectId: 7, status: 'running' });
    expect(result.current.runs.map((r) => r.id)).toEqual(['r1', 'p1']);
    expect(result.current.selectedId).toBe('r1');
  });

  it('polls get + getGraph while live and stops once the run completes', async () => {
    const running = wf({ id: 'run-1', status: 'running' });
    const completed = wf({ id: 'run-1', status: 'completed' });
    vi.spyOn(api.workflows, 'list').mockImplementation(async (params) => {
      if (params?.status === 'running') return [running];
      return [];
    });
    const get = vi.spyOn(api.workflows, 'get')
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(running)
      .mockResolvedValue(completed);
    const getGraph = vi.spyOn(api.workflows, 'getGraph').mockResolvedValue(GRAPH);

    const { result } = renderHook(() => useLiveOrchestration());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.graph?.nodes.some((n) => n.status === 'running')).toBe(true);
    expect(get.mock.calls.length).toBeGreaterThan(0);
    const afterMount = get.mock.calls.length;

    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_WORKFLOW_POLL_MS); });
    expect(get.mock.calls.length).toBeGreaterThan(afterMount);
    expect(getGraph.mock.calls.length).toBeGreaterThan(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_WORKFLOW_POLL_MS); });
    const afterComplete = get.mock.calls.length;

    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_WORKFLOW_POLL_MS * 2); });
    expect(get.mock.calls.length).toBe(afterComplete);
  });
});
