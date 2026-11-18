/**
 * The browser LoRA fine-tune on the `@webdit/torch` engine — what the training
 * worker runs. Forward, backward and AdamW all go through the engine's
 * autograd: the merged weight is the engine's `loraMerge` op (the moved
 * `LORA_FORWARD_WGSL` / `LORA_BACKWARD_WGSL` kernels on WebGPU) and the update
 * is `optim.AdamW` (`ADAMW_WGSL`). The same code runs on the CPU reference
 * backend when the worker has no GPU, so there is one algorithm, not two.
 *
 * Only the adapter A/B are trainable; the Evermind base is uploaded as frozen
 * constants and checked unchanged before the artifact is packaged.
 */

import {
  BPETokenizer,
  EvermindLM,
  EvermindLMLoRA,
  importEvermind,
  type BaseQuant,
} from '@seanhogg/builderforce-memory-engine';
import { F, keep, optim, tensor, type Backend, type DeviceTensor } from '@webdit/torch/autograd';
import { EvermindEngineGraph } from './evermindEngineGraph';
import { packageBrowserLoRAArtifact } from './loraArtifact';
import type { BrowserLoRAArtifact, EngineTrainingRequest, TrainingProgress, TrainingStep } from './protocol';

export interface EngineTrainingHooks {
  log(message: string): void;
  progress(progress: TrainingProgress): void;
  epoch(step: TrainingStep): void;
  /** Polled between sequences; true stops the run without an artifact. */
  isCancelled(): boolean;
}

/** Minimum gap between progress events, and between yields to the worker's message loop. */
const PROGRESS_INTERVAL_MS = 250;
const YIELD_INTERVAL_MS = 30;
/**
 * Most predictions scored in one forward/backward window: bounds activation
 * memory and the T × vocab head for long sequences. Exact — see
 * `EvermindEngineGraph.backwardSequence`.
 */
export const MAX_SCORED_PER_WINDOW = 512;
const DEFAULT_BASE = { dModel: 96, numLayers: 2, hiddenDim: 192, seed: 0x42f0ce } as const;
const ADAPTER_SEED = 0x10a0;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
/** A macrotask, so a `cancel` message queued behind a CPU-bound loop is delivered. */
const yieldToEvents = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function buildBase(request: EngineTrainingRequest, examples: string[]): { tokenizer: BPETokenizer; model: EvermindLM } {
  const tokenizer = new BPETokenizer();
  if (request.tokenizerSpec) tokenizer.loadHuggingFace(request.tokenizerSpec);
  else tokenizer.train(examples, { numMerges: Math.min(512, Math.max(64, examples.length * 8)) });
  const model = request.baseCheckpoint
    ? importEvermind(new Uint8Array(request.baseCheckpoint))
    : new EvermindLM({ vocabSize: tokenizer.vocabSize, ...DEFAULT_BASE, ...request.modelConfig });
  if (model.config.vocabSize !== tokenizer.vocabSize) {
    throw new Error(`Tokenizer vocabulary (${tokenizer.vocabSize}) does not match base model (${model.config.vocabSize}).`);
  }
  return { tokenizer, model };
}

function sameValues(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return false;
  return true;
}

/**
 * Train the adapter and package it. Resolves `null` when cancelled. Every
 * engine tensor it creates is released before it returns, on every path.
 */
export async function trainLoRAOnEngine(
  backend: Backend,
  request: EngineTrainingRequest,
  hooks: EngineTrainingHooks,
): Promise<BrowserLoRAArtifact | null> {
  const { params } = request;
  const examples = request.examples.map((item) => item.trim()).filter(Boolean);
  if (examples.length === 0) throw new Error('No training text available.');
  const { tokenizer, model } = buildBase(request, examples);
  const quant: BaseQuant = params.precision === 'int8' ? 'int8' : 'fp16';
  const lora = new EvermindLMLoRA(model, { rank: params.loraConfig.rank, alpha: params.loraConfig.alpha, baseQuant: quant, seed: ADAPTER_SEED });
  const sequences = examples.map((text) => tokenizer.encode(text, { addBos: true, addEos: true })).filter((s) => s.length > 1);
  if (sequences.length === 0) throw new Error('Tokenizer produced no trainable sequences.');

  const { adapter } = lora;
  const frozenBase = lora.mergedEmb(); // B starts at zero, so this is the (quantized) frozen base
  const o = { backend };
  const owned: DeviceTensor[] = [];
  const own = (t: DeviceTensor) => { owned.push(keep(t)); return t; };
  const graph = new EvermindEngineGraph(model, backend);
  let optimizer: optim.AdamW | null = null;
  try {
    const base = own(tensor(frozenBase, [adapter.rows, adapter.cols], o));
    const a = own(tensor(adapter.A, [adapter.rank, adapter.cols], { ...o, requiresGrad: true }));
    const b = own(tensor(adapter.B, [adapter.rows, adapter.rank], { ...o, requiresGrad: true }));
    const opt = new optim.AdamW([a, b], { lr: params.learningRate, betas: [0.9, 0.999], eps: 1e-8, weightDecay: 0.01 });
    optimizer = opt;
    const accumulate = Math.max(1, params.gradientAccumulationSteps);
    hooks.log(`Training ${adapter.numParams().toLocaleString()} adapter parameters; base weights are frozen.`);

    let optimizerSteps = 0;
    let tokens = 0;
    const started = now();
    let lastProgress = -Infinity;
    let lastYield = now();
    const merged = () => F.loraMerge(base, a, b, adapter.scale);
    for (let epoch = 1; epoch <= params.epochs; epoch += 1) {
      let count = 0, pending = 0, loss = 0;
      // The epoch's loss stays on the device; it is read back only when reported.
      let lossSum: DeviceTensor | null = null;
      const meanLoss = async () => (lossSum && count ? (await lossSum.item()) / count : 0);
      const report = async (force: boolean) => {
        const at = now();
        if (!force && at - lastProgress < PROGRESS_INTERVAL_MS) return;
        lastProgress = at;
        const seconds = Math.max((at - started) / 1000, 1e-3);
        hooks.progress({ epoch, step: optimizerSteps, loss: await meanLoss(), tokensPerSecond: tokens / seconds });
      };
      const flush = async () => {
        if (!pending) return;
        opt.step(1 / pending);
        opt.zeroGrad();
        pending = 0;
        optimizerSteps += 1;
        await report(false);
      };
      try {
        for (const sequence of sequences) {
          if (hooks.isCancelled()) return null;
          const sequenceLoss = await graph.backwardSequence(sequence, merged, MAX_SCORED_PER_WINDOW);
          if (lossSum) {
            const next: DeviceTensor = keep(F.add(lossSum, sequenceLoss));
            lossSum.dispose();
            sequenceLoss.dispose();
            lossSum = next;
          } else lossSum = sequenceLoss;
          count += 1; pending += 1; tokens += sequence.length;
          if (pending >= accumulate) await flush();
          if (now() - lastYield > YIELD_INTERVAL_MS) { await yieldToEvents(); lastYield = now(); }
        }
        await flush();
        await report(true);
        loss = await meanLoss();
      } finally {
        (lossSum as DeviceTensor | null)?.dispose();
      }
      hooks.epoch({ epoch, step: epoch, loss, learningRate: params.learningRate });
      hooks.log(`Epoch ${epoch}/${params.epochs} — loss ${loss.toFixed(4)}`);
      await yieldToEvents();
      lastYield = now();
    }
    if (hooks.isCancelled()) return null;

    if (!sameValues(await base.data(), frozenBase)) {
      throw new Error('Frozen-base invariant failed: base weights changed during LoRA training.');
    }
    adapter.A.set(await a.data());
    adapter.B.set(await b.data());
    return packageBrowserLoRAArtifact({ lora, model, tokenizer, modelId: request.modelId, params, sequenceCount: sequences.length });
  } finally {
    optimizer?.dispose();
    for (const t of owned) t.dispose();
    graph.dispose();
  }
}
