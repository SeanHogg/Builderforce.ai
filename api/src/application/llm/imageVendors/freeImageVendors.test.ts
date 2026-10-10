import { afterEach, describe, expect, it, vi } from 'vitest';
import { VendorRetryableError } from '../vendors/types';
import { buildCloudflareImageBody, cloudflareImageModule, parseCloudflareImageBody } from './cloudflare';
import { buildGoogleImageBody, googleImageModule, parseGoogleImageResponse } from './googleai';
import { HUGGING_FACE_IMAGE_ENDPOINT, buildHuggingFaceImageBody, huggingFaceImageModule, parseHuggingFaceImageResponse } from './huggingface';
import { pollinationsImageModule, pollinationsImageUrl } from './pollinations';
import { anyImageVendorBound, getAllImageVendorIds, imageModelsByTierPrefixed } from './registry';
import { executeImageGeneration, parseImageSize } from './types';

// ---------------------------------------------------------------------------
// The byte-producing image vendors (Cloudflare, Hugging Face, Pollinations) and
// Gemini: request shaping, response normalisation, and the registry wiring
// that makes them reachable.
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
afterEach(() => { (globalThis as { fetch: typeof fetch }).fetch = originalFetch; });

function mockFetch(respond: (url: string, init?: RequestInit) => Response) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => respond(String(input), init));
  (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const PNG_B64 = 'iVBORw==';

describe('shared: parseImageSize', () => {
  it('parses WxH and rejects malformed or zero sizes', () => {
    expect(parseImageSize('1024x768')).toEqual({ width: 1024, height: 768 });
    expect(parseImageSize('wide')).toBeUndefined();
    expect(parseImageSize('0x512')).toBeUndefined();
    expect(parseImageSize(undefined)).toBeUndefined();
  });
});

describe('cloudflare image vendor', () => {
  it('sends steps (no size) to fixed-size Flux Schnell', () => {
    const body = buildCloudflareImageBody({ apiKey: 'k', model: '@cf/black-forest-labs/flux-1-schnell', prompt: 'p', size: '1792x1024' });
    expect(body).toEqual({ prompt: 'p', steps: 4 });
  });

  it('clamps SD-family sizes into [256, 2048] on a 64px grid', () => {
    const body = buildCloudflareImageBody({ apiKey: 'k', model: '@cf/bytedance/stable-diffusion-xl-lightning', prompt: 'p', size: '4000x100' });
    expect(body).toMatchObject({ width: 2048, height: 256 });
  });

  it('accepts both the JSON `{ result: { image } }` and raw-bytes answers', () => {
    expect(parseCloudflareImageBody('m', { kind: 'json', raw: { result: { image: 'QUJD' } } }, 'b64_json').data)
      .toEqual([{ b64_json: 'QUJD' }]);
    expect(parseCloudflareImageBody('m', { kind: 'bytes', base64: PNG_B64, mimeType: 'image/png' }, 'url').data)
      .toEqual([{ url: `data:image/png;base64,${PNG_B64}` }]);
  });

  it('treats a 200 with no image as retryable so the cascade advances', () => {
    expect(() => parseCloudflareImageBody('m', { kind: 'json', raw: { result: {} } }, 'url')).toThrow(VendorRetryableError);
  });

  it('needs BOTH the token and the account id to count as bound', () => {
    expect(cloudflareImageModule.apiKeyFrom({ CLOUDFLARE_AI_API_TOKEN: 't' })).toBeNull();
    expect(cloudflareImageModule.apiKeyFrom({ CLOUDFLARE_AI_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a' })).toBe('t::a');
  });

  it('calls the native /ai/run endpoint and reads image bytes', async () => {
    const fetchFn = mockFetch(() => new Response(PNG_BYTES, { status: 200, headers: { 'Content-Type': 'image/png' } }));
    const result = await cloudflareImageModule.generate({ apiKey: 't::acct', model: '@cf/lykon/dreamshaper-8-lcm', prompt: 'p', responseFormat: 'b64_json' });
    expect(String(fetchFn.mock.calls[0]![0])).toBe('https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/lykon/dreamshaper-8-lcm');
    expect(result.data).toEqual([{ b64_json: PNG_B64 }]);
  });
});

describe('google (gemini) image vendor', () => {
  it('asks for IMAGE output with an aspect ratio Gemini accepts', () => {
    const body = buildGoogleImageBody({ apiKey: 'k', model: 'gemini-2.5-flash-image', prompt: 'p', size: '400x1000' });
    expect(body).toMatchObject({ generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16' } } });
  });

  it('pulls the inline image part out of the candidate', () => {
    const raw = { candidates: [{ content: { parts: [{ text: 'here' }, { inlineData: { mimeType: 'image/png', data: PNG_B64 } }] } }] };
    expect(parseGoogleImageResponse('m', raw, 'url').data).toEqual([{ url: `data:image/png;base64,${PNG_B64}` }]);
  });

  it('surfaces a safety block (no image part) as retryable with its finishReason', () => {
    expect(() => parseGoogleImageResponse('m', { candidates: [{ finishReason: 'IMAGE_SAFETY' }] }, 'url'))
      .toThrow(/IMAGE_SAFETY/);
  });

  it('authenticates with x-goog-api-key, never a Bearer token', async () => {
    const fetchFn = mockFetch(() => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: PNG_B64 } }] } }] }), { status: 200 }));
    await googleImageModule.generate({ apiKey: 'g-key', model: 'gemini-2.5-flash-image', prompt: 'p' });
    const headers = fetchFn.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('g-key');
    expect(headers['Authorization']).toBeUndefined();
  });
});

describe('hugging face image vendor', () => {
  // hf-inference answers `410 ... deprecated and no longer supported by provider
  // hf-inference` (2026-10); FLUX.1-schnell is served by the nscale provider's
  // OpenAI-compatible images endpoint behind the same HF router.
  it('sends the OpenAI images body (b64_json, n, size) to the nscale provider route', () => {
    expect(buildHuggingFaceImageBody({ apiKey: 'k', model: 'black-forest-labs/FLUX.1-schnell', prompt: 'p', size: '512x512' }))
      .toEqual({ model: 'black-forest-labs/FLUX.1-schnell', prompt: 'p', response_format: 'b64_json', n: 1, size: '512x512' });
    expect(buildHuggingFaceImageBody({ apiKey: 'k', model: 'm', prompt: 'p', n: 2 })).not.toHaveProperty('size');
    expect(HUGGING_FACE_IMAGE_ENDPOINT).toBe('https://router.huggingface.co/nscale/v1/images/generations');
  });

  it('lists only FLUX.1-schnell — SDXL base is fal-ai-only on HF and was dropped', () => {
    expect(huggingFaceImageModule.catalog.map((e) => e.id)).toEqual(['black-forest-labs/FLUX.1-schnell']);
  });

  it('POSTs to the nscale route with the hf token and parses data[0].b64_json', async () => {
    const fetchFn = mockFetch(() => new Response(JSON.stringify({ created: 1, data: [{ b64_json: PNG_B64 }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const result = await huggingFaceImageModule.generate({ apiKey: 'hf_x', model: 'black-forest-labs/FLUX.1-schnell', prompt: 'p', responseFormat: 'b64_json' });
    expect(String(fetchFn.mock.calls[0]![0])).toBe(HUGGING_FACE_IMAGE_ENDPOINT);
    expect((fetchFn.mock.calls[0]![1]!.headers as Record<string, string>)['Authorization']).toBe('Bearer hf_x');
    expect(result.data).toEqual([{ b64_json: PNG_B64 }]);
  });

  it('returns a data: URL with the sniffed mime type for url callers', () => {
    expect(parseHuggingFaceImageResponse('m', { data: [{ b64_json: '/9j/4AAQ' }] }, 'url').data)
      .toEqual([{ url: 'data:image/jpeg;base64,/9j/4AAQ' }]);
    expect(parseHuggingFaceImageResponse('m', { data: [{ b64_json: PNG_B64 }] }, 'url').data)
      .toEqual([{ url: `data:image/png;base64,${PNG_B64}` }]);
  });

  it('treats a 200 without b64_json as retryable (no image), not a success', () => {
    expect(() => parseHuggingFaceImageResponse('m', { data: [] }, 'url')).toThrow(VendorRetryableError);
  });

  it('surfaces "no remaining credits" (402) as a retryable 402 capacity failure', async () => {
    mockFetch(() => new Response('{"error":"You have no remaining credits"}', { status: 402 }));
    const err = await huggingFaceImageModule.generate({ apiKey: 'hf', model: 'black-forest-labs/FLUX.1-schnell', prompt: 'p' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VendorRetryableError);
    expect((err as VendorRetryableError).status).toBe(402);
  });

  it('cascades (retryable) when the monthly credit is spent — 402', async () => {
    mockFetch(() => new Response('{"error":"credits exhausted"}', { status: 402 }));
    await expect(huggingFaceImageModule.generate({ apiKey: 'hf', model: 'black-forest-labs/FLUX.1-schnell', prompt: 'p' }))
      .rejects.toBeInstanceOf(VendorRetryableError);
  });
});

describe('pollinations image vendor', () => {
  it('puts the prompt in the path and keeps generations private', () => {
    const url = new URL(pollinationsImageUrl({ apiKey: 'k', model: 'black-forest-labs/flux.1-schnell', prompt: 'a red fox', size: '768x512' }));
    expect(url.host).toBe('gen.pollinations.ai');
    expect(url.pathname).toBe('/image/a%20red%20fox');
    expect(url.searchParams.get('model')).toBe('black-forest-labs/flux.1-schnell');
    expect(url.searchParams.get('private')).toBe('true');
    expect(url.searchParams.get('width')).toBe('768');
  });

  it('is opt-in: unbound without a token', () => {
    expect(pollinationsImageModule.apiKeyFrom({})).toBeNull();
  });

  it('GETs without a body, sends the secret key as a Bearer token, and reads the bytes', async () => {
    const fetchFn = mockFetch(() => new Response(PNG_BYTES, { status: 200, headers: { 'Content-Type': 'image/jpeg' } }));
    const result = await pollinationsImageModule.generate({ apiKey: 'sk_test', model: 'black-forest-labs/flux.1-schnell', prompt: 'p' });
    const init = fetchFn.mock.calls[0]![1]!;
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk_test');
    expect(init.body).toBeUndefined();
    expect(result.data[0]!.url).toMatch(/^data:image\/jpeg;base64,/);
  });
});

describe('image transport', () => {
  it('a 400 is still fatal (only 402 joins the cascade)', async () => {
    mockFetch(() => new Response('bad prompt', { status: 400 }));
    await expect(executeImageGeneration({
      vendorId: 'together', endpoint: 'https://x', apiKey: 'k', model: 'm', body: {},
      parseResponse: () => { throw new Error('unreachable'); },
    })).rejects.not.toBeInstanceOf(VendorRetryableError);
  });
});

describe('image vendor registry', () => {
  it('registers every vendor, free ones first', () => {
    expect(getAllImageVendorIds()).toEqual(['cloudflare', 'together', 'huggingface', 'pollinations', 'googleai', 'fluxapi']);
  });

  it('interleaves pools across vendors', () => {
    const pool = imageModelsByTierPrefixed('FREE');
    expect(pool.slice(0, 4).map((m) => m.split('/')[0])).toEqual(['cloudflare', 'together', 'huggingface', 'pollinations']);
    expect(pool[4]!.startsWith('cloudflare/')).toBe(true);
  });

  it('anyImageVendorBound reflects any one vendor credential', () => {
    expect(anyImageVendorBound({})).toBe(false);
    expect(anyImageVendorBound({ HF_API_TOKEN: 'hf' })).toBe(true);
    expect(anyImageVendorBound({ GOOGLE_API_KEY: 'g' })).toBe(true);
  });
});
