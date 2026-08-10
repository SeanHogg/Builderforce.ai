import { describe, expect, it } from 'vitest';
import { selectTriageBatch } from './triageStage';
import type { OpenStall } from './stallWatch';

const candidate = (id: number, idleMs = id * 1_000) => ({ task: { id }, idleMs });
const open = (
  taskId: number,
  attempts = 0,
  lastAttemptAt: Date | null = null,
  escalatedAt: Date | null = null,
): OpenStall => ({
  id: `stall-${taskId}`,
  taskId,
  cause: 'failure_breaker',
  remedy: 'reset_breaker',
  observedStatus: 'ready',
  attempts,
  lastSeenAt: new Date('2026-07-27T00:00:00Z'),
  lastAttemptAt,
  escalatedAt,
});

describe('selectTriageBatch', () => {
  it('finishes accountable open remedies before growing the register', () => {
    const rows = [candidate(1), candidate(2), candidate(3)];
    const stalls = new Map([[2, open(2)]]);
    expect(selectTriageBatch(rows, stalls, 2).map((r) => r.task.id)).toEqual([2, 3]);
  });

  it('rotates the dispatch ceiling toward remedies with fewer attempts', () => {
    const rows = [candidate(1), candidate(2), candidate(3)];
    const stalls = new Map([
      [1, open(1, 1, new Date('2026-07-27T01:00:00Z'))],
      [2, open(2, 0)],
      [3, open(3, 1, new Date('2026-07-27T00:00:00Z'))],
    ]);
    expect(selectTriageBatch(rows, stalls, 3).map((r) => r.task.id)).toEqual([2, 3, 1]);
  });

  it('rotates zero-attempt remedies after a refused action instead of starving the register', () => {
    const rows = [candidate(1, 10), candidate(2, 10), candidate(3, 10)];
    const recentlyObserved = {
      ...open(1),
      lastSeenAt: new Date('2026-07-27T02:00:00Z'),
    };
    const leastRecentlyObserved = {
      ...open(2),
      lastSeenAt: new Date('2026-07-27T00:00:00Z'),
    };
    const stalls = new Map<number, OpenStall>([
      [1, recentlyObserved],
      [2, leastRecentlyObserved],
      [3, { ...open(3), lastSeenAt: new Date('2026-07-27T01:00:00Z') }],
    ]);

    expect(selectTriageBatch(rows, stalls, 2).map((r) => r.task.id)).toEqual([2, 3]);
  });

  it('places escalated observation-only rows behind new discoveries', () => {
    const rows = [candidate(1), candidate(2), candidate(3)];
    const stalls = new Map([
      [1, open(1, 3, new Date('2026-07-27T01:00:00Z'), new Date('2026-07-27T01:05:00Z'))],
      [2, open(2)],
    ]);
    expect(selectTriageBatch(rows, stalls, 3).map((r) => r.task.id)).toEqual([2, 3, 1]);
  });

  it('keeps longest-idle ordering within an equal priority class', () => {
    const rows = [candidate(1, 10), candidate(2, 30), candidate(3, 20)];
    expect(selectTriageBatch(rows, new Map(), 2).map((r) => r.task.id)).toEqual([2, 3]);
  });

  /**
   * Escalation happens INSIDE the batch loop, so a row at the ceiling that is never
   * selected can never be handed to a human. Ranking by fewest-attempts put those rows
   * dead last, which meant the tickets most in need of a person were the least likely to
   * reach one: measured on project 11, three rows sat at attempts=3 with escalated=0.
   */
  it('promotes rows at the remedy ceiling so they can actually escalate', () => {
    const rows = [candidate(1), candidate(2), candidate(3)];
    const stalls = new Map<number, OpenStall>([
      [1, open(1, 0)],
      [2, open(2, 3)], // at MAX_REMEDY_ATTEMPTS, not yet escalated
      [3, open(3, 1)],
    ]);
    expect(selectTriageBatch(rows, stalls, 1).map((r) => r.task.id)).toEqual([2]);
  });

  /**
   * Coverage used to freeze. Open rows outranked new discoveries unconditionally, so once
   * the register held more rows than the batch, the same rows recirculated forever and no
   * new ticket was ever diagnosed — project 11 sat at "confirmed by deep triage: 50 of
   * 678" pass after pass while 628 tickets were never looked at once.
   */
  it('reserves part of every batch for tickets never diagnosed before', () => {
    const registered = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((id) => candidate(id, 100_000));
    const brandNew = [90, 91].map((id) => candidate(id, 10));
    const stalls = new Map<number, OpenStall>(registered.map((r) => [r.task.id, open(r.task.id)]));

    const picked = selectTriageBatch([...registered, ...brandNew], stalls, 6).map((r) => r.task.id);
    // A third of the batch goes to discovery even though every registered row is
    // ten thousand times more idle.
    expect(picked).toHaveLength(6);
    expect(picked.filter((id) => id >= 90)).toEqual([90, 91]);
  });

  it('gives the whole batch to the register when there is nothing new to discover', () => {
    const registered = [1, 2, 3].map((id) => candidate(id));
    const stalls = new Map<number, OpenStall>(registered.map((r) => [r.task.id, open(r.task.id)]));
    // The reserve is an upper bound, never a quota left unspent.
    expect(selectTriageBatch(registered, stalls, 3)).toHaveLength(3);
  });
});
