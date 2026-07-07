import { describe, it, expect } from 'vitest';
import {
  assembleProject360,
  healthTier,
  type Project360Aggregate,
  type Project360ActiveRow,
  type Project360TaskRow,
} from './computeProject360';

const NOW = '2026-07-03T00:00:00.000Z';

const agg = (over: Partial<Project360Aggregate>): Project360Aggregate => ({
  id: 1,
  name: 'Demo',
  key: 'DEMO',
  status: 'active',
  taskCount: 0,
  completedTaskCount: 0,
  openTaskCount: 0,
  blockedTaskCount: 0,
  overdueTaskCount: 0,
  linkedGoalCount: 0,
  initiativeId: null,
  hasArchitecturePrd: false,
  assignedAgentHost: null,
  ...over,
});

const task = (over: Partial<Project360TaskRow> & { id: number }): Project360TaskRow => ({
  key: `DEMO-${over.id}`,
  title: `Task ${over.id}`,
  status: 'backlog',
  taskType: 'task',
  storyPoints: null,
  description: null,
  assignedUserId: null,
  assignedAgentHostId: null,
  assignedAgentRef: null,
  ...over,
});

const build = (a: Project360Aggregate, tasks: Project360TaskRow[], active: Project360ActiveRow[] = []) =>
  assembleProject360({ agg: a, tasks, active, resolveName: (o) => o.ref, nowIso: NOW });

describe('healthTier', () => {
  it('maps score bands to tiers', () => {
    expect(healthTier(85)).toBe('healthy');
    expect(healthTier(65)).toBe('watch');
    expect(healthTier(45)).toBe('at_risk');
    expect(healthTier(10)).toBe('critical');
  });
});

describe('assembleProject360', () => {
  it('an empty project is neutral/healthy with no data', () => {
    const r = build(agg({ taskCount: 0 }), []);
    expect(r.hasData).toBe(false);
    expect(r.overall.score).toBe(100);
    expect(r.overall.progressPct).toBe(0);
    expect(r.gaps).toHaveLength(0);
    expect(r.dimensions).toHaveLength(8);
    expect(r.pillars.map((p) => p.key)).toEqual(['delivery', 'execution', 'planning', 'team']);
  });

  it('a fully-completed project scores high and surfaces no blocking gaps', () => {
    const r = build(
      agg({ taskCount: 4, completedTaskCount: 4, openTaskCount: 0, linkedGoalCount: 1, hasArchitecturePrd: true }),
      [1, 2, 3, 4].map((id) => task({ id, status: 'done' })),
    );
    expect(r.overall.progressPct).toBe(100);
    expect(r.overall.tier).toBe('healthy');
    expect(r.dimensions.find((d) => d.key === 'progress')!.score).toBe(100);
  });

  it('flags overdue, blocked, unassigned, unestimated and missing direction with severity-ranked gaps', () => {
    const r = build(
      agg({
        taskCount: 8,
        completedTaskCount: 1,
        openTaskCount: 7,
        blockedTaskCount: 2,
        overdueTaskCount: 3,
        linkedGoalCount: 0,
        hasArchitecturePrd: false,
      }),
      [
        task({ id: 1, status: 'blocked' }),
        task({ id: 2, status: 'blocked' }),
        task({ id: 3, status: 'backlog', storyPoints: null }),
        task({ id: 4, status: 'backlog', storyPoints: 0 }),
        task({ id: 5, status: 'ready', storyPoints: 5 }),
        task({ id: 6, status: 'in_progress', assignedUserId: 'u1', description: 'A well described task with scope.' }),
        task({ id: 7, status: 'done' }),
      ],
    );
    const dimScore = (k: string) => r.dimensions.find((d) => d.key === k)!.score;
    expect(dimScore('progress')).toBeLessThan(40); // 1/8
    expect(dimScore('flow')).toBeLessThan(100); // 2 blocked of 7 open
    expect(dimScore('direction')).toBe(20); // no goals, no PRD → base only
    expect(r.overall.tier === 'at_risk' || r.overall.tier === 'critical').toBe(true);

    const dims = new Set(r.gaps.map((g) => g.dimension));
    expect(dims.has('timeliness')).toBe(true);
    expect(dims.has('flow')).toBe(true);
    expect(dims.has('direction')).toBe(true);
    expect(dims.has('staffing')).toBe(true);
    // Sorted high → low severity.
    const rankOf = { high: 3, medium: 2, low: 1 } as const;
    for (let i = 1; i < r.gaps.length; i++) {
      expect(rankOf[r.gaps[i - 1]!.severity]).toBeGreaterThanOrEqual(rankOf[r.gaps[i]!.severity]);
    }
    // Every gap that offers a Brain action carries a non-empty seed.
    for (const g of r.gaps) if (g.action?.kind === 'brain') expect(g.action.text && g.action.text.length).toBeTruthy();
  });

  it('derives live workforce status: running vs awaiting vs blocked vs idle', () => {
    const r = build(
      agg({ taskCount: 4, openTaskCount: 4 }),
      [
        task({ id: 1, status: 'in_progress', assignedUserId: 'alice' }),
        task({ id: 2, status: 'in_progress', assignedAgentRef: 'cloud-7' }),
        task({ id: 3, status: 'blocked', assignedAgentHostId: 9 }),
        task({ id: 4, status: 'ready', assignedUserId: 'bob' }),
      ],
      [
        { taskId: 1, status: 'running' },
        { taskId: 2, status: 'paused' },
      ],
    );
    const by = Object.fromEntries(r.workforce.map((m) => [m.ref, m]));
    expect(by['alice']!.status).toBe('working');
    expect(by['cloud-7']!.status).toBe('awaiting');
    expect(by['cloud-7']!.kind).toBe('cloud');
    expect(by['host:9']!.status).toBe('blocked');
    expect(by['bob']!.status).toBe('idle');
    expect(r.counts.workers).toBe(1);
    expect(r.counts.activeRuns).toBe(2);
  });

  it('overlays availability so an idle owner explains why (out of office)', () => {
    const r = assembleProject360({
      agg: agg({ taskCount: 1, openTaskCount: 1 }),
      tasks: [task({ id: 1, status: 'ready', assignedUserId: 'carol' })],
      active: [],
      resolveName: (o) => o.ref,
      resolveAvailability: (ref) => (ref === 'carol' ? { status: 'ooo', until: null } : undefined),
      nowIso: NOW,
    });
    const carol = r.workforce.find((m) => m.ref === 'carol')!;
    expect(carol.status).toBe('idle');
    expect(carol.reason.toLowerCase()).toContain('out of office');
  });

  it('threads the assigned task type onto the workforce member (epic/gap link to their own kind)', () => {
    const r = build(
      agg({ taskCount: 2, openTaskCount: 2 }),
      [
        task({ id: 1, status: 'in_progress', assignedUserId: 'alice', taskType: 'epic' }),
        task({ id: 2, status: 'ready', assignedUserId: 'bob', taskType: 'gap' }),
      ],
    );
    const by = Object.fromEntries(r.workforce.map((m) => [m.ref, m]));
    expect(by['alice']!.taskType).toBe('epic');
    expect(by['bob']!.taskType).toBe('gap');
  });
});
