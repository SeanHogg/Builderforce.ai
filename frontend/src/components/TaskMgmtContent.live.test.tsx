import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { TaskMgmtContent } from './TaskMgmtContent';

// Live board run feed: a ticket that a cloud agent (Kevin) already ran and that a
// freshly-queued cloud agent (Bob) is now pending on. Asserts the card resolves
// BOTH cloud agents by name (not the generic "Agent"), shows the agent history,
// and flags the queued run as pending — the regression this change fixes.
vi.mock('@/lib/builderforceApi', () => ({
  tasksApi: {
    list: vi.fn().mockResolvedValue([
      { id: 1, title: 'Avatar filters', status: 'ready', priority: 'high', key: 'T-1', projectId: 1, assignedAgentRef: 'bob' },
    ]),
    update: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(undefined),
    assignees: vi.fn().mockResolvedValue([]),
  },
  agentHosts: { list: vi.fn().mockResolvedValue([]) },
  runtimeApi: {
    submitExecution: vi.fn().mockResolvedValue({}),
    listRecent: vi.fn().mockResolvedValue([
      { id: 10, taskId: 1, status: 'completed', cloudAgentRef: 'kevin', createdAt: '2026-06-14T10:00:00Z' },
      { id: 11, taskId: 1, status: 'pending', cloudAgentRef: 'bob', createdAt: '2026-06-14T11:00:00Z' },
    ]),
  },
  isAwaitingApprovalExecution: vi.fn().mockReturnValue(false),
  boardsApi: {
    list: vi.fn().mockResolvedValue([]),
    dispatches: vi.fn().mockResolvedValue([]),
    swimlanes: { list: vi.fn().mockResolvedValue([]) },
    agents: { list: vi.fn().mockResolvedValue([]) },
  },
  workflowDefinitions: {
    runTargets: vi.fn().mockResolvedValue({
      hosts: [],
      cloudAgents: [
        { ref: 'kevin', name: 'Kevin BA/PM/PO' },
        { ref: 'bob', name: 'Bob Developer' },
      ],
    }),
  },
}));

vi.mock('@/lib/api', () => ({ fetchProjects: vi.fn().mockResolvedValue([{ id: 1, name: 'Demo' }]) }));

describe('TaskMgmtContent live run chips', () => {
  it('resolves cloud agents by name, shows agent history, and flags the queued run pending', async () => {
    const { findAllByText, getByText } = render(<TaskMgmtContent projects={[{ id: 1, name: 'Demo' }] as never} />);

    // Both the prior agent (Kevin) and the freshly-queued agent (Bob) render by
    // name — a cloud agent (cloudAgentRef) must NOT fall back to a generic "Agent".
    await waitFor(async () => {
      expect((await findAllByText(/Kevin BA\/PM\/PO/)).length).toBeGreaterThan(0);
      expect((await findAllByText(/Bob Developer/)).length).toBeGreaterThan(0);
    });

    // The queued run is explicitly flagged pending on the card (chip meta "· pending").
    expect(getByText(/pending/)).toBeTruthy();
  });
});
