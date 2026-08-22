import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Project } from '@/lib/types';
import { PortfolioHealthContent } from './PortfolioHealthContent';

// The global next-intl mock returns the KEY (with interpolation values appended),
// so these assert the WIRING — which message a cell renders and with what number —
// and the copy itself is asserted against the catalogue in i18n/messages.test.ts.

const fetchProjects = vi.fn<() => Promise<Project[]>>();
vi.mock('@/lib/api', () => ({ fetchProjects: () => fetchProjects() }));

let nextId = 1;
const project = (o: Partial<Project> = {}): Project => ({ id: nextId++, name: `p${nextId}`, ...o } as Project);

const delivering = {
  dora: { deploymentFrequencyPerDay: 3, totalDeployments: 90, leadTimeHours: 6, changeFailureRatePct: 2, mttrHours: 0.5 },
  lifecycle: { sampleSize: 40, totalAvgHours: 48 },
  bottlenecks: { rework: { reworkRate: 0 }, agingWip: { stuckCount: 0 } },
};

describe('PortfolioHealthContent', () => {
  beforeEach(() => {
    fetchProjects.mockReset();
  });

  it('renders one card per live project, worst first, and links each to its project', async () => {
    fetchProjects.mockResolvedValue([
      project({ name: 'Delivering', status: 'active', taskCount: 10, completedTaskCount: 9, openTaskCount: 1, deliverySignals: delivering }),
      project({ name: 'Paused', status: 'on_hold', taskCount: 9, completedTaskCount: 0, openTaskCount: 9 }),
      project({ name: 'Empty shell', status: 'active', taskCount: 0 }),
      project({ name: 'Finished', status: 'completed', taskCount: 4, completedTaskCount: 4 }),
    ]);

    render(<PortfolioHealthContent />);

    const cards = await screen.findAllByRole('article');
    // 'Finished' is not live, so it is not reported on at all.
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => within(c).getByRole('link').textContent)).toEqual(['Empty shell', 'Paused', 'Delivering']);
    expect(within(cards[0]).getByRole('link').getAttribute('href')).toMatch(/^\/projects\?project=\d+&panel=analytics$/);
  });

  it('names the blocker and the matching next action on each card', async () => {
    fetchProjects.mockResolvedValue([project({ name: 'Empty shell', status: 'active', taskCount: 0 })]);

    render(<PortfolioHealthContent />);

    const card = await screen.findByRole('article');
    expect(within(card).getByText('pmo.health.blocker.noTasks')).toBeTruthy();
    expect(within(card).getByText('pmo.health.action.noTasks')).toBeTruthy();
    expect(within(card).getByText('pmo.health.risk.high')).toBeTruthy();
  });

  it('leads with the RAG counts, the overall band and the top priority actions', async () => {
    fetchProjects.mockResolvedValue([
      project({ name: 'Stalled', status: 'active', taskCount: 40, completedTaskCount: 0, openTaskCount: 40 }),
      project({ name: 'Paused', status: 'on_hold', taskCount: 9, completedTaskCount: 0, openTaskCount: 9 }),
      project({ name: 'Delivering', status: 'active', taskCount: 10, completedTaskCount: 9, openTaskCount: 1, deliverySignals: delivering }),
    ]);

    render(<PortfolioHealthContent />);

    await screen.findByText('pmo.health.snapshotHeading');
    // One tile per band, each labelled by its band key and carrying its count.
    expect(screen.getAllByText('pmo.health.rag.red')).not.toHaveLength(0);
    // Any red present makes the whole portfolio red.
    const banner = screen.getByText('pmo.health.overallLabel').parentElement!;
    expect(within(banner).getByText('pmo.health.rag.red')).toBeTruthy();
    // Two non-green projects → two ranked actions, worst first, green never listed.
    const actions = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(actions.map((li) => li.textContent)).toEqual([
      'Stalled — pmo.health.action.notStarted 40',
      'Paused — pmo.health.action.onHold',
    ]);
  });

  it('shows its own empty state when nothing is live, rather than an empty grid', async () => {
    fetchProjects.mockResolvedValue([project({ name: 'Archived', status: 'archived' })]);

    render(<PortfolioHealthContent />);

    await screen.findByText('pmo.health.empty');
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });

  it('surfaces a failed read instead of rendering a false all-green portfolio', async () => {
    fetchProjects.mockRejectedValue(new Error('offline'));

    render(<PortfolioHealthContent />);

    await waitFor(() => expect(screen.getByText('offline')).toBeTruthy());
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });
});
