import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import { WorkflowRunHistoryPanel } from './WorkflowRunHistoryPanel';
import { LIVE_WORKFLOW_POLL_MS } from './workflowRunUi';
import * as api from '@/lib/builderforceApi';
import type { Workflow, WorkflowGraph } from '@/lib/builderforceApi';

const NOW = '2026-10-12T00:00:00.000Z';

function wf(partial: Partial<Workflow> & Pick<Workflow, 'id' | 'status'>): Workflow {
  return {
    agentHostId: 1,
    workflowType: 'feature',
    description: 'Ship the DAG',
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

describe('WorkflowRunHistoryPanel live refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(api.workflowDefinitions, 'usage').mockResolvedValue({
      days: [],
      totalRuns: 0,
      totalCostUsd: 0,
    });
    vi.spyOn(api.workflowDefinitions, 'runs').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('re-fetches a running run on an interval and stops once it completes', async () => {
    const running = wf({ id: 'run-1', status: 'running', tasks: [] });
    const completed = wf({ id: 'run-1', status: 'completed', tasks: [] });
    const get = vi.spyOn(api.workflows, 'get')
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(running)
      .mockResolvedValue(completed);

    const { getByText } = render(
      <WorkflowRunHistoryPanel definitionId="def-1" definitionName="Feature" initialRunId="run-1" />,
    );

    await act(async () => { await Promise.resolve(); });
    expect(getByText(/running/)).toBeTruthy();
    // initialRunId fetch + the live-poll tick that arms as soon as status is in-flight
    expect(get.mock.calls.length).toBeGreaterThan(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_WORKFLOW_POLL_MS); });
    expect(getByText(/completed/)).toBeTruthy();
    const afterComplete = get.mock.calls.length;

    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_WORKFLOW_POLL_MS * 2); });
    expect(get.mock.calls.length).toBe(afterComplete);
  });

  it('does not poll a completed run', async () => {
    const done = wf({ id: 'run-2', status: 'completed', tasks: [] });
    const get = vi.spyOn(api.workflows, 'get').mockResolvedValue(done);

    render(
      <WorkflowRunHistoryPanel definitionId="def-1" definitionName="Feature" initialRunId="run-2" />,
    );

    await act(async () => { await Promise.resolve(); });
    expect(get).toHaveBeenCalled();
    const afterMount = get.mock.calls.length;

    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_WORKFLOW_POLL_MS * 3); });
    expect(get.mock.calls.length).toBe(afterMount);
  });

  it('refreshes the graph while a running run is on the graph tab', async () => {
    const running = wf({ id: 'run-1', status: 'running', tasks: [] });
    vi.spyOn(api.workflows, 'get').mockResolvedValue(running);
    const getGraph = vi.spyOn(api.workflows, 'getGraph').mockResolvedValue(GRAPH);

    const { getByText, findByText } = render(
      <WorkflowRunHistoryPanel definitionId="def-1" definitionName="Feature" initialRunId="run-1" />,
    );

    await act(async () => { await Promise.resolve(); });
    fireEvent.click(getByText('workflowsContent.graph'));
    await act(async () => { await Promise.resolve(); });
    expect(getGraph).toHaveBeenCalled();
    const afterOpen = getGraph.mock.calls.length;

    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_WORKFLOW_POLL_MS); });
    expect(getGraph.mock.calls.length).toBeGreaterThan(afterOpen);
  });
});
