import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import * as api from '@/lib/builderforceApi';
import type { Workflow, WorkflowGraph } from '@/lib/builderforceApi';
import { LIVE_WORKFLOW_POLL_MS } from '@/components/workflowRunUi';
import { LiveOrchestrationWorkspace } from './LiveOrchestrationWorkspace';

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

describe('LiveOrchestrationWorkspace', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows empty copy when nothing is in flight', async () => {
    vi.spyOn(api.workflows, 'list').mockResolvedValue([]);
    const { getByTestId } = render(<LiveOrchestrationWorkspace />);
    await act(async () => { await Promise.resolve(); });
    expect(getByTestId('live-orchestration-empty').textContent).toContain('orchestrationWorkspace.empty');
  });

  it('lists in-flight runs and maps graph status onto the DAG', async () => {
    const running = wf({ id: 'run-1', status: 'running', description: 'Ship the DAG', projectName: 'Alpha' });
    vi.spyOn(api.workflows, 'list').mockImplementation(async (params) => {
      if (params?.status === 'running') return [running];
      return [];
    });
    vi.spyOn(api.workflows, 'get').mockResolvedValue(running);
    vi.spyOn(api.workflows, 'getGraph').mockResolvedValue(GRAPH);

    const { getByTestId, getByText } = render(<LiveOrchestrationWorkspace projectId={3} />);
    await act(async () => { await Promise.resolve(); });

    expect(getByTestId('live-orchestration-run-run-1').textContent).toContain('Ship the DAG');
    expect(getByText('Plan')).toBeTruthy();
    expect(getByText('Code')).toBeTruthy();
    const code = getByText('Code').closest('g');
    expect(code?.querySelector('rect')?.getAttribute('stroke-width')).toBe('1.5');
  });

  it('selects another in-flight run and refreshes its graph', async () => {
    const a = wf({ id: 'a', status: 'running', description: 'Run A' });
    const b = wf({ id: 'b', status: 'pending', description: 'Run B' });
    vi.spyOn(api.workflows, 'list').mockImplementation(async (params) => {
      if (params?.status === 'running') return [a];
      if (params?.status === 'pending') return [b];
      return [];
    });
    vi.spyOn(api.workflows, 'get').mockImplementation(async (id) => (id === 'b' ? b : a));
    vi.spyOn(api.workflows, 'getGraph').mockImplementation(async (id) => (
      id === 'b'
        ? { workflowId: 'b', status: 'pending', nodes: [{ id: 'n', label: 'Wait', role: 'planner', status: 'pending' }], edges: [] }
        : GRAPH
    ));

    const { getByTestId, getByText } = render(<LiveOrchestrationWorkspace />);
    await act(async () => { await Promise.resolve(); });
    expect(getByText('Code')).toBeTruthy();

    fireEvent.click(getByTestId('live-orchestration-run-b'));
    await act(async () => { await Promise.resolve(); });
    expect(getByText('Wait')).toBeTruthy();
  });

  it('keeps polling the selected graph while the run is live', async () => {
    const running = wf({ id: 'run-1', status: 'running' });
    vi.spyOn(api.workflows, 'list').mockImplementation(async (params) => {
      if (params?.status === 'running') return [running];
      return [];
    });
    vi.spyOn(api.workflows, 'get').mockResolvedValue(running);
    const getGraph = vi.spyOn(api.workflows, 'getGraph').mockResolvedValue(GRAPH);

    render(<LiveOrchestrationWorkspace />);
    await act(async () => { await Promise.resolve(); });
    const afterMount = getGraph.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);

    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_WORKFLOW_POLL_MS); });
    expect(getGraph.mock.calls.length).toBeGreaterThan(afterMount);
  });
});
