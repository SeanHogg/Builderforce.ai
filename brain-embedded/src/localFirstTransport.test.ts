import { afterEach, describe, expect, it, vi } from 'vitest';
import { GATEWAY_COMPLETIONS_PATH, type LocalRuntimeProbe } from '@builderforce/local-inference';
import type { BrainStreamFn } from './brainRunStore';
import { localFallbackTrace } from './localFirstTraces';
import {
  completeLocal,
  completeLocalFirst,
  createLocalFirstStream,
  localTransport,
} from './localFirstTransport';

/**
 * The shared streamer bound to a runtime on the user's machine. Load-bearing:
 *
 *  - the transport must rewrite the streamer's hard-coded gateway path onto the
 *    runtime's plain OpenAI route, and send NO bearer for an on-device engine. If
 *    `streamChatCompletion` ever changes that path, `GATEWAY_COMPLETIONS_PATH` stops
 *    matching and this suite fails — the alternative is a silent 404 per turn;
 *  - local first must fall over to the gateway INVISIBLY and FAST: a dead runtime must
 *    not ride the streamer's half-minute connect-retry before the cloud answers.
 */

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('localTransport', () => {
  it('sends no bearer for an on-device engine and rewrites through its fetch', async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (input: string) => {
      seen.push(input);
      return new Response('{}', { status: 200 });
    });
    const transport = localTransport({ baseUrl: 'http://127.0.0.1:1919/v1' }, fetchImpl);
    // Null (not "") is what makes the streamer omit the header outright.
    expect(transport.getToken()).toBeNull();
    expect(transport.baseUrl).toBe('http://127.0.0.1:1919');
    await transport.fetch?.(`${transport.baseUrl}${GATEWAY_COMPLETIONS_PATH}`, {});
    expect(seen).toEqual(['http://127.0.0.1:1919/v1/chat/completions']);
  });

  it("carries an endpoint's own credential (Kimi, bfi --api-key)", () => {
    expect(localTransport({ baseUrl: 'https://api.kimi.com/coding/v1', token: 'kc-token' }).getToken()).toBe('kc-token');
  });

  it('authenticates the non-streaming path too', async () => {
    let seen: Record<string, string> = {};
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      seen = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    });
    await expect(
      completeLocal({ baseUrl: 'https://api.kimi.com/coding/v1', token: 'kc-token' }, 'k3', [{ role: 'user', content: 'hi' }], undefined, fetchImpl),
    ).resolves.toBe('ok');
    expect(seen.authorization).toBe('Bearer kc-token');
  });
});

describe('createLocalFirstStream', () => {
  const probes: LocalRuntimeProbe[] = [
    {
      provider: 'synapse',
      endpoint: { baseUrl: 'http://127.0.0.1:11435', token: 'bfi-key' },
      reachable: true,
      models: [{ ref: 'local/synapse/qwen3-8b', provider: 'synapse', model: 'qwen3-8b', tools: true }],
    },
    {
      provider: 'ollama',
      endpoint: { baseUrl: 'http://127.0.0.1:11434' },
      reachable: true,
      models: [{ ref: 'local/ollama/gemma:2b', provider: 'ollama', model: 'gemma:2b' }],
    },
  ];
  const hello = { messages: [{ role: 'user' as const, content: 'hello' }] };
  const toolTurn = {
    messages: [{ role: 'user' as const, content: 'edit it' }],
    tools: [{ type: 'function' as const, function: { name: 'edit_file', description: 'edit', parameters: {} } }],
  };
  const sse = (text: string): Response =>
    new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  const cloudStream = () => vi.fn<BrainStreamFn>(async () => ({ text: 'from-cloud', toolCalls: [], finishReason: 'stop' }));

  it('serves on this machine, reports the local ref as the model, and records no fallback', async () => {
    const seen: Array<{ url: string; model: string; auth?: string }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      seen.push({ url, model: (JSON.parse(String(init.body)) as { model: string }).model, auth: headers.Authorization });
      return sse('hi');
    });
    const cloud = cloudStream();
    const onModel = vi.fn();
    const result = await createLocalFirstStream({ probes, cloud, fetch: fetchImpl })(hello, { onModel });

    expect(result.text).toBe('hi');
    expect(result.resolvedModel).toBe('local/synapse/qwen3-8b');
    expect(result.localFirst).toEqual([{ target: 'local/synapse/qwen3-8b', outcome: 'served' }]);
    expect(localFallbackTrace('t', 1, result.localFirst)).toBeNull();
    expect(cloud).not.toHaveBeenCalled();
    expect(seen).toEqual([{ url: 'http://127.0.0.1:11435/v1/chat/completions', model: 'qwen3-8b', auth: 'Bearer bfi-key' }]);
    expect(onModel).toHaveBeenCalledWith('local/synapse/qwen3-8b', undefined);
  });

  it('fails over at once when the runtime is not running, and says so in the trace', async () => {
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED', syscall: 'connect' }),
    });
    const fetchImpl = vi.fn(async () => {
      throw refused;
    });
    const cloud = cloudStream();
    const result = await createLocalFirstStream({ probes, cloud, fetch: fetchImpl })(hello);
    expect(result.text).toBe('from-cloud');
    // One try, no connect-retry backoff.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const trace = localFallbackTrace('t', 3, result.localFirst);
    expect(trace).toMatchObject({
      category: 'message',
      label: 'llm.local_fallback',
      args: { step: 3, from: 'local/synapse/qwen3-8b', to: 'gateway' },
    });
    // Summaries only — the runtime's bearer never reaches a persisted step.
    expect(JSON.stringify(trace)).not.toContain('bfi-key');
  });

  it('fails over on an HTTP error or an empty answer', async () => {
    for (const local of [new Response('model not found', { status: 404 }), new Response('data: [DONE]\n\n', { status: 200 })]) {
      const cloud = cloudStream();
      const result = await createLocalFirstStream({ probes, cloud, fetch: vi.fn(async () => local) })(hello);
      expect(result.text).toBe('from-cloud');
      expect(result.localFirst?.map((a) => a.outcome)).toEqual([expect.stringMatching(/^(failed|refused)$/), 'served']);
    }
  });

  it('sends a tool turn straight to the gateway when no local model reports tools', async () => {
    const fetchImpl = vi.fn(async () => sse('never'));
    const cloud = cloudStream();
    await createLocalFirstStream({ probes: probes.slice(1), cloud, fetch: fetchImpl })(toolTurn);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(cloud).toHaveBeenCalledTimes(1);
  });

  it('signed out with nothing local that fits, asks for sign-in like a gateway route', async () => {
    await expect(createLocalFirstStream({ probes: probes.slice(1), cloud: null, fetch: vi.fn() })(toolTurn)).rejects.toThrow(
      'not_signed_in',
    );
  });
});

describe('completeLocalFirst', () => {
  it('falls over to the cloud completion when the local runtime fails', async () => {
    const cloud = vi.fn(async () => 'summary-from-cloud');
    const probes: LocalRuntimeProbe[] = [
      {
        provider: 'ollama',
        endpoint: { baseUrl: 'http://127.0.0.1:11434' },
        reachable: true,
        models: [{ ref: 'local/ollama/gemma:2b', provider: 'ollama', model: 'gemma:2b' }],
      },
    ];
    await expect(
      completeLocalFirst({
        probes,
        messages: [{ role: 'user', content: 'summarize' }],
        cloud,
        fetch: vi.fn(async () => {
          throw new TypeError('fetch failed');
        }),
      }),
    ).resolves.toBe('summary-from-cloud');
    expect(cloud).toHaveBeenCalledTimes(1);
  });
});
