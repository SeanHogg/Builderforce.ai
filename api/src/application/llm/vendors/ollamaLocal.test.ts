import { afterEach, describe, expect, it, vi } from 'vitest';
import { ollamaLocalModule } from './ollamaLocal';
import { VendorFatalError, VendorRetryableError, type VendorEgress, type VendorEnv } from './types';
import { dispatchVendor, parseVendorPrefix, vendorForModel } from './registry';
import { passthroughEgress } from './__fixtures__/localEgress';

const originalFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

describe('ollamaLocalModule.apiKeyFrom', () => {
  it('passes the OLLAMA_LOCAL_CONFIG sentinel straight through', () => {
    const env = { OLLAMA_LOCAL_CONFIG: '::http://127.0.0.1:11434::llama3.1:8b' } as VendorEnv;
    expect(ollamaLocalModule.apiKeyFrom(env)).toBe('::http://127.0.0.1:11434::llama3.1:8b');
  });

  it('is null when no tenant connection is configured', () => {
    expect(ollamaLocalModule.apiKeyFrom({} as VendorEnv)).toBeNull();
  });
});

describe('direct/ollama-local/ prefix routing', () => {
  it('routes to the ollama-local vendor', () => {
    expect(parseVendorPrefix('direct/ollama-local/default')).toEqual({ vendor: 'ollama-local', modelId: 'default' });
    expect(vendorForModel('direct/ollama-local/default')).toBe('ollama-local');
  });
});

describe('ollamaLocalModule.call', () => {
  it('POSTs to <baseUrl>/api/chat with the CONFIGURED model, ignoring the requested catalog id', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: typeof input === 'string' ? input : input.toString(), init: init ?? {} });
      return new Response(JSON.stringify({
        message: { role: 'assistant', content: 'hello from my own ollama' },
        prompt_eval_count: 4, eval_count: 6,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const result = await dispatchVendor({
      env: { OLLAMA_LOCAL_CONFIG: '::http://127.0.0.1:11434::llama3.1:8b' } as VendorEnv,
      modelChain: ['direct/ollama-local/default'],
      messages: [{ role: 'user', content: 'hi' }],
      // A self-hosted instance is only reachable through the tenant's runtime, so the
      // cascade skips it outright without one — supply the transport to reach the module.
      egress: passthroughEgress,
    });

    expect(result.vendorUsed).toBe('ollama-local');
    expect(result.content).toBe('hello from my own ollama');
    expect(result.usage).toEqual({ prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://127.0.0.1:11434/api/chat');
    const sentBody = JSON.parse(calls[0]!.init.body as string) as { model: string };
    // "default" (the catalog id) never reaches the wire — the tenant's own model wins.
    expect(sentBody.model).toBe('llama3.1:8b');
  });

  it('strips a trailing /v1 the same way the on-prem host does, landing on the native /api/chat path', async () => {
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async () =>
      new Response(JSON.stringify({ message: { content: 'ok' } }), { status: 200 })) as unknown as typeof fetch;

    await ollamaLocalModule.call({
      apiKey: '::http://127.0.0.1:11434/v1::llama3.1:8b',
      model: 'default',
      messages: [{ role: 'user', content: 'hi' }],
    });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls[0]![0]).toBe('http://127.0.0.1:11434/api/chat');
  });

  it('forwards a non-empty apiKey as the Bearer token, for an instance behind a reverse-proxy token', async () => {
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async () =>
      new Response(JSON.stringify({ message: { content: 'ok' } }), { status: 200 })) as unknown as typeof fetch;

    await ollamaLocalModule.call({
      apiKey: 'proxy-token::http://127.0.0.1:11434::llama3.1:8b',
      model: 'default',
      messages: [{ role: 'user', content: 'hi' }],
    });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer proxy-token');
  });

  it('classifies a 5xx as retryable and a 4xx as fatal', async () => {
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async () =>
      new Response('service unavailable', { status: 503 })) as unknown as typeof fetch;
    await expect(ollamaLocalModule.call({
      apiKey: '::http://127.0.0.1:11434::llama3.1:8b', model: 'default', messages: [{ role: 'user', content: 'hi' }],
    })).rejects.toBeInstanceOf(VendorRetryableError);

    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async () =>
      new Response('bad request', { status: 400 })) as unknown as typeof fetch;
    await expect(ollamaLocalModule.call({
      apiKey: '::http://127.0.0.1:11434::llama3.1:8b', model: 'default', messages: [{ role: 'user', content: 'hi' }],
    })).rejects.toBeInstanceOf(VendorFatalError);
  });

  it('throws a fatal error on a malformed sentinel rather than mis-parsing it', async () => {
    await expect(ollamaLocalModule.call({
      apiKey: 'no-separators-here', model: 'default', messages: [{ role: 'user', content: 'hi' }],
    })).rejects.toBeInstanceOf(VendorFatalError);

    await expect(ollamaLocalModule.call({
      apiKey: 'only-one::separator', model: 'default', messages: [{ role: 'user', content: 'hi' }],
    })).rejects.toBeInstanceOf(VendorFatalError);
  });

  it('declares requiresLocalEgress and never auto-routes — reachable only via an explicit pin', () => {
    expect(ollamaLocalModule.requiresLocalEgress).toBe(true);
    expect(ollamaLocalModule.autoRoute).toBe(false);
  });

  it('rides a supplied egress transport instead of calling fetch directly', async () => {
    const seen: string[] = [];
    const egress: VendorEgress = async (endpoint) => {
      seen.push(endpoint);
      return new Response(JSON.stringify({ message: { content: 'via the tenant host' } }), { status: 200 });
    };
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async () => {
      throw new Error('must not call the Worker\'s own fetch when an egress transport is supplied');
    }) as unknown as typeof fetch;

    const result = await dispatchVendor({
      env: { OLLAMA_LOCAL_CONFIG: '::http://127.0.0.1:11434::llama3.1:8b' } as VendorEnv,
      modelChain: ['direct/ollama-local/default'],
      messages: [{ role: 'user', content: 'hi' }],
      egress,
    });

    expect(result.content).toBe('via the tenant host');
    expect(seen).toEqual(['http://127.0.0.1:11434/api/chat']);
  });
});
