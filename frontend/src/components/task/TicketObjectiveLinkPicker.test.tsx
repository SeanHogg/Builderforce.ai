import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TicketObjectiveLinkPicker, groupObjectivesForTicket } from './TicketObjectiveLinkPicker';
import { pmoApi, type Objective } from '@/lib/builderforceApi';

// Flipped per test: the picker AND the real <RoleGate> both read `usePermission`.
const perm = vi.hoisted(() => ({ allowed: true }));

vi.mock('@/lib/builderforceApi', () => ({
  pmoApi: { objectives: { list: vi.fn(), addLink: vi.fn() } },
}));
vi.mock('@/lib/rbac', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rbac')>()),
  usePermission: () => ({
    allowed: perm.allowed,
    role: perm.allowed ? 'manager' : 'developer',
    required: 'manager',
  }),
}));

const mockList = vi.mocked(pmoApi.objectives.list);
const mockAddLink = vi.mocked(pmoApi.objectives.addLink);

function objective(over: Partial<Objective> & Pick<Objective, 'id' | 'title'>): Objective {
  return {
    description: null, period: null, status: 'active', projectId: null, portfolioId: null,
    initiativeId: null, ownerUserId: null, startDate: null, endDate: null,
    costClass: null, costClassSource: 'manual',
    ...over,
  };
}

const rows: Objective[] = [
  objective({ id: 'o-ws', title: 'Workspace north star' }),
  objective({ id: 'o-b', title: 'Cut cycle time', projectId: 11, period: '2026-Q3' }),
  objective({ id: 'o-a', title: 'Activate trial teams', projectId: 11 }),
  objective({ id: 'o-other', title: 'Another project goal', projectId: 99 }),
];

const picker = () => screen.getByRole('combobox', { name: /ticketContext\.linkObjectiveLabel/ });
const linkButton = () => screen.getByRole('button', { name: /ticketContext\.linkObjective/ });

beforeEach(() => {
  mockList.mockReset();
  mockAddLink.mockReset();
  perm.allowed = true;
});

describe('groupObjectivesForTicket', () => {
  it('puts the ticket’s own project first, everything else after, each by title', () => {
    const g = groupObjectivesForTicket(rows, 11);
    expect(g.project.map((o) => o.id)).toEqual(['o-a', 'o-b']);
    // Workspace-level and other projects' OKRs stay linkable — a ticket can serve them.
    expect(g.other.map((o) => o.id)).toEqual(['o-other', 'o-ws']);
  });

  it('offers the whole list ungrouped when the ticket has no project', () => {
    const g = groupObjectivesForTicket(rows, null);
    expect(g.project).toEqual([]);
    expect(g.other).toHaveLength(4);
  });
});

describe('TicketObjectiveLinkPicker', () => {
  it('links the chosen objective to this ticket and hands control back to the strip', async () => {
    mockList.mockResolvedValue(rows);
    mockAddLink.mockResolvedValue({ id: 'link-1' });
    const onLinked = vi.fn();
    render(<TicketObjectiveLinkPicker taskId={169} projectId={11} onLinked={onLinked} />);

    await waitFor(() => expect(picker()).not.toBeDisabled());
    fireEvent.click(picker());
    // The ticket's project is named as its own group, ahead of the rest.
    expect(screen.getByText(/ticketContext\.projectObjectives/)).toBeInTheDocument();
    expect(screen.getByText(/ticketContext\.otherObjectives/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Cut cycle time · 2026-Q3' }));

    fireEvent.click(linkButton());
    await waitFor(() => expect(mockAddLink).toHaveBeenCalledWith('o-b', { linkKind: 'task', taskId: 169 }));
    await waitFor(() => expect(onLinked).toHaveBeenCalledTimes(1));
  });

  it('disables — never hides — the control below MANAGER, and never posts', async () => {
    perm.allowed = false;
    mockList.mockResolvedValue(rows);
    render(<TicketObjectiveLinkPicker taskId={169} projectId={11} onLinked={vi.fn()} />);

    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(picker()).toBeDisabled();
    expect(linkButton()).toBeDisabled();
    // The RoleGate names the role that CAN do it.
    expect(screen.getByTitle(/common\.requiresRoleHint/)).toBeInTheDocument();
    fireEvent.click(linkButton());
    expect(mockAddLink).not.toHaveBeenCalled();
  });

  it('reports a failed load as a failure with a retry — not as an empty workspace', async () => {
    mockList.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(rows);
    render(<TicketObjectiveLinkPicker taskId={169} projectId={11} onLinked={vi.fn()} />);

    expect(await screen.findByText(/ticketContext\.loadObjectivesFailed/)).toBeInTheDocument();
    expect(screen.queryByText(/ticketContext\.noObjectivesYet/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /ticketContext\.retryLoadObjectives/ }));
    await waitFor(() => expect(picker()).not.toBeDisabled());
    expect(mockList).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/ticketContext\.loadObjectivesFailed/)).not.toBeInTheDocument();
  });

  it('says so when the workspace has no objectives yet', async () => {
    mockList.mockResolvedValue([]);
    render(<TicketObjectiveLinkPicker taskId={169} projectId={11} onLinked={vi.fn()} />);

    expect(await screen.findByText(/ticketContext\.noObjectivesYet/)).toBeInTheDocument();
    expect(picker()).toBeDisabled();
  });

  it('keeps the strip as-is and shows the reason when the link write fails', async () => {
    mockList.mockResolvedValue(rows);
    mockAddLink.mockRejectedValue(new Error('forbidden'));
    const onLinked = vi.fn();
    render(<TicketObjectiveLinkPicker taskId={169} projectId={11} onLinked={onLinked} />);

    await waitFor(() => expect(picker()).not.toBeDisabled());
    fireEvent.click(picker());
    fireEvent.click(screen.getByRole('option', { name: 'Workspace north star' }));
    fireEvent.click(linkButton());

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onLinked).not.toHaveBeenCalled();
  });
});
