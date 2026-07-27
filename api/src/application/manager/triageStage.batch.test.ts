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
});
