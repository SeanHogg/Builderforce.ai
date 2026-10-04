import { describe, expect, it, vi } from 'vitest';

/**
 * Lifecycle guards for the DiffusionEngine improvements: failed-init cleanup,
 * the prompt-embedding memo, cancellation between denoise steps, and feed
 * validation before the first UNet run.
 */

vi.mock('onnxruntime-web', () => ({
  env: { versions: { common: '0.0.0-test' }, wasm: {} },
  Tensor: class {
    constructor(public type: string, public data: unknown, public dims: number[]) {}
  },
  InferenceSession: { create: vi.fn() },
}));
vi.mock('@huggingface/transformers', () => ({
  env: { allowLocalModels: true, backends: { onnx: { wasm: {} } } },
  AutoTokenizer: { from_pretrained: vi.fn() },
}));
vi.mock('./weight-cache', () => ({
  getOrFetchWeight: vi.fn(async () => new ArrayBuffer(16)),
}));

import { DiffusionEngine } from './diffusion-engine';

const SIZE = 64; // latent 4 × 8 × 8 = 256
const LATENT = 4 * (SIZE / 8) * (SIZE / 8);
const TINY_EMBED = 77 * 768; // lcm-tiny-sd: SD1.5 CLIP-L

function tinyEngine() {
  return new DiffusionEngine({
    model: 'lcm-tiny-sd',
    probed: { kind: 'wasm', label: 'mock', approxMemoryMb: null },
    apiKey: '',
    weightSources: ['huggingface-cdn'],
    width: SIZE,
    height: SIZE,
  });
}

function inject(engine: DiffusionEngine, fields: Record<string, unknown>) {
  Object.assign(engine as unknown as Record<string, unknown>, fields);
}

describe('DiffusionEngine.init failure cleanup', () => {
  it('releases the sessions it DID create when a later one fails', async () => {
    const ort = await import('onnxruntime-web');
    const transformers = await import('@huggingface/transformers');
    (transformers.AutoTokenizer.from_pretrained as ReturnType<typeof vi.fn>).mockResolvedValue(async () => ({}));
    const release = vi.fn(async () => {});
    const create = ort.InferenceSession.create as ReturnType<typeof vi.fn>;
    create.mockReset();
    create
      .mockResolvedValueOnce({ inputNames: ['input_ids'], release }) // text encoder
      .mockRejectedValueOnce(new Error('std::bad_alloc'));          // unet OOMs

    const engine = tinyEngine();
    await expect(engine.init()).rejects.toThrow(/Out of memory/);
    expect(release).toHaveBeenCalledTimes(1);
    expect((engine as unknown as Record<string, unknown>).textEncoderSession).toBeNull();
  });
});

describe('DiffusionEngine.embedPrompt memo', () => {
  function engineWithEncoder() {
    const engine = tinyEngine();
    const run = vi.fn(async () => ({ last_hidden_state: { data: new Float32Array(TINY_EMBED).fill(0.5) } }));
    inject(engine, {
      tokenizer: async () => ({ input_ids: { data: new Int32Array(77) } }),
      textEncoderSession: { run, release: async () => {} },
    });
    return { engine, run };
  }

  it('runs the text encoder once per distinct prompt', async () => {
    const { engine, run } = engineWithEncoder();
    await engine.embedPrompt('a lighthouse at dusk');
    await engine.embedPrompt('a lighthouse at dusk');
    await engine.embedPrompt('blurry, low quality');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('hands every caller its own copy, so mutating one cannot poison the cache', async () => {
    const { engine } = engineWithEncoder();
    const first = await engine.embedPrompt('p');
    first.fill(99);
    const second = await engine.embedPrompt('p');
    expect(second[0]).toBe(0.5);
  });

  it('evicts the least recently used prompt beyond its capacity', async () => {
    const { engine, run } = engineWithEncoder();
    for (let i = 0; i < 9; i++) await engine.embedPrompt(`prompt ${i}`);
    expect(run).toHaveBeenCalledTimes(9);
    await engine.embedPrompt('prompt 0'); // evicted → re-encoded
    expect(run).toHaveBeenCalledTimes(10);
    await engine.embedPrompt('prompt 8'); // still cached
    expect(run).toHaveBeenCalledTimes(10);
  });
});

describe('DiffusionEngine.denoise', () => {
  function engineWithSessions(onUnet: () => void = () => {}) {
    const engine = tinyEngine();
    const unetRun = vi.fn(async () => { onUnet(); return { out_sample: { data: new Float32Array(LATENT) } }; });
    const vaeRun = vi.fn(async () => ({ sample: { data: new Float32Array(3 * SIZE * SIZE) } }));
    inject(engine, {
      unetSession: { run: unetRun, release: async () => {} },
      vaeSession: { run: vaeRun, release: async () => {} },
    });
    return { engine, unetRun, vaeRun };
  }

  const inputs = () => ({
    latent: new Float32Array(LATENT).fill(0.1),
    condEmbedding: new Float32Array(TINY_EMBED),
    uncondEmbedding: null,
    guidance: 1,
    seed: 1,
  });

  it('runs one UNet pass per timestep then one VAE decode, leaving the input latent untouched', async () => {
    const { engine, unetRun, vaeRun } = engineWithSessions();
    const args = inputs();
    await engine.denoise(args);
    expect(unetRun).toHaveBeenCalledTimes(4);
    expect(vaeRun).toHaveBeenCalledTimes(1);
    expect(args.latent[0]).toBeCloseTo(0.1);
  });

  it('stops between steps when the signal aborts mid-run', async () => {
    const controller = new AbortController();
    const { engine, unetRun, vaeRun } = engineWithSessions(() => controller.abort());
    await expect(engine.denoise({ ...inputs(), signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(unetRun).toHaveBeenCalledTimes(1);
    expect(vaeRun).not.toHaveBeenCalled();
  });

  it('rejects an embedding from a different backbone before any UNet run', async () => {
    const { engine, unetRun } = engineWithSessions();
    const sd21Embedding = new Float32Array(77 * 1024);
    await expect(engine.denoise({ ...inputs(), condEmbedding: sd21Embedding })).rejects.toThrow(/different model/);
    expect(unetRun).not.toHaveBeenCalled();
  });

  it('rejects a latent made at another resolution', async () => {
    const { engine } = engineWithSessions();
    await expect(engine.denoise({ ...inputs(), latent: new Float32Array(LATENT * 4) })).rejects.toThrow(/latent length/);
  });
});
