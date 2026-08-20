import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { AllocationHealthRow } from '../metrics/allocationHealth';
import type { MemberScorecard } from '../metrics/workforceMetrics';

/**
 * The three cohorts, and the one they used to leave out.
 *
 * Over-allocation was already computed and already drawn. Under-utilisation was
 * sitting in the same result as `utilizationPct` and had no name. IDLE was in
 * neither: allocation health is derived from members who HOLD open work, so a
 * member carrying nothing simply does not appear in it, and their absence read as
 * health when it means the opposite. That asymmetry is the bug — you notice the
 * person with twelve open tickets; you do not notice the person with none — so it
 * is the thing these tests pin.
 */

const computeAllocationHealth = vi.hoisted(() => vi.fn());
const computeMemberMetrics = vi.hoisted(() => vi.fn());

vi.mock('../metrics/allocationHealth', () => ({ computeAllocationHealth }));
vi.mock('../metrics/workforceMetrics', () => ({ computeMemberMetrics }));

const { computeWorkforceHealth, UNDER_UTILISED_PCT } = await import('./workforceHealth');

const db = {} as Db;

function allocRow(name: string, observedWip: number, maxWip = 5): AllocationHealthRow {
  return {
    memberKind: 'human',
    memberRef: name,
    name,
    maxWip,
    hasExplicitMax: true,
    observedWip,
    overAllocated: observedWip > maxWip,
    utilizationPct: Math.round((observedWip / maxWip) * 100),
  };
}

function card(name: string, assignedCount = 3): MemberScorecard {
  return {
    memberKind: 'human', memberRef: name, memberName: name, discipline: null,
    assignedCount, completedCount: 0, redoCount: 0, reopenCount: 0,
    avgCycleTimeHours: null, avgPickupLatencyHours: null, avgIdleAfterDoneHours: null,
    boardHygieneScore: null, engagementScore: null, effectivenessScore: 100,
  };
}

function wire(members: AllocationHealthRow[], cards: MemberScorecard[]) {
  computeAllocationHealth.mockResolvedValue({
    members,
    overAllocatedCount: members.filter((m) => m.overAllocated).length,
    totalMembers: members.length,
  });
  computeMemberMetrics.mockResolvedValue(cards);
}

beforeEach(() => {
  computeAllocationHealth.mockReset();
  computeMemberMetrics.mockReset();
});

describe('computeWorkforceHealth', () => {
  it('splits members into the three cohorts', async () => {
    wire(
      [allocRow('drowning', 9), allocRow('steady', 4), allocRow('slack', 1)],
      [card('drowning'), card('steady'), card('slack'), card('nothing-assigned', 6)],
    );

    const out = await computeWorkforceHealth(db, 1, 30);

    expect(out.overAllocated.map((m) => m.name)).toEqual(['drowning']);
    expect(out.underUtilised.map((m) => m.name)).toEqual(['slack']); // 20% ≤ 40%
    expect(out.idle.map((m) => m.name)).toEqual(['nothing-assigned']);
  });

  it('finds the idle member allocation health cannot see', async () => {
    // The whole reason this composes two services: a member holding no open work
    // is ABSENT from allocation health, so on its own it reports a perfectly
    // healthy tenant while somebody has nothing to do.
    wire([allocRow('busy', 4)], [card('busy'), card('benched', 1)]);

    const out = await computeWorkforceHealth(db, 1, 30);
    expect(out.overAllocated).toEqual([]);
    expect(out.underUtilised).toEqual([]);
    expect(out.idle.map((m) => m.name)).toEqual(['benched']);
    expect(out.idle[0]).toMatchObject({ observedWip: 0, utilizationPct: 0, activeInWindow: 1 });
  });

  it('keeps the cohorts disjoint — an over-allocated member is never also under-utilised', async () => {
    wire([allocRow('drowning', 9), allocRow('slack', 1)], [card('drowning'), card('slack')]);
    const out = await computeWorkforceHealth(db, 1, 30);
    const names = [...out.overAllocated, ...out.underUtilised, ...out.idle].map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('treats the threshold as inclusive and nothing above it as slack', async () => {
    // maxWip 10 → 4 open tasks is exactly 40%, 5 is 50%.
    wire([allocRow('at-threshold', 4, 10), allocRow('above', 5, 10)], []);
    const out = await computeWorkforceHealth(db, 1, 30);
    expect(UNDER_UTILISED_PCT).toBe(40);
    expect(out.underUtilised.map((m) => m.name)).toEqual(['at-threshold']);
  });

  it('does not call someone idle who was never active in the window', async () => {
    // Restricted to members the window saw, or every departed and never-onboarded
    // account in the tenant would be reported as sitting idle.
    wire([allocRow('busy', 4)], [card('busy')]);
    const out = await computeWorkforceHealth(db, 1, 30);
    expect(out.idle).toEqual([]);
  });

  it('counts the population once even though it comes from two sources', async () => {
    wire([allocRow('busy', 4), allocRow('slack', 1)], [card('busy'), card('benched')]);
    const out = await computeWorkforceHealth(db, 1, 30);
    expect(out.membersWithWork).toBe(2);
    expect(out.totalMembers).toBe(3); // busy, slack, benched — busy counted once
  });

  it('sorts each cohort so the most extreme case is first', async () => {
    wire(
      [allocRow('worst', 12), allocRow('bad', 7), allocRow('slackest', 0, 5), allocRow('slack', 2, 10)],
      [card('worst'), card('bad'), card('slackest'), card('slack'), card('idle-b', 1), card('idle-a', 9)],
    );
    const out = await computeWorkforceHealth(db, 1, 30);
    expect(out.overAllocated.map((m) => m.name)).toEqual(['worst', 'bad']);
    expect(out.underUtilised.map((m) => m.name)).toEqual(['slackest', 'slack']);
    expect(out.idle.map((m) => m.name)).toEqual(['idle-a', 'idle-b']);
  });

  it('shares ONE underlying read between concurrent callers', async () => {
    // Three registry metrics pluck off this result and the composed answer
    // resolves all three at once. Without the in-flight memo that is three
    // board-wide scans for one question.
    wire([allocRow('busy', 4)], [card('busy')]);
    await Promise.all([
      computeWorkforceHealth(db, 1, 30),
      computeWorkforceHealth(db, 1, 30),
      computeWorkforceHealth(db, 1, 30),
    ]);
    expect(computeAllocationHealth).toHaveBeenCalledTimes(1);
    expect(computeMemberMetrics).toHaveBeenCalledTimes(1);
  });

  it('is not a cache: a later caller reads again', async () => {
    wire([allocRow('busy', 4)], [card('busy')]);
    await computeWorkforceHealth(db, 1, 30);
    await computeWorkforceHealth(db, 1, 30);
    expect(computeAllocationHealth).toHaveBeenCalledTimes(2);
  });

  it('does not poison the memo when a read fails', async () => {
    computeAllocationHealth.mockRejectedValueOnce(new Error('db down'));
    computeMemberMetrics.mockResolvedValue([]);
    await expect(computeWorkforceHealth(db, 1, 30)).rejects.toThrow('db down');

    wire([allocRow('busy', 4)], [card('busy')]);
    await expect(computeWorkforceHealth(db, 1, 30)).resolves.toMatchObject({ membersWithWork: 1 });
  });
});
