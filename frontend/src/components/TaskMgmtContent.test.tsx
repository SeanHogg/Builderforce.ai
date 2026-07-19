import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { TaskMgmtContent } from './TaskMgmtContent';
import { tasksApi } from '@/lib/builderforceApi';

// mock APIs used by component
vi.mock('@/lib/builderforceApi', () => {
  return {
    tasksApi: {
      list: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(undefined),
      assignees: vi.fn().mockResolvedValue([]),
    },
    agentHosts: { list: vi.fn().mockResolvedValue([]) },
    runtimeApi: {
      submitExecution: vi.fn().mockResolvedValue({}),
      listRecent: vi.fn().mockResolvedValue([]),
    },
    isAwaitingApprovalExecution: vi.fn().mockReturnValue(false),
    boardsApi: {
      list: vi.fn().mockResolvedValue([]),
      swimlanes: { list: vi.fn().mockResolvedValue([]) },
      agents: { list: vi.fn().mockResolvedValue([]) },
    },
    workflowDefinitions: {
      runTargets: vi.fn().mockResolvedValue({ hosts: [], cloudAgents: [] }),
    },
    // This factory REPLACES the module, so anything the component tree touches
    // must be listed — an omitted export reads as `undefined` and blows up in an
    // effect (e.g. `kanbanApi.assigneeProfiles().then(...)`). Only the calls that
    // fire on mount need to be here; each returns its real empty shape.
    kanbanApi: {
      assigneeProfiles: vi.fn().mockResolvedValue({}),
      participantsSummary: vi.fn().mockResolvedValue([]),
      flaggedForProject: vi.fn().mockResolvedValue([]),
    },
  };
});

vi.mock('@/lib/api', () => ({ fetchProjects: vi.fn().mockResolvedValue([]) }));

describe('TaskMgmtContent', () => {
  it('renders backlog column in board view', async () => {
    const { getByText } = render(<TaskMgmtContent projects={[]} />);
    const boardBtn = getByText(/board/i);
    fireEvent.click(boardBtn);
    await waitFor(() => {
      expect(getByText('Backlog')).toBeTruthy();
    });
  });

  it('shows checkboxes and allows bulk status in list view', async () => {
    // mock tasks API to return two tasks
    vi.mocked(tasksApi.list).mockResolvedValueOnce([
      { id: 1, title: 'A', status: 'todo' },
      { id: 2, title: 'B', status: 'todo' },
    ] as any);
    const { getByText, getAllByRole, getAllByText } = render(<TaskMgmtContent projects={[]} />);
    // switch to list view
    const listBtn = getByText(/list/i);
    fireEvent.click(listBtn);
    await waitFor(() => {
      // two checkboxes (one per row) plus header
      const checkboxes = getAllByRole('checkbox');
      expect(checkboxes.length).toBe(3);
    });
    // select all using header checkbox
    const headerCb = getAllByRole('checkbox')[0];
    fireEvent.click(headerCb);
    // select first row status dropdown appears when clicking status cell
    const statusSpan = getAllByText('To Do')[0];
    fireEvent.click(statusSpan);
    // should transform into select element
    await waitFor(() => {
      expect(getAllByRole('combobox').length).toBeGreaterThan(0);
    });
  });
});
