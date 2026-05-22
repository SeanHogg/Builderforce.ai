import { afterEach, describe, expect, it, vi } from 'vitest';
import { VendorFatalError, VendorRetryableError } from '../vendors/types';
import { extractFluxImageUrl, fluxApiModule, sizeToAspectRatio } from './fluxapi';
import { togetherImageModule } from './together';

// ---------------------------------------------------------------------------
// Image-vendor unit tests — exercise the parsers + the mock fetch path so we
// confirm:
//   - Together's OpenAI-shaped { data: [{ url|b64_json|revised_prompt }] }
//     normalises correctly into ImageGenResult.
//   - FluxAPI's non-OpenAI envelope is reshaped via extractFluxImageUrl.
//   - Both vendors classify status codes per the shared CASCADE/AUTH/fatal map.
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

function mockFetchOnce(status: number, body: unknown) {
  // Typed to the fetch signature so `fn.mock.calls[0][1]` (RequestInit) is non-empty.
  const fn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    { status, headers: { 'Content-Type': 'application/json' } },
  ));
  (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

// ===========================================================================
// FluxAPI vendor
// ===========================================================================

describe('fluxapi: sizeToAspectRatio', () => {
  it.each([
    ['1024x1024', '1:1'],
    ['1792x1024', '16:9'],
    ['1024x1792', '9:16'],
    ['2560x1080', '21:9'],
    ['1080x2560', '9:21'],
    ['1280x960',  '4:3'],
    ['960x1280',  '3:4'],
    ['',          '1:1'],
    ['bogus',     '1:1'],
    ['0x0',       '1:1'],
  ])('maps "%s" → "%s"', (size, expected) => {
    expect(sizeToAspectRatio(size)).toBe(expected);
  });
});

describe('fluxapi: extractFluxImageUrl', () => {
  it.each([
    [{ data: { url:      'https://x/img.jpg' } }, 'https://x/img.jpg'],
    [{ data: { imageUrl: 'https://x/img.jpg' } }, 'https://x/img.jpg'],
    [{ data: { image:    'https://x/img.jpg' } }, 'https://x/img.jpg'],
    [{ data: { result: { url: 'https://x/img.jpg' } } }, 'https://x/img.jpg'],
    [{ data: { output_url:  'https://x/img.jpg' } }, 'https://x/img.jpg'],
  ])('extracts url from %o', (raw, expected) => {
    expect(extractFluxImageUrl(raw)).toBe(expected);
  });

  it('returns null for async-poll envelope (no url, just taskId)', () => {
    expect(extractFluxImageUrl({ data: { taskId: 'abc-123' } })).toBeNull();
  });

  it('returns null when data field is missing', () => {
    expect(extractFluxImageUrl({ code: 200, message: 'ok' })).toBeNull();
    expect(extractFluxImageUrl(null)).toBeNull();
  });
});

describe('fluxapi: generate()', () => {
  it('normalises sync response into OpenAI-shaped { data: [{ url }] }', async () => {
    mockFetchOnce(200, { data: { url: 'https://flux/result.jpg' } });
    const result = await fluxApiModule.generate({
      apiKey: 'test-key',
      model: 'flux-kontext-pro',
      prompt: 'a duck',
      size: '1024x1024',
    });
    expect(result.model).toBe('flux-kontext-pro');
    expect(result.data).toEqual([{ url: 'https://flux/result.jpg' }]);
    expect(typeof result.created).toBe('number');
  });

  it('throws VendorRetryableError on 429 (cascade-eligible)', async () => {
    mockFetchOnce(429, { error: 'rate limit' });
    await expect(fluxApiModule.generate({
      apiKey: 'test-key', model: 'flux-kontext-pro', prompt: 'a duck',
    })).rejects.toBeInstanceOf(VendorRetryableError);
  });

  it('throws VendorFatalError on 400 (cascade short-circuits)', async () => {
    mockFetchOnce(400, { error: 'bad prompt' });
    await expect(fluxApiModule.generate({
      apiKey: 'test-key', model: 'flux-kontext-pro', prompt: 'a duck',
    })).rejects.toBeInstanceOf(VendorFatalError);
  });

  it('throws VendorRetryableError on async-poll response (no url present)', async () => {
    mockFetchOnce(200, { code: 200, data: { taskId: 'abc-123' }, message: 'pending' });
    await expect(fluxApiModule.generate({
      apiKey: 'test-key', model: 'flux-kontext-pro', prompt: 'a duck',
    })).rejects.toBeInstanceOf(VendorRetryableError);
  });

  it('sends Authorization: Bearer + JSON body with mapped aspectRatio', async () => {
    const fn = mockFetchOnce(200, { data: { url: 'https://flux/result.jpg' } });
    await fluxApiModule.generate({
      apiKey: 'test-key',
      model: 'flux-kontext-pro',
      prompt: 'a duck',
      size: '1792x1024',
      extraBody: { safetyTolerance: 5 },
    });
    expect(fn).toHaveBeenCalledTimes(1);
    const callArgs = fn.mock.calls[0]!;
    const init = callArgs[1]!;
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-key');
    const body = JSON.parse(init.body as string);
    expect(body.prompt).toBe('a duck');
    expect(body.aspectRatio).toBe('16:9');
    expect(body.safetyTolerance).toBe(5); // extraBody override wins
  });
});

// ===========================================================================
// Together vendor
// ===========================================================================

describe('together: generate()', () => {
  it('returns the parsed OpenAI shape', async () => {
    mockFetchOnce(200, {
      created: 1716321600,
      data: [
        { url: 'https://together/a.png' },
        { b64_json: 'iVBORw0KGgoA…', revised_prompt: 'a duck on a pond' },
      ],
    });
    const result = await togetherImageModule.generate({
      apiKey: 'test-key',
      model: 'black-forest-labs/FLUX.1-schnell-Free',
      prompt: 'a duck',
      size: '1024x1024',
    });
    expect(result.created).toBe(1716321600);
    expect(result.data).toEqual([
      { url: 'https://together/a.png' },
      { b64_json: 'iVBORw0KGgoA…', revised_prompt: 'a duck on a pond' },
    ]);
  });

  it('throws retryable error on empty data array (cascade advances)', async () => {
    mockFetchOnce(200, { created: 1, data: [] });
    await expect(togetherImageModule.generate({
      apiKey: 'test-key', model: 'Lykon/DreamShaper', prompt: 'a duck',
    })).rejects.toBeInstanceOf(VendorRetryableError);
  });

  it('throws retryable on 503 (cascade-eligible)', async () => {
    mockFetchOnce(503, { error: 'overloaded' });
    await expect(togetherImageModule.generate({
      apiKey: 'test-key', model: 'Lykon/DreamShaper', prompt: 'a duck',
    })).rejects.toBeInstanceOf(VendorRetryableError);
  });

  it('sends width/height (not aspectRatio) for Together — vendor format diverges from Flux', async () => {
    const fn = mockFetchOnce(200, { data: [{ url: 'x' }] });
    await togetherImageModule.generate({
      apiKey: 'test-key',
      model: 'Lykon/DreamShaper',
      prompt: 'p',
      size: '1024x768',
    });
    const body = JSON.parse((fn.mock.calls[0]![1]!).body as string);
    expect(body.width).toBe(1024);
    expect(body.height).toBe(768);
    expect(body.aspectRatio).toBeUndefined();
  });
});

// ===========================================================================
// Vendor catalog membership (cheap drift check)
// ===========================================================================

describe('image vendor catalogs', () => {
  it('together.catalog uses FREE tier (cascade contract)', () => {
    for (const entry of togetherImageModule.catalog) {
      expect(entry.tier).toBe('FREE');
    }
  });

  it('fluxapi.catalog uses PREMIUM tier (cascade contract)', () => {
    for (const entry of fluxApiModule.catalog) {
      expect(entry.tier).toBe('PREMIUM');
    }
  });

  it('apiKeyFrom reads the right env var per vendor', () => {
    expect(togetherImageModule.apiKeyFrom({ TOGETHER_API_KEY: 'tg' })).toBe('tg');
    expect(togetherImageModule.apiKeyFrom({ FLUX_API_KEY: 'fl' })).toBeNull();
    expect(fluxApiModule.apiKeyFrom({ FLUX_API_KEY: 'fl' })).toBe('fl');
    expect(fluxApiModule.apiKeyFrom({ TOGETHER_API_KEY: 'tg' })).toBeNull();
  });
});
