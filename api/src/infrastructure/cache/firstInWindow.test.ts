import { describe, expect, it, vi } from 'vitest';

const calls: Array<{ key: string; opts: unknown }> = [];
const held = new Set<string>();
vi.mock('./readThroughCache', () => ({
  getOrSetCached: async (_env: unknown, key: string, loader: () => Promise<unknown>, opts: unknown) => {
    calls.push({ key, opts });
    if (held.has(key)) return 1;
    held.add(key);
    return loader();
  },
}));

import { firstInWindow } from './firstInWindow';

describe('firstInWindow', () => {
  it('is true once per key, then false while the marker is held', async () => {
    expect(await firstInWindow(undefined, 'k1', 60)).toBe(true);
    expect(await firstInWindow(undefined, 'k1', 60)).toBe(false);
    expect(await firstInWindow(undefined, 'k2', 60)).toBe(true);
  });

  it('holds the marker in both cache layers for exactly the window', async () => {
    await firstInWindow(undefined, 'k3', 600);
    expect(calls.at(-1)).toEqual({ key: 'k3', opts: { kvTtlSeconds: 600, l1TtlMs: 600_000 } });
  });
});
