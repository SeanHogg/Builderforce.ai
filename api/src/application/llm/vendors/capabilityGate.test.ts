import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelInputUnsupportedError, entryRefusesImages, requestCarriesImages } from './capabilityGate';
import { CascadeExhaustedError, catalogEntry, dispatchVendor, getModule } from './registry';

// ---------------------------------------------------------------------------
// Vision gate — production 2026-10-03..10: `direct/minimax/MiniMax-M1` refused 31
// of 61 calls with `invalid params, MiniMax-M1 not support img (2013)`. Image input
// must never be dispatched to a model the catalog declares text-only.
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
afterEach(() => { (globalThis as { fetch: typeof fetch }).fetch = originalFetch; });

const IMAGE_MESSAGES = [{
  role: 'user',
  content: [
    { type: 'text', text: 'What is in this picture?' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw==' } },
  ],
}];
const TEXT_MESSAGES = [{ role: 'user', content: 'hello' }];

function okFetch(): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(
    JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'a cat' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  ));
  (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('requestCarriesImages', () => {
  it('detects chat-completions, Responses and Anthropic-native image parts', () => {
    expect(requestCarriesImages(IMAGE_MESSAGES)).toBe(true);
    expect(requestCarriesImages([{ role: 'user', content: [{ type: 'input_image', image_url: 'x' }] }])).toBe(true);
    expect(requestCarriesImages([{ role: 'user', content: [{ type: 'image', source: {} }] }])).toBe(true);
  });

  it('is false for text-only and malformed messages', () => {
    expect(requestCarriesImages(TEXT_MESSAGES)).toBe(false);
    expect(requestCarriesImages([{ role: 'user', content: [{ type: 'text', text: 'x' }] }])).toBe(false);
    expect(requestCarriesImages(undefined)).toBe(false);
    expect(requestCarriesImages([null, { content: null }])).toBe(false);
  });
});

describe('entryRefusesImages', () => {
  it('refuses only an entry that DECLARES capabilities without vision', () => {
    expect(entryRefusesImages({ capabilities: ['tools'] })).toBe(true);
    expect(entryRefusesImages({ capabilities: ['tools', 'vision'] })).toBe(false);
  });

  it('treats an undeclared entry or an uncatalogued model as unknown (never refused)', () => {
    expect(entryRefusesImages({})).toBe(false);
    expect(entryRefusesImages(undefined)).toBe(false);
  });

  it('MiniMax M1 / Text-01 are declared text-only in the catalog', () => {
    const minimax = getModule('minimax').catalog;
    expect(minimax.find((e) => e.id === 'MiniMax-M1')?.capabilities).toEqual(['tools']);
    expect(minimax.find((e) => e.id === 'MiniMax-Text-01')?.capabilities).toEqual(['tools']);
    expect(entryRefusesImages(catalogEntry('claude-opus-5-5') ?? undefined)).toBe(false);
  });
});

describe('dispatchVendor vision gate', () => {
  it('refuses a strict MiniMax-M1 pin carrying an image with a typed 400 — no upstream call', async () => {
    const fetchFn = okFetch();
    const err = await dispatchVendor({
      env: { MINIMAX_API_KEY: 'mm' },
      modelChain: ['direct/minimax/MiniMax-M1'],
      messages: IMAGE_MESSAGES,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelInputUnsupportedError);
    expect((err as ModelInputUnsupportedError).status).toBe(400);
    expect((err as ModelInputUnsupportedError).capability).toBe('vision');
    expect((err as Error).message).toContain('direct/minimax/MiniMax-M1');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('skips the text-only candidate and serves the image on the next vision model', async () => {
    const fetchFn = okFetch();
    const result = await dispatchVendor({
      env: { MINIMAX_API_KEY: 'mm', GOOGLE_API_KEY: 'g' },
      modelChain: ['direct/minimax/MiniMax-M1', 'googleai/gemini-2.5-flash'],
      messages: IMAGE_MESSAGES,
    });
    expect(result.vendorUsed).toBe('googleai');
    expect(result.attempts).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0]![0])).not.toContain('minimax');
  });

  it('names the no-vision skip when the rest of the chain fails for other reasons', async () => {
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async () => new Response('busy', { status: 503 })) as unknown as typeof fetch;
    const err = await dispatchVendor({
      env: { MINIMAX_API_KEY: 'mm', GOOGLE_API_KEY: 'g' },
      modelChain: ['direct/minimax/MiniMax-M1', 'googleai/gemini-2.5-flash'],
      messages: IMAGE_MESSAGES,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CascadeExhaustedError);
    expect((err as CascadeExhaustedError).skippedNoVision).toEqual(['minimax:direct/minimax/MiniMax-M1']);
    expect((err as Error).message).toContain('skipped no-vision');
  });

  it('still dispatches a text-only model for a text request', async () => {
    const fetchFn = okFetch();
    const result = await dispatchVendor({
      env: { MINIMAX_API_KEY: 'mm' },
      modelChain: ['direct/minimax/MiniMax-M1'],
      messages: TEXT_MESSAGES,
    });
    expect(result.vendorUsed).toBe('minimax');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('tries an uncatalogued model with an image (unknown is not text-only)', async () => {
    const fetchFn = okFetch();
    const result = await dispatchVendor({
      env: { MINIMAX_API_KEY: 'mm' },
      modelChain: ['direct/minimax/MiniMax-VL-01'],
      messages: IMAGE_MESSAGES,
    });
    expect(result.vendorUsed).toBe('minimax');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
