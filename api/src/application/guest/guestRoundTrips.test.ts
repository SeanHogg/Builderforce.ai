import { describe, expect, it } from 'vitest';
import type { Env } from '../../env';
import { GUEST_CHAT_LIMITS } from '../../domain/tenant/PlanLimits';
import { consumeGuestRoundTrip } from './guestRoundTrips';
import { consumeGuestAllowance } from './guestDailyCounter';

function kvEnv(): Env {
  const store = new Map<string, string>();
  return {
    AUTH_CACHE_KV: {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => { store.set(k, v); },
      delete: async (k: string) => { store.delete(k); },
    },
  } as unknown as Env;
}

describe('consumeGuestRoundTrip', () => {
  it('charges EVERY round-trip (continuations included) and refuses past the daily ceiling', async () => {
    const env = kvEnv();
    for (let i = 0; i < GUEST_CHAT_LIMITS.roundTripsDailyLimit; i++) {
      expect((await consumeGuestRoundTrip(env, 'visitor-a', null)).allowed).toBe(true);
    }
    expect(await consumeGuestRoundTrip(env, 'visitor-a', null)).toMatchObject({ allowed: false, reason: 'visitor', remaining: 0 });
    // Another visitor has their own ceiling.
    expect((await consumeGuestRoundTrip(env, 'visitor-b', null)).allowed).toBe(true);
  });

  it('enforces the per-IP backstop across rotated visitor ids', async () => {
    const env = kvEnv();
    const ip = '203.0.113.9';
    for (let i = 0; i < GUEST_CHAT_LIMITS.ipRoundTripsDailyLimit; i++) {
      await consumeGuestRoundTrip(env, `visitor-${i}`, ip);
    }
    expect(await consumeGuestRoundTrip(env, 'visitor-fresh', ip)).toMatchObject({ allowed: false, reason: 'ip' });
  });

  it('meters on its own scope — it never spends another guest allowance', async () => {
    const env = kvEnv();
    await consumeGuestRoundTrip(env, 'visitor-a', null);
    const other = await consumeGuestAllowance(env, 'guest-research', 'visitor-a', null, { visitorDailyLimit: 3, ipDailyLimit: 5 });
    expect(other.remaining).toBe(2);
  });
});
