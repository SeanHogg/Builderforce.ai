/**
 * The shared anonymous allowance.
 *
 * Extracted from `guestResearch` when guest EXPORTS needed the identical
 * mechanic. Two properties are load-bearing and neither is obvious at a call
 * site:
 *   1. Scopes are INDEPENDENT — a visitor who has spent their research lookups
 *      must still be able to download the document they already made. One shared
 *      counter would have made every new guest capability quietly ration the
 *      others.
 *   2. A KV outage degrades to "not counted", never to a refused request. These
 *      are abuse backstops, not billing.
 */
import { describe, expect, it } from 'vitest';
import type { Env } from '../../env';
import { consumeGuestAllowance } from './guestDailyCounter';

const LIMITS = { visitorDailyLimit: 3, ipDailyLimit: 5 };

/** An in-memory stand-in for AUTH_CACHE_KV — the counters are plain strings. */
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

describe('consumeGuestAllowance', () => {
  it('charges each call and counts the visitor axis down', async () => {
    const env = kvEnv();
    const first = await consumeGuestAllowance(env, 'scope', 'visitor-a', '203.0.113.1', LIMITS);
    const second = await consumeGuestAllowance(env, 'scope', 'visitor-a', '203.0.113.1', LIMITS);
    expect(first).toMatchObject({ allowed: true, limit: 3, remaining: 2 });
    expect(second.remaining).toBe(1);
  });

  it('refuses once the visitor axis is spent', async () => {
    const env = kvEnv();
    for (let call = 0; call < LIMITS.visitorDailyLimit; call += 1) {
      await consumeGuestAllowance(env, 'scope', 'visitor-a', null, LIMITS);
    }
    expect(await consumeGuestAllowance(env, 'scope', 'visitor-a', null, LIMITS))
      .toMatchObject({ allowed: false, reason: 'visitor', remaining: 0 });
  });

  it('refuses on the IP backstop even when the visitor id keeps changing', async () => {
    const env = kvEnv();
    for (let call = 0; call < LIMITS.ipDailyLimit; call += 1) {
      await consumeGuestAllowance(env, 'scope', `visitor-${call}`, '203.0.113.9', LIMITS);
    }
    expect(await consumeGuestAllowance(env, 'scope', 'visitor-fresh', '203.0.113.9', LIMITS))
      .toMatchObject({ allowed: false, reason: 'ip' });
  });

  it('keeps scopes independent, so one capability cannot ration another', async () => {
    const env = kvEnv();
    for (let call = 0; call < LIMITS.visitorDailyLimit; call += 1) {
      await consumeGuestAllowance(env, 'guestresearch', 'visitor-a', null, LIMITS);
    }
    expect(await consumeGuestAllowance(env, 'guestresearch', 'visitor-a', null, LIMITS)).toMatchObject({ allowed: false });
    expect(await consumeGuestAllowance(env, 'guestexport', 'visitor-a', null, LIMITS)).toMatchObject({ allowed: true });
  });

  it('allows the call when KV is unbound rather than refusing it', async () => {
    const env = {} as unknown as Env;
    expect(await consumeGuestAllowance(env, 'scope', 'visitor-a', '203.0.113.1', LIMITS)).toMatchObject({ allowed: true });
  });
});
