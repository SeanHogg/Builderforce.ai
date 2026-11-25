import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@huggingface/transformers', () => ({
  env: {},
  AutoTokenizer: { from_pretrained: vi.fn() },
  CLIPTokenizer: class {
    constructor(public json: unknown, public config: unknown) {}
  },
}));

const MODEL = 'lcm-tiny-sd' as const;
const TOKENIZER_REPO = 'Xenova/clip-vit-large-patch14';
const WEIGHT_FILES = [
  'text_encoder/model.onnx',
  'unet/model.onnx',
  'unet/model.onnx_data',
  'vae_decoder/model.onnx',
  'vae_decoder/model.onnx_data',
];
const FILE_BYTES = 8;
const JSON_BODY = '{"a":1}';

/** A fresh module graph over a fresh IndexedDB, so each test owns its store. */
async function load() {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
  const offline = await import('./model-offline');
  const tokenizer = await import('./tokenizer-store');
  const { weightStore } = await import('../residency/weight-store');
  return { ...offline, ...tokenizer, store: weightStore() };
}

/** A fetch serving a small body for every URL, honouring the abort signal. */
function installFetch() {
  const fetchMock = vi.fn(async (url: string, init?: { signal?: AbortSignal }) => {
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const body = url.endsWith('.json') ? new TextEncoder().encode(JSON_BODY) : new Uint8Array(FILE_BYTES);
    return new Response(body, { headers: { 'content-length': String(body.byteLength) } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('offline model preparation', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('is not available before anything is stored', async () => {
    const { isModelAvailableOffline } = await load();
    await expect(isModelAvailableOffline(MODEL)).resolves.toBe(false);
  });

  it('writes every weight and the tokenizer to the store, then reports available with its size', async () => {
    const m = await load();
    installFetch();
    const progress = vi.fn();
    await m.prepareModelOffline({ model: MODEL, authToken: 't', baseUrl: 'https://api.test', onProgress: progress });

    for (const f of WEIGHT_FILES) await expect(m.store.has(`${MODEL}/${f}`)).resolves.toBe(true);
    await expect(m.isModelAvailableOffline(MODEL)).resolves.toBe(true);
    const status = await m.getModelOfflineStatus(MODEL);
    expect(status.sizeBytes).toBe(WEIGHT_FILES.length * FILE_BYTES + 2 * JSON_BODY.length);
    expect(progress.mock.calls.at(-1)![0].fileCount).toBe(WEIGHT_FILES.length);
    await expect(m.loadStoredTokenizer(TOKENIZER_REPO)).resolves.not.toBeNull();
  });

  it('stays available with no network once prepared', async () => {
    const m = await load();
    installFetch();
    await m.prepareModelOffline({ model: MODEL, authToken: 't' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await expect(m.isModelAvailableOffline(MODEL)).resolves.toBe(true);
  });

  it('is not available when the weights are stored but the tokenizer is not', async () => {
    const m = await load();
    for (const f of WEIGHT_FILES) await m.store.write(`${MODEL}/${f}`, new ArrayBuffer(4));
    await expect(m.isModelAvailableOffline(MODEL)).resolves.toBe(false);
  });

  it('rejects with an AbortError when the signal aborts, and is not available', async () => {
    const m = await load();
    installFetch();
    const controller = new AbortController();
    const run = m.prepareModelOffline({
      model: MODEL,
      authToken: 't',
      onProgress: () => controller.abort(),
      signal: controller.signal,
    });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    await expect(m.isModelAvailableOffline(MODEL)).resolves.toBe(false);
  });
});
