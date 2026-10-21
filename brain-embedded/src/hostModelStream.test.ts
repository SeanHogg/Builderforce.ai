import { describe, expect, it, vi } from 'vitest';
import type { LocalRuntimeProbe } from '@builderforce/local-inference';
import type { BrainStreamFn } from './brainRunStore';
import { BrainRequestError } from './chatError';
import { createHostModelStream } from './hostModelStream';
import type { LocalSuccessSnapshot, LocalSuccessStore } from './localSuccess/localSuccessRouter';
import type { LocalSuccessFederation, LocalSuccessFleetHead } from './localSuccess/localSuccessFederation';

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

  it('sends a HOST-pinned gateway model first (Hybrid: never hard-pinned), and leaves a call-named model as the caller sent it', async () => {
    const { cloud, calls } = fakeCloud();
    const pinned = createHostModelStream({ pinned: () => 'anthropic/claude-sonnet-4', cloud: () => cloud });
    await pinned(hello);
    expect(calls[0]).toMatchObject({ model: 'anthropic/claude-sonnet-4', modelStrict: false });
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

  describe('inference mode', () => {
    it('Local only never builds a cloud stream, and fails no_local_model with nothing local', async () => {
      const cloudFactory = vi.fn(() => fakeCloud().cloud);
      const stream = createHostModelStream({ mode: () => 'local-only', probes: async () => [], cloud: cloudFactory, signedIn: () => true });
      await expect(stream(hello)).rejects.toThrow('no_local_model');
      expect(cloudFactory).not.toHaveBeenCalled();
    });

    it('Local only fails no_local_model signed out too — never not_signed_in', async () => {
      const stream = createHostModelStream({ mode: () => 'local-only', probes: async () => [], cloud: () => null, signedIn: () => false });
      await expect(stream(hello)).rejects.toThrow('no_local_model');
    });

    it('Local only sets a gateway pin aside and serves the turn on the device', async () => {
      const fetchImpl = vi.fn(async () => sse('from-device'));
      const { cloud, calls } = fakeCloud();
      const stream = createHostModelStream({
        mode: () => 'local-only',
        pinned: () => 'anthropic/claude-sonnet-4',
        probes: async () => [ollama],
        cloud: () => cloud,
        fetch: fetchImpl,
        fit: async (m) => m,
      });
      expect((await stream(hello)).resolvedModel).toBe('local/ollama/gemma:2b');
      expect((await stream({ ...hello, model: 'openai/gpt-5', modelStrict: true })).resolvedModel).toBe('local/ollama/gemma:2b');
      expect((await stream({ ...hello, routingMode: 'byo_pool' })).resolvedModel).toBe('local/ollama/gemma:2b');
      expect(calls).toEqual([]);
    });

    it('Local only refuses a runtime that leaves the device (registry onDevice: false — Kimi Code)', async () => {
      const kimiFetch = vi.fn(async () => sse('from-kimi'));
      const localPin = vi.fn(() => ({ endpoint: { baseUrl: 'https://api.kimi.com/coding/v1' }, model: 'kimi-k2' }));
      const offline = createHostModelStream({
        mode: () => 'local-only',
        pinned: () => 'local/kimi-code/kimi-k2',
        localPin,
        probes: async () => [],
        cloud: () => null,
        fetch: kimiFetch,
        fit: async (m) => m,
      });
      await expect(offline(hello)).rejects.toThrow('no_local_model');
      await expect(offline({ ...hello, model: 'local/kimi-code/kimi-k2' })).rejects.toThrow('no_local_model');
      expect(kimiFetch).not.toHaveBeenCalled();
      const withDevice = createHostModelStream({
        mode: () => 'local-only',
        pinned: () => 'local/kimi-code/kimi-k2',
        localPin,
        probes: async () => [ollama],
        cloud: () => null,
        fetch: vi.fn(async () => sse('from-device')),
        fit: async (m) => m,
      });
      expect((await withDevice(hello)).resolvedModel).toBe('local/ollama/gemma:2b');
    });

    it('a signed-in person whose cloud route is unavailable never sees the sign-in prompt', async () => {
      const stream = createHostModelStream({ mode: () => 'hybrid', probes: async () => [], cloud: () => null, signedIn: () => true });
      await expect(stream(hello)).rejects.toThrow('no_local_model');
      const probed = createHostModelStream({
        mode: () => 'hybrid',
        probes: async () => [{ ...ollama, models: [] }],
        cloud: () => null,
        signedIn: () => true,
      });
      await expect(probed(hello)).rejects.toThrow('no_local_model');
    });

    it('signed out on Hybrid with nothing local still asks for sign-in', async () => {
      const stream = createHostModelStream({ mode: () => 'hybrid', probes: async () => [], cloud: () => null, signedIn: () => false });
      await expect(stream(hello)).rejects.toThrow('not_signed_in');
    });

    it('Specific: the host pin wins', async () => {
      const { cloud, calls } = fakeCloud();
      const stream = createHostModelStream({ mode: () => 'specific', pinned: () => 'anthropic/claude-sonnet-4', probes: async () => [ollama], cloud: () => cloud });
      await stream(hello);
      expect(calls[0]).toMatchObject({ model: 'anthropic/claude-sonnet-4', modelStrict: true });
    });
  });

  /**
   * The operator's four rows — where Hybrid and Specific differ. The person's pick is the
   * host pin, or the model a call names STRICTLY (how the web app and the editor carry it).
   */
  describe('Hybrid vs Specific', () => {
    const failingCloud = () => {
      const calls: Array<Parameters<BrainStreamFn>[0]> = [];
      const cloud: BrainStreamFn = async (opts) => {
        calls.push(opts);
        // A 503 — transport-class, so Hybrid may fall back from it.
        if (opts.model) throw new BrainRequestError('pinned model unavailable', { status: 503 });
        return { text: 'from-auto', toolCalls: [] } as unknown as Awaited<ReturnType<BrainStreamFn>>;
      };
      return { cloud, calls };
    };

    it('Hybrid + Auto (no pick): local first, then the gateway', async () => {
      const fetchImpl = vi.fn(async () => sse('from-device'));
      const { cloud, calls } = fakeCloud();
      const stream = createHostModelStream({ mode: () => 'hybrid', probes: async () => [ollama], cloud: () => cloud, fetch: fetchImpl, fit: async (m) => m });
      expect((await stream(hello)).resolvedModel).toBe('local/ollama/gemma:2b');
      expect(calls).toEqual([]);
      const down = createHostModelStream({
        mode: () => 'hybrid',
        probes: async () => [ollama],
        cloud: () => cloud,
        fetch: vi.fn(async () => new Response('down', { status: 503 })),
        fit: async (m) => m,
      });
      expect((await down(hello)).text).toBe('from-cloud');
      expect(calls).toHaveLength(1);
    });

    it('Hybrid + a pick: the pick first, NOT hard-pinned; a failed pick falls back to the local engine, then the gateway on Auto', async () => {
      const { cloud, calls } = failingCloud();
      const fetchImpl = vi.fn(async () => sse('from-device'));
      const stream = createHostModelStream({ mode: () => 'hybrid', probes: async () => [ollama], cloud: () => cloud, fetch: fetchImpl, fit: async (m) => m });
      // The web app / editor carry the pick on the call, strictly.
      const result = await stream({ ...hello, model: 'anthropic/claude-sonnet-4', modelStrict: true });
      expect(calls[0]).toMatchObject({ model: 'anthropic/claude-sonnet-4', modelStrict: false });
      expect(result.resolvedModel).toBe('local/ollama/gemma:2b');
      // Nothing local either: Auto at the gateway, with the pick and its strictness dropped.
      const gatewayOnly = createHostModelStream({ mode: () => 'hybrid', pinned: () => 'anthropic/claude-sonnet-4', probes: async () => [], cloud: () => cloud });
      expect((await gatewayOnly(hello)).text).toBe('from-auto');
      expect(calls.at(-1)!.model).toBeUndefined();
      expect(calls.at(-1)!.modelStrict).toBeUndefined();
      // No routingMode at all — never stamped 'auto' — so the gateway applies the
      // ACCOUNT's cloud funding order.
      expect(calls.at(-1)!.routingMode).toBeUndefined();
      expect('routingMode' in calls.at(-1)!).toBe(false);
    });

    it('Hybrid + a pick refused 401 or 402 is TERMINAL — no fallback, the remedy banner shows', async () => {
      for (const status of [401, 402, 403]) {
        const calls: Array<Parameters<BrainStreamFn>[0]> = [];
        const cloud: BrainStreamFn = async (opts) => {
          calls.push(opts);
          if (opts.model) throw new BrainRequestError(`refused ${status}`, { status });
          return { text: 'from-auto', toolCalls: [] } as unknown as Awaited<ReturnType<BrainStreamFn>>;
        };
        const onFallback = vi.fn();
        const stream = createHostModelStream({ mode: () => 'hybrid', pinned: () => 'anthropic/claude-sonnet-4', probes: async () => [], cloud: () => cloud, onFallback });
        await expect(stream(hello)).rejects.toMatchObject({ status });
        expect(calls).toHaveLength(1);
        expect(onFallback).not.toHaveBeenCalled();
      }
    });

    it('Hybrid + a pick refused 503 falls back to Auto and tells the host (onFallback)', async () => {
      const { cloud, calls } = failingCloud();
      const onFallback = vi.fn();
      const stream = createHostModelStream({ mode: () => 'hybrid', pinned: () => 'anthropic/claude-sonnet-4', probes: async () => [], cloud: () => cloud, onFallback });
      expect((await stream(hello)).text).toBe('from-auto');
      expect(calls).toHaveLength(2);
      expect(onFallback).toHaveBeenCalledTimes(1);
      expect(onFallback).toHaveBeenCalledWith({ from: 'anthropic/claude-sonnet-4', reason: 'pinned model unavailable' });
    });

    it('Hybrid + a pick whose plain (non-transport) error is terminal — never a silent swap', async () => {
      const calls: Array<Parameters<BrainStreamFn>[0]> = [];
      const cloud: BrainStreamFn = async (opts) => {
        calls.push(opts);
        throw new Error('byo key rejected');
      };
      const onFallback = vi.fn();
      const stream = createHostModelStream({ mode: () => 'hybrid', pinned: () => 'anthropic/claude-sonnet-4', probes: async () => [], cloud: () => cloud, onFallback });
      await expect(stream(hello)).rejects.toThrow('byo key rejected');
      expect(calls).toHaveLength(1);
      expect(onFallback).not.toHaveBeenCalled();
    });

    it('Hybrid + a pick that already streamed owns the turn — no second answer', async () => {
      const cloud: BrainStreamFn = async (_opts, handlers) => {
        handlers?.onTextDelta?.('partial');
        throw new Error('dropped mid-stream');
      };
      const stream = createHostModelStream({ mode: () => 'hybrid', pinned: () => 'anthropic/claude-sonnet-4', probes: async () => [ollama], cloud: () => cloud, fetch: vi.fn(async () => sse('from-device')) });
      await expect(stream(hello, { onTextDelta: () => {} })).rejects.toThrow('dropped mid-stream');
    });

    it('Specific + a pick: exactly the pinned route, modelStrict, no local attempt and no fallback', async () => {
      const { cloud, calls } = failingCloud();
      const fetchImpl = vi.fn(async () => sse('from-device'));
      const probes = vi.fn(async () => [ollama]);
      const stream = createHostModelStream({ mode: () => 'specific', probes, cloud: () => cloud, fetch: fetchImpl, fit: async (m) => m });
      await expect(stream({ ...hello, model: 'anthropic/claude-sonnet-4', modelStrict: true })).rejects.toThrow('pinned model unavailable');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ model: 'anthropic/claude-sonnet-4', modelStrict: true });
      expect(probes).not.toHaveBeenCalled();
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('Specific with no pick fails no_specific_model — never a silent Hybrid', async () => {
      const { cloud, calls } = fakeCloud();
      const probes = vi.fn(async () => [ollama]);
      const stream = createHostModelStream({ mode: () => 'specific', probes, cloud: () => cloud, signedIn: () => true });
      await expect(stream(hello)).rejects.toThrow('no_specific_model');
      // A model the call names WITHOUT strictness (a project pin, a failover) is not the person's pick.
      await expect(stream({ ...hello, model: 'openai/gpt-5' })).rejects.toThrow('no_specific_model');
      expect(calls).toEqual([]);
      expect(probes).not.toHaveBeenCalled();
      // "Use my connected accounts" is a pick of the BYO pool: exactly that, at the gateway.
      await stream({ ...hello, routingMode: 'byo_pool' });
      expect(calls).toHaveLength(1);
      expect(calls[0]!.routingMode).toBe('byo_pool');
    });
  });
});

describe("createHostModelStream — Hybrid's run.local-success predictor", () => {
  /** A trusted head that says every turn FAILS locally (P(succeeds) ≈ 0.25%). */
  const failsHead: LocalSuccessSnapshot = {
    v: 1,
    outcomes: [],
    head: { params: [...Array<number>(18).fill(0), 3, -3], holdoutLoss: 0.1, samples: 40 },
  };

  function memoryStore(initial?: LocalSuccessSnapshot): LocalSuccessStore & { saved: () => LocalSuccessSnapshot | undefined } {
    let saved: LocalSuccessSnapshot | undefined;
    return { load: () => initial, save: (s) => { saved = s; }, saved: () => saved };
  }

  const settled = async (store: { saved: () => LocalSuccessSnapshot | undefined }) => {
    await vi.waitFor(() => expect(store.saved()).toBeDefined());
    return store.saved()!.outcomes;
  };

  it("Hybrid Auto: skips a local attempt the predictor is confident fails, and records the cloud's result", async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const fetchImpl = vi.fn(async () => sse('from-device'));
      const { cloud, calls } = fakeCloud();
      const store = memoryStore(failsHead);
      const stream = createHostModelStream({ mode: () => 'hybrid', probes: async () => [ollama], cloud: () => cloud, fetch: fetchImpl, fit: async (m) => m, localSuccess: store });
      expect((await stream(hello)).text).toBe('from-cloud');
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(calls).toHaveLength(1);
      const [outcome] = await settled(store);
      expect(outcome).toMatchObject({ ref: 'local/ollama/gemma:2b', cloud: 'succeeded' });
      expect(outcome!.local).toBeUndefined();
    } finally {
      random.mockRestore();
    }
  });

  it("cold start tries local (today's behaviour) and records the local success as a label", async () => {
    const fetchImpl = vi.fn(async () => sse('from-device'));
    const { cloud, calls } = fakeCloud();
    const store = memoryStore();
    const stream = createHostModelStream({ mode: () => 'hybrid', probes: async () => [ollama], cloud: () => cloud, fetch: fetchImpl, fit: async (m) => m, localSuccess: store });
    expect((await stream(hello)).resolvedModel).toBe('local/ollama/gemma:2b');
    expect(calls).toEqual([]);
    expect((await settled(store))[0]).toMatchObject({ ref: 'local/ollama/gemma:2b', local: 'succeeded' });
  });

  it("records a local failure that fell back to the gateway as the local model's failure", async () => {
    const { cloud } = fakeCloud();
    const store = memoryStore();
    const stream = createHostModelStream({
      mode: () => 'hybrid',
      probes: async () => [ollama],
      cloud: () => cloud,
      fetch: vi.fn(async () => new Response('down', { status: 503 })),
      fit: async (m) => m,
      localSuccess: store,
    });
    expect((await stream(hello)).text).toBe('from-cloud');
    expect((await settled(store))[0]).toMatchObject({ local: 'failed', fellBack: true, cloud: 'succeeded' });
  });

  it('Local only never consults it — on this device local is the only option', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const fetchImpl = vi.fn(async () => sse('from-device'));
      const store = memoryStore(failsHead);
      const stream = createHostModelStream({ mode: () => 'local-only', probes: async () => [ollama], cloud: () => null, fetch: fetchImpl, fit: async (m) => m, localSuccess: store });
      expect((await stream(hello)).resolvedModel).toBe('local/ollama/gemma:2b');
      expect(store.saved()).toBeUndefined();
    } finally {
      random.mockRestore();
    }
  });

  it('a pick is never second-guessed: Hybrid with a local pick runs it', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const fetchImpl = vi.fn(async () => sse('from-device'));
      const { cloud, calls } = fakeCloud();
      const stream = createHostModelStream({
        mode: () => 'hybrid',
        pinned: () => 'local/ollama/gemma:2b',
        localPin: () => ({ endpoint: ollama.endpoint, model: 'gemma:2b' }),
        probes: async () => [ollama],
        cloud: () => cloud,
        fetch: fetchImpl,
        fit: async (m) => m,
        localSuccess: memoryStore(failsHead),
      });
      expect((await stream(hello)).resolvedModel).toBe('local/ollama/gemma:2b');
      expect(calls).toEqual([]);
    } finally {
      random.mockRestore();
    }
  });
});

describe('createHostModelStream — federating the run.local-success head', () => {
  const store = (): LocalSuccessStore => ({ load: () => undefined, save: () => undefined });
  const fleet = () => ({
    pull: vi.fn(async (_projectId: number): Promise<LocalSuccessFleetHead | null> => null),
    push: vi.fn(async (_projectId: number, _contribution: unknown): Promise<void> => undefined),
  });
  const inProject = { ...hello, metadata: { projectId: 7 } };

  function stream(input: { mode: 'hybrid' | 'local-only' | 'specific'; signedIn: boolean; federation: LocalSuccessFederation; pinned?: string }) {
    const { cloud } = fakeCloud();
    return createHostModelStream({
      mode: () => input.mode,
      signedIn: () => input.signedIn,
      probes: async () => [ollama],
      cloud: () => (input.mode === 'local-only' ? null : cloud),
      fetch: vi.fn(async () => sse('from-device')),
      fit: async (m) => m,
      localSuccess: store(),
      localSuccessFederation: input.federation,
      ...(input.pinned ? { pinned: () => input.pinned } : {}),
    });
  }

  it("a signed-in Hybrid turn in a project refreshes its project's fleet head", async () => {
    const federation = fleet();
    await stream({ mode: 'hybrid', signedIn: true, federation })(inProject);
    await vi.waitFor(() => expect(federation.pull).toHaveBeenCalledWith(7));
  });

  it('never federates anonymous, Local only, Specific, or a turn with no project', async () => {
    const cases = [
      { mode: 'hybrid' as const, signedIn: false, call: inProject },
      { mode: 'local-only' as const, signedIn: true, call: inProject },
      { mode: 'specific' as const, signedIn: true, call: inProject, pinned: 'openai/gpt-5' },
      { mode: 'hybrid' as const, signedIn: true, call: hello },
    ];
    for (const c of cases) {
      const federation = fleet();
      await stream({ mode: c.mode, signedIn: c.signedIn, federation, ...(c.pinned ? { pinned: c.pinned } : {}) })(c.call);
      await new Promise((r) => setTimeout(r, 0));
      expect(federation.pull).not.toHaveBeenCalled();
      expect(federation.push).not.toHaveBeenCalled();
    }
  });
});
