import { afterAll, describe, expect, it } from 'vitest';
import { BPETokenizer, EvermindLM, EvermindLMLoRA } from '@seanhogg/builderforce-memory-engine';
import { cpu, endScope, startScope, tensor, type Backend } from '@webdit/torch/autograd';
import { EvermindEngineGraph, selectExperts } from './evermindEngineGraph';
import { trainLoRAOnEngine } from './loraEngineTrainer';
import type { TrainingParams } from './protocol';

/**
 * Parity oracle for the engine re-expression of the browser trainer: the
 * engine graph must reproduce `EvermindLM.lossAndBackward` (loss AND the
 * tied-embedding gradient the adapter is trained from), and a whole engine
 * fine-tune must track the memory engine's exact CPU `lora.fit` loss curve.
 * The WebGPU variant runs through Dawn's Node binding when it is installed
 * and an adapter exists; otherwise it skips with the reason.
 */

const CONFIG = { vocabSize: 23, dModel: 8, numLayers: 2, convKernel: 3, hiddenDim: 16, numExperts: 4, topK: 2, seed: 7 };
const TOKENS = [1, 5, 9, 2, 17, 4, 4, 11, 20, 3, 8];

function close(actual: ArrayLike<number>, expected: ArrayLike<number>, atol: number, rtol: number): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    expect(Math.abs(actual[i]! - expected[i]!), `index ${i}`).toBeLessThanOrEqual(atol + rtol * Math.abs(expected[i]!));
  }
}

async function engineLossAndGrad(backend: Backend, model: EvermindLM, tokens: number[]) {
  const graph = new EvermindEngineGraph(model, backend);
  const emb = tensor(model.emb, [model.config.vocabSize, model.config.dModel], { backend, requiresGrad: true });
  try {
    startScope();
    let loss = 0;
    try {
      const l = await graph.loss(tokens, emb);
      l.backward();
      loss = await l.item();
    } finally {
      endScope();
    }
    return { loss, grad: Float32Array.from(await emb.grad!.data()) };
  } finally {
    emb.dispose();
    graph.dispose();
  }
}

function referenceLossAndGrad(model: EvermindLM, tokens: number[]) {
  model.zeroGrad();
  const loss = model.lossAndBackward(tokens);
  return { loss, grad: Float32Array.from(model.gradients()[0]!.data) };
}

async function probeDawn(): Promise<{ backend: Backend & { destroy(): void } | null; reason: string }> {
  try {
    // Dawn's Node binding is the ENGINE's dev dependency (webdit/torch/test/helpers/gpu.ts uses it).
    const { createRequire } = await import('node:module');
    const { fileURLToPath, pathToFileURL } = await import('node:url');
    const engineManifest = fileURLToPath(new URL('../../../../webdit/torch/package.json', import.meta.url));
    const dawn = pathToFileURL(createRequire(engineManifest).resolve('webgpu')).href;
    const { create } = (await import(/* @vite-ignore */ dawn)) as { create: (flags: string[]) => GPU };
    const { createWebGPUBackend } = await import('@webdit/torch/webgpu');
    const backend = await createWebGPUBackend({ gpu: create([]) });
    return { backend, reason: `adapter: ${backend.adapterDescription}` };
  } catch (error) {
    return { backend: null, reason: `no WebGPU adapter: ${error instanceof Error ? error.message : String(error)}` };
  }
}

describe('selectExperts', () => {
  it('picks the top-k logits per position, ties to the lower expert index', () => {
    expect(selectExperts([0.1, 0.9, 0.5, 0.9, 3, 2, 1, 0], 2, 4, 2)).toEqual([
      [false, true, false, true],
      [true, true, false, false],
    ]);
  });
});

describe('EvermindEngineGraph (CPU reference backend)', () => {
  it('matches EvermindLM.lossAndBackward: loss and tied-embedding gradient', async () => {
    const model = new EvermindLM(CONFIG);
    const reference = referenceLossAndGrad(model, TOKENS);
    const engine = await engineLossAndGrad(cpu, model, TOKENS);
    expect(Math.abs(engine.loss - reference.loss)).toBeLessThan(1e-5 + 1e-5 * reference.loss);
    close(engine.grad, reference.grad, 1e-6, 1e-3);
  });

  it('windowed backward (long sequences) is exactly the full-sequence loss and gradient', async () => {
    const model = new EvermindLM(CONFIG);
    const tokens = Array.from({ length: 61 }, (_, i) => (i * 7 + 3) % CONFIG.vocabSize);
    const reference = referenceLossAndGrad(model, tokens);
    const graph = new EvermindEngineGraph(model, cpu);
    const emb = tensor(model.emb, [CONFIG.vocabSize, CONFIG.dModel], { requiresGrad: true });
    try {
      for (const maxScored of [7, 16, 60]) {
        emb.grad?.dispose();
        emb.grad = null;
        const loss = await graph.backwardSequence(tokens, () => emb, maxScored);
        expect(Math.abs((await loss.item()) - reference.loss), `window ${maxScored}`).toBeLessThan(1e-5 + 1e-5 * reference.loss);
        close(await emb.grad!.data(), reference.grad, 1e-6, 1e-3);
        loss.dispose();
      }
    } finally {
      emb.dispose();
      graph.dispose();
    }
  });

  it('releases the frozen weights it uploads', async () => {
    const model = new EvermindLM(CONFIG);
    const graph = new EvermindEngineGraph(model, cpu);
    const constants = (graph as unknown as { constants: Array<{ isDisposed: boolean }> }).constants;
    expect(constants.length).toBeGreaterThan(0);
    const held = [...constants];
    graph.dispose();
    expect(held.every((t) => t.isDisposed)).toBe(true);
  });
});

describe('engine fine-tune vs the exact CPU lora.fit reference', () => {
  it('produces a comparable, falling loss curve under the same seeds', async () => {
    const examples = ['the quick brown fox jumps', 'over the lazy dog again', 'the dog sleeps by the fox'];
    const params: TrainingParams = {
      epochs: 6, batchSize: 1, learningRate: 5e-3, gradientAccumulationSteps: 1, precision: 'float16',
      loraConfig: { rank: 2, alpha: 4, targetModules: ['embed_tokens'] },
    };
    const modelConfig = { dModel: 8, numLayers: 1, hiddenDim: 16, numExperts: 2, topK: 1 };
    const curve: number[] = [];
    const artifact = await trainLoRAOnEngine(cpu, { modelId: 'parity', params, examples, modelConfig }, {
      log: () => undefined, progress: () => undefined, epoch: (step) => curve.push(step.loss), isCancelled: () => false,
    });
    expect(artifact).not.toBeNull();

    // The same base, tokenizer and adapter init, trained by the memory engine's exact CPU path.
    const tokenizer = new BPETokenizer();
    tokenizer.train(examples, { numMerges: Math.min(512, Math.max(64, examples.length * 8)) });
    const model = new EvermindLM({ vocabSize: tokenizer.vocabSize, seed: 0x42f0ce, ...modelConfig }); // the trainer's default base seed
    const lora = new EvermindLMLoRA(model, { rank: 2, alpha: 4, baseQuant: 'fp16', seed: 0x10a0 });
    const sequences = examples.map((text) => tokenizer.encode(text, { addBos: true, addEos: true }));
    // The trainer's AdamW: decoupled weight decay 0.01 — so this is an exact oracle, not an approximate one.
    const reference = lora.fit(sequences, { epochs: params.epochs, lr: params.learningRate, accumSteps: 1, weightDecay: 0.01 });

    expect(curve).toHaveLength(params.epochs);
    close(curve, reference, 1e-4, 1e-3); // float32 engine vs the reference's double accumulations
    expect(curve.at(-1)!).toBeLessThan(curve[0]!);
  });
});

const dawn = await probeDawn();
afterAll(() => dawn.backend?.destroy());

describe.skipIf(!dawn.backend)(`EvermindEngineGraph (WebGPU; ${dawn.reason})`, () => {
  it('matches the CPU reference on the GPU backend', async () => {
    const model = new EvermindLM(CONFIG);
    const reference = referenceLossAndGrad(model, TOKENS);
    const engine = await engineLossAndGrad(dawn.backend!, model, TOKENS);
    expect(Math.abs(engine.loss - reference.loss)).toBeLessThan(1e-4 + 1e-4 * reference.loss);
    close(engine.grad, reference.grad, 1e-5, 1e-2);
  });

  it('a whole fine-tune on the GPU tracks the CPU engine run', async () => {
    const request = {
      modelId: 'gpu-parity',
      examples: ['the quick brown fox jumps', 'over the lazy dog again'],
      modelConfig: { dModel: 8, numLayers: 1, hiddenDim: 16, numExperts: 2, topK: 1 },
      params: { epochs: 4, batchSize: 1, learningRate: 5e-3, gradientAccumulationSteps: 2, precision: 'float16', loraConfig: { rank: 2, alpha: 4, targetModules: ['embed_tokens'] } } satisfies TrainingParams,
    };
    const run = async (backend: Backend) => {
      const curve: number[] = [];
      await trainLoRAOnEngine(backend, request, { log: () => undefined, progress: () => undefined, epoch: (s) => curve.push(s.loss), isCancelled: () => false });
      return curve;
    };
    close(await run(dawn.backend!), await run(cpu), 1e-4, 1e-2);
  });
});
