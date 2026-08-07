/**
 * The guest research allowance and its backing.
 *
 * Two properties are load-bearing and neither is obvious from the call site:
 *   1. A guest NEVER reaches a tenant's BYO search key — the backing comes from the
 *      platform resolver, which knows nothing about `integration_credentials`.
 *   2. The allowance is charged BEFORE the outbound request, on two axes, and a
 *      refusal is a refusal (this surface is an outbound proxy exposed to the public
 *      internet, so an off-by-one here is an abuse hole, not a UX bug).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import { GUEST_RESEARCH_LIMITS } from '../../domain/tenant/PlanLimits';
import { consumeGuestResearchCall, guestWebSearch } from './guestResearch';
import { wikipediaSearchVendor } from '../runtime/webSearchVendors';

/** An in-memory stand-in for AUTH_CACHE_KV — the counters are plain string values. */
function kvEnv(extra: Record<string, unknown> = {}): Env {
  const store = new Map<string, string>();
  return {
    JWT_SECRET: 'test',
    AUTH_CACHE_KV: {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => { store.set(k, v); },
      delete: async (k: string) => { store.delete(k); },
    },
    ...extra,
  } as unknown as Env;
}

beforeEach(() => { vi.unstubAllGlobals(); });

describe('consumeGuestResearchCall', () => {
  it('charges each call and reports the remaining visitor allowance', async () => {
    const env = kvEnv();
    const first = await consumeGuestResearchCall(env, 'visitor-a', '203.0.113.1');
    const second = await consumeGuestResearchCall(env, 'visitor-a', '203.0.113.1');

    expect(first).toMatchObject({ allowed: true, limit: GUEST_RESEARCH_LIMITS.callsDailyLimit });
    expect(first.remaining).toBe(GUEST_RESEARCH_LIMITS.callsDailyLimit - 1);
    expect(second.remaining).toBe(GUEST_RESEARCH_LIMITS.callsDailyLimit - 2);
  });

  it('refuses once the visitor axis is spent', async () => {
    const env = kvEnv();
    for (let i = 0; i < GUEST_RESEARCH_LIMITS.callsDailyLimit; i += 1) {
      expect((await consumeGuestResearchCall(env, 'visitor-b', null)).allowed).toBe(true);
    }
    expect(await consumeGuestResearchCall(env, 'visitor-b', null))
      .toMatchObject({ allowed: false, reason: 'visitor', remaining: 0 });
  });

  it('refuses on the IP backstop even when the visitor id keeps rotating', async () => {
    const env = kvEnv();
    const ip = '198.51.100.7';
    for (let i = 0; i < GUEST_RESEARCH_LIMITS.ipCallsDailyLimit; i += 1) {
      await consumeGuestResearchCall(env, `rotating-${i}`, ip);
    }
    expect(await consumeGuestResearchCall(env, 'rotating-next', ip))
      .toMatchObject({ allowed: false, reason: 'ip' });
  });

  it('allows the call when no KV is bound — a cache outage must not remove research', async () => {
    const env = { JWT_SECRET: 'test' } as unknown as Env;
    expect((await consumeGuestResearchCall(env, 'visitor-c', null)).allowed).toBe(true);
  });
});

describe('guestWebSearch backing', () => {
  it('uses the KEYLESS vendor when the deployment funds no operator key', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(
      JSON.stringify({ query: { search: [{ title: 'Michigan' }] } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const r = await guestWebSearch(kvEnv(), 'michigan school districts');

    expect(r).toMatchObject({ ok: true, coverage: 'encyclopedic' });
    expect(String(fetchMock.mock.calls[0]![0])).toContain(new URL(wikipediaSearchVendor.endpoint).host);
  });

  it('uses the operator key when one is funded, without any tenant lookup', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(
      JSON.stringify({ web: { results: [{ title: 'T', url: 'https://example.com/x' }] } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const r = await guestWebSearch(kvEnv({ BRAVE_SEARCH_API_KEY: 'op-key' }), 'ev makers by volume');

    expect(r).toMatchObject({ ok: true, coverage: 'web' });
    const init = fetchMock.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)['X-Subscription-Token']).toBe('op-key');
  });
});
