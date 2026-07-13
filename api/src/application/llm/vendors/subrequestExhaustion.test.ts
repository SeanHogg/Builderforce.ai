import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchWithVendorTimeout,
  isSubrequestCapMessage,
  VendorRetryableError,
  WorkerSubrequestExhaustedError,
  RequestAbortedError,
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

describe('fetchWithVendorTimeout external-signal cancellation', () => {
  // A fetch that rejects when its signal is aborted (mirrors the platform fetch).
  const abortingFetch = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const sig = init?.signal;
    if (sig?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    sig?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));

  it('throws RequestAbortedError (not a timeout) when the caller signal aborts', async () => {
    (globalThis as { fetch: typeof fetch }).fetch = abortingFetch as unknown as typeof fetch;
    const ac = new AbortController();
    ac.abort(); // already cancelled before the call

    await expect(
      fetchWithVendorTimeout('openrouter', 'qwen/qwen3-coder:free', 'https://example/api', { method: 'POST' }, 25_000, ac.signal),
    ).rejects.toBeInstanceOf(RequestAbortedError);
  });
});

describe('dispatchVendor stops the cascade on caller cancellation', () => {
  it('does NOT walk further models once the caller aborts', async () => {
    const fetchSpy = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const sig = init?.signal;
      if (sig?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
      sig?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
    const ac = new AbortController();
    ac.abort();

    await expect(
      dispatchVendor({
        env: { OPENROUTER_API_KEY: 'sk-test', CEREBRAS_API_KEY: 'sk-test' },
        modelChain: ['qwen/qwen3-coder:free', 'qwen/qwen3-next-80b-a3b-instruct:free', 'llama3.1-8b'],
        messages: [{ role: 'user', content: 'hi' }],
        signal: ac.signal,
      }),
    ).rejects.toBeInstanceOf(RequestAbortedError);

    expect(fetchSpy).toHaveBeenCalledTimes(1); // stopped after the first model
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

describe('dispatchVendor advances the cascade on a request-error (400) [1488]', () => {
  it('tries the next vendor when one 400s, instead of bubbling out fatally', async () => {
    // First model (openrouter) returns 400 → VendorFatalError; a vendor-dialect
    // mismatch another upstream may accept. The cascade must ADVANCE, not stop.
    let n = 0;
    const fetchSpy = vi.fn(async () => {
      n++;
      if (n === 1) {
        return new Response(
          JSON.stringify({ error: { message: 'messages[0].role invalid', type: 'invalid_request_error' } }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    const result = await dispatchVendor({
      env: { OPENROUTER_API_KEY: 'sk-test', CEREBRAS_API_KEY: 'sk-test' },
      modelChain: ['qwen/qwen3-coder:free' /* openrouter → 400 */, 'llama3.1-8b' /* cerebras → 200 */],
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);   // advanced past the 400
    expect(result.content).toBe('ok');
    expect(result.attempts).toHaveLength(1);      // the 400 is recorded as an advanced-past attempt
    expect(result.attempts[0]?.status).toBe(400);
  });
});
