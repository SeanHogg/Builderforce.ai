import { afterEach, describe, expect, it, vi } from 'vitest';
import { freetokenModule } from './freetoken';
import { ollamaLocalModule } from './ollamaLocal';
import { VendorFatalError, VendorRetryableError, type VendorEgress, type VendorEnv } from './types';
import { dispatchVendor, parseVendorPrefix, vendorForModel } from './registry';
import { passthroughEgress } from './__fixtures__/localEgress';

const originalFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

/** A minimal OpenAI-shaped completion, which is what the engine returns. */
function completion(content: string): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('freetokenModule.apiKeyFrom', () => {
  it('passes the FREETOKEN_CONFIG sentinel straight through', () => {
    const env = { FREETOKEN_CONFIG: '::http://127.0.0.1:1919::gpt-oss-20b' } as VendorEnv;
    expect(freetokenModule.apiKeyFrom(env)).toBe('::http://127.0.0.1:1919::gpt-oss-20b');
  });

  it('is null when no tenant connection is configured', () => {
    expect(freetokenModule.apiKeyFrom({} as VendorEnv)).toBeNull();
  });
});

describe('direct/freetoken/ prefix routing', () => {
  it('routes to the freetoken vendor', () => {
    expect(parseVendorPrefix('direct/freetoken/default')).toEqual({ vendor: 'freetoken', modelId: 'default' });
    expect(vendorForModel('direct/freetoken/default')).toBe('freetoken');
  });
});

describe('freetokenModule.call', () => {
  it('POSTs to <baseUrl>/v1/chat/completions with the CONFIGURED model, ignoring the requested catalog id', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: typeof input === 'string' ? input : input.toString(), init: init ?? {} });
      return completion('hello from my own engine');
    }) as unknown as typeof fetch;

    const result = await dispatchVendor({
      env: { FREETOKEN_CONFIG: '::http://127.0.0.1:1919::gpt-oss-20b' } as VendorEnv,
      modelChain: ['direct/freetoken/default'],
      messages: [{ role: 'user', content: 'hi' }],
      // A self-hosted engine is only reachable through the tenant's runtime, so the
      // cascade skips it outright without one — supply the transport to reach the module.
      egress: passthroughEgress,
    });

    expect(result.vendorUsed).toBe('freetoken');
    expect(result.content).toBe('hello from my own engine');
    expect(result.usage).toEqual({ prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 });

    expect(calls).toHaveLength(1);
    // The OpenAI route — NOT ollama's native /api/chat.
    expect(calls[0]!.url).toBe('http://127.0.0.1:1919/v1/chat/completions');
    const sentBody = JSON.parse(calls[0]!.init.body as string) as { model: string };
    // "default" (the catalog id) never reaches the wire — the tenant's own model wins.
    expect(sentBody.model).toBe('gpt-oss-20b');
  });

  it('accepts the documented /v1 base form without doubling the path', async () => {
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async () => completion('ok')) as unknown as typeof fetch;

    await freetokenModule.call({
      apiKey: '::http://127.0.0.1:1919/v1::gpt-oss-20b',
      model: 'default',
      messages: [{ role: 'user', content: 'hi' }],
    });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls[0]![0]).toBe('http://127.0.0.1:1919/v1/chat/completions');
  });

  it('forwards a non-empty apiKey as the Bearer token, for an engine behind a reverse-proxy token', async () => {
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async () => completion('ok')) as unknown as typeof fetch;

    await freetokenModule.call({
      apiKey: 'proxy-token::http://127.0.0.1:1919::gpt-oss-20b',
      model: 'default',
      messages: [{ role: 'user', content: 'hi' }],
    });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer proxy-token');
  });

  it('classifies a 5xx as retryable and a 4xx as fatal', async () => {
    const params = {
      apiKey: '::http://127.0.0.1:1919::gpt-oss-20b',
      model: 'default',
      messages: [{ role: 'user' as const, content: 'hi' }],
    };

    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async () =>
      new Response('service unavailable', { status: 503 })) as unknown as typeof fetch;
    await expect(freetokenModule.call(params)).rejects.toBeInstanceOf(VendorRetryableError);

    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async () =>
      new Response('bad request', { status: 400 })) as unknown as typeof fetch;
    await expect(freetokenModule.call(params)).rejects.toBeInstanceOf(VendorFatalError);
  });

  it('throws a fatal error on a malformed sentinel rather than mis-parsing it', async () => {
    for (const apiKey of ['no-separators-here', 'only-one::separator']) {
      await expect(freetokenModule.call({
        apiKey, model: 'default', messages: [{ role: 'user', content: 'hi' }],
      })).rejects.toBeInstanceOf(VendorFatalError);
    }
  });

  it('declares requiresLocalEgress and never auto-routes — reachable only via an explicit pin', () => {
    expect(freetokenModule.requiresLocalEgress).toBe(true);
    expect(freetokenModule.autoRoute).toBe(false);
  });

  it('rides a supplied egress transport instead of calling fetch directly', async () => {
    const seen: string[] = [];
    const egress: VendorEgress = async (endpoint) => {
      seen.push(endpoint);
      return completion('via the tenant host');
    };
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async () => {
      throw new Error('must not call the Worker\'s own fetch when an egress transport is supplied');
    }) as unknown as typeof fetch;

    const result = await dispatchVendor({
      env: { FREETOKEN_CONFIG: '::http://127.0.0.1:1919::gpt-oss-20b' } as VendorEnv,
      modelChain: ['direct/freetoken/default'],
      messages: [{ role: 'user', content: 'hi' }],
      egress,
    });

    expect(result.content).toBe('via the tenant host');
    expect(seen).toEqual(['http://127.0.0.1:1919/v1/chat/completions']);
  });

  it('streams, unlike the ollama-based self-hosted vendor', () => {
    // The distinction that justifies a separate module: FreeToken serves SSE on the
    // OpenAI route, so a streamed dispatch is served incrementally instead of skipped.
    expect(typeof freetokenModule.callStream).toBe('function');
    expect(ollamaLocalModule.callStream).toBeUndefined();
  });
});
