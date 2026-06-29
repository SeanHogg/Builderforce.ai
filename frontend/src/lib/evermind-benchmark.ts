/**
 * evermind-benchmark.ts — in-browser benchmarking for the Studio.
 *
 * Builds a fresh EvermindLM from a corpus, holds out a slice the model never
 * trains on, and scores it with the standard language-model yardsticks
 * (perplexity, bits-per-token, top-1/top-k next-token accuracy, throughput) plus
 * a qualitative generation sample. Runs entirely on-device (pure CPU) via
 * @seanhogg/builderforce-memory-engine — no WebGPU and no network required, so
 * it works in every browser.
 *
 * The canonical harness is `trainAndBenchmark` in the engine. We feature-detect
 * it and delegate when the installed engine ships it; otherwise we fall back to
 * the same algorithm built on the primitives the published engine already
 * exposes (EvermindLM / EvermindLMTrainer / BPETokenizer / crossEntropyLoss).
 * When the engine dependency is bumped to a build that exports the harness, this
 * file uses it automatically with zero changes.
 */

export interface EvermindBenchmarkOptions {
  numMerges?: number;
  dModel?: number;
  numLayers?: number;
  hiddenDim?: number;
  epochs?: number;
  lr?: number;
  seed?: number;
  heldOutRatio?: number;
  topK?: number;
  prompt?: string;
}

export interface EvermindBenchmarkResult {
  sequences: number;
  tokens: number;
  crossEntropy: number;
  perplexity: number;
  bitsPerToken: number;
  top1Accuracy: number;
  topKAccuracy: number;
  topK: number;
  tokensPerSecond?: number;
  elapsedMs?: number;
  trainSequences: number;
  evalSequences: number;
  initialTrainLoss: number;
  finalTrainLoss: number;
  vocabSize: number;
  sample: string;
}

/** Minimal slice of the engine surface this helper relies on. */
interface EngineModule {
  trainAndBenchmark?: (corpus: string, opts?: EvermindBenchmarkOptions) => EvermindBenchmarkResult;
  EvermindLM: new (cfg: Record<string, unknown>) => {
    forward(tokens: number[]): { logits: Float32Array[] };
    generateText(prompt: string, codec: unknown, opts: Record<string, unknown>): string;
  };
  EvermindLMTrainer: new (
    model: unknown,
    opts: { lr?: number; epochs?: number },
  ) => { fit(sequences: number[][]): number[] };
  BPETokenizer: new () => {
    train(corpus: string, opts: { numMerges: number }): void;
    encode(text: string): number[];
    vocabSize: number;
  };
  crossEntropyLoss: (logits: Float32Array, targetId: number) => number;
}

const LN2 = Math.LN2;

function argmax(logits: Float32Array): number {
  let best = 0;
  let bestVal = -Infinity;
  for (let i = 0; i < logits.length; i++) {
    if (logits[i]! > bestVal) {
      bestVal = logits[i]!;
      best = i;
    }
  }
  return best;
}

function inTopK(logits: Float32Array, target: number, k: number): boolean {
  const targetVal = logits[target]!;
  let greater = 0;
  for (let i = 0; i < logits.length; i++) {
    if (logits[i]! > targetVal) greater++;
    if (greater >= k) return false;
  }
  return true;
}

/** Deterministic LCG matching the engine's SeededRng, for a reproducible split. */
function makeRng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

function corpusToSequences(corpus: string, tok: { encode(text: string): number[] }): number[][] {
  return corpus
    .split(/(?<=\.)\s+/)
    .map((s) => tok.encode(s.trim()))
    .filter((ids) => ids.length >= 2);
}

/** Local implementation mirroring the engine's `trainAndBenchmark`. */
function localTrainAndBenchmark(
  engine: EngineModule,
  corpus: string,
  opts: EvermindBenchmarkOptions,
): EvermindBenchmarkResult {
  const seed = opts.seed ?? 7;
  const tok = new engine.BPETokenizer();
  tok.train(corpus, { numMerges: opts.numMerges ?? 100 });

  const all = corpusToSequences(corpus, tok);
  if (all.length < 2) {
    throw new Error(
      'corpus produced fewer than 2 trainable sentences; add more text so a held-out eval split can be reserved',
    );
  }

  // Deterministic shuffle + split.
  const rng = makeRng(seed);
  const order = [...all];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const ratio = Math.min(0.9, Math.max(0.05, opts.heldOutRatio ?? 0.25));
  let evalCount = Math.round(order.length * ratio);
  evalCount = Math.max(1, Math.min(order.length - 1, evalCount));
  const evalSeqs = order.slice(0, evalCount);
  const trainSeqs = order.slice(evalCount);

  const model = new engine.EvermindLM({
    vocabSize: tok.vocabSize,
    dModel: opts.dModel ?? 32,
    numLayers: opts.numLayers ?? 2,
    hiddenDim: opts.hiddenDim ?? 48,
    seed,
  });
  const epochs = opts.epochs ?? 30;
  const history = new engine.EvermindLMTrainer(model, { lr: opts.lr ?? 0.03, epochs }).fit(trainSeqs);

  // Score the held-out split.
  const topK = opts.topK ?? 5;
  let ceSum = 0;
  let tokens = 0;
  let top1Hits = 0;
  let topKHits = 0;
  let elapsedMs = 0;
  const now = () =>
    typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
  for (const seq of evalSeqs) {
    if (seq.length < 2) continue;
    const t0 = now();
    const { logits } = model.forward(seq);
    elapsedMs += now() - t0;
    const targets = seq.slice(1);
    const n = Math.min(logits.length, targets.length);
    for (let t = 0; t < n; t++) {
      const target = targets[t]!;
      const lg = logits[t]!;
      if (target < 0 || target >= lg.length) continue;
      ceSum += engine.crossEntropyLoss(lg, target);
      if (argmax(lg) === target) top1Hits++;
      if (inTopK(lg, target, topK)) topKHits++;
      tokens++;
    }
  }

  const meanCe = tokens > 0 ? ceSum / tokens : 0;
  const sample = model.generateText(opts.prompt ?? 'The', tok, { maxNewTokens: 8, temperature: 0 });

  return {
    sequences: evalSeqs.length,
    tokens,
    crossEntropy: meanCe,
    perplexity: Math.exp(meanCe),
    bitsPerToken: meanCe / LN2,
    top1Accuracy: tokens > 0 ? top1Hits / tokens : 0,
    topKAccuracy: tokens > 0 ? topKHits / tokens : 0,
    topK,
    elapsedMs,
    tokensPerSecond: elapsedMs > 0 ? (tokens / elapsedMs) * 1000 : 0,
    trainSequences: trainSeqs.length,
    evalSequences: evalSeqs.length,
    initialTrainLoss: history[0] ?? 0,
    finalTrainLoss: history.at(-1) ?? 0,
    vocabSize: tok.vocabSize,
    sample,
  };
}

/**
 * Train + benchmark an EvermindLM on the given corpus, on-device. Yields once
 * before the synchronous CPU work so the caller's "running" UI can paint first.
 */
export async function runEvermindBenchmark(
  corpus: string,
  opts: EvermindBenchmarkOptions = {},
): Promise<EvermindBenchmarkResult> {
  const engine = (await import('@seanhogg/builderforce-memory-engine')) as unknown as EngineModule;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  if (typeof engine.trainAndBenchmark === 'function') {
    return engine.trainAndBenchmark(corpus, opts);
  }
  return localTrainAndBenchmark(engine, corpus, opts);
}
