import { describe, expect, it, vi } from 'vitest';
import { loadPlatformProof } from './platformProof';
import type { Db } from '../../infrastructure/database/connection';

/** A chain stub: each `select()` claims the next queued count, in call order. */
function stubDb(counts: number[]): Db {
  const queue = [...counts];
  const select = vi.fn(() => {
    const rows = Promise.resolve([{ n: queue.shift() ?? 0 }]);
    return { from: () => ({ where: () => rows }) };
  });
  return { select } as unknown as Db;
}

describe('loadPlatformProof', () => {
  it('returns the real counts, uninflated, with an as-of time', async () => {
    const proof = await loadPlatformProof(stubDb([1500, 37, 820, 9100]), undefined);
    expect(proof).toMatchObject({ builders: 1500, buildersThisWeek: 37, projects: 820, agentRunsCompleted: 9100 });
    expect(Number.isNaN(Date.parse(proof.asOf))).toBe(false);
  });
});
