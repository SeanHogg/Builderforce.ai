import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
vi.mock('../../infrastructure/cache/readThroughCache', () => ({
  peekCached: async (_env: unknown, key: string) => store.get(key) ?? null,
  setCached: async (_env: unknown, key: string, value: unknown) => { store.set(key, value); },
}));

import {
  conductTicketCursorKey, loadRotationCursor, saveRotationCursor, takeRotatingWindow, type RotationFetch,
} from './conductRotation';

/** An id-ordered set of `n` review tickets behind the same fetch contract the SQL loaders use. */
function ticketSet(n: number): RotationFetch<{ id: number }> {
  const all = Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
  return async (range, limit) => (
    'after' in range ? all.filter((t) => t.id > range.after) : all.filter((t) => t.id <= range.upTo)
  ).slice(0, limit);
}

beforeEach(() => store.clear());

describe('takeRotatingWindow', () => {
  it('starts at the beginning with no cursor and stops at the cap', async () => {
    const w = await takeRotatingWindow({ cursor: 0, limit: 20, fetch: ticketSet(45) });
    expect(w.map((t) => t.id)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('resumes AFTER the cursor and wraps to the start when the tail is short', async () => {
    const w = await takeRotatingWindow({ cursor: 40, limit: 20, fetch: ticketSet(45) });
    expect(w.map((t) => t.id)).toEqual([41, 42, 43, 44, 45, ...Array.from({ length: 15 }, (_, i) => i + 1)]);
  });
});

describe('ticket 21+ is conducted on the next tick (no-op outcomes never touch updated_at)', () => {
  it('every one of 45 tickets is examined within three ticks, whatever the outcomes', async () => {
    const env = {} as never;
    const key = conductTicketCursorKey(1, 9);
    const fetch = ticketSet(45);
    const conducted: number[][] = [];
    for (let tick = 0; tick < 3; tick += 1) {
      const window = await takeRotatingWindow({ cursor: await loadRotationCursor(env, key), limit: 20, fetch });
      conducted.push(window.map((t) => t.id));
      // Every outcome is a no-op (wait_for_run / await_merge): nothing is "touched".
      await saveRotationCursor(env, key, window[window.length - 1]!.id);
    }
    expect(conducted[0]).toContain(1);
    expect(conducted[0]).not.toContain(21);
    expect(conducted[1]![0]).toBe(21);
    expect(conducted[1]).toContain(40);
    expect(new Set(conducted.flat())).toEqual(new Set(Array.from({ length: 45 }, (_, i) => i + 1)));
  });

  it('a budget-truncated tick resumes after the last ticket it actually examined', async () => {
    const env = {} as never;
    const key = conductTicketCursorKey(1, 9);
    await saveRotationCursor(env, key, 7); // tick shed after ticket 7
    const w = await takeRotatingWindow({ cursor: await loadRotationCursor(env, key), limit: 20, fetch: ticketSet(45) });
    expect(w[0]!.id).toBe(8);
  });
});

describe('the cursor store', () => {
  it('reads 0 when nothing (or something unusable) is stored', async () => {
    expect(await loadRotationCursor({} as never, 'k')).toBe(0);
    store.set('k', 'garbage');
    expect(await loadRotationCursor({} as never, 'k')).toBe(0);
  });
});
