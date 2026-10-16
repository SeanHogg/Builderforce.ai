import { describe, expect, it, vi } from 'vitest';
import {
  BROWSER_ENGINE_BASE_URL,
  GATEWAY_COMPLETIONS_PATH,
  HTTP_LOCAL_RUNTIMES,
  LOCAL_MODEL_PREFIX,
  LOCAL_RUNTIMES,
  LOCAL_RUNTIME_IDS,
  createLocalRuntimeProber,
  formatLocalModelRef,
  isLocalModelRef,
  localChatCompletionsUrl,
  localModelsUrl,
  matchLocalChatEndpoint,
  normalizeLocalBaseUrl,
  parseBfiDiscovery,
  parseLocalModelRef,
  probeLocalRuntimes,
  rewriteToLocalUrl,
  type FetchLike,
} from './index.js';

/**
 * The registry, ref grammar, URL fence and probe. Two things are load-bearing and
 * invisible at a call site, so they are pinned here: the ref grammar must survive an
 * Ollama id containing both `:` and `/`, and the probe must read every failure as "no
 * models" — a developer running one runtime of three is the normal case.
 */

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });

describe('registry', () => {
  it('lists every runtime once, on-device engines first', () => {
    expect(LOCAL_RUNTIME_IDS).toEqual(['synapse', 'ollama', 'freetoken', 'browser', 'kimi-code']);
    expect(LOCAL_RUNTIMES.filter((r) => r.onDevice).map((r) => r.id)).toEqual([
      'synapse',
      'ollama',
      'freetoken',
      'browser',
    ]);
  });

  it('marks the in-page engine as reached by the page, never over HTTP', () => {
    expect(LOCAL_RUNTIMES.filter((r) => r.reach === 'page').map((r) => r.id)).toEqual(['browser']);
    expect(HTTP_LOCAL_RUNTIMES.map((r) => r.id)).toEqual(['synapse', 'ollama', 'freetoken', 'kimi-code']);
    expect(LOCAL_RUNTIMES.find((r) => r.id === 'browser')).toMatchObject({
      defaultBaseUrl: BROWSER_ENGINE_BASE_URL,
      tools: 'unknown',
    });
  });

  it('names runtimes with brand tokens', () => {
    expect(Object.fromEntries(LOCAL_RUNTIMES.map((r) => [r.id, r.label]))).toEqual({
      synapse: 'Synapse',
      ollama: 'Ollama',
      freetoken: 'FreeToken',
      browser: 'Gemini Nano',
      'kimi-code': 'Kimi Code',
    });
  });
});

describe('local model refs', () => {
  it('round-trips plain, Synapse and Ollama ids', () => {
    expect(parseLocalModelRef(formatLocalModelRef('freetoken', 'gpt-oss-20b'))).toEqual({
      provider: 'freetoken',
      model: 'gpt-oss-20b',
    });
    expect(formatLocalModelRef('synapse', 'qwen3-8b')).toBe('local/synapse/qwen3-8b');
    expect(parseLocalModelRef(formatLocalModelRef('ollama', 'hf.co/user/repo:q4_K_M'))).toEqual({
      provider: 'ollama',
      model: 'hf.co/user/repo:q4_K_M',
    });
  });

  it('rejects anything that is not a local ref', () => {
    for (const ref of [
      undefined,
      '',
      'claude-sonnet-4',
      'direct/ollama-local/default',
      'project_evermind:12',
      'local/',
      'local/ollama',
      'local/ollama/',
      'local/lmstudio/foo',
    ]) {
      expect(parseLocalModelRef(ref)).toBeNull();
      expect(isLocalModelRef(ref)).toBe(false);
    }
    expect(formatLocalModelRef('ollama', 'x').startsWith(LOCAL_MODEL_PREFIX)).toBe(true);
  });
});

describe('endpoint URLs', () => {
  it('accepts the bare origin and the /v1 form identically', () => {
    for (const raw of ['http://127.0.0.1:1919', 'http://127.0.0.1:1919/', 'http://127.0.0.1:1919/v1/', '  http://127.0.0.1:1919/v1  ']) {
      expect(normalizeLocalBaseUrl(raw)).toBe('http://127.0.0.1:1919');
    }
    expect(localChatCompletionsUrl('http://127.0.0.1:1919/v1')).toBe('http://127.0.0.1:1919/v1/chat/completions');
    expect(localModelsUrl('http://127.0.0.1:11434/')).toBe('http://127.0.0.1:11434/v1/models');
  });

  it("rewrites only the shared streamer's gateway path", () => {
    expect(rewriteToLocalUrl(`http://127.0.0.1:1919${GATEWAY_COMPLETIONS_PATH}`)).toBe('http://127.0.0.1:1919/v1/chat/completions');
    expect(rewriteToLocalUrl('http://127.0.0.1:1919/v1/models')).toBe('http://127.0.0.1:1919/v1/models');
  });

  it('fences a proxy to exactly the configured chat routes, with their credential', () => {
    const endpoints = {
      ollama: { baseUrl: 'http://127.0.0.1:11434' },
      synapse: { baseUrl: 'http://127.0.0.1:11435/v1', token: 'bfi-key' },
      freetoken: { baseUrl: '' },
    };
    expect(matchLocalChatEndpoint(endpoints, 'http://127.0.0.1:11435/v1/chat/completions')).toEqual({
      provider: 'synapse',
      endpoint: { baseUrl: 'http://127.0.0.1:11435/v1', token: 'bfi-key' },
    });
    for (const url of [
      'http://127.0.0.1:11434/v1/models',
      'http://127.0.0.1:11434/api/pull',
      'http://localhost:11434/v1/chat/completions',
      'http://169.254.169.254/v1/chat/completions',
      '/v1/chat/completions',
    ]) {
      expect(matchLocalChatEndpoint(endpoints, url), url).toBeNull();
    }
  });

  it('never fences a proxy to the in-page engine — it has no server', () => {
    const endpoints = { browser: { baseUrl: BROWSER_ENGINE_BASE_URL } };
    expect(matchLocalChatEndpoint(endpoints, `${BROWSER_ENGINE_BASE_URL}/v1/chat/completions`)).toBeNull();
  });
});

describe('bfi discovery', () => {
  it('reads the loopback port and the api key bfi serve announced', () => {
    expect(parseBfiDiscovery({ port: 11435, pid: 1, version: '0.1.0', token: 'k' })).toEqual({
      baseUrl: 'http://127.0.0.1:11435',
      token: 'k',
    });
    expect(parseBfiDiscovery({ port: 11434, pid: 1, version: '0.1.0', token: '' })).toEqual({
      baseUrl: 'http://127.0.0.1:11434',
    });
  });

  it('rejects a file that names no usable port', () => {
    for (const raw of [null, 'x', {}, { port: '11434' }, { port: 0 }, { port: 70_000 }, { port: 1.5 }]) {
      expect(parseBfiDiscovery(raw)).toBeNull();
    }
  });
});

describe('probeLocalRuntimes', () => {
  it('maps /v1/models to refs, sends the bearer, and skips blank endpoints', async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
      expect(url).toBe('http://127.0.0.1:11435/v1/models');
      expect(init?.headers).toEqual(expect.objectContaining({ authorization: 'Bearer desk' }));
      return json({ data: [{ id: 'qwen3-8b', owned_by: 'bfi' }, { id: 42 }] });
    });
    const probes = await probeLocalRuntimes(fetchImpl, {
      synapse: { baseUrl: 'http://127.0.0.1:11435/v1', token: 'desk' },
      ollama: { baseUrl: '' },
      'kimi-code': { baseUrl: 'https://api.kimi.com/coding/v1' },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(probes).toEqual([
      {
        provider: 'synapse',
        endpoint: { baseUrl: 'http://127.0.0.1:11435/v1', token: 'desk' },
        reachable: true,
        // bfi grammar-constrains tools for every model it serves.
        models: [{ ref: 'local/synapse/qwen3-8b', provider: 'synapse', model: 'qwen3-8b', tools: true }],
      },
    ]);
  });

  it('never probes the in-page engine over HTTP, even with an endpoint', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => json({ data: [{ id: 'gemini-nano' }] }));
    const probes = await probeLocalRuntimes(fetchImpl, { browser: { baseUrl: BROWSER_ENGINE_BASE_URL } });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(probes).toEqual([]);
  });

  it('reads a dead, failing or malformed runtime as unreachable, never throwing', async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url) => {
      if (url.includes('11434')) throw new TypeError('fetch failed');
      if (url.includes('1919')) return new Response('nope', { status: 500 });
      return new Response('not json', { status: 200 });
    });
    const probes = await probeLocalRuntimes(fetchImpl, {
      ollama: { baseUrl: 'http://127.0.0.1:11434' },
      freetoken: { baseUrl: 'http://127.0.0.1:1919' },
      synapse: { baseUrl: 'http://127.0.0.1:2000' },
    });
    expect(probes.map((p) => [p.provider, p.reachable, p.models.length])).toEqual([
      ['synapse', false, 0],
      ['ollama', false, 0],
      ['freetoken', false, 0],
    ]);
  });

  it("learns Ollama tool support and context from /api/show, and drops embedding-only models", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
      if (url.endsWith('/v1/models')) return json({ data: [{ id: 'qwen3:8b' }, { id: 'gemma:2b' }, { id: 'nomic-embed-text' }, { id: 'old' }] });
      const { model } = JSON.parse(String(init?.body)) as { model: string };
      if (model === 'qwen3:8b') return json({ capabilities: ['completion', 'tools'], model_info: { 'qwen3.context_length': 40_960 } });
      if (model === 'gemma:2b') return json({ capabilities: ['completion'] });
      if (model === 'nomic-embed-text') return json({ capabilities: ['embedding'] });
      return new Response('', { status: 404 });
    });
    const [ollama] = await probeLocalRuntimes(fetchImpl, { ollama: { baseUrl: 'http://127.0.0.1:11434' } }, { capabilities: true });
    expect(ollama!.models).toEqual([
      { ref: 'local/ollama/qwen3:8b', provider: 'ollama', model: 'qwen3:8b', tools: true, contextTokens: 40_960 },
      { ref: 'local/ollama/gemma:2b', provider: 'ollama', model: 'gemma:2b' },
      // No card at all: listed, but never trusted with tools.
      { ref: 'local/ollama/old', provider: 'ollama', model: 'old' },
    ]);
  });

  it('asks for no capability cards unless the caller needs them', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => json({ data: [{ id: 'a' }, { id: 'b' }] }));
    await probeLocalRuntimes(fetchImpl, { ollama: { baseUrl: 'http://127.0.0.1:11434' } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not list bfi's models twice when bfi answers on the Ollama port", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => json({ data: [{ id: 'qwen3-8b', owned_by: 'bfi' }] }));
    const both = await probeLocalRuntimes(fetchImpl, {
      ollama: { baseUrl: 'http://127.0.0.1:11434' },
      synapse: { baseUrl: 'http://127.0.0.1:11434' },
    });
    expect(both.flatMap((p) => p.models.map((m) => m.ref))).toEqual(['local/synapse/qwen3-8b']);
    // Synapse not configured (e.g. a browser that cannot read bfi.json): still servable.
    const ollamaOnly = await probeLocalRuntimes(fetchImpl, { ollama: { baseUrl: 'http://127.0.0.1:11434' } });
    expect(ollamaOnly.flatMap((p) => p.models.map((m) => m.ref))).toEqual(['local/ollama/qwen3-8b']);
  });
});

describe('createLocalRuntimeProber', () => {
  it('memoizes within the TTL, re-probes on fresh, expiry or a settings change', async () => {
    let t = 0;
    const fetchImpl = vi.fn<FetchLike>(async () => json({ data: [{ id: 'm' }] }));
    const prober = createLocalRuntimeProber(fetchImpl, { ttlMs: 1_000, now: () => t });
    const a = { ollama: { baseUrl: 'http://127.0.0.1:11434' } };
    await prober.probe(a);
    await prober.probe(a);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await prober.probe(a, { fresh: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    t = 2_000;
    await prober.probe(a);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await prober.probe({ ollama: { baseUrl: 'http://127.0.0.1:11999' } });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    prober.invalidate();
    await prober.probe({ ollama: { baseUrl: 'http://127.0.0.1:11999' } });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });
});
