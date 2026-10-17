import { describe, expect, it, vi } from 'vitest';
import type { LocalRuntimeProbe, LocalRuntimeProber } from '@builderforce/local-inference';
import { loopbackEndpoints, resolveLoopbackProbes, SYNAPSE_DEFAULT_URL } from './localRuntimes';
import { createRovrStream } from './route';

const BASE = 'https://builderforce.ai/gateway';

const sse = (text: string): Response =>
  new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });

const prober = (probes: LocalRuntimeProbe[]): LocalRuntimeProber => ({ probe: async () => probes, invalidate: () => undefined });

const ollama: LocalRuntimeProbe = {
  provider: 'ollama',
  endpoint: { baseUrl: 'http://127.0.0.1:11434' },
  reachable: true,
  models: [{ ref: 'local/ollama/gemma:2b', provider: 'ollama', model: 'gemma:2b' }],
};
const nothing: LocalRuntimeProbe[] = [{ provider: 'ollama', endpoint: { baseUrl: 'http://127.0.0.1:11434' }, reachable: false, models: [] }];
const hello = { messages: [{ role: 'user' as const, content: 'hello' }] };

function route(probes: LocalRuntimeProbe[], key: string | null) {
  const seen: Array<{ url: string; auth?: string }> = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    seen.push({ url, auth: (init.headers as Record<string, string>).Authorization });
    return sse(url.startsWith(BASE) ? 'from-cloud' : 'from-device');
  });
  const stream = createRovrStream({ baseUrl: BASE, fetch: fetchImpl, prober: prober(probes), endpoints: async () => loopbackEndpoints(null), key: async () => key });
  return { stream, seen };
}

describe('Rovr model route — local first, failover to the gateway', () => {
  it('serves a turn on this device, with no account and no bearer', async () => {
    const { stream, seen } = route([ollama], null);
    const result = await stream(hello);
    expect(result.text).toBe('from-device');
    expect(result.resolvedModel).toBe('local/ollama/gemma:2b');
    expect(seen).toEqual([{ url: 'http://127.0.0.1:11434/v1/chat/completions', auth: undefined }]);
  });

  it('uses the gateway with the signed-in key when nothing local is running', async () => {
    const { stream, seen } = route(nothing, 'bfk_test');
    const result = await stream(hello);
    expect(result.text).toBe('from-cloud');
    expect(seen).toEqual([{ url: `${BASE}/llm/v1/chat/completions`, auth: 'Bearer bfk_test' }]);
  });

  it('sends a tool turn to the gateway when no local model can take tools', async () => {
    const { stream, seen } = route([ollama], 'bfk_test');
    await stream({ ...hello, tools: [{ type: 'function', function: { name: 'browser_click', description: 'click', parameters: {} } }] });
    expect(seen.map((s) => s.url)).toEqual([`${BASE}/llm/v1/chat/completions`]);
  });

  it("serves a chat turn on the browser's own model through the page fetch, never a tool turn", async () => {
    const page: LocalRuntimeProbe = {
      provider: 'browser',
      endpoint: { baseUrl: 'http://browser.local' },
      reachable: true,
      models: [{ ref: 'local/browser/gemini-nano', provider: 'browser', model: 'gemini-nano', tools: false }],
    };
    const pageFetch = vi.fn(async (url: string) => sse(url.startsWith('http://browser.local') ? 'from-page' : 'from-cloud'));
    const gateway = vi.fn(async () => sse('from-cloud'));
    const stream = createRovrStream({
      baseUrl: BASE,
      fetch: gateway,
      prober: prober(nothing),
      endpoints: async () => loopbackEndpoints(null),
      key: async () => 'bfk_test',
      page: { probe: async () => [page], fetch: pageFetch },
    });
    const chat = await stream(hello);
    expect(chat.text).toBe('from-page');
    expect(chat.resolvedModel).toBe('local/browser/gemini-nano');
    expect(pageFetch).toHaveBeenCalledWith('http://browser.local/v1/chat/completions', expect.anything());
    const tool = await stream({ ...hello, tools: [{ type: 'function', function: { name: 'browser_click', description: 'click', parameters: {} } }] });
    expect(tool.text).toBe('from-cloud');
    expect(pageFetch).toHaveBeenCalledTimes(1);
  });

  it('serves a PINNED page model through the page fetch, tool turns included, without probing or the gateway', async () => {
    const ref = 'local/bfi/bonsai-8b-q1_0';
    const pageFetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body)).model).toBe('bonsai-8b-q1_0');
      return sse(url === 'http://bfi.local/v1/chat/completions' ? 'from-bonsai' : 'wrong-route');
    });
    const gateway = vi.fn(async () => sse('from-cloud'));
    const probePage = vi.fn(async () => []);
    const probeHttp = vi.fn(async () => nothing);
    const stream = createRovrStream({
      baseUrl: BASE,
      fetch: gateway,
      prober: { probe: probeHttp, invalidate: () => undefined },
      endpoints: async () => loopbackEndpoints(null),
      key: async () => 'bfk_test',
      page: { probe: probePage, fetch: pageFetch },
      pinned: async () => ref,
    });
    const chat = await stream(hello);
    expect(chat.text).toBe('from-bonsai');
    expect(chat.resolvedModel).toBe(ref);
    const tool = await stream({ ...hello, tools: [{ type: 'function', function: { name: 'browser_click', description: 'click', parameters: {} } }] });
    expect(tool.text).toBe('from-bonsai');
    expect(pageFetch).toHaveBeenCalledTimes(2);
    expect(gateway).not.toHaveBeenCalled();
    expect(probePage).not.toHaveBeenCalled();
    expect(probeHttp).not.toHaveBeenCalled();
  });

  it('routes automatically when the pin is not a page model', async () => {
    const { stream, seen } = (() => {
      const seenUrls: string[] = [];
      const fetchImpl = vi.fn(async (url: string) => {
        seenUrls.push(url);
        return sse('from-device');
      });
      const s = createRovrStream({
        baseUrl: BASE,
        fetch: fetchImpl,
        prober: prober([ollama]),
        endpoints: async () => loopbackEndpoints(null),
        key: async () => null,
        page: { probe: async () => [], fetch: fetchImpl },
        pinned: async () => null,
      });
      return { stream: s, seen: seenUrls };
    })();
    await stream(hello);
    expect(seen).toEqual(['http://127.0.0.1:11434/v1/chat/completions']);
  });

  it('sends a PINNED gateway model straight to the gateway, hard-pinned and tagged rovr', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const headers: Array<Record<string, string>> = [];
    const gateway = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      headers.push(init.headers as Record<string, string>);
      return sse('from-cloud');
    });
    const probeHttp = vi.fn(async () => [ollama]);
    const stream = createRovrStream({
      baseUrl: BASE,
      fetch: gateway,
      prober: { probe: probeHttp, invalidate: () => undefined },
      endpoints: async () => loopbackEndpoints(null),
      key: async () => 'bfk_test',
      pinned: async () => 'anthropic/claude-sonnet-4',
    });
    const result = await stream(hello);
    expect(result.text).toBe('from-cloud');
    expect(gateway).toHaveBeenCalledWith(`${BASE}/llm/v1/chat/completions`, expect.anything());
    expect(bodies[0]!.model).toBe('anthropic/claude-sonnet-4');
    expect(headers[0]!['x-builderforce-surface']).toBe('rovr');
    expect(probeHttp).not.toHaveBeenCalled();
  });

  it('routes a pinned gateway model automatically when signed out', async () => {
    const seenUrls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      seenUrls.push(url);
      return sse('from-device');
    });
    const stream = createRovrStream({
      baseUrl: BASE,
      fetch: fetchImpl,
      prober: prober([ollama]),
      endpoints: async () => loopbackEndpoints(null),
      key: async () => null,
      pinned: async () => 'anthropic/claude-sonnet-4',
    });
    const result = await stream(hello);
    expect(result.text).toBe('from-device');
    expect(seenUrls).toEqual(['http://127.0.0.1:11434/v1/chat/completions']);
  });

  it('asks for sign-in when signed out with nothing local that fits', async () => {
    const { stream } = route(nothing, null);
    await expect(stream(hello)).rejects.toThrow('not_signed_in');
  });
});

describe('loopback runtimes', () => {
  it('probes every on-device runtime at its default port, Synapse at the bfi port or the person\'s address', () => {
    expect(loopbackEndpoints(null)).toEqual({
      synapse: { baseUrl: SYNAPSE_DEFAULT_URL },
      ollama: { baseUrl: 'http://127.0.0.1:11434' },
      freetoken: { baseUrl: 'http://127.0.0.1:1919' },
    });
    expect(loopbackEndpoints(' http://127.0.0.1:11500 ').synapse).toEqual({ baseUrl: 'http://127.0.0.1:11500' });
  });

  it('does not let Synapse claim an Ollama model found at the same address', () => {
    const synapse: LocalRuntimeProbe = {
      provider: 'synapse',
      endpoint: { baseUrl: 'http://127.0.0.1:11434' },
      reachable: true,
      models: [
        { ref: 'local/synapse/gemma:2b', provider: 'synapse', model: 'gemma:2b', tools: true },
        { ref: 'local/synapse/qwen3-8b', provider: 'synapse', model: 'qwen3-8b', tools: true },
      ],
    };
    const resolved = resolveLoopbackProbes([synapse, ollama]);
    expect(resolved.find((p) => p.provider === 'synapse')!.models.map((m) => m.model)).toEqual(['qwen3-8b']);
    expect(resolved.find((p) => p.provider === 'ollama')!.models.map((m) => m.model)).toEqual(['gemma:2b']);
  });

  it('leaves Synapse alone when it runs on its own port', () => {
    const synapse: LocalRuntimeProbe = { ...ollama, provider: 'synapse', endpoint: { baseUrl: 'http://127.0.0.1:11435' } };
    expect(resolveLoopbackProbes([synapse, ollama])).toEqual([synapse, ollama]);
  });
});
