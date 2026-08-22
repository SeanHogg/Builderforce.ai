import { describe, it, expect } from 'vitest';
import type { Project } from '@/lib/types';
import { buildPortfolioHealth, buildPortfolioHealthItem, livePortfolioProjects } from './portfolioHealth';

/**
 * Minimal fixtures — only the fields the portfolio read touches. Everything else on
 * `Project` is optional, which is the point: the health read is composed from what the
 * `/api/projects` list already attaches, not from a bespoke payload.
 */
let nextId = 1;
const project = (o: Partial<Project> = {}): Project => ({
  id: nextId++,
  name: `project-${nextId}`,
  ...o,
} as Project);

/** Delivery signals that score well enough to land in the healthy tier. */
const delivering = {
  dora: { deploymentFrequencyPerDay: 3, totalDeployments: 90, leadTimeHours: 6, changeFailureRatePct: 2, mttrHours: 0.5 },
  lifecycle: { sampleSize: 40, totalAvgHours: 48 },
  bottlenecks: { rework: { reworkRate: 0 }, agingWip: { stuckCount: 0 } },
};

/** Delivery signals bad enough to land in the critical tier. */
const stalling = {
  dora: { deploymentFrequencyPerDay: 0.01, totalDeployments: 1, leadTimeHours: 900, changeFailureRatePct: 45, mttrHours: 300 },
  lifecycle: { sampleSize: 30, totalAvgHours: 720 },
  bottlenecks: { rework: { reworkRate: 0.4 }, agingWip: { stuckCount: 8 } },
};

describe('livePortfolioProjects', () => {
  it('drops completed and archived projects, keeps active and on-hold ones', () => {
    const kept = livePortfolioProjects([
      project({ name: 'a', status: 'active' }),
      project({ name: 'b', status: 'on_hold' }),
      project({ name: 'c', status: 'completed' }),
      project({ name: 'd', status: 'archived' }),
      project({ name: 'e' }), // status omitted → the column default, 'active'
    ]);
    expect(kept.map((p) => p.name)).toEqual(['a', 'b', 'e']);
  });
});

describe('buildPortfolioHealthItem', () => {
  it('reads a project with no tasks as red, with nothing to measure', () => {
    const item = buildPortfolioHealthItem(project({ status: 'active', taskCount: 0 }));
    expect(item.blocker.key).toBe('noTasks');
    expect(item.action.key).toBe('noTasks');
    expect(item.rag).toBe('red');
    expect(item.risk).toBe('high');
  });

  it('reads a project whose tasks all sit untouched as red, not started', () => {
    const item = buildPortfolioHealthItem(
      project({ status: 'active', taskCount: 40, completedTaskCount: 0, openTaskCount: 40 }),
    );
    expect(item.blocker.key).toBe('notStarted');
    expect(item.blocker.values).toEqual({ count: 40 });
    expect(item.rag).toBe('red');
  });

  it('reads a deliberate hold as amber rather than red', () => {
    const item = buildPortfolioHealthItem(
      project({ status: 'on_hold', taskCount: 9, completedTaskCount: 0, openTaskCount: 9 }),
    );
    expect(item.blocker.key).toBe('onHold');
    expect(item.rag).toBe('amber');
    expect(item.risk).toBe('medium');
  });

  it('names blocked tasks ahead of overdue ones, and bands them amber', () => {
    const item = buildPortfolioHealthItem(
      project({
        status: 'active', taskCount: 19, completedTaskCount: 13, openTaskCount: 6,
        blockedTaskCount: 3, overdueTaskCount: 2, deliverySignals: delivering,
      }),
    );
    expect(item.blocker.key).toBe('blocked');
    expect(item.blocker.values).toEqual({ count: 3 });
    expect(item.rag).toBe('amber');
  });

  it('bands a stalled delivery red even with work completed', () => {
    const item = buildPortfolioHealthItem(
      project({ status: 'active', taskCount: 20, completedTaskCount: 18, openTaskCount: 2, deliverySignals: stalling }),
    );
    expect(item.blocker.key).toBe('deliveryStalled');
    expect(item.rag).toBe('red');
  });

  it('holds a project under half-way at amber even when nothing is blocking it', () => {
    const item = buildPortfolioHealthItem(
      project({ status: 'active', taskCount: 10, completedTaskCount: 3, openTaskCount: 7, deliverySignals: delivering }),
    );
    expect(item.blocker.key).toBe('onTrack');
    expect(item.rag).toBe('amber');
  });

  it('bands a delivering project past half-way green', () => {
    const item = buildPortfolioHealthItem(
      project({ status: 'active', taskCount: 10, completedTaskCount: 8, openTaskCount: 2, deliverySignals: delivering }),
    );
    expect(item.blocker.key).toBe('onTrack');
    expect(item.rag).toBe('green');
    expect(item.risk).toBe('low');
  });

  it('says so when there is no delivery signal to read', () => {
    const item = buildPortfolioHealthItem(
      project({ status: 'active', taskCount: 10, completedTaskCount: 8, openTaskCount: 2 }),
    );
    expect(item.blocker.key).toBe('noSignal');
    expect(item.health.healthScore).toBeNull();
  });

  it('pairs every action with its own blocker key', () => {
    const item = buildPortfolioHealthItem(project({ status: 'active', taskCount: 0 }));
    expect(item.action.key).toBe(item.blocker.key);
    expect(item.action.values).toEqual(item.blocker.values);
  });
});

describe('buildPortfolioHealth', () => {
  const portfolio = () => buildPortfolioHealth([
    project({ name: 'green-one', status: 'active', taskCount: 10, completedTaskCount: 9, openTaskCount: 1, deliverySignals: delivering }),
    project({ name: 'on-hold', status: 'on_hold', taskCount: 9, completedTaskCount: 0, openTaskCount: 9 }),
    project({ name: 'empty-shell', status: 'active', taskCount: 0 }),
    project({ name: 'not-started', status: 'active', taskCount: 40, completedTaskCount: 0, openTaskCount: 40 }),
    project({ name: 'archived', status: 'archived', taskCount: 5, completedTaskCount: 5 }),
  ]);

  it('counts each band over the live projects only', () => {
    const { summary } = portfolio();
    expect(summary.total).toBe(4);
    expect(summary.green).toBe(1);
    expect(summary.amber).toBe(1);
    expect(summary.red).toBe(2);
  });

  it('takes the worst band present as the overall health', () => {
    expect(portfolio().summary.overall).toBe('red');
    const allGreen = buildPortfolioHealth([
      project({ status: 'active', taskCount: 10, completedTaskCount: 9, openTaskCount: 1, deliverySignals: delivering }),
    ]);
    expect(allGreen.summary.overall).toBe('green');
  });

  it('orders the grid worst first', () => {
    const { items } = portfolio();
    expect(items.map((i) => i.rag)).toEqual(['red', 'red', 'amber', 'green']);
    expect(items[items.length - 1].name).toBe('green-one');
  });

  it('names at most three top actions and never a green project', () => {
    const { summary } = portfolio();
    expect(summary.topActions).toHaveLength(3);
    expect(summary.topActions.map((a) => a.rank)).toEqual([1, 2, 3]);
    expect(summary.topActions.some((a) => a.item.rag === 'green')).toBe(false);
  });

  it('returns an empty portfolio rather than throwing when nothing is live', () => {
    const empty = buildPortfolioHealth([project({ status: 'archived' })]);
    expect(empty.items).toEqual([]);
    expect(empty.summary.total).toBe(0);
    expect(empty.summary.overall).toBe('green');
    expect(empty.summary.topActions).toEqual([]);
  });
});
