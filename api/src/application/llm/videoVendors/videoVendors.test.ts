import { afterEach, describe, expect, it, vi } from 'vitest';
import { VendorFatalError, VendorRetryableError } from '../vendors/types';
import { clampVideoDuration } from './types';
import { pollinationsVideoModule, pollinationsVideoUrl } from './pollinations';
import { buildVeoBody, classifyVeoOperation, googleVideoModule } from './googleai';
import { maxVideoSecondsFor, videoChainConfigured, videoModelChainForPlan, videoSecondsFor } from './registry';

const originalFetch = globalThis.fetch;
afterEach(() => { (globalThis as { fetch: typeof fetch }).fetch = originalFetch; });

function mockFetch(respond: (url: string, init?: RequestInit) => Response) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => respond(String(input), init));
  (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

const MP4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);

describe('clampVideoDuration', () => {
  it('picks the nearest allowed length, ties to the shorter', () => {
    expect(clampVideoDuration({ durations: [4, 6, 8] }, 5)).toBe(4);
    expect(clampVideoDuration({ durations: [4, 6, 8] }, 7.5)).toBe(8);
    expect(clampVideoDuration({ durations: [5] }, 12)).toBe(5);
    expect(clampVideoDuration({ durations: [5, 10] }, Number.NaN)).toBe(5);
  });
});

describe('plan chains', () => {
  it('free plans get only the cheap model; paid plans lead with quality and keep it as fallback', () => {
    expect(videoModelChainForPlan(false)).toEqual(['pollinations/alibaba/wan-2.2-fast']);
    const paid = videoModelChainForPlan(true);
    expect(paid[0]).toBe('pollinations/bytedance/seedance-1-pro-fast');
    expect(paid).toContain('googleai/veo-3.1-fast-generate-preview');
    expect(paid[paid.length - 1]).toBe('pollinations/alibaba/wan-2.2-fast');
  });

  it('reserves the longest clip a chain could bill', () => {
    expect(videoSecondsFor('pollinations/google/veo-3.1-fast', 5)).toBe(4);
    expect(maxVideoSecondsFor(videoModelChainForPlan(true), 10)).toBe(10);
  });

  it('knows whether any vendor in a chain has a key', () => {
    expect(videoChainConfigured({}, videoModelChainForPlan(false))).toBe(false);
    expect(videoChainConfigured({ GOOGLE_API_KEY: 'g' }, videoModelChainForPlan(false))).toBe(false);
    expect(videoChainConfigured({ GOOGLE_API_KEY: 'g' }, videoModelChainForPlan(true))).toBe(true);
  });
});

describe('pollinations video', () => {
  it('builds the prompt-in-path URL with the first frame', () => {
    const url = new URL(pollinationsVideoUrl({ apiKey: 'k', model: 'alibaba/wan-2.2-fast', prompt: 'a red fox', durationSeconds: 5, aspectRatio: '9:16', imageUrl: 'https://img/x.png' }));
    expect(url.host).toBe('gen.pollinations.ai');
    expect(url.pathname).toBe('/video/a%20red%20fox');
    expect(url.searchParams.get('aspectRatio')).toBe('9:16');
    expect(url.searchParams.get('image')).toBe('https://img/x.png');
  });

  it('returns the MP4 bytes synchronously, with the secret key as a Bearer token', async () => {
    const fetchFn = mockFetch(() => new Response(MP4, { status: 200, headers: { 'Content-Type': 'video/mp4' } }));
    const step = await pollinationsVideoModule.start({ apiKey: 'sk_x', model: 'alibaba/wan-2.2-fast', prompt: 'p', durationSeconds: 5, aspectRatio: '16:9' });
    expect(step.kind).toBe('done');
    expect((fetchFn.mock.calls[0]![1]!.headers as Record<string, string>).Authorization).toBe('Bearer sk_x');
  });

  it('treats a JSON 200 as retryable and a spent balance (402) as retryable', async () => {
    mockFetch(() => new Response('{"queued":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await expect(pollinationsVideoModule.start({ apiKey: 'k', model: 'm', prompt: 'p', durationSeconds: 5, aspectRatio: '16:9' })).rejects.toBeInstanceOf(VendorRetryableError);
    mockFetch(() => new Response('out of pollen', { status: 402 }));
    await expect(pollinationsVideoModule.start({ apiKey: 'k', model: 'm', prompt: 'p', durationSeconds: 5, aspectRatio: '16:9' })).rejects.toBeInstanceOf(VendorRetryableError);
  });

  it('treats a 400 as fatal', async () => {
    mockFetch(() => new Response('bad prompt', { status: 400 }));
    await expect(pollinationsVideoModule.start({ apiKey: 'k', model: 'm', prompt: 'p', durationSeconds: 5, aspectRatio: '16:9' })).rejects.toBeInstanceOf(VendorFatalError);
  });
});

describe('google veo', () => {
  it('asks for landscape when a square clip is requested', () => {
    const body = buildVeoBody({ apiKey: 'k', model: 'm', prompt: 'p', durationSeconds: 6, aspectRatio: '1:1' }, null);
    expect(body).toMatchObject({ parameters: { aspectRatio: '16:9', durationSeconds: 6 } });
  });

  it('reads operation states', () => {
    expect(classifyVeoOperation('m', { done: false })).toEqual({ kind: 'pending' });
    expect(classifyVeoOperation('m', { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://v/1' } }] } } })).toEqual({ kind: 'ready', uri: 'https://v/1' });
    expect(() => classifyVeoOperation('m', { done: true, response: { generateVideoResponse: { raiMediaFilteredReasons: ['person'] } } })).toThrow(/filtered: person/);
  });

  it('starts a long-running operation with the key header, then polls and downloads', async () => {
    const fetchFn = mockFetch((url) => {
      if (url.endsWith(':predictLongRunning')) return Response.json({ name: 'models/veo/operations/42' });
      if (url.endsWith('/models/veo/operations/42')) return Response.json({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://files/v.mp4' } }] } } });
      return new Response(MP4, { status: 200, headers: { 'Content-Type': 'video/mp4' } });
    });
    const started = await googleVideoModule.start({ apiKey: 'gk', model: 'veo-3.1-fast-generate-preview', prompt: 'p', durationSeconds: 8, aspectRatio: '16:9' });
    expect(started).toMatchObject({ kind: 'pending', handle: 'models/veo/operations/42' });
    const headers = fetchFn.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('gk');
    expect(headers.Authorization).toBeUndefined();
    const done = await googleVideoModule.poll({ apiKey: 'gk', model: 'veo-3.1-fast-generate-preview', handle: 'models/veo/operations/42' });
    expect(done.kind).toBe('done');
  });
});
