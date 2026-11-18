/**
 * Browser LoRA training — the interaction-thread client of the training
 * worker (PRD 22 §3.2, PRD 31 §W9 phase 7). The fine-tune itself — tokenizer,
 * model, forward/backward/AdamW on the `@webdit/torch` engine, artifact
 * packaging — runs in {@link ./training.worker}. This side only resolves the
 * corpus, relays events and does the workspace I/O (dataset download, job
 * updates, artifact upload), which is network-bound.
 *
 * Lifecycle (§3.3): one worker per run. It is terminated when the run
 * completes, fails or is cancelled, and on `dispose()` (panel unmount); the
 * worker destroys its GPU device before it acknowledges a stop. After a stop
 * no callback fires and nothing is uploaded, whatever the worker still sends.
 */

import { downloadDataset, streamTrainingLogs, updateTrainingJob, uploadArtifact } from '../api';
import type { TrainingLog } from '../types';
import {
  transferablesOf,
  type BrowserLoRAArtifact,
  type EngineTrainingRequest,
  type TokenizerSpec,
  type TrainingDataMode,
  type TrainingDevice,
  type TrainingParams,
  type TrainingProgress,
  type TrainingStep,
  type TrainingWorkerRequest,
  type TrainingWorkerResponse,
} from './protocol';

export type TrainingWorkerFactory = () => Worker;

export interface BrowserLoRATrainerOptions {
  modelId: string;
  jobId?: string;
  datasetId?: string;
  /** Local-only mode performs no dataset download, log stream, job update, or artifact upload. */
  dataMode?: TrainingDataMode;
  /** Optional portable Evermind base checkpoint. When omitted a deterministic browser base is created. */
  baseCheckpoint?: ArrayBuffer;
  /** Tokenizer paired with baseCheckpoint. A corpus tokenizer is learned when no checkpoint is supplied. */
  tokenizerSpec?: TokenizerSpec;
  modelConfig?: EngineTrainingRequest['modelConfig'];
  onLog: (message: string) => void;
  onStep: (step: TrainingStep) => void;
  onEpochEnd: (epoch: number, avgLoss: number) => void;
  /** The device the WORKER acquired (its own WebGPU device, or the CPU reference). */
  onReady?: (device: TrainingDevice, detail: string) => void;
  onProgress?: (progress: TrainingProgress) => void;
  onArtifact?: (artifact: BrowserLoRAArtifact) => void;
  onComplete: (artifactKey: string) => void;
  onError: (error: Error) => void;
  /** Injectable for tests; production spawns the bundled training worker. */
  workerFactory?: TrainingWorkerFactory;
}

export interface BrowserLoRATraining {
  /** Spawn the worker and acquire its engine backend (WebGPU, else CPU). */
  init(): Promise<void>;
  /** Run one fine-tune. Resolves after `onComplete`, or silently when stopped. */
  train(params: TrainingParams, localExamples: string[]): Promise<void>;
  /** Stop at the next sequence; the worker releases the GPU, then is terminated. */
  cancel(): void;
  /** Panel unmount: stop as `cancel` does, silently. */
  dispose(): void;
}

/** How long a stopped worker gets to release its GPU before it is terminated anyway. */
const STOP_GRACE_MS = 2000;

type Terminal = Extract<TrainingWorkerResponse, { type: 'ready' | 'artifact' | 'cancelled' | 'error' | 'closed' }>;

function defaultWorkerFactory(): Worker {
  // The statically-analysable `new URL(…, import.meta.url)` form webpack/Turbopack/vite
  // compile into a worker bundle; the `window` guard keeps server layers from emitting it.
  if (typeof window !== 'undefined') {
    return new Worker(new URL('./training.worker.ts', import.meta.url), { type: 'module', name: 'browser-lora-training' });
  }
  throw new Error('The training worker runs only in a browser.');
}

function parseJsonl(jsonl: string): string[] {
  return jsonl.split('\n').filter(Boolean).map((line) => {
    try {
      const ex = JSON.parse(line) as { instruction?: string; input?: string; output?: string };
      return [ex.instruction, ex.input, ex.output].filter(Boolean).join('\n').trim();
    } catch {
      return line.trim();
    }
  }).filter(Boolean);
}

const asError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));

class BrowserLoRATrainer implements BrowserLoRATraining {
  private worker: Worker | null = null;
  private ready = false;
  /** Set by cancel()/dispose(): from then on nothing is reported, uploaded or completed. */
  private stopRequested = false;
  private settle: ((message: Terminal) => void) | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private onEpoch: ((step: TrainingStep) => void) | null = null;

  constructor(private readonly options: BrowserLoRATrainerOptions) {}

  async init(): Promise<void> {
    this.shutdown();
    this.stopRequested = false;
    this.options.onLog('Initialising exact-gradient browser LoRA engine…');
    const worker = (this.options.workerFactory ?? defaultWorkerFactory)();
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<TrainingWorkerResponse>) => this.receive(event.data);
    worker.onerror = (event: ErrorEvent) => this.finish({ type: 'error', message: event.message || 'The training worker failed.' });
    const reply = await this.request({ type: 'init' });
    if (this.stopRequested) return;
    if (reply.type !== 'ready') {
      this.shutdown();
      throw new Error(reply.type === 'error' ? reply.message : 'The training worker did not start.');
    }
    this.ready = true;
    this.options.onReady?.(reply.device, reply.detail);
    this.options.onLog(reply.device === 'webgpu'
      ? `Browser LoRA ready (engine autograd on WebGPU — ${reply.detail}; training runs in a worker).`
      : 'Browser LoRA ready (engine autograd on the CPU reference; training runs in a worker).');
  }

  async train(params: TrainingParams, localExamples: string[]): Promise<void> {
    if (this.stopRequested) return;
    if (!this.ready || !this.worker) throw new Error('Trainer not initialised. Call init() first.');
    const { options } = this;
    const mode = options.dataMode ?? 'workspace';
    const jobId = mode === 'workspace' ? options.jobId : undefined;
    let jobUpdates: Promise<void> = Promise.resolve();
    let jobFailure = null as Error | null; // assigned from the update chain, so not narrowed to null here
    this.onEpoch = (step) => {
      options.onStep(step);
      options.onEpochEnd(step.epoch, step.loss);
      if (!jobId) return;
      jobUpdates = jobUpdates
        .then(() => updateTrainingJob(jobId, { status: 'running', currentEpoch: step.epoch, currentLoss: step.loss }))
        .then(() => undefined, (error: unknown) => {
          if (jobFailure) return;
          jobFailure = asError(error);
          this.stop(); // the job record can no longer follow the run: end it now, then fail with this error
        });
    };
    try {
      let examples = localExamples.map((item) => item.trim()).filter(Boolean);
      if (mode === 'workspace' && options.datasetId) {
        options.onLog(`Fetching workspace dataset ${options.datasetId}…`);
        examples = parseJsonl(await downloadDataset(options.datasetId));
        if (this.stopRequested) return;
      }
      if (examples.length === 0) throw new Error('No training text available.');
      if (jobId) {
        streamTrainingLogs(jobId, (log: TrainingLog) => {
          if (log.message && !this.stopRequested) options.onLog(`[server] ${log.message}`);
        }).catch(() => undefined);
      }
      // A copy: the transfer detaches it, and the caller keeps its checkpoint for the next run.
      const reply = await this.request({
        type: 'train',
        request: { modelId: options.modelId, params, examples, baseCheckpoint: options.baseCheckpoint?.slice(0), tokenizerSpec: options.tokenizerSpec, modelConfig: options.modelConfig },
      });
      await jobUpdates;
      if (jobFailure) throw jobFailure;
      // A stop wins over anything the worker sent after it — even a finished artifact.
      if (this.stopRequested || reply.type === 'cancelled' || reply.type === 'closed') return;
      if (reply.type === 'error') throw new Error(reply.message);
      if (reply.type !== 'artifact') throw new Error(`Unexpected training worker reply: ${reply.type}`);
      this.shutdown(); // the run is over and the worker already released its device
      const { artifact } = reply;
      options.onArtifact?.(artifact);
      let artifactKey = `local://${artifact.filename}`;
      if (jobId) {
        const result = await uploadArtifact(jobId, artifact.bytes, {
          format: 'safetensors',
          filename: artifact.filename,
          baseModel: options.modelId,
          rank: params.loraConfig.rank,
          alpha: params.loraConfig.alpha,
        });
        artifactKey = result.r2Key;
        await updateTrainingJob(jobId, { status: 'completed', currentEpoch: params.epochs, r2ArtifactKey: artifactKey });
      }
      if (this.stopRequested) return;
      options.onLog(`LoRA adapter ready: ${artifactKey}`);
      options.onComplete(artifactKey);
    } catch (error) {
      const err = asError(error);
      if (jobId) await updateTrainingJob(jobId, { status: 'failed', errorMessage: err.message }).catch(() => undefined);
      if (this.stopRequested) return;
      options.onError(err);
      throw err;
    } finally {
      this.onEpoch = null;
      // A stop in flight ends with the worker's acknowledgement (after it released the
      // device) or the grace timer; anything else ends the worker now.
      if (!this.stopTimer) this.shutdown();
    }
  }

  cancel(): void {
    if (this.stopRequested) return;
    this.options.onLog('Training stop requested…');
    this.stopRequested = true;
    this.stop();
  }

  dispose(): void {
    this.stopRequested = true;
    this.stop();
  }

  /** Ask the worker to stop and release its device; terminate it if it does not answer in time. */
  private stop(): void {
    this.ready = false;
    if (!this.worker) {
      this.shutdown();
      return;
    }
    if (this.stopTimer) return;
    this.worker.postMessage({ type: 'cancel' } satisfies TrainingWorkerRequest);
    this.stopTimer = setTimeout(() => this.shutdown(), STOP_GRACE_MS);
  }

  private request(message: TrainingWorkerRequest): Promise<Terminal> {
    // No worker (already stopped and terminated): nothing will ever answer.
    if (!this.worker) return Promise.resolve({ type: 'closed' });
    return new Promise((resolve) => {
      this.settle = resolve;
      this.worker!.postMessage(message, transferablesOf(message));
    });
  }

  private receive(message: TrainingWorkerResponse): void {
    switch (message.type) {
      case 'log': if (!this.stopRequested) this.options.onLog(message.message); return;
      case 'progress': if (!this.stopRequested) this.options.onProgress?.(message.progress); return;
      case 'epoch': if (!this.stopRequested) this.onEpoch?.(message.step); return;
      default: this.finish(message);
    }
  }

  /** Hand a terminal reply to whoever awaits it; a stop acknowledged with nobody waiting ends the worker. */
  private finish(message: Terminal): void {
    const settle = this.settle;
    this.settle = null;
    settle?.(message);
    const stopAcknowledged = this.stopTimer !== null && message.type !== 'ready';
    if (stopAcknowledged || (!settle && (message.type === 'closed' || message.type === 'cancelled' || message.type === 'error'))) this.shutdown();
  }

  /** Terminate the worker (idempotent) and release anyone still waiting on it. */
  private shutdown(): void {
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    this.ready = false;
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    }
    const settle = this.settle;
    this.settle = null;
    settle?.({ type: 'closed' });
  }
}

/** The one construction point for browser LoRA training (presentation never `new`s an engine). */
export function createBrowserLoRATrainer(options: BrowserLoRATrainerOptions): BrowserLoRATraining {
  return new BrowserLoRATrainer(options);
}
