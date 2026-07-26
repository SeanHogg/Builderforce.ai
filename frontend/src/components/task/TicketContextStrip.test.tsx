import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TicketContextStrip } from './TicketContextStrip';
import { TaskBadges } from './TaskBadges';
import { tasksApi, kanbanApi, type Task, type TicketContext } from '@/lib/builderforceApi';

vi.mock('@/lib/builderforceApi', () => ({
  tasksApi: { context: vi.fn() },
  kanbanApi: { coordinate: vi.fn() },
}));

const mockContext = vi.mocked(tasksApi.context);
const mockCoordinate = vi.mocked(kanbanApi.coordinate);

function makeContext(over: Partial<TicketContext> = {}): TicketContext {
  return {
    taskId: 169,
    projectId: 11,
    completion: {
      percent: 19,
      laneKey: 'in_progress',
      laneIndex: 3,
      laneCount: 9,
      isTerminal: false,
      basis: [
        { kind: 'lane', percent: 38, weight: 0.5, done: 4, total: 9 },
        { kind: 'signoff', percent: 0, weight: 0.5, done: 0, total: 10 },
      ],
    },
    signoff: { completed: 0, required: 10, percent: 0, gaps: 10, outstandingRoles: ['Business Analyst', 'Product Owner'] },
    epic: null,
    children: null,
    objectives: [],
    ...over,
  };
}

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 169, projectId: 11, key: 'BF-169', title: 'Produce a feature matrix',
    description: null, status: 'in_progress', priority: 'medium', taskType: 'task',
    parentTaskId: null, sprintId: null, assignedAgentType: null, assignedAgentHostId: null,
    assignedAgentRef: null, assignedUserId: null, gitBranch: null, explicitRepoId: null,
    githubPrUrl: null, githubPrNumber: null, startDate: null, dueDate: null, persona: null,
    archived: false, createdAt: '2026-06-29T16:52:39.124Z', updatedAt: '2026-06-29T16:52:39.124Z',
    ...over,
  };
}

beforeEach(() => {
  mockContext.mockReset();
  mockCoordinate.mockReset();
});

describe('TaskBadges', () => {
  /**
   * The bug that prompted the shared component: the board card showed the audit
   * flag, sign-off rollup, PRD count and business value, and opening the ticket
   * dropped all four. One component now feeds card, table and drawer.
   */
  it('renders the flag, sign-off rollup, business value and PRD count together', () => {
    render(
      <TaskBadges
        task={makeTask({ businessValue: 45, specCount: 2, reviewCount: 1, lastReviewVerdict: 'gaps' })}
        flagged
        participants={{ completed: 0, required: 10, percent: 0 }}
      />,
    );
    expect(screen.getByText(/board\.audit\.flagged/)).toBeInTheDocument();
    expect(screen.getByText('0/10', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/board\.businessValue\.badge 45/)).toBeInTheDocument();
    expect(screen.getByText(/PRD ×2/)).toBeInTheDocument();
    expect(screen.getByText(/common\.reviewedTimes 1/)).toBeInTheDocument();
  });

  it('hides the sign-off rollup when the board tracks no required roles', () => {
    render(<TaskBadges task={makeTask()} participants={{ completed: 0, required: 0, percent: 100 }} />);
    expect(screen.queryByText('0/0')).not.toBeInTheDocument();
  });
});

describe('TicketContextStrip', () => {
  it('shows the ticket %, and the basis it was folded from', async () => {
    mockContext.mockResolvedValue(makeContext());
    render(<TicketContextStrip taskId={169} />);

    expect(await screen.findByText('19%')).toBeInTheDocument();
    // The number is auditable in place — never a bare assertion.
    expect(screen.getByText(/ticketContext\.basisLane 4 9/)).toBeInTheDocument();
    expect(screen.getByText(/ticketContext\.basisSignoff 0 10/)).toBeInTheDocument();
  });

  it('names the roles the ticket is waiting on instead of burying them in a tab', async () => {
    mockContext.mockResolvedValue(makeContext());
    render(<TicketContextStrip taskId={169} />);
    expect(await screen.findByText('Business Analyst · Product Owner')).toBeInTheDocument();
  });

  it('dispatches the outstanding reviewers from the strip and re-reads the context', async () => {
    mockContext.mockResolvedValue(makeContext());
    mockCoordinate.mockResolvedValue({ ok: true, status: 'ok', dispatched: true, requiredOutstanding: 10 });
    const onChanged = vi.fn();
    render(<TicketContextStrip taskId={169} onChanged={onChanged} />);

    fireEvent.click(await screen.findByText(/ticketContext\.dispatchReviewers/));
    await waitFor(() => expect(mockCoordinate).toHaveBeenCalledWith(169));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(mockContext).toHaveBeenCalledTimes(2);
  });

  it('surfaces the parent Epic with its own rollup, and opens it on click', async () => {
    mockContext.mockResolvedValue(makeContext({
      epic: { id: 42, key: 'BF-42', title: 'Feature matrix epic', status: 'in_progress', total: 8, done: 3, percent: 38 },
    }));
    const onOpenEpic = vi.fn();
    render(<TicketContextStrip taskId={169} onOpenEpic={onOpenEpic} />);

    fireEvent.click(await screen.findByText('Feature matrix epic'));
    expect(onOpenEpic).toHaveBeenCalledWith(42);
    expect(screen.getByText(/ticketContext\.epicChildren 3 8/)).toBeInTheDocument();
    expect(screen.getByText('38%')).toBeInTheDocument();
  });

  it('states the ticket’s share of the objective, not just that one is linked', async () => {
    mockContext.mockResolvedValue(makeContext({
      objectives: [{
        id: 'o1', title: 'Ship measurable delivery', status: 'active', period: '2026-Q3',
        percent: 60, via: 'task', viaLabel: null, sharePercent: 25,
        linkedTaskCount: 4, linkedTaskDone: 1,
        keyResults: [{ id: 'k1', title: 'Cycle time < 3d', status: 'on_track', unit: null, currentValue: 4, targetValue: 3, percent: 60 }],
      }],
    }));
    render(<TicketContextStrip taskId={169} />);

    expect(await screen.findByText('Ship measurable delivery')).toBeInTheDocument();
    // The objective's own attainment plus its single key result — both read 60%.
    expect(screen.getAllByText('60%')).toHaveLength(2);
    expect(screen.getByText(/ticketContext\.objectiveShare/)).toBeInTheDocument();
    expect(screen.getByText('Cycle time < 3d')).toBeInTheDocument();
  });

  it('prompts to link a goal rather than silently showing nothing', async () => {
    mockContext.mockResolvedValue(makeContext({ signoff: { completed: 2, required: 2, percent: 100, gaps: 0, outstandingRoles: [] } }));
    render(<TicketContextStrip taskId={169} />);
    expect(await screen.findByText(/ticketContext\.noObjective/)).toBeInTheDocument();
    // Nothing outstanding ⇒ no blockers box shouting at the operator.
    expect(screen.queryByText(/ticketContext\.dispatchReviewers/)).not.toBeInTheDocument();
  });

  it('renders nothing while the context is still loading', () => {
    mockContext.mockReturnValue(new Promise(() => {}));
    const { container } = render(<TicketContextStrip taskId={169} />);
    expect(container).toBeEmptyDOMElement();
  });
});
