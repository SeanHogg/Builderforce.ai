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
