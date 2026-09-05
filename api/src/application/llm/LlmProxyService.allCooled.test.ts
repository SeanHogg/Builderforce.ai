import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmProxyService, type ProxyEnv } from './LlmProxyService';
import { _resetMemoryCooldowns, loadCooledVendors, recordFailure } from '../../infrastructure/auth/cooldownStore';

// ---------------------------------------------------------------------------
// ALL-COOLED LAST-CHANCE PROBE.
//
// The symptom this replaces, from a Creation Canvas diagnostic: a Brain turn
// ("Synthesize these customer interviews into product requirements") failed in
// 811ms with
//
//     All candidate models are on cooldown. Retry in a minute or two.
//
// — no upstream was contacted. A cooldown is a HINT written by an earlier request;
// it is never proof that THIS request would fail, and the escalating TTL can bench a
// vendor for up to an hour after a single strike. So when every candidate is cooled
// and the paid backstop is unavailable, the proxy composes the chain again with the
// cooldown gate off and actually dispatches it.
//
// The guarantee under test: a cooldown alone can never end a request with zero
// upstream attempts, and that synthetic message is never surfaced to a caller.
// ---------------------------------------------------------------------------

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const originalFetch = globalThis.fetch;
afterEach(() => { (globalThis as { fetch: typeof fetch }).fetch = originalFetch; });
beforeEach(() => { _resetMemoryCooldowns(); });

const env: ProxyEnv = { OPENROUTER_API_KEY: 'or-free' };

// A deliberately SMALL single-vendor pool: benching that one vendor is then the whole
// pool, which is the state the fix is about. (The full free pool cannot be benched in
// a test the same way — the cooldown prefetch only reads the leading slice of the
// seed, so models past it are never gated in the first place.)
const POOL = ['openai/gpt-oss-20b:free', 'google/gemma-4-26b-a4b-it:free'] as const;

/** `disablePaidOverflow` removes the premium fallback AND the funded backstop, which
 *  is what leaves the probe as the ONLY thing between a stale bench and a failed turn. */
const proxy = () => new LlmProxyService(env, { modelPool: POOL, disablePaidOverflow: true });

/** Bench the pool's vendor. A 401 is an `auth` failure, which trips vendor cooldown on
 *  the first strike — every model on that key is then unreachable, so the chain
 *  composer has nothing left to return. */
async function coolTheEntirePool(): Promise<void> {
  await recordFailure(env, 'openrouter', POOL[0], 401);
  // Guard the FIXTURE, not just the fix: were the bench not actually in place the
  // request would take the ordinary cascade and answer for the wrong reason, and these
  // tests would pass while proving nothing.
  expect((await loadCooledVendors(env, ['openrouter'])).has('openrouter')).toBe(true);
}

describe('every candidate cooled — last-chance probe', () => {
  it('dispatches anyway and serves the request instead of reporting a cooldown', async () => {
    await coolTheEntirePool();

    const models: string[] = [];
    const fetchSpy = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url !== OPENROUTER_ENDPOINT) throw new Error(`unmocked fetch: ${url}`);
      models.push(String((JSON.parse(String(init?.body ?? '{}')) as { model?: string }).model));
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'requirements' } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    const result = await proxy().complete({
      messages: [{ role: 'user', content: 'Synthesize these customer interviews into product requirements' }],
    });

    expect(result.response.status).toBe(200);
    expect(result.outcome).toBe('success');
    // The model that answered was itself benched — that is the whole point: the probe
    // overrides the bench rather than hunting for a model that escaped it.
    expect(POOL).toContain(models[0]);
  });

  it('surfaces the REAL upstream failure when the probe also fails', async () => {
    await coolTheEntirePool();

    const fetchSpy = vi.fn(async () => new Response(
      JSON.stringify({ error: { message: 'upstream is genuinely saturated' } }),
      { status: 429, headers: { 'content-type': 'application/json' } },
    ));
    (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    const result = await proxy().complete({ messages: [{ role: 'user', content: 'hi' }] });

    expect(fetchSpy).toHaveBeenCalled();
    expect(result.response.status).toBe(429);
    const body = await result.response.json() as { error?: { message?: string; details?: { failovers?: unknown[] } } };
    // The caller gets the upstream's own diagnostic and a real per-model failover
    // trace — never the synthetic "everything is cooled, wait a minute" message.
    expect(body.error?.message ?? '').not.toMatch(/on cooldown/i);
    expect(result.outcome).not.toBe('all_cooldown');
    expect((body.error?.details?.failovers ?? []).length).toBeGreaterThan(0);
  });
});
