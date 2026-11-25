import { describe, expect, it, vi } from 'vitest';
import { RECENT_BOARD_SEED_LIMIT, seedRecentBoards } from './seedRecentBoards';

const boards = (count: number) => Array.from({ length: count }, (_, n) => ({ id: `board-${n}` }));

describe('seedRecentBoards', () => {
  it('skips boards the device already holds', async () => {
    const seed = vi.fn(async (_id: string) => undefined);
    const result = await seedRecentBoards({
      list: async () => boards(3), heldIds: async () => new Set(['board-1']), seed, report: vi.fn(),
    });
    expect(seed.mock.calls.map(([id]) => id)).toEqual(['board-0', 'board-2']);
    expect(result).toEqual({ seeded: 2, failed: 0 });
  });

  it('reads at most the approved limit', async () => {
    const seed = vi.fn(async () => undefined);
    await seedRecentBoards({ list: async () => boards(50), heldIds: async () => new Set(), seed, report: vi.fn() });
    expect(seed).toHaveBeenCalledTimes(RECENT_BOARD_SEED_LIMIT);
    expect(RECENT_BOARD_SEED_LIMIT).toBe(20);
  });

  it('counts and reports a failure without aborting the others', async () => {
    const report = vi.fn();
    const boom = new Error('offline');
    const seed = vi.fn(async (id: string) => { if (id === 'board-1') throw boom; });
    const result = await seedRecentBoards({ list: async () => boards(3), heldIds: async () => new Set(), seed, report });
    expect(seed).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ seeded: 2, failed: 1 });
    expect(report).toHaveBeenCalledWith('seedRecentBoards:board-1', boom);
  });

  it('seeds nothing when every recent board is held', async () => {
    const seed = vi.fn();
    expect(await seedRecentBoards({ list: async () => boards(2), heldIds: async () => new Set(['board-0', 'board-1']), seed, report: vi.fn() }))
      .toEqual({ seeded: 0, failed: 0 });
    expect(seed).not.toHaveBeenCalled();
  });
});
