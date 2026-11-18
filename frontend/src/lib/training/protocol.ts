/**
 * Browser LoRA training — the shared contract between the panel-side client
 * ({@link ./browserLoRATrainer}) and the training Web Worker
 * ({@link ./training.worker}). Everything here is structured-clone safe: plain
 * data plus ArrayBuffers, which are TRANSFERRED across the boundary (never
 * SharedArrayBuffer). PRD 22 §3.2 / PRD 31 §W9 phase 7.
 */

import type { BPETokenizer, EvermindLMConfig } from '@seanhogg/builderforce-memory-engine';

export interface LoRAConfig {
  rank: number;
  alpha: number;
  targetModules: string[];
}

export interface TrainingParams {
  epochs: number;
  batchSize: number;
  learningRate: number;
  gradientAccumulationSteps: number;
  precision: 'float16' | 'int8';
  loraConfig: LoRAConfig;
}

/** One point of the loss curve — emitted once per epoch. */
export interface TrainingStep {
  epoch: number;
  step: number;
  loss: number;
  learningRate: number;
}

/** Live progress — emitted per optimizer step, throttled by the worker. */
export interface TrainingProgress {
  epoch: number;
  /** Optimizer steps taken so far, across epochs. */
  step: number;
  /** Mean loss over the current epoch so far. */
  loss: number;
  tokensPerSecond: number;
}

export type TrainingDataMode = 'local-only' | 'workspace';

export interface BrowserLoRAArtifact {
  bytes: ArrayBuffer;
  filename: string;
  format: 'safetensors';
  adapterBytes: number;
  baseBytes: number;
  trainableParams: number;
  baseParams: number;
  /** Merged, self-contained runtime package used by the canonical publish route. */
  evermindPackage: ArrayBuffer;
  tokenizer: { vocab: Record<string, number>; merges: string[] };
}

export type TokenizerSpec = Parameters<BPETokenizer['loadHuggingFace']>[0];

/** What the worker needs to run one fine-tune. The corpus is already resolved to text. */
export interface EngineTrainingRequest {
  modelId: string;
  params: TrainingParams;
  examples: string[];
  /** Optional portable Evermind base checkpoint (transferred — send a copy you can lose). */
  baseCheckpoint?: ArrayBuffer;
  /** Tokenizer paired with baseCheckpoint. A corpus tokenizer is learned when omitted. */
  tokenizerSpec?: TokenizerSpec;
  modelConfig?: Omit<EvermindLMConfig, 'vocabSize'>;
}

export type TrainingDevice = 'webgpu' | 'cpu';

export type TrainingWorkerRequest =
  | { type: 'init' }
  | { type: 'train'; request: EngineTrainingRequest }
  /** Stop at the next sequence boundary, release the GPU, then acknowledge. */
  | { type: 'cancel' };

export type TrainingWorkerResponse =
  | { type: 'ready'; device: TrainingDevice; detail: string }
  | { type: 'log'; message: string }
  | { type: 'progress'; progress: TrainingProgress }
  | { type: 'epoch'; step: TrainingStep }
  | { type: 'artifact'; artifact: BrowserLoRAArtifact }
  | { type: 'cancelled' }
  | { type: 'error'; message: string }
  /** The worker released every engine resource; the client may terminate it. */
  | { type: 'closed' };

const BROWSER_LORA_MAX_PARAMS = 20e6;

export function canTrainInBrowser(maxParams: number): boolean {
  return maxParams <= BROWSER_LORA_MAX_PARAMS;
}

/** The buffers a response carries, so the sender can transfer instead of copy. */
export function transferablesOf(message: TrainingWorkerResponse | TrainingWorkerRequest): ArrayBuffer[] {
  if (message.type === 'artifact') return [message.artifact.bytes, message.artifact.evermindPackage];
  if (message.type === 'train' && message.request.baseCheckpoint) return [message.request.baseCheckpoint];
  return [];
}
