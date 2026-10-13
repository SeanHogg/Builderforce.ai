import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  applyLiveGraphToNodes,
  mapGraphNodesToFlowSteps,
  normalizeLiveStepStatus,
  startCanvasWorkflowLivePoll,
} from './liveGraphStatus';
import { LIVE_WORKFLOW_POLL_MS } from '../workflowRunUi';
import * as api from '@/lib/builderforceApi';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { Workflow, WorkflowGraph } from '@/lib/builderforceApi';

function obj(id: string, data: Record<string, unknown>): CanvasObject {
  return {
    id,
    type: 'creation',
    position: { x: 0, y: 0 },
    data: { kind: 'flowStep', title: id, ...data },
  } as CanvasObject;
}

function wf(partial: Partial<Workflow> & Pick<Workflow, 'id' | 'status'>): Workflow {
  return {
    agentHostId: 1,
    workflowType: 'feature',
    createdAt: '2026-10-13T00:00:00.000Z',
    updatedAt: '2026-10-13T00:00:00.000Z',
    ...partial,
  };
}

describe('normalizeLiveStepStatus', () => {
  it('folds orchestrator aliases onto pending/running/completed/failed', () => {
    expect(normalizeLiveStepStatus('running')).toBe('running');
    expect(normalizeLiveStepStatus('complete')).toBe('completed');
    expect(normalizeLiveStepStatus('failed')).toBe('failed');
    expect(normalizeLiveStepStatus('pending')).toBe('pending');
    expect(normalizeLiveStepStatus('cancelled')).toBeNull();
  });
});

describe('mapGraphNodesToFlowSteps', () => {
  it('matches by id when the graph still carries the board object id', () => {
    const mapped = mapGraphNodesToFlowSteps(
      [{ id: 'step-a', title: 'Plan' }],
      [{ id: 'step-a', label: 'something else', status: 'running' }],
    );
    expect(mapped.get('step-a')).toBe('running');
  });

  it('matches by title/label when ids are task UUIDs', () => {
    const mapped = mapGraphNodesToFlowSteps(
      [{ id: 'board-a', title: 'Plan' }],
      [{ id: 'task-uuid-1', label: 'Plan', status: 'running' }],
    );
    expect(mapped.get('board-a')).toBe('running');
  });

  it('matches by order after dropping a synthetic Trigger extra', () => {
    const mapped = mapGraphNodesToFlowSteps(
      [
        { id: 'board-a', title: 'Research' },
        { id: 'board-b', title: 'Write' },
      ],
      [
        { id: 't0', label: 'Trigger (manual)', status: 'completed' },
        { id: 't1', label: 'LLM openai: do the research', status: 'running' },
        { id: 't2', label: 'LLM openai: write it up', status: 'pending' },
      ],
    );
    expect(mapped.get('board-a')).toBe('running');
    expect(mapped.get('board-b')).toBe('pending');
  });

  it('skips compiler :in/:out ids', () => {
    const mapped = mapGraphNodesToFlowSteps(
      [{ id: 'board-a', title: 'Fetch' }],
      [
        { id: 'board-a:in', label: 'Fetch · input', status: 'completed' },
        { id: 't1', label: 'Fetch', status: 'running' },
        { id: 'board-a:out', label: 'Fetch · output', status: 'pending' },
      ],
    );
    expect(mapped.get('board-a')).toBe('running');
  });
});

describe('applyLiveGraphToNodes', () => {
  it('stamps workflowRunStatus onto matching flowSteps', () => {
    const nodes = [
      obj('frame-1', { kind: 'frame', title: 'Flow' }),
      obj('step-a', { title: 'Plan' }),
      obj('step-b', { title: 'Code' }),
    ];
    const next = applyLiveGraphToNodes(nodes, {
      targetId: 'frame-1',
      memberIds: new Set(['step-a', 'step-b']),
      graphNodes: [
        { id: 't1', label: 'Plan', status: 'completed' },
        { id: 't2', label: 'Code', status: 'running' },
      ],
    });
    expect(next.find((n) => n.id === 'step-a')?.data.workflowRunStatus).toBe('completed');
    expect(next.find((n) => n.id === 'step-b')?.data.workflowRunStatus).toBe('running');
    expect(next.find((n) => n.id === 'step-b')?.data.status).toBe('running');
  });

  it('does not clobber a blocked step status', () => {
    const nodes = [
      obj('step-a', { title: 'Plan', status: 'Needs setup', flowStepIssue: 'Choose an action' }),
    ];
    const next = applyLiveGraphToNodes(nodes, {
      targetId: 'frame-1',
      memberIds: new Set(['step-a']),
      graphNodes: [{ id: 't1', label: 'Plan', status: 'running' }],
    });
    expect(next[0]!.data.workflowRunStatus).toBe('running');
    expect(next[0]!.data.status).toBe('Needs setup');
  });

  it('overlays live status onto a legacy workflow card step list', () => {
    const nodes = [
      obj('card-1', {
        kind: 'workflow',
        title: 'Legacy',
        steps: [{ id: 's1', title: 'Plan' }, { id: 's2', title: 'Code' }],
      }),
    ];
    const next = applyLiveGraphToNodes(nodes, {
      targetId: 'card-1',
      memberIds: null,
      graphNodes: [
        { id: 't1', label: 'Plan', status: 'failed' },
        { id: 't2', label: 'Code', status: 'pending' },
      ],
    });
    const steps = next[0]!.data.steps as Array<{ title: string; status: string }>;
    expect(steps[0]).toMatchObject({ title: 'Plan', status: 'failed' });
    expect(steps[1]).toMatchObject({ title: 'Code', status: 'pending' });
  });
});

describe('startCanvasWorkflowLivePoll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('polls get + getGraph while running and stops once completed', async () => {
    const running = wf({ id: 'run-1', status: 'running' });
    const completed = wf({ id: 'run-1', status: 'completed' });
    const runningGraph: WorkflowGraph = {
      workflowId: 'run-1',
      status: 'running',
      nodes: [{ id: 't1', label: 'Plan', role: 'planner', status: 'running' }],
      edges: [],
    };
    const doneGraph: WorkflowGraph = {
      ...runningGraph,
      status: 'completed',
      nodes: [{ id: 't1', label: 'Plan', role: 'planner', status: 'completed' }],
    };
    const get = vi.spyOn(api.workflows, 'get')
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(running)
      .mockResolvedValue(completed);
    vi.spyOn(api.workflows, 'getGraph')
      .mockResolvedValueOnce(runningGraph)
      .mockResolvedValueOnce(runningGraph)
      .mockResolvedValue(doneGraph);

    const ticks: string[] = [];
    const stop = startCanvasWorkflowLivePoll({
      runId: 'run-1',
      onTick: (snapshot) => { ticks.push(snapshot.status); },
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(ticks[0]).toBe('running');
    expect(get.mock.calls.length).toBe(1);

    await vi.advanceTimersByTimeAsync(LIVE_WORKFLOW_POLL_MS);
    expect(ticks).toContain('running');

    await vi.advanceTimersByTimeAsync(LIVE_WORKFLOW_POLL_MS);
    expect(ticks.at(-1)).toBe('completed');
    const afterComplete = get.mock.calls.length;

    await vi.advanceTimersByTimeAsync(LIVE_WORKFLOW_POLL_MS * 2);
    expect(get.mock.calls.length).toBe(afterComplete);
    stop();
  });

  it('stops polling when the run fails', async () => {
    const running = wf({ id: 'run-2', status: 'running' });
    const failed = wf({ id: 'run-2', status: 'failed' });
    const get = vi.spyOn(api.workflows, 'get')
      .mockResolvedValueOnce(running)
      .mockResolvedValue(failed);
    vi.spyOn(api.workflows, 'getGraph').mockResolvedValue({
      workflowId: 'run-2',
      status: 'failed',
      nodes: [{ id: 't1', label: 'Plan', role: 'planner', status: 'failed' }],
      edges: [],
    });

    const ticks: string[] = [];
    const stop = startCanvasWorkflowLivePoll({
      runId: 'run-2',
      onTick: (snapshot) => { ticks.push(snapshot.status); },
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(LIVE_WORKFLOW_POLL_MS);
    expect(ticks.at(-1)).toBe('failed');
    const afterFail = get.mock.calls.length;
    await vi.advanceTimersByTimeAsync(LIVE_WORKFLOW_POLL_MS * 2);
    expect(get.mock.calls.length).toBe(afterFail);
    stop();
  });
});
