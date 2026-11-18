/**
 * A connected vendor seeds several models (both flagships, or the tenant's selection). Once
 * its ACCOUNT refuses within a turn — 401/402, a 429 on a subscription's shared quota, or a
 * timeout/5xx streak — the rest
 * of that vendor's models are skipped for the turn instead of each failing in turn. A 403
 * is model-level (a plan-gated model): the account's other models are still tried.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_FAULT_STREAK, createAccountFailureTracker, isAccountRefusalStatus } from './accountFailure';
import { CascadeExhaustedError, dispatchVendor } from './registry';
import { subscriptionVendorIdsFromCredentials } from '../tenantProviderKeyService';

const originalFetch = globalThis.fetch;
afterEach(() => { (globalThis as { fetch: typeof fetch }).fetch = originalFetch; });

const MESSAGES = [{ role: 'user', content: 'hello' }];
const M3 = 'direct/minimax/MiniMax-M3';
const M27 = 'direct/minimax/MiniMax-M2.7';
const M27_FAST = 'direct/minimax/MiniMax-M2.7-highspeed';
const GEMINI = 'googleai/gemini-2.5-flash';
const ENV = { MINIMAX_API_KEY: 'mm', GOOGLE_API_KEY: 'g' };

/** MiniMax answers with `minimaxStatuses` in turn (the last repeats; 200 serves); everything else serves. */
function fetchWith(minimaxStatuses: number[]): ReturnType<typeof vi.fn> {
  let i = 0;
  const fn = vi.fn(async (url: unknown) => {
    const status = String(url).includes('minimax') ? minimaxStatuses[Math.min(i++, minimaxStatuses.length - 1)]! : 200;
    if (status !== 200) {
      return new Response(JSON.stringify({ error: { message: `upstream ${status}` } }), { status });
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'served' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
  (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

const minimaxCalls = (fn: ReturnType<typeof vi.fn>): number =>
  fn.mock.calls.filter(([url]) => String(url).includes('minimax')).length;

const accountScoped = (vendor: string): boolean => vendor === 'minimax';

describe('account-level failure tracker', () => {
  it('401 and 402 refuse the account at once', () => {
    for (const status of [401, 402]) {
      expect(isAccountRefusalStatus(status)).toBe(true);
      const t = createAccountFailureTracker();
      expect(t.record({ vendor: 'anthropic', status })).toBe(true);
      expect(t.failed('anthropic')).toBe(true);
      expect(t.failed('xai')).toBe(false);
    }
  });

  it('429 refuses the account only when its quota is shared (a subscription)', () => {
    expect(isAccountRefusalStatus(429)).toBe(false);
    expect(isAccountRefusalStatus(429, true)).toBe(true);
    // An API key: Opus rate-limited says nothing about Sonnet on the same key.
    const key = createAccountFailureTracker();
    expect(key.record({ vendor: 'anthropic', status: 429 })).toBe(false);
    expect(key.failed('anthropic')).toBe(false);
    // A subscription: every model draws on the one quota.
    const sub = createAccountFailureTracker((vendor) => vendor === 'openai-codex');
    expect(sub.record({ vendor: 'openai-codex', status: 429 })).toBe(true);
    expect(sub.record({ vendor: 'anthropic', status: 429 })).toBe(false);
  });

  it('403 refuses only the model (a plan-gated model), never the account', () => {
    expect(isAccountRefusalStatus(403)).toBe(false);
    const t = createAccountFailureTracker();
    expect(t.record({ vendor: 'kimi-code', status: 403, kind: 'client_error' })).toBe(false);
    expect(t.record({ vendor: 'kimi-code', status: 403, kind: 'client_error' })).toBe(false);
    expect(t.failed('kimi-code')).toBe(false);
  });

  it('one timeout or 5xx is a model fault; a streak of them is the account', () => {
    expect(ACCOUNT_FAULT_STREAK).toBe(2);
    const t = createAccountFailureTracker();
    expect(t.record({ vendor: 'kimi-code', status: 408, kind: 'timeout' })).toBe(false);
    expect(t.failed('kimi-code')).toBe(false);
    expect(t.record({ vendor: 'kimi-code', status: 503, kind: 'server_error' })).toBe(true);
    expect(t.failed('kimi-code')).toBe(true);
  });

  it('a request error between faults breaks the streak; a 400/404 never fails the account', () => {
    const t = createAccountFailureTracker();
    t.record({ vendor: 'qwen', status: 503, kind: 'server_error' });
    t.record({ vendor: 'qwen', status: 400, kind: 'client_error' });
    t.record({ vendor: 'qwen', status: 404, kind: 'client_error' });
    expect(t.record({ vendor: 'qwen', status: 503, kind: 'server_error' })).toBe(false);
    expect(t.failed('qwen')).toBe(false);
  });
});

describe('dispatch skips a failed account’s remaining models', () => {
  it('401 on the first MiniMax seed: the second is never called, the next vendor serves', async () => {
    const fn = fetchWith([401]);
    const result = await dispatchVendor({ env: ENV, modelChain: [M3, M27, GEMINI], messages: MESSAGES, isAccountScoped: accountScoped });
    expect(result.vendorUsed).toBe('googleai');
    expect(minimaxCalls(fn)).toBe(1);
    expect(result.attempts.map((a) => [a.model, a.status])).toEqual([[M3, 401]]);
  });

  it('429 on a subscription skips the rest of the account', async () => {
    const fn = fetchWith([429]);
    const result = await dispatchVendor({
      env: ENV, modelChain: [M3, M27, GEMINI], messages: MESSAGES,
      isAccountScoped: accountScoped, sharesAccountQuota: accountScoped,
    });
    expect(result.vendorUsed).toBe('googleai');
    expect(minimaxCalls(fn)).toBe(1);
  });

  it('429 on an API key is per model: the account’s next model is still tried and serves', async () => {
    const fn = fetchWith([429, 200]);
    const result = await dispatchVendor({ env: ENV, modelChain: [M3, M27, GEMINI], messages: MESSAGES, isAccountScoped: accountScoped });
    expect(minimaxCalls(fn)).toBe(2);
    expect(result.vendorUsed).toBe('minimax');
    expect(result.modelUsed).toBe(M27);
  });

  it('a 5xx streak skips the rest of the selection', async () => {
    const fn = fetchWith([503]);
    const result = await dispatchVendor({ env: ENV, modelChain: [M3, M27, M27_FAST, GEMINI], messages: MESSAGES, isAccountScoped: accountScoped });
    expect(result.vendorUsed).toBe('googleai');
    expect(minimaxCalls(fn)).toBe(ACCOUNT_FAULT_STREAK);
  });

  it('403 on the first Kimi Code model: the second Kimi Code model is still tried and serves', async () => {
    // Kimi Code refuses K3 with a 403 when the subscription lacks it; the same account's
    // kimi-for-coding is a working fallback and must not be skipped as "account failed".
    const K3 = 'direct/kimi-code/k3';
    const KFC = 'direct/kimi-code/kimi-for-coding';
    const asked: string[] = [];
    const egress = vi.fn(async (_endpoint: string, init: RequestInit) => {
      const model = (JSON.parse(String(init.body ?? '{}')) as { model?: string }).model ?? '';
      asked.push(model);
      if (model === 'k3') return new Response(JSON.stringify({ error: { message: 'model not available on your plan' } }), { status: 403 });
      return new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'served' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const result = await dispatchVendor({
      env: { KIMI_CODE_API_KEY: 'sk-kimi-code' },
      modelChain: [K3, KFC, GEMINI],
      messages: MESSAGES,
      egress,
      isAccountScoped: (vendor) => vendor === 'kimi-code',
    } as Parameters<typeof dispatchVendor>[0]);
    expect(result.vendorUsed).toBe('kimi-code');
    expect(result.modelUsed).toBe(KFC);
    expect(asked).toEqual(['k3', 'kimi-for-coding']);
    expect(result.attempts.map((a) => [a.model, a.status])).toEqual([[K3, 403]]);
  });

  it('names the skip when the whole chain fails', async () => {
    fetchWith([401]);
    const err = await dispatchVendor({ env: { MINIMAX_API_KEY: 'mm' }, modelChain: [M3, M27], messages: MESSAGES, isAccountScoped: accountScoped })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CascadeExhaustedError);
    expect((err as CascadeExhaustedError).skippedAccountFailed).toEqual([`minimax:${M27}`]);
    expect((err as Error).message).toContain('skipped account-failed');
  });

  it('a vendor that is not one account (no predicate, or the predicate says no) keeps every model', async () => {
    const unscoped = fetchWith([401]);
    await dispatchVendor({ env: ENV, modelChain: [M3, M27, GEMINI], messages: MESSAGES });
    expect(minimaxCalls(unscoped)).toBe(2);
    const operator = fetchWith([401]);
    await dispatchVendor({ env: ENV, modelChain: [M3, M27, GEMINI], messages: MESSAGES, isAccountScoped: () => false });
    expect(minimaxCalls(operator)).toBe(2);
  });
});

describe('which connected vendors share one quota (subscriptionVendorIdsFromCredentials)', () => {
  it('every resolved subscription, and Kimi Code (its subscription rides its key slot) — never an API key', () => {
    const subs = subscriptionVendorIdsFromCredentials({
      anthropicOAuthToken: 'oat',
      openaiCodexAuth: { accessToken: 'a', accountId: 'b' },
      xaiOAuthToken: 'x',
      vendorKeys: { kimi: 'kimi-token', minimax: 'mm', google: 'g' },
    });
    expect([...subs].sort()).toEqual(['anthropic', 'kimi-code', 'openai-codex', 'xai-oauth']);
  });

  it('an Anthropic or OpenAI API key is per-model limits, not a shared quota', () => {
    const subs = subscriptionVendorIdsFromCredentials({ vendorKeys: { anthropic: 'sk-ant', openai: 'sk', xai: 'xai' } });
    expect([...subs]).toEqual([]);
  });
});
