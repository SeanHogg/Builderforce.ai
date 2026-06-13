import { describe, expect, it } from 'vitest';
import {
  scoreMembers,
  rollupDora,
  memberMetricsCacheKey,
  doraCacheKey,
  type MemberTaskRow,
  type DeployRow,
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
  });
});

describe('cache keys', () => {
  it('namespace member vs dora and fold tenant/version/window', () => {
    expect(memberMetricsCacheKey(7, 3, 14)).toBe('workforce-metrics:members:tenant:7:v:3:days:14');
    expect(doraCacheKey(7, 3, 30)).toBe('workforce-metrics:dora:tenant:7:v:3:days:30');
  });
});
