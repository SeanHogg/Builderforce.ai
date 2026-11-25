import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('onnxruntime-web', () => ({
  env: { versions: { common: '0.0.0-test' }, wasm: {} },
  Tensor: class {},
  InferenceSession: {
    create: vi.fn(async () => ({
      inputNames: ['input_ids', 'sample', 'timestep', 'encoder_hidden_states'],
      release: async () => {},
    })),
  },
}));
vi.mock('@huggingface/transformers', () => ({
  env: { allowLocalModels: true, backends: { onnx: { wasm: {} } } },
  // The network loader must never be reached: the stored tokenizer wins.
  AutoTokenizer: { from_pretrained: vi.fn(async () => { throw new TypeError('network'); }) },
  CLIPTokenizer: class {
    constructor(public json: unknown, public config: unknown) {}
  },
}));
vi.mock('./device-router', async (orig) => ({
  ...(await orig<typeof import('./device-router')>()),
  probeDevice: vi.fn(async () => ({ kind: 'wasm', label: 'mock', approxMemoryMb: null })),
}));

const WEIGHT_FILES = [
  'text_encoder/model.onnx',
  'unet/model.onnx',
  'unet/model.onnx_data',
  'vae_decoder/model.onnx',
  'vae_decoder/model.onnx_data',
];

describe('VideoEngine.create with the model available offline', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('succeeds with a warm store and a fetch that rejects (no network used)', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', new IDBFactory());
    const { weightStore } = await import('./residency/weight-store');
    const store = weightStore();
    for (const f of WEIGHT_FILES) await store.write(`lcm-tiny-sd/${f}`, new ArrayBuffer(16));
    const json = new TextEncoder().encode('{}').buffer as ArrayBuffer;
    for (const f of ['tokenizer.json', 'tokenizer_config.json']) {
      await store.write(`tokenizer/Xenova/clip-vit-large-patch14/${f}`, json.slice(0));
    }
    const fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', fetchMock);

    const { VideoEngine } = await import('./video-engine');
    const engine = await VideoEngine.create({ model: 'lcm-tiny-sd', apiKey: 'tok', baseUrl: 'https://api.test' });

    expect(engine).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    await engine?.dispose();
  });
});
