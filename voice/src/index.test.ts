import { describe, it, expect, vi } from 'vitest';
import {
  VoiceClient,
  resolveNarrationEngine,
  getEngineUnavailableReason,
  ServerCloneProvider,
  ClientCloneProvider,
  FallbackVoiceProvider,
  VoiceApiError,
  type NarrationProvider,
} from './index';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SYNTH_OK = {
  audioUrl: 'https://r2.example/voice/abc.wav',
  audioKey: 'tenant/voice/abc.wav',
  durationMs: 1234,
  wordTimestamps: [{ word: 'hello', startMs: 0, endMs: 600 }],
};

describe('ServerCloneProvider (Option B — metered gateway path)', () => {
  it('POSTs text to /api/studio/voice-clones/:id/synthesize with bearer auth', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.builderforce.ai/api/studio/voice-clones/clone-7/synthesize');
      expect(init?.method).toBe('POST');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer clk_test');
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.text).toBe('hello world');
      expect(body.speed).toBe(1.2);
      return jsonResponse(SYNTH_OK);
    });

    const provider = new ServerCloneProvider({
      apiKey: 'clk_test',
      voiceId: 'clone-7',
      fetchFn: fetchMock as unknown as typeof fetch,
    });

    const result = await provider.synthesize({ text: 'hello world', speed: 1.2 });
    expect(result.engineId).toBe('clone-server');
    expect(result.cloned).toBe(true);
    expect(result.audioUrl).toBe(SYNTH_OK.audioUrl);
    expect(result.durationMs).toBe(1234);
    expect(result.wordTimestamps).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces a 402 entitlement denial as a VoiceApiError', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { message: 'Upgrade to Pro for Voice Cloning', code: 'pro_required' } }, 402),
    );
    const provider = new ServerCloneProvider({
      apiKey: 'clk_test',
      voiceId: 'clone-7',
      fetchFn: fetchMock as unknown as typeof fetch,
    });
    await expect(provider.synthesize({ text: 'hi' })).rejects.toBeInstanceOf(VoiceApiError);
  });
});

describe('resolveNarrationEngine + getEngineUnavailableReason (the seam)', () => {
  const fakeClient = (available: boolean): NarrationProvider => ({
    id: 'clone-client',
    isAvailable: async () => available,
    unavailableReason: async () => (available ? null : 'no WebGPU + no embedding'),
    synthesize: async () => ({
      engineId: 'clone-client',
      cloned: true,
      pcm: new Float32Array(10),
      sampleRate: 24_000,
      durationMs: 100,
      wordTimestamps: [],
    }),
  });
  const fakeServer = (available: boolean): NarrationProvider => ({
    id: 'clone-server',
    isAvailable: async () => available,
    unavailableReason: async () => (available ? null : 'not configured'),
    synthesize: async () => ({ engineId: 'clone-server', cloned: true, durationMs: 50, wordTimestamps: [] }),
  });

  it('prefers the on-device client over the server when both are available', async () => {
    const engine = await resolveNarrationEngine({
      voiceId: 'v1',
      providers: [fakeServer(true), fakeClient(true)],
    });
    expect(engine.engineId).toBe('clone-client');
    expect(engine.cloned).toBe(true);
    expect(engine.fallbackReason).toBeNull();
  });

  it('falls back to the server when the client is unavailable', async () => {
    const engine = await resolveNarrationEngine({
      voiceId: 'v1',
      providers: [fakeClient(false), fakeServer(true)],
    });
    expect(engine.engineId).toBe('clone-server');
  });

  it('falls back to the named voice WITH a reason when no clone path works', async () => {
    const fallback = new FallbackVoiceProvider({
      voiceName: 'Narrator',
      synthesize: async (req) => ({ durationMs: req.text.length * 60, wordTimestamps: [] }),
    });
    const engine = await resolveNarrationEngine({
      voiceId: 'v1',
      providers: [fakeClient(false), fakeServer(false)],
      fallback,
    });
    expect(engine.engineId).toBe('fallback');
    expect(engine.cloned).toBe(false);
    expect(engine.fallbackReason).toMatch(/Cloning unavailable/);
    // honest path still produces audio metadata
    const out = await engine.synthesize({ text: 'hello' });
    expect(out.cloned).toBe(false);
    expect(out.durationMs).toBeGreaterThan(0);
  });

  it('getEngineUnavailableReason is null when a clone path exists, a string otherwise', async () => {
    expect(await getEngineUnavailableReason([fakeClient(true)])).toBeNull();
    expect(await getEngineUnavailableReason([fakeClient(false), fakeServer(false)])).toMatch(
      /Cloning unavailable/,
    );
  });

  it('preferClone=false routes straight to the fallback even if cloning is available', async () => {
    const fallback = new FallbackVoiceProvider({
      voiceName: 'Narrator',
      synthesize: async () => ({ durationMs: 10, wordTimestamps: [] }),
    });
    const engine = await resolveNarrationEngine({
      voiceId: 'v1',
      providers: [fakeClient(true)],
      fallback,
      preferClone: false,
    });
    expect(engine.engineId).toBe('fallback');
  });

  it('returns a throwing engine (reason pre-exposed) when nothing is available', async () => {
    const engine = await resolveNarrationEngine({
      voiceId: 'v1',
      providers: [fakeServer(false)],
    });
    expect(engine.fallbackReason).toBeTruthy();
    await expect(engine.synthesize({ text: 'x' })).rejects.toThrow();
  });
});

describe('ClientCloneProvider (Option A — on-device, structurally typed)', () => {
  it('adapts the studio engine output into a NarrationResult', async () => {
    const provider = new ClientCloneProvider({
      engine: {
        synthesize: async () => ({
          pcm: new Float32Array([0.1, -0.2, 0.3]),
          sampleRate: 24_000,
          durationMs: 321,
          wordTimestamps: [{ word: 'hi', startMs: 0, endMs: 100 }],
        }),
      },
      speaker: { data: [0.1, 0.2, 0.3], dim: 3, sampleRate: 24_000 },
    });
    expect(await provider.isAvailable()).toBe(true);
    const out = await provider.synthesize({ text: 'hi' });
    expect(out.engineId).toBe('clone-client');
    expect(out.pcm).toBeInstanceOf(Float32Array);
    expect(out.sampleRate).toBe(24_000);
  });

  it('is unavailable (with a reason) without a speaker embedding', async () => {
    const provider = new ClientCloneProvider({
      engine: { synthesize: async () => ({ pcm: new Float32Array(0), sampleRate: 24_000, durationMs: 0, wordTimestamps: [] }) },
      speaker: { data: [], dim: 0, sampleRate: 24_000 },
    });
    expect(await provider.isAvailable()).toBe(false);
    expect(await provider.unavailableReason()).toMatch(/embedding/);
  });
});

describe('VoiceClient', () => {
  it('narrate() resolves the server path and returns cloned audio', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(SYNTH_OK));
    const client = new VoiceClient({ apiKey: 'clk_test', fetchFn: fetchMock as unknown as typeof fetch });
    const result = await client.narrate('clone-7', { text: 'the pitch, in my voice' });
    expect(result.engineId).toBe('clone-server');
    expect(result.audioUrl).toBe(SYNTH_OK.audioUrl);
  });

  it('prefers the on-device engine when an engine + speaker are supplied', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(SYNTH_OK));
    const client = new VoiceClient({
      apiKey: 'clk_test',
      fetchFn: fetchMock as unknown as typeof fetch,
      clientEngine: {
        synthesize: async () => ({ pcm: new Float32Array(4), sampleRate: 24_000, durationMs: 80, wordTimestamps: [] }),
      },
    });
    const result = await client.narrate(
      'clone-7',
      { text: 'hi' },
      { speaker: { data: [0.1, 0.2], dim: 2, sampleRate: 24_000 } },
    );
    expect(result.engineId).toBe('clone-client');
    expect(fetchMock).not.toHaveBeenCalled(); // never hit the metered path
  });

  it('throws on an empty apiKey', () => {
    expect(() => new VoiceClient({ apiKey: '' })).toThrow(/apiKey/);
  });
});
