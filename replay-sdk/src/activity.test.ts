import { describe, expect, it } from 'vitest';
import { touchActivity, type ActivityState } from './activity';

describe('touchActivity', () => {
  it('adds gaps up to 30 s and skips longer idle gaps', () => {
    const state: ActivityState = { activeMs: 0, lastActiveAt: null };
    touchActivity(state, 1_000);
    touchActivity(state, 6_000);
    touchActivity(state, 36_000);
    touchActivity(state, 100_000);
    touchActivity(state, 101_000);
    expect(state.activeMs).toBe(5_000 + 30_000 + 1_000);
    expect(state.lastActiveAt).toBe(101_000);
  });
});
