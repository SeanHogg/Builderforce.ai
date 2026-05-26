import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchWithVendorTimeout,
  isSubrequestCapMessage,
  VendorRetryableError,
  WorkerSubrequestExhaustedError,
} from './types';
import { dispatchVendor } from './registry';

// ---------------------------------------------------------------------------
// Worker subrequest exhaustion — Cloudflare's per-invocation cap (50 free /
// 1000 paid). Production trace `llm-2cc6ba1b-...` (2026-05-26) showed the
// gateway burning 4-6 attempts on identical `Too many subrequests by single
// Worker invocation` errors after the cap was hit. These tests pin down the
// detection + short-circuit behaviour.
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

describe('isSubrequestCapMessage', () => {
  it('matches the canonical Cloudflare error phrasing', () => {
    expect(isSubrequestCapMessage(
      'Too many subrequests by single Worker invocation. To configure this limit, refer to https://developers.cloudflare.com/workers/wrangler/configuration/#limits',
    )).toBe(true);
  });

  it('matches when the phrase is embedded in a wider message', () => {
    expect(isSubrequestCapMessage('network: Too many subrequests by single Worker invocation')).toBe(true);
  });

  it('does not match unrelated network errors', () => {
    expect(isSubrequestCapMessage('connect ECONNRESET')).toBe(false);
    expect(isSubrequestCapMessage('upstream timed out')).toBe(false);
  });
});

describe('fetchWithVendorTimeout subrequest detection', () => {
  it('throws WorkerSubrequestExhaustedError on the Cloudflare cap message', async () => {
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async () => {
      throw new Error('Too many subrequests by single Worker invocation. To configure this limit, refer to https://developers.cloudflare.com/workers/wrangler/configuration/#limits');
    }) as unknown as typeof fetch;

    await expect(
      fetchWithVendorTimeout('openrouter', 'qwen/qwen3-coder:free', 'https://example/api', { method: 'POST' }),
    ).rejects.toBeInstanceOf(WorkerSubrequestExhaustedError);
  });

  it('still throws VendorRetryableError for ordinary network failures', async () => {
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async () => {
      throw new Error('connect ECONNRESET');
    }) as unknown as typeof fetch;

    await expect(
      fetchWithVendorTimeout('openrouter', 'qwen/qwen3-coder:free', 'https://example/api', { method: 'POST' }),
    ).rejects.toBeInstanceOf(VendorRetryableError);
  });
});

describe('dispatchVendor short-circuits on subrequest exhaustion', () => {
  it('does NOT walk further models once the cap is hit', async () => {
    // Three model chain; fetch throws the subrequest-cap error on the FIRST
    // call. If short-circuit works correctly, fetch is called exactly once.
    const fetchSpy = vi.fn(async () => {
      throw new Error('Too many subrequests by single Worker invocation');
    });
    (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    await expect(
      dispatchVendor({
        env: { OPENROUTER_API_KEY: 'sk-test', CEREBRAS_API_KEY: 'sk-test' },
        modelChain: [
          'qwen/qwen3-coder:free',                  // openrouter
          'qwen/qwen3-next-80b-a3b-instruct:free',  // openrouter
          'llama3.1-8b',                            // cerebras
        ],
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toBeInstanceOf(WorkerSubrequestExhaustedError);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('cascades normally on retryable errors (sanity check the short-circuit is targeted)', async () => {
    // First two attempts return 429, third returns 200. fetch should be
    // called three times — short-circuit must not trigger on plain rate
    // limits.
    let n = 0;
    const fetchSpy = vi.fn(async () => {
      n++;
      if (n < 3) {
        return new Response('rate limited', { status: 429 });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    const result = await dispatchVendor({
      env: { OPENROUTER_API_KEY: 'sk-test', CEREBRAS_API_KEY: 'sk-test' },
      modelChain: [
        'qwen/qwen3-coder:free',
        'qwen/qwen3-next-80b-a3b-instruct:free',
        'llama3.1-8b',
      ],
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(result.content).toBe('ok');
    expect(result.attempts).toHaveLength(2); // first two retried
  });
});
