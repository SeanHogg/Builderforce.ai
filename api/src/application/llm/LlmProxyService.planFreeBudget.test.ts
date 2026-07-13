import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FREE_ATTEMPT_BUDGET,
  FREE_MODEL_POOL,
  PRO_FREE_ATTEMPT_BUDGET,
  freeAttemptBudgetForPlan,
  llmProxyForPlan,
  type ProxyEnv,
} from './LlmProxyService';
import { _resetMemoryCooldowns } from '../../infrastructure/auth/cooldownStore';

// ---------------------------------------------------------------------------
// Plan-aware free-tier breadth: the general (non-coding) FREE-attempt cap is no
// longer a single constant for every plan. Free → 2 (latency-tuned, reaches the
// paid backstop fast); Pro/Teams → wider free-tier breadth before escalating to
// their paid pool. Closes the "Pro plan's free-tier section is also capped at 2,
// no Pro-specific carve-out" gap.
// ---------------------------------------------------------------------------

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/** Every OpenRouter call 429s so the cascade walks its full free budget. */
function install429Fetch(): void {
  const fn = vi.fn(async (input: string | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url !== OPENROUTER_ENDPOINT) throw new Error(`unmocked fetch: ${url}`);
    return new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
  });
  (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  _resetMemoryCooldowns();
});

const env: ProxyEnv = { OPENROUTER_API_KEY: 'or-free' };
const freeCodersIn = (chain: readonly string[] | undefined): string[] =>
  (chain ?? []).filter((m) => FREE_MODEL_POOL.includes(m));

describe('freeAttemptBudgetForPlan', () => {
  it('free → FREE_ATTEMPT_BUDGET (2)', () => {
    expect(freeAttemptBudgetForPlan('free')).toBe(FREE_ATTEMPT_BUDGET);
  });
  it('pro / teams → the wider PRO_FREE_ATTEMPT_BUDGET', () => {
    expect(freeAttemptBudgetForPlan('pro')).toBe(PRO_FREE_ATTEMPT_BUDGET);
    expect(freeAttemptBudgetForPlan('teams')).toBe(PRO_FREE_ATTEMPT_BUDGET);
    expect(PRO_FREE_ATTEMPT_BUDGET).toBeGreaterThan(FREE_ATTEMPT_BUDGET);
  });
});

describe('plan-aware free-tier breadth in the general cascade', () => {
  it('a FREE-plan general run caps free attempts at 2', async () => {
    install429Fetch();
    const proxy = llmProxyForPlan(env, 'free');
    const result = await proxy.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(freeCodersIn(result.candidateChain).length).toBeLessThanOrEqual(FREE_ATTEMPT_BUDGET);
  });

  it('a PRO-plan general run tries MORE free models than the Free cap of 2', async () => {
    install429Fetch();
    const proxy = llmProxyForPlan(env, 'pro');
    const result = await proxy.complete({ messages: [{ role: 'user', content: 'hi' }] });
    // Pro gets the wider free budget; with the free pool large enough the chain
    // includes more than the Free-plan cap of 2 free attempts.
    expect(freeCodersIn(result.candidateChain).length).toBeGreaterThan(FREE_ATTEMPT_BUDGET);
  });
});
