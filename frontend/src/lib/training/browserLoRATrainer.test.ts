import { describe, it, expect, vi } from 'vitest';
import { EvermindModelPackage, safetensorsToTensors } from '@seanhogg/builderforce-memory-engine';
import { cpu } from '@webdit/torch/autograd';

// Mock the API so the browser-LoRA tests can prove they make no network calls.
vi.mock('../api', () => ({
  downloadDataset: vi.fn().mockResolvedValue(''),
  uploadArtifact: vi.fn().mockResolvedValue({ r2Key: 'adapters/test.bin' }),
  updateTrainingJob: vi.fn().mockResolvedValue(undefined),
  streamTrainingLogs: vi.fn().mockResolvedValue(undefined),
}));

import { createBrowserLoRATrainer, type BrowserLoRATrainerOptions } from './browserLoRATrainer';
import { createTrainingWorkerHost, type EngineSession } from './trainingWorkerHost';
import type { BrowserLoRAArtifact, TrainingParams, TrainingProgress, TrainingStep, TrainingWorkerResponse } from './protocol';

/**
 * The worker contract, driven in-process: a fake Worker routes structured-clone
 * copies (with TRANSFER, as the real boundary does) to the real worker host on
 * the engine's CPU backend. The first four tests are the former
 * `WebGPUTrainer (exact browser LoRA)` suite from `model-provider.test.ts`,
 * moved here with their assertions unchanged.
 */

interface Harness {
  workers: FakeWorker[];
  sessions: { destroyed: number };
  factory: () => Worker;
}

class FakeWorker {
  onmessage: ((event: { data: TrainingWorkerResponse }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  terminated = false;
  readonly fromWorker: TrainingWorkerResponse[] = [];
  readonly transferredOut: ArrayBuffer[] = [];
  private readonly handle;

  constructor(acquire: () => Promise<EngineSession>) {
    this.handle = createTrainingWorkerHost((message, transfer) => {
      if (this.terminated) return;
      this.transferredOut.push(...(transfer as ArrayBuffer[]));
      const data = structuredClone(message, { transfer });
      this.fromWorker.push(data);
      setTimeout(() => { if (!this.terminated) this.onmessage?.({ data }); }, 0);
    }, acquire);
  }

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    const data = structuredClone(message, { transfer });
    setTimeout(() => { if (!this.terminated) void this.handle(data as never); }, 0);
  }

  terminate(): void {
    this.terminated = true;
  }
}

function harness(): Harness {
  const sessions = { destroyed: 0 };
  const workers: FakeWorker[] = [];
  const acquire = async (): Promise<EngineSession> => ({ backend: cpu, device: 'cpu', detail: 'test', destroy: () => { sessions.destroyed += 1; } });
  return { workers, sessions, factory: () => { const w = new FakeWorker(acquire); workers.push(w); return w as unknown as Worker; } };
}

const TINY_MODEL = { dModel: 8, numLayers: 1, hiddenDim: 16, numExperts: 2, topK: 1 };
const PARAMS: TrainingParams = {
  epochs: 1, batchSize: 1, learningRate: 1e-3, gradientAccumulationSteps: 1, precision: 'float16',
  loraConfig: { rank: 2, alpha: 4, targetModules: ['embed_tokens'] },
};

function makeTrainer(overrides: Partial<BrowserLoRATrainerOptions> = {}, h: Harness = harness()) {
  const logs: string[] = [];
  const trainer = createBrowserLoRATrainer({
    modelId: 'evermind-browser-test',
    onLog: (m) => logs.push(m),
    onStep: () => {},
    onEpochEnd: () => {},
    onComplete: () => {},
    onError: () => {},
    workerFactory: h.factory,
    ...overrides,
  });
  return { trainer, logs, h };
}

describe('browser LoRA training worker (exact browser LoRA)', () => {
  it('initialises the exact CPU path when WebGPU is unavailable', async () => {
    const { trainer, logs } = makeTrainer();
    await expect(trainer.init()).resolves.toBeUndefined();
    expect(logs.join('\n')).toMatch(/exact-gradient browser LoRA/i);
    trainer.dispose();
  });

  it('train() refuses to run before a successful init() (no synthetic loop)', async () => {
    const { trainer } = makeTrainer();
    await expect(
      trainer.train(
        {
          epochs: 2,
          batchSize: 4,
          learningRate: 1e-4,
          gradientAccumulationSteps: 1,
          precision: 'float16',
          loraConfig: { rank: 8, alpha: 16, targetModules: ['q_proj'] },
        },
        ['example'],
      ),
    ).rejects.toThrow(/not initialised/i);
  });

  it('trains real LoRA matrices locally and emits a valid safetensors adapter without network calls', async () => {
    const artifacts: BrowserLoRAArtifact[] = [];
    let completedKey = '';
    const steps: TrainingStep[] = [];
    const { trainer } = makeTrainer({
      dataMode: 'local-only',
      modelConfig: TINY_MODEL,
      onStep: (step) => steps.push(step),
      onArtifact: (artifact) => artifacts.push(artifact),
      onComplete: (key) => { completedKey = key; },
    });
    await trainer.init();
    await trainer.train(PARAMS, ['hello browser adapter', 'hello private training']);

    expect(steps).toHaveLength(1);
    expect(Number.isFinite(steps[0]!.loss)).toBe(true);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.filename).toMatch(/\.safetensors$/);
    const view = new DataView(artifacts[0]!.bytes);
    const headerLength = Number(view.getBigUint64(0, true));
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(artifacts[0]!.bytes, 8, headerLength)));
    expect(header.__metadata__.peft_type).toBe('LORA');
    expect(header['base_model.model.embed_tokens.lora_A.weight'].shape).toEqual([2, 8]);
    expect(header['base_model.model.embed_tokens.lora_B.weight'].shape[1]).toBe(2);
    const runtimePackage = EvermindModelPackage.fromBlob(artifacts[0]!.evermindPackage);
    expect(runtimePackage.validate()).toEqual({ ok: true, errors: [] });
    expect(runtimePackage.loadLM().config.vocabSize).toBe(Object.keys(artifacts[0]!.tokenizer.vocab).length);
    const api = await import('../api');
    expect(api.downloadDataset).not.toHaveBeenCalled();
    expect(api.uploadArtifact).not.toHaveBeenCalled();
    expect(api.updateTrainingJob).not.toHaveBeenCalled();
    expect(completedKey).toMatch(/^local:\/\//);
  });

  it('source contains no synthetic Math.exp / Math.random loss generation', async () => {
    // Guard against regressions reintroducing the fake loss curve — over every trainer source.
    const fs = await import('node:fs');
    const url = await import('node:url');
    const path = await import('node:path');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const sources = fs.readdirSync(here).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const src = fs.readFileSync(path.join(here, file), 'utf8');
      expect(src).not.toMatch(/Math\.exp/);
      expect(src).not.toMatch(/Math\.random/);
      // The old "prove GPU writing works" buffer hack must be gone.
      expect(src).not.toMatch(/prove GPU/i);
    }
  });
});

describe('training worker contract', () => {
  it('streams progress, transfers the artifact out, and frees the engine and worker on completion', async () => {
    const progress: TrainingProgress[] = [];
    const artifacts: BrowserLoRAArtifact[] = [];
    const { trainer, h } = makeTrainer({
      dataMode: 'local-only',
      modelConfig: TINY_MODEL,
      onProgress: (p) => progress.push(p),
      onArtifact: (a) => artifacts.push(a),
    });
    await trainer.init();
    await trainer.train({ ...PARAMS, epochs: 2 }, ['alpha beta gamma', 'beta gamma delta', 'gamma delta alpha']);

    expect(progress.length).toBeGreaterThanOrEqual(2);
    const last = progress.at(-1)!;
    expect(last.epoch).toBe(2);
    expect(last.step).toBe(6); // 3 sequences × 2 epochs, one optimizer step each
    expect(Number.isFinite(last.loss)).toBe(true);
    expect(last.tokensPerSecond).toBeGreaterThan(0);

    const worker = h.workers[0]!;
    const out = worker.fromWorker.find((m) => m.type === 'artifact');
    expect(out).toBeDefined();
    expect(worker.transferredOut).toHaveLength(2); // bytes + evermindPackage, moved not copied
    expect(worker.transferredOut.every((b) => b instanceof ArrayBuffer)).toBe(true);
    expect(worker.transferredOut.every((b) => b.byteLength === 0)).toBe(true); // detached on the worker side

    const tensors = safetensorsToTensors(new Uint8Array(artifacts[0]!.bytes));
    expect(tensors.map((t) => t.name).sort()).toEqual([
      'base_model.model.embed_tokens.lora_A.weight',
      'base_model.model.embed_tokens.lora_B.weight',
    ]);
    expect(tensors.find((t) => t.name.endsWith('lora_B.weight'))!.data.some((v) => v !== 0)).toBe(true); // B left zero-init ⇒ trained

    expect(h.sessions.destroyed).toBe(1);
    expect(worker.terminated).toBe(true);
  });

  it('cancel stops the run without an artifact, releases the GPU session and terminates the worker', async () => {
    let completed = false;
    const artifacts: BrowserLoRAArtifact[] = [];
    const epochs: number[] = [];
    let trainer!: ReturnType<typeof createBrowserLoRATrainer>;
    const made = makeTrainer({
      dataMode: 'local-only',
      modelConfig: TINY_MODEL,
      onArtifact: (a) => artifacts.push(a),
      onComplete: () => { completed = true; },
      onEpochEnd: (epoch) => { epochs.push(epoch); if (epoch === 1) trainer.cancel(); },
    });
    trainer = made.trainer;
    await trainer.init();
    await trainer.train({ ...PARAMS, epochs: 200 }, ['one two three four', 'five six seven eight']);

    expect(completed).toBe(false);
    expect(artifacts).toHaveLength(0);
    expect(epochs.length).toBeLessThan(200);
    expect(made.h.workers[0]!.fromWorker.some((m) => m.type === 'cancelled')).toBe(true);
    expect(made.h.sessions.destroyed).toBe(1);
    expect(made.h.workers[0]!.terminated).toBe(true);
    expect(made.logs.join('\n')).toMatch(/stop requested/i);
  });

  it('dispose after init releases the engine session and terminates the worker (panel unmount)', async () => {
    const { trainer, h } = makeTrainer();
    await trainer.init();
    trainer.dispose();
    await vi.waitFor(() => expect(h.workers[0]!.terminated).toBe(true));
    expect(h.sessions.destroyed).toBe(1);
    expect(h.workers[0]!.fromWorker.at(-1)?.type).toBe('closed');
  });

  it('repeated runs each get a fresh worker and leave none alive', async () => {
    const h = harness();
    for (let run = 0; run < 3; run += 1) {
      const { trainer } = makeTrainer({ dataMode: 'local-only', modelConfig: TINY_MODEL }, h);
      await trainer.init();
      await trainer.train(PARAMS, ['repeat run text', 'another line']);
    }
    expect(h.workers).toHaveLength(3);
    expect(h.workers.every((w) => w.terminated)).toBe(true);
    expect(h.sessions.destroyed).toBe(3);
  });

  it('keeps the caller’s base checkpoint intact across the transfer', async () => {
    const h = harness();
    const checkpoint = new ArrayBuffer(16);
    const errors: Error[] = [];
    const run = makeTrainer({ dataMode: 'local-only', baseCheckpoint: checkpoint, onError: (e) => errors.push(e) }, h).trainer;
    await run.init();
    await expect(run.train(PARAMS, ['text'])).rejects.toThrow(); // 16 zero bytes are not an Evermind checkpoint
    expect(errors).toHaveLength(1);
    expect(checkpoint.byteLength).toBe(16); // a copy crossed the boundary, not the caller's buffer
    expect(h.sessions.destroyed).toBe(1);
    expect(h.workers[0]!.terminated).toBe(true);
  });
});

// These use the workspace path, so they run after every "no network calls" assertion above.
describe('stop and failure edges', () => {
  it('cancel during the dataset download resolves (no hang), starts nothing and reports nothing', async () => {
    const api = await import('../api');
    let release!: (jsonl: string) => void;
    vi.mocked(api.downloadDataset).mockImplementationOnce(() => new Promise<string>((resolve) => { release = resolve; }));
    const streamsBefore = vi.mocked(api.streamTrainingLogs).mock.calls.length;
    const onComplete = vi.fn();
    const onError = vi.fn();
    const { trainer, h } = makeTrainer({ dataMode: 'workspace', datasetId: 'ds-1', jobId: 'job-1', modelConfig: TINY_MODEL, onComplete, onError });
    await trainer.init();
    const run = trainer.train(PARAMS, []);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    trainer.cancel();
    release('{"instruction":"late corpus text"}\n');
    await expect(run).resolves.toBeUndefined();
    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(vi.mocked(api.streamTrainingLogs).mock.calls.length).toBe(streamsBefore);
    expect(h.workers[0]!.fromWorker.some((m) => m.type === 'artifact' || m.type === 'epoch')).toBe(false);
    await vi.waitFor(() => expect(h.workers[0]!.terminated).toBe(true));
    expect(h.sessions.destroyed).toBe(1);
  });

  it('an artifact that arrives after a stop is treated as cancelled: no onArtifact, onComplete or upload', async () => {
    const api = await import('../api');
    const uploadsBefore = vi.mocked(api.uploadArtifact).mock.calls.length;
    const onArtifact = vi.fn();
    const onComplete = vi.fn();
    let trainer!: ReturnType<typeof createBrowserLoRATrainer>;
    const made = makeTrainer({
      dataMode: 'workspace', jobId: 'job-2', modelConfig: TINY_MODEL, onArtifact, onComplete,
      onEpochEnd: () => trainer.cancel(), // the last epoch: the worker packages before it sees the cancel
    });
    trainer = made.trainer;
    await trainer.init();
    await trainer.train(PARAMS, ['racing the stop button', 'second line']);
    expect(made.h.workers[0]!.fromWorker.some((m) => m.type === 'artifact')).toBe(true); // the race really happened
    expect(onArtifact).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(vi.mocked(api.uploadArtifact).mock.calls.length).toBe(uploadsBefore);
    expect(made.h.workers[0]!.terminated).toBe(true);
  });

  it('a failed per-epoch job update stops the run promptly and fails it with that error', async () => {
    const api = await import('../api');
    vi.mocked(api.updateTrainingJob).mockRejectedValueOnce(new Error('job store unavailable'));
    const onError = vi.fn();
    const epochs: number[] = [];
    const { trainer, h } = makeTrainer({
      dataMode: 'workspace', jobId: 'job-3', modelConfig: TINY_MODEL, onError, onEpochEnd: (epoch) => epochs.push(epoch),
    });
    await trainer.init();
    await expect(trainer.train({ ...PARAMS, epochs: 200 }, ['one two three', 'four five six'])).rejects.toThrow(/job store unavailable/);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(epochs.length).toBeLessThan(200);
    expect(vi.mocked(api.updateTrainingJob)).toHaveBeenCalledWith('job-3', expect.objectContaining({ status: 'failed', errorMessage: 'job store unavailable' }));
    expect(h.workers[0]!.terminated).toBe(true);
    expect(h.sessions.destroyed).toBe(1);
  });
});
