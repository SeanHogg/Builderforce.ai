import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAllVendorIds,
  getModule,
  vendorForModel,
  parseVendorPrefix,
  vendorAutoRoutes,
  autoRoutableModelsByTier,
  dispatchVendor,
  dispatchVendorStream,
} from './registry';
import { CAPACITY_LIMIT_MARKER, VendorRetryableError, type UpstreamDiagnostic, type VendorEnv } from './types';
import { createOpenAICompatibleVendor } from './openaiCompatible';
import {
  openAICompatibleModules,
  openAICompatibleModulesById,
  OPENAI_COMPATIBLE_VENDOR_KEYS,
  passthroughVendorKeys,
} from './openaiCompatibleVendors';
import { BYO_FRONTIER_CODERS } from '../modelPool';

// ---------------------------------------------------------------------------
// "30+ model providers" must be LITERALLY TRUE at the gateway: the vendor
// registry has to carry ≥30 real, wired vendor modules — and each new
// OpenAI-compatible vendor must build a correct request (Bearer auth + its own
// base URL) and route through the SAME dispatch machinery as the original seven.
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

describe('vendor registry — "30+ providers" claim', () => {
  it('registers at least 30 wired vendors', () => {
    const ids = getAllVendorIds();
    expect(ids.length).toBeGreaterThanOrEqual(30);
    // No duplicates — every id is distinct.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every factory vendor is a real module (key reader + catalog + call, no throwing placeholder)', () => {
    for (const mod of openAICompatibleModules) {
      expect(typeof mod.apiKeyFrom).toBe('function');
      expect(typeof mod.call).toBe('function');
      expect(typeof mod.tierFor).toBe('function');
      // Each has a non-empty curated default catalog of real model ids.
      expect(mod.catalog.length).toBeGreaterThan(0);
      // Explicit-pin-only: never silently auto-selected into FREE/PRO pools.
      expect(mod.autoRoute).toBe(false);
    }
  });

  it('a bound key makes the vendor key-bound; an unbound one does not', () => {
    const groq = getModule('groq');
    expect(groq.apiKeyFrom({ GROQ_API_KEY: 'gsk_test' } as VendorEnv)).toBe('gsk_test');
    expect(groq.apiKeyFrom({} as VendorEnv)).toBeNull();
  });
});

describe('explicit direct/<vendor>/<id> prefix routing reaches the new vendors', () => {
  it('routes a groq pin to the groq vendor', () => {
    expect(parseVendorPrefix('direct/groq/llama-3.3-70b-versatile')).toEqual({
      vendor: 'groq',
      modelId: 'llama-3.3-70b-versatile',
    });
    expect(vendorForModel('direct/groq/llama-3.3-70b-versatile')).toBe('groq');
  });

  it('routes a deepseek and an openai pin to their vendors', () => {
    expect(vendorForModel('direct/deepseek/deepseek-chat')).toBe('deepseek');
    expect(vendorForModel('direct/openai/gpt-4o')).toBe('openai');
  });

  it('routes a cohere pin to Cohere\'s OpenAI-compatible endpoint', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: typeof input === 'string' ? input : input.toString(), init: init ?? {} });
      return new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    expect(vendorForModel('direct/cohere/command-a-03-2025')).toBe('cohere');
    const result = await dispatchVendor({
      env: { COHERE_API_KEY: 'cohere-secret' } as VendorEnv,
      modelChain: ['direct/cohere/command-a-03-2025'],
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.vendorUsed).toBe('cohere');
    expect(calls[0]!.url).toBe('https://api.cohere.com/compatibility/v1/chat/completions');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer cohere-secret');
  });

  it('does NOT hijack OpenRouter <org>/<slug> ids (no bare-prefix collision)', () => {
    // These are OpenRouter model ids that share an org name with a direct vendor —
    // they must still resolve to OpenRouter, never the direct vendor.
    expect(vendorForModel('openai/gpt-oss-120b:free')).toBe('openrouter');
    expect(vendorForModel('mistralai/mistral-7b')).toBe('openrouter');
    expect(vendorForModel('deepseek/deepseek-v4-flash')).toBe('openrouter');
  });

  it('the new vendors stay OUT of the auto-selected FREE/PRO pools', () => {
    expect(vendorAutoRoutes('groq')).toBe(false);
    expect(vendorAutoRoutes('deepseek')).toBe(false);
    // No factory-vendor model id leaks into the auto-routable pools.
    const autoIds = new Set(autoRoutableModelsByTier('FREE', 'STANDARD', 'PREMIUM', 'ULTRA'));
    for (const mod of openAICompatibleModules) {
      for (const entry of mod.catalog) {
        expect(autoIds.has(entry.id)).toBe(false);
      }
    }
  });
});

describe('a factory vendor builds a correct OpenAI-compatible request', () => {
  it('records HTTP 410 for a retired model and advances to the next candidate', async () => {
    const calledModels: string[] = [];
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { model: string };
      calledModels.push(request.model);
      if (request.model === 'minimaxai/minimax-m3') {
        return new Response(JSON.stringify({ detail: 'model has reached end of life' }), {
          status: 410,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const result = await dispatchVendor({
      env: { NVIDIA_API_KEY: 'nvapi-test' } as VendorEnv,
      modelChain: ['minimaxai/minimax-m3', 'mistralai/mistral-medium-3.5-128b'],
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(calledModels).toEqual(['minimaxai/minimax-m3', 'mistralai/mistral-medium-3.5-128b']);
    expect(result.modelUsed).toBe('mistralai/mistral-medium-3.5-128b');
    expect(result.attempts).toEqual([
      expect.objectContaining({
        model: 'minimaxai/minimax-m3',
        vendor: 'nvidia',
        status: 410,
        kind: 'client_error',
      }),
    ]);
  });

  it('routes Kimi Code subscription keys to api.kimi.com, not the Moonshot Open Platform', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: typeof input === 'string' ? input : input.toString(), init: init ?? {} });
      return new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const result = await dispatchVendor({
      env: { KIMI_CODE_API_KEY: 'sk-kimi-code' } as VendorEnv,
      modelChain: ['direct/kimi-code/kimi-for-coding'],
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.vendorUsed).toBe('kimi-code');
    expect(calls.map((call) => call.url)).toEqual(['https://api.kimi.com/coding/v1/chat/completions']);
    expect((calls[0]!.init.headers as Record<string, string>)['User-Agent']).toBe('Builderforce.ai');
  });

  it('classifies Kimi Code HTTP 403 usage exhaustion as capacity, not rejected access', async () => {
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async () => new Response(
      JSON.stringify({ error: { message: "You've reached your usage limit for this billing cycle." } }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch;

    let thrown: unknown;
    try {
      await getModule('kimi-code').call({
        apiKey: 'sk-kimi-code',
        model: 'kimi-for-coding',
        messages: [{ role: 'user', content: 'hi' }],
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(VendorRetryableError);
    expect((thrown as VendorRetryableError).status).toBe(429);
    expect((thrown as VendorRetryableError).message).toContain(CAPACITY_LIMIT_MARKER);
    expect((thrown as VendorRetryableError).message).toContain('upstream 403');
  });

  it('leads the Moonshot catalog with a current model, not a retired moonshot-v1-* id', () => {
    const ids = getModule('moonshot').catalog.map((entry) => entry.id);
    // The credential health probe dispatches the FIRST catalog entry, so a retired
    // id here reads back as "your key is broken" on a perfectly good account.
    expect(ids[0]).toBe('kimi-k2.5');
    expect(ids.some((id) => id.startsWith('moonshot-v1-'))).toBe(false);
  });

  it('every direct/<vendor>/ BYO flagship names a model that vendor actually carries', () => {
    // A BYO flagship LEADS auto-select on the tenant's own key. When it drifts off
    // the catalog — as `direct/moonshot/kimi-k2-0711-preview` had — the connected
    // account routes to a dead id and the probe blames the credential.
    const drifted = BYO_FRONTIER_CODERS
      .map((ref) => parseVendorPrefix(ref))
      .filter((parsed) => parsed !== null)
      .filter(({ vendor, modelId }) =>
        vendor in openAICompatibleModulesById
        && !openAICompatibleModulesById[vendor]!.catalog.some((entry) => entry.id === modelId));
    expect(drifted).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Moonshot runs two independent Open Platforms — api.moonshot.ai (international)
// and api.moonshot.cn (China) — whose keys are NOT interchangeable, and a key
// carries no marker for which issued it. Pinning one host silently 401s the other
// platform's tenants, which is exactly how "connect a Moonshot key instead"
// became a second dead end for anyone told to leave Kimi Code behind.
// ---------------------------------------------------------------------------
describe('Moonshot regional host resolution', () => {
  /** Record every URL a call reaches, answering each host per `respond`. */
  function stubHosts(respond: (url: string) => Response): string[] {
    const urls: string[] = [];
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async (input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      urls.push(url);
      return respond(url);
    }) as unknown as typeof fetch;
    return urls;
  }

  const ok = () => new Response(
    JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
  const rejected = () => new Response(
    JSON.stringify({ error: { message: 'Invalid Authentication', type: 'invalid_authentication_error' } }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  );

  const call = (apiKey: string) => getModule('moonshot').call({
    apiKey, model: 'kimi-k2.5', messages: [{ role: 'user', content: 'hi' }],
  });

  const INTL = 'https://api.moonshot.ai/v1/chat/completions';
  const CN = 'https://api.moonshot.cn/v1/chat/completions';

  it('sends an international key to api.moonshot.ai and never touches the China host', async () => {
    const urls = stubHosts(ok);
    await call('sk-intl-happy');
    expect(urls).toEqual([INTL]);
  });

  it('falls back to api.moonshot.cn when the international host rejects the credential', async () => {
    const urls = stubHosts((url) => (url === INTL ? rejected() : ok()));
    await call('sk-cn-first-use');
    expect(urls).toEqual([INTL, CN]);
  });

  it('remembers the resolved host, so the next call on that key costs no wasted rejection', async () => {
    stubHosts((url) => (url === INTL ? rejected() : ok()));
    await call('sk-cn-remembered');

    const second = stubHosts((url) => (url === INTL ? rejected() : ok()));
    await call('sk-cn-remembered');
    expect(second).toEqual([CN]);
  });

  it('does NOT cross to the sibling host on a transient failure', async () => {
    // A 429 is the upstream having a bad minute. Re-sending it to a platform the key
    // does not belong to spends the tenant's money to learn nothing.
    const urls = stubHosts(() => new Response('rate limited', { status: 429 }));
    await expect(call('sk-transient')).rejects.toBeInstanceOf(VendorRetryableError);
    expect(urls).toEqual([INTL]);
  });

  it('reports the INTERNATIONAL host\'s rejection when both platforms refuse the key', async () => {
    const urls = stubHosts(rejected);
    let thrown: unknown;
    try { await call('sk-dead-everywhere'); } catch (error) { thrown = error; }

    expect(urls).toEqual([INTL, CN]);
    // The operator connected an Open Platform key; an error naming the China host
    // would send them to fix an account they never meant to use.
    expect(thrown).toBeInstanceOf(VendorRetryableError);
    expect((thrown as VendorRetryableError).status).toBe(401);
  });

  it('a single-host vendor makes exactly one attempt on an auth rejection', async () => {
    const urls = stubHosts(rejected);
    await expect(getModule('deepseek').call({
      apiKey: 'sk-deepseek-dead', model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }],
    })).rejects.toBeInstanceOf(VendorRetryableError);
    expect(urls).toEqual(['https://api.deepseek.com/v1/chat/completions']);
  });
});

// ---------------------------------------------------------------------------
// A failed upstream call has to leave behind something an operator can SEND the
// provider. "Kimi refused us" and "Kimi's CDN refused us before reading the key"
// demand opposite responses and are indistinguishable in an error message, so the
// transport records the endpoint, the provider's own correlation headers, and
// whether the body was an edge block page — redacted, per the submission checklist
// in docs/partnerships/kimi-code-hosted-integration-request.md.
// ---------------------------------------------------------------------------
describe('upstream diagnostic capture', () => {
  function stubResponse(status: number, body: string, headers: Record<string, string>) {
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async () =>
      new Response(body, { status, headers })) as unknown as typeof fetch;
  }

  const callKimi = () => getModule('kimi-code').call({
    apiKey: 'sk-kimi-code', model: 'kimi-for-coding', messages: [{ role: 'user', content: 'hi' }],
  });

  async function diagnosticFrom(call: () => Promise<unknown>) {
    try { await call(); } catch (error) {
      return (error as VendorRetryableError & { diagnostic?: UpstreamDiagnostic }).diagnostic;
    }
    throw new Error('expected the call to reject');
  }

  it('flags an HTML 403 as an EDGE block and keeps the provider\'s correlation headers', async () => {
    stubResponse(403, '<!doctype html><html><body>Forbidden</body></html>', {
      'content-type': 'text/html',
      'cf-ray': '9a1b2c3d4e5f6789-LHR',
      server: 'cloudflare',
      date: 'Sat, 02 Aug 2026 10:00:00 GMT',
    });

    const diagnostic = await diagnosticFrom(callKimi);
    expect(diagnostic).toMatchObject({
      endpoint: 'https://api.kimi.com/coding/v1/chat/completions',
      status: 403,
      // The load-bearing bit: the API never saw the key, so this is not a credential problem.
      edgeBlocked: true,
    });
    expect(diagnostic!.headers['cf-ray']).toBe('9a1b2c3d4e5f6789-LHR');
    expect(diagnostic!.headers['server']).toBe('cloudflare');
  });

  it('does NOT flag a JSON credential rejection as an edge block', async () => {
    stubResponse(401, JSON.stringify({ error: { message: 'Invalid Authentication' } }), {
      'content-type': 'application/json',
      'x-request-id': 'req_abc123',
    });

    const diagnostic = await diagnosticFrom(callKimi);
    expect(diagnostic).toMatchObject({ status: 401, edgeBlocked: false });
    expect(diagnostic!.headers['x-request-id']).toBe('req_abc123');
  });

  it('carries ONLY allowlisted headers — never a cookie or a reflected credential', async () => {
    stubResponse(403, '<html></html>', {
      'cf-ray': 'ray-1',
      'set-cookie': 'session=super-secret; HttpOnly',
      authorization: 'Bearer sk-kimi-code',
      'x-internal-user-email': 'someone@example.com',
    });

    const diagnostic = await diagnosticFrom(callKimi);
    // An operator pastes this into a third party's ticket system; an allowlist is the
    // only thing standing between that and whatever the upstream chose to echo back.
    // (`content-type` is set by the Response constructor and IS allowlisted — it is how
    // an HTML block page is told from a JSON error envelope.)
    expect(diagnostic!.headers['cf-ray']).toBe('ray-1');
    expect(Object.keys(diagnostic!.headers).sort()).toEqual(['cf-ray', 'content-type']);
  });

  it('drops the query string from the recorded endpoint', async () => {
    // A base URL can carry a key in the query (Google's `?key=` shape); the recorded
    // endpoint must survive being pasted into a ticket regardless of the vendor.
    stubResponse(403, '<html></html>', {});
    const vendor = createOpenAICompatibleVendor({
      id: 'groq',
      baseUrl: 'https://example.test/v1/chat/completions?key=SECRET&x=1',
      apiKeyEnv: 'GROQ_API_KEY',
    });
    const diagnostic = await diagnosticFrom(() => vendor.call({
      apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'hi' }],
    }));
    expect(diagnostic!.endpoint).toBe('https://example.test/v1/chat/completions');
  });

  it('reaches the caller through the cascade as failovers[0].diagnostic', async () => {
    // The probe reads `failovers[0]`, so a diagnostic that stops at the vendor module
    // is invisible to every surface that needs it.
    stubResponse(403, '<html>blocked</html>', { 'cf-ray': 'ray-2' });
    let attempts: ReadonlyArray<{ diagnostic?: UpstreamDiagnostic }> = [];
    try {
      await dispatchVendor({
        env: { KIMI_CODE_API_KEY: 'sk-kimi-code' } as VendorEnv,
        modelChain: ['direct/kimi-code/kimi-for-coding'],
        messages: [{ role: 'user', content: 'hi' }],
      });
    } catch (error) {
      attempts = (error as { attempts: ReadonlyArray<{ diagnostic?: UpstreamDiagnostic }> }).attempts;
    }
    expect(attempts[0]?.diagnostic).toMatchObject({ status: 403, edgeBlocked: true });
  });
});

// ---------------------------------------------------------------------------
// Local egress. Kimi Code's edge refuses the Worker itself — same request from an
// ordinary machine gets a clean JSON answer — so that vendor runs from the tenant's
// own connected runtime when one is online. The rules that matter: the transport
// reaches the vendor that declared it needs it, and reaches NO other vendor (a
// tenant's laptop must not become the route for all LLM traffic).
// ---------------------------------------------------------------------------
describe('local egress routing', () => {
  /** A stand-in runtime: records what it was asked to fetch, answers 200. */
  function recordingEgress() {
    const calls: Array<{ endpoint: string; init: RequestInit }> = [];
    const egress = vi.fn(async (endpoint: string, init: RequestInit) => {
      calls.push({ endpoint, init });
      return new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    return { calls, egress };
  }

  beforeEach(() => {
    // Direct fetch answers 200 too, so a test failing over to it looks like success —
    // which is the point: the assertions are about WHICH path ran, not about status.
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'direct' } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch;
  });

  it('declares kimi-code as needing local egress, and no other factory vendor', () => {
    const declaring = openAICompatibleModules.filter((m) => m.requiresLocalEgress).map((m) => m.id);
    expect(declaring).toEqual(['kimi-code']);
  });

  it('routes a kimi-code call through the tenant runtime instead of the Worker', async () => {
    const { calls, egress } = recordingEgress();
    await dispatchVendor({
      env: { KIMI_CODE_API_KEY: 'sk-kimi-code' } as VendorEnv,
      modelChain: ['direct/kimi-code/kimi-for-coding'],
      messages: [{ role: 'user', content: 'hi' }],
      egress,
    });

    expect(calls.map((c) => c.endpoint)).toEqual(['https://api.kimi.com/coding/v1/chat/completions']);
    // The credential rides the relayed request — it is the tenant's own key going to
    // the tenant's own machine, which is what makes the call a licensed personal client.
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-kimi-code');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does NOT tunnel a vendor that never asked for it', async () => {
    // A tenant connecting a runtime must not silently reroute their DeepSeek (or any
    // other) traffic through their own laptop.
    const { calls, egress } = recordingEgress();
    await dispatchVendor({
      env: { DEEPSEEK_API_KEY: 'sk-deepseek' } as VendorEnv,
      modelChain: ['direct/deepseek/deepseek-chat'],
      messages: [{ role: 'user', content: 'hi' }],
      egress,
    });

    expect(calls).toEqual([]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to direct egress when no runtime is online', async () => {
    // Likely to fail against Kimi's edge — but refusing to try would strand any tenant
    // whose network Kimi does not happen to block.
    await dispatchVendor({
      env: { KIMI_CODE_API_KEY: 'sk-kimi-code' } as VendorEnv,
      modelChain: ['direct/kimi-code/kimi-for-coding'],
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('serves a STREAMED kimi request instead of skipping it', async () => {
    // The relay is request/response, so Kimi cannot stream incrementally. Marking it
    // `noStream` would have made `dispatchVendorStream` skip the vendor outright — a
    // caller who streams would silently never reach the account they connected, which
    // is the same "connected but unused" failure this whole effort exists to end.
    const { calls, egress } = recordingEgress();
    const result = await dispatchVendorStream({
      env: { KIMI_CODE_API_KEY: 'sk-kimi-code' } as VendorEnv,
      modelChain: ['direct/kimi-code/kimi-for-coding'],
      messages: [{ role: 'user', content: 'hi' }],
      egress,
    });

    expect(result.vendorUsed).toBe('kimi-code');
    expect(calls).toHaveLength(1);
    // The relayed call is the NON-streaming one — asking the provider to stream would
    // just produce an SSE body the relay buffers whole anyway.
    expect(JSON.parse(calls[0]!.init.body as string).stream).not.toBe(true);
    const sse = await new Response(result.response.body).text();
    expect(sse).toContain('data: ');
    expect(sse).toContain('[DONE]');
  });

  it('classifies a relayed 403 exactly like a direct one', async () => {
    // The relay must not change what a failure MEANS — the edge-block diagnostic is
    // what the operator-facing remediation branches on.
    const egress = vi.fn(async () => new Response('<html>Forbidden</html>', {
      status: 403, headers: { 'content-type': 'text/html', 'cf-ray': 'ray-9' },
    }));
    let thrown: unknown;
    try {
      await dispatchVendor({
        env: { KIMI_CODE_API_KEY: 'sk-kimi-code' } as VendorEnv,
        modelChain: ['direct/kimi-code/kimi-for-coding'],
        messages: [{ role: 'user', content: 'hi' }],
        egress,
      });
    } catch (error) { thrown = error; }

    const attempts = (thrown as { attempts: ReadonlyArray<{ diagnostic?: UpstreamDiagnostic }> }).attempts;
    expect(attempts[0]?.diagnostic).toMatchObject({ status: 403, edgeBlocked: true });
  });
});

describe('a factory vendor builds a correct OpenAI-compatible request (cont.)', () => {
  it('POSTs to the vendor base URL with a Bearer auth header and the pinned model in the body', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: typeof input === 'string' ? input : input.toString(), init: init ?? {} });
      return new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const env: VendorEnv = { GROQ_API_KEY: 'gsk_secret' };
    const result = await dispatchVendor({
      env,
      modelChain: ['direct/groq/llama-3.3-70b-versatile'],
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.vendorUsed).toBe('groq');
    expect(result.modelUsed).toBe('direct/groq/llama-3.3-70b-versatile');
    expect(result.content).toBe('ok');

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    // Correct base URL.
    expect(call.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    // Correct Bearer auth header.
    const headers = call.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer gsk_secret');
    expect(headers['Content-Type']).toBe('application/json');
    // The un-prefixed model id is sent to the upstream (prefix stripped).
    const sentBody = JSON.parse(call.init.body as string) as { model: string; messages: unknown[] };
    expect(sentBody.model).toBe('llama-3.3-70b-versatile');
    expect(sentBody.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('an unbound vendor key is skipped (cascade falls through to the next candidate)', async () => {
    const seen: string[] = [];
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async (input: string | URL) => {
      seen.push(typeof input === 'string' ? input : input.toString());
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'served' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    // deepseek key unbound, groq key bound → the chain skips deepseek, serves on groq.
    const result = await dispatchVendor({
      env: { GROQ_API_KEY: 'gsk_secret' } as VendorEnv,
      modelChain: ['direct/deepseek/deepseek-chat', 'direct/groq/llama-3.3-70b-versatile'],
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.vendorUsed).toBe('groq');
    // deepseek never hit the network (no key) — only groq did.
    expect(seen).toEqual(['https://api.groq.com/openai/v1/chat/completions']);
  });
});

describe('passthroughVendorKeys', () => {
  it('exposes one key per factory vendor and copies bound keys (null when absent)', () => {
    expect(OPENAI_COMPATIBLE_VENDOR_KEYS.length).toBe(openAICompatibleModules.length);
    const out = passthroughVendorKeys({ GROQ_API_KEY: 'gsk', DEEPSEEK_API_KEY: 'dsk' } as VendorEnv);
    expect(out.GROQ_API_KEY).toBe('gsk');
    expect(out.DEEPSEEK_API_KEY).toBe('dsk');
    // An unbound vendor key is present as null (so the dispatcher's key check is honest).
    expect(out.OPENAI_API_KEY).toBeNull();
  });
});
