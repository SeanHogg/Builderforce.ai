import { describe, expect, it } from 'vitest';
import { claimTab, heartbeat, type TabCoordinatorLease } from './tabCoordinator.js';

const TTL_MS = 1_000;

describe('tab coordinator', () => {
  it('grants the first tab when the holder is absent and does not mutate the lease', () => {
    const current = Object.freeze<TabCoordinatorLease>({ expiresAt: 0 });

    expect(claimTab(current, 'tab-a', 0)).toEqual({ holder: 'tab-a' });
    expect(current).toEqual({ expiresAt: 0 });
  });

  it('treats a blank holder as absent', () => {
    const current = Object.freeze<TabCoordinatorLease>({ holder: '', expiresAt: 9_000 });

    expect(claimTab(current, 'tab-a', 0)).toEqual({ holder: 'tab-a' });
    expect(current.holder).toBe('');
  });

  it('refuses a second tab while the first hold is live and leaves the holder unchanged', () => {
    const current = Object.freeze<TabCoordinatorLease>({ holder: 'tab-a', expiresAt: TTL_MS });

    expect(claimTab(current, 'tab-b', TTL_MS - 1)).toEqual({ holder: 'tab-a', refused: 'tab-b' });
    expect(current).toEqual({ holder: 'tab-a', expiresAt: TTL_MS });
  });

  it('lets another tab claim when expiresAt is in the past', () => {
    const current = Object.freeze<TabCoordinatorLease>({ holder: 'tab-a', expiresAt: 50 });

    expect(claimTab(current, 'tab-b', 51)).toEqual({ holder: 'tab-b' });
    expect(current.holder).toBe('tab-a');
  });

  it('lets another tab claim when expiresAt equals now', () => {
    const current = Object.freeze<TabCoordinatorLease>({ holder: 'tab-a', expiresAt: TTL_MS });

    expect(claimTab(current, 'tab-b', TTL_MS)).toEqual({ holder: 'tab-b' });
    expect(current).toEqual({ holder: 'tab-a', expiresAt: TTL_MS });
  });

  it('lets the holding tab claim again without refusing itself', () => {
    const current = Object.freeze<TabCoordinatorLease>({ holder: 'tab-a', expiresAt: TTL_MS });

    expect(claimTab(current, 'tab-a', 1)).toEqual({ holder: 'tab-a' });
    expect(current).toEqual({ holder: 'tab-a', expiresAt: TTL_MS });
  });

  it('does not let two tabs of one device both hold a live lease', () => {
    const empty = Object.freeze<TabCoordinatorLease>({ expiresAt: 0 });
    expect(claimTab(empty, 'tab-a', 0)).toEqual({ holder: 'tab-a' });

    const held = Object.freeze<TabCoordinatorLease>({ holder: 'tab-a', expiresAt: TTL_MS });
    expect(claimTab(held, 'tab-b', 10)).toEqual({ holder: 'tab-a', refused: 'tab-b' });
    expect(claimTab(held, 'tab-a', 10)).toEqual({ holder: 'tab-a' });
    expect(held.holder).toBe('tab-a');
  });

  it('extends expiresAt only for the holding tab and does not mutate the input', () => {
    const current = Object.freeze<TabCoordinatorLease>({ holder: 'tab-a', expiresAt: TTL_MS });

    expect(heartbeat(current, 'tab-b', 500, TTL_MS)).toBe(current);
    expect(heartbeat(current, 'tab-a', 500, TTL_MS)).toEqual({ holder: 'tab-a', expiresAt: 500 + TTL_MS });
    expect(current).toEqual({ holder: 'tab-a', expiresAt: TTL_MS });
  });

  it('does not heartbeat a lease whose holder is absent', () => {
    const current = Object.freeze<TabCoordinatorLease>({ expiresAt: 0 });

    expect(heartbeat(current, 'tab-a', 10, TTL_MS)).toBe(current);
  });

  it('still extends for the named holder after the previous expiry, without mutating', () => {
    const current = Object.freeze<TabCoordinatorLease>({ holder: 'tab-a', expiresAt: 50 });

    expect(heartbeat(current, 'tab-a', 51, TTL_MS)).toEqual({ holder: 'tab-a', expiresAt: 51 + TTL_MS });
    expect(heartbeat(current, 'tab-b', 51, TTL_MS)).toBe(current);
    expect(current.expiresAt).toBe(50);
  });
});
