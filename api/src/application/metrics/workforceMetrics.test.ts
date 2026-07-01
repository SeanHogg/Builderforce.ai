import { describe, expect, it } from 'vitest';
import {
  scoreMembers,
  rollupDora,
  rollupDoraSeries,
  rollupByDiscipline,
  memberMetricsCacheKey,
  doraCacheKey,
  type MemberScorecard,
  type MemberTaskRow,
  type DeployRow,
  type LeadRow,
} from './workforceMetrics';

/**
 * Locks the pure scoring math behind the workforce effectiveness/engagement +
 * DORA metrics (migrations 0117/0118) — no DB. Covers: owner precedence,
 * redo/reopen/cycle effectiveness penalties, human-only engagement (idle-after-
 * done hygiene + pickup latency), agents getting null engagement, and the four
 * DORA aggregates.
 */

const H = 3_600_000;
function task(over: Partial<MemberTaskRow>): MemberTaskRow {
  return {
    taskId: over.taskId ?? 1,
    assignedUserId: over.assignedUserId ?? null,
    assignedUserName: over.assignedUserName ?? null,
    assignedAgentHostId: over.assignedAgentHostId ?? null,
    assignedHostName: over.assignedHostName ?? null,
    assignedAgentRef: over.assignedAgentRef ?? null,
    createdAt: over.createdAt ?? new Date('2026-06-10T00:00:00Z'),
    completedAt: over.completedAt ?? null,
    lastWorkedAt: over.lastWorkedAt ?? null,
    redoCount: over.redoCount ?? 0,
    reopenCount: over.reopenCount ?? 0,
  };
}

describe('scoreMembers', () => {
  it('buckets by single owner (human > host > cloud) and counts completion', () => {
    const rows = [
      task({ taskId: 1, assignedUserId: 'u1', assignedUserName: 'Ann', completedAt: new Date('2026-06-10T04:00:00Z') }),
      task({ taskId: 2, assignedUserId: 'u1', assignedUserName: 'Ann' }), // still open
      task({ taskId: 3, assignedAgentRef: 'agent-x', completedAt: new Date('2026-06-10T02:00:00Z') }),
    ];
    const cards = scoreMembers(rows, new Map());
    const ann = cards.find((c) => c.memberRef === 'u1')!;
    expect(ann.memberKind).toBe('human');
    expect(ann.assignedCount).toBe(2);
    expect(ann.completedCount).toBe(1);
    const agent = cards.find((c) => c.memberRef === 'agent-x')!;
    expect(agent.memberKind).toBe('cloud_agent');
    expect(agent.engagementScore).toBeNull(); // agents have no board behaviour
  });

  it('docks effectiveness for redo and reopen', () => {
    const clean = scoreMembers(
      [task({ taskId: 1, assignedUserId: 'u1', completedAt: new Date('2026-06-10T01:00:00Z') })],
      new Map(),
    )[0]!;
    const messy = scoreMembers(
      [task({ taskId: 2, assignedUserId: 'u2', completedAt: new Date('2026-06-10T01:00:00Z'), redoCount: 2, reopenCount: 1 })],
      new Map(),
    )[0]!;
    expect(messy.redoCount).toBe(2);
    expect(messy.reopenCount).toBe(1);
    expect(messy.effectivenessScore!).toBeLessThan(clean.effectivenessScore!);
  });

  it('rewards prompt board hygiene (low idle-after-done) for humans', () => {
    const created = new Date('2026-06-10T00:00:00Z');
    const completed = new Date('2026-06-10T10:00:00Z');
    const prompt = scoreMembers(
      [task({ assignedUserId: 'u1', createdAt: created, completedAt: completed, lastWorkedAt: new Date(completed.getTime() - 0.25 * H) })],
      new Map(),
    )[0]!;
    const idle = scoreMembers(
      [task({ assignedUserId: 'u2', createdAt: created, completedAt: completed, lastWorkedAt: new Date(completed.getTime() - 20 * H) })],
      new Map(),
    )[0]!;
    expect(prompt.boardHygieneScore!).toBeGreaterThan(idle.boardHygieneScore!);
  });

  it('uses first-move timing for pickup latency', () => {
    const created = new Date('2026-06-10T00:00:00Z');
    const fm = new Map<number, Date>([[1, new Date(created.getTime() + 3 * H)]]);
    const card = scoreMembers([task({ taskId: 1, assignedUserId: 'u1', createdAt: created, completedAt: new Date('2026-06-10T08:00:00Z'), lastWorkedAt: new Date('2026-06-10T07:00:00Z') })], fm)[0]!;
    expect(card.avgPickupLatencyHours).toBeCloseTo(3, 5);
  });
});

describe('rollupDora', () => {
  it('computes the four metrics', () => {
    const deploys: DeployRow[] = [
      { deployedAt: new Date('2026-06-01T00:00:00Z'), isFailure: false, restoredAt: null },
      { deployedAt: new Date('2026-06-02T00:00:00Z'), isFailure: true, restoredAt: new Date('2026-06-02T04:00:00Z') },
    ];
    const dora = rollupDora(10, [24, 48], deploys);
    expect(dora.totalDeployments).toBe(2);
    expect(dora.deploymentFrequencyPerDay).toBeCloseTo(0.2, 5);
    expect(dora.leadTimeHours).toBeCloseTo(36, 5);
    expect(dora.changeFailureRatePct).toBeCloseTo(50, 5);
    expect(dora.mttrHours).toBeCloseTo(4, 5);
  });

  it('null-safes an empty window', () => {
    const dora = rollupDora(30, [], []);
    expect(dora.totalDeployments).toBe(0);
    expect(dora.leadTimeHours).toBeNull();
    expect(dora.changeFailureRatePct).toBeNull();
    expect(dora.mttrHours).toBeNull();
    expect(dora.series).toEqual([]);
  });
});

describe('rollupDoraSeries', () => {
  const WEEK = 7 * 24 * H;
  it('buckets deploys + lead times into per-week points anchored at the window start', () => {
    const windowStart = Date.UTC(2026, 5, 1); // 2026-06-01
    const now = windowStart + 3 * WEEK; // three full weeks
    const deploys: DeployRow[] = [
      // week 0: one clean deploy
      { deployedAt: new Date(windowStart + 1 * 24 * H), isFailure: false, restoredAt: null },
      // week 1: one failed+restored deploy
      { deployedAt: new Date(windowStart + WEEK + 2 * 24 * H), isFailure: true, restoredAt: new Date(windowStart + WEEK + 2 * 24 * H + 5 * H) },
    ];
    const leads: LeadRow[] = [
      { completedAt: new Date(windowStart + 1 * 24 * H), leadTimeHrs: 10 },
      { completedAt: new Date(windowStart + WEEK + 1 * 24 * H), leadTimeHrs: 30 },
    ];
    const series = rollupDoraSeries(windowStart, now, leads, deploys);
    expect(series).toHaveLength(3);
    expect(series[0]!.bucketStart).toBe('2026-06-01');
    expect(series[0]!.totalDeployments).toBe(1);
    expect(series[0]!.leadTimeHours).toBeCloseTo(10, 5);
    expect(series[0]!.changeFailureRatePct).toBeCloseTo(0, 5);
    expect(series[1]!.totalDeployments).toBe(1);
    expect(series[1]!.changeFailureRatePct).toBeCloseTo(100, 5);
    expect(series[1]!.mttrHours).toBeCloseTo(5, 5);
    expect(series[1]!.leadTimeHours).toBeCloseTo(30, 5);
    expect(series[2]!.totalDeployments).toBe(0); // empty final week
    expect(series[2]!.leadTimeHours).toBeNull();
  });

  it('returns at least one bucket for a sub-week window', () => {
    const windowStart = Date.UTC(2026, 5, 1);
    const series = rollupDoraSeries(windowStart, windowStart + 2 * 24 * H, [], []);
    expect(series).toHaveLength(1);
    expect(series[0]!.totalDeployments).toBe(0);
  });
});

describe('rollupByDiscipline', () => {
  function card(over: Partial<MemberScorecard>): MemberScorecard {
    return {
      memberKind: 'human', memberRef: 'u', memberName: 'U', discipline: null,
      assignedCount: 0, completedCount: 0, redoCount: 0, reopenCount: 0,
      avgCycleTimeHours: null, avgPickupLatencyHours: null, avgIdleAfterDoneHours: null,
      boardHygieneScore: null, engagementScore: null, effectivenessScore: null,
      ...over,
    };
  }

  it('groups by discipline, buckets null as unassigned, and averages effectiveness', () => {
    const cards = [
      card({ memberRef: 'a', discipline: 'product', completedCount: 3, effectivenessScore: 80 }),
      card({ memberRef: 'b', discipline: 'product', completedCount: 2, effectivenessScore: 60 }),
      card({ memberRef: 'c', discipline: 'qa', completedCount: 1, effectivenessScore: 90 }),
      card({ memberRef: 'd', discipline: null, completedCount: 4, effectivenessScore: null }),
    ];
    const roll = rollupByDiscipline(cards);
    const product = roll.find((r) => r.discipline === 'product')!;
    expect(product.memberCount).toBe(2);
    expect(product.completedCount).toBe(5);
    expect(product.avgEffectiveness).toBeCloseTo(70, 5);
    const unassigned = roll.find((r) => r.discipline === 'unassigned')!;
    expect(unassigned.memberCount).toBe(1);
    expect(unassigned.completedCount).toBe(4);
    expect(unassigned.avgEffectiveness).toBeNull(); // no scored members
  });

  it('sorts by completed work desc', () => {
    const roll = rollupByDiscipline([
      card({ discipline: 'design', completedCount: 1 }),
      card({ discipline: 'engineering', completedCount: 9 }),
    ]);
    expect(roll[0]!.discipline).toBe('engineering');
  });
});

describe('cache keys', () => {
  it('namespace member vs dora and fold tenant/version/window', () => {
    expect(memberMetricsCacheKey(7, 3, 14)).toBe('workforce-metrics:members:tenant:7:v:3:days:14');
    expect(doraCacheKey(7, 3, 30)).toBe('workforce-metrics:dora:tenant:7:v:3:days:30');
  });
});
