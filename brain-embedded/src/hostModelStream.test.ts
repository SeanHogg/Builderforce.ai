import { describe, expect, it, vi } from 'vitest';
import type { LocalRuntimeProbe } from '@builderforce/local-inference';
import type { BrainStreamFn } from './brainRunStore';
import { createHostModelStream } from './hostModelStream';

/**
 * The ONE host routing step (web app, Rovr, VS Code). Load-bearing:
 *  - a local pin runs on its runtime through the host's fetch, never at the gateway;
 *  - a HOST-pinned gateway model is hard-pinned; a model the call names keeps its own flags;
 *  - with nothing probed the gateway gets the call untouched, and signed out that is
 *    `not_signed_in`; `byo_pool` never runs on the device.
 */

const sse = (text: string): Response =>
  new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });

const hello = { messages: [{ role: 'user' as const, content: 'hello' }] };

const ollama: LocalRuntimeProbe = {
  provider: 'ollama',
  endpoint: { baseUrl: 'http://127.0.0.1:11434' },
  reachable: true,
  models: [{ ref: 'local/ollama/gemma:2b', provider: 'ollama', model: 'gemma:2b' }],
};

function fakeCloud() {
  const calls: Array<Parameters<BrainStreamFn>[0]> = [];
  const cloud: BrainStreamFn = async (opts) => {
    calls.push(opts);
    return { text: 'from-cloud', toolCalls: [] } as unknown as Awaited<ReturnType<BrainStreamFn>>;
  };
  return { cloud, calls };
}

describe('createHostModelStream', () => {
  it('serves a page pin the call names through the host fetch, without probing', async () => {
    const fetchImpl = vi.fn(async (url: string) => sse(url === 'http://bfi.local/v1/chat/completions' ? 'from-bonsai' : 'wrong'));
    const probes = vi.fn(async () => [ollama]);
    const { cloud, calls } = fakeCloud();
    const stream = createHostModelStream({ cloud: () => cloud, probes, fetch: fetchImpl, fit: async (m) => m });
    const result = await stream({ ...hello, model: 'local/bfi/bonsai-8b-q1_0' });
    expect(result.text).toBe('from-bonsai');
    expect(result.resolvedModel).toBe('local/bfi/bonsai-8b-q1_0');
    expect(probes).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('hard-pins a HOST-pinned gateway model, but leaves a call-named model as the caller sent it', async () => {
    const { cloud, calls } = fakeCloud();
    const pinned = createHostModelStream({ pinned: () => 'anthropic/claude-sonnet-4', cloud: () => cloud });
    await pinned(hello);
    expect(calls[0]).toMatchObject({ model: 'anthropic/claude-sonnet-4', modelStrict: true });
    const unpinned = createHostModelStream({ cloud: () => cloud });
    await unpinned({ ...hello, model: 'openai/gpt-5' });
    expect(calls[1]!.model).toBe('openai/gpt-5');
    expect(calls[1]!.modelStrict).toBeUndefined();
  });

  it('routes a host-pinned gateway model automatically when signed out', async () => {
    const fetchImpl = vi.fn(async () => sse('from-device'));
    const stream = createHostModelStream({
      pinned: () => 'anthropic/claude-sonnet-4',
      probes: async () => [ollama],
      cloud: () => null,
      fetch: fetchImpl,
      fit: async (m) => m,
    });
    expect((await stream(hello)).resolvedModel).toBe('local/ollama/gemma:2b');
  });

  it('sends the call to the gateway untouched when nothing is probed, and asks for sign-in signed out', async () => {
    const { cloud, calls } = fakeCloud();
    await createHostModelStream({ probes: async () => [], cloud: () => cloud })(hello);
    expect(calls).toHaveLength(1);
    await expect(createHostModelStream({ probes: async () => [], cloud: () => null })(hello)).rejects.toThrow('not_signed_in');
  });

  it('never serves an explicit byo_pool call on the device', async () => {
    const fetchImpl = vi.fn(async () => sse('from-device'));
    const { cloud, calls } = fakeCloud();
    const stream = createHostModelStream({ probes: async () => [ollama], cloud: () => cloud, fetch: fetchImpl });
    await stream({ ...hello, routingMode: 'byo_pool' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it('routes a local pin this host cannot serve automatically', async () => {
    const fetchImpl = vi.fn(async () => sse('from-device'));
    const stream = createHostModelStream({
      pinned: () => 'local/bfi/bonsai-8b-q1_0',
      localPin: () => null,
      probes: async () => [ollama],
      cloud: () => null,
      fetch: fetchImpl,
      fit: async (m) => m,
    });
    expect((await stream(hello)).resolvedModel).toBe('local/ollama/gemma:2b');
  });
});
