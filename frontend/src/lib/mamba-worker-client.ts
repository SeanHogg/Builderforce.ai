/**
 * Mamba Web Worker client — the main-thread {@link ModelProvider} that proxies to
 * the engine running inside {@link ./mamba.worker}. Drop-in for
 * {@link MambaModelProvider}: same generate/stream/train/exportTrainedWeights
 * surface, but all GPU + CPU-heavy work happens off the main thread so the UI
 * never janks during generation (the article's Web Worker best practice).
 *
 * Worker creation is feature-detected and wrapped in try/catch: if the runtime
 * can't spawn the worker, the provider reports not-ready and the inference
 * cascade transparently falls through to the next tier — nothing breaks.
 */

import type {
  MambaProviderConfig,
  ModelContext,
  ModelProvider,
} from './model-provider';
import { createInferenceProvider, type InferenceCascadeConfig } from './model-provider';
import type {
  InitResult,
  TrainRequestOptions,
  WorkerRequest,
  WorkerRequestBody,
  WorkerResponse,
} from './mamba-worker-protocol';

/** True when this runtime can spawn a dedicated Web Worker. */
export function hasWorker(): boolean {
  return typeof Worker !== 'undefined';
}

/** Injectable so tests can supply a fake Worker; prod uses the bundler URL form. */
export type WorkerFactory = () => Worker;

function defaultWorkerFactory(): Worker {
  // `new URL(..., import.meta.url)` is the statically-analysable form webpack 5 /
  // Turbopack (Next.js) compile into a separate worker bundle.
  return new Worker(new URL('./mamba.worker.ts', import.meta.url), { type: 'module' });
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  onToken?: (token: string) => void;
  onEpoch?: (epoch: number, loss: number) => void;
}

export class MambaWorkerProvider implements ModelProvider {
  readonly id = 'mamba-worker';
  readonly name = 'Mamba (On-Device WebGPU · Worker)';
  readonly isLocal = true;

  private worker: Worker | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private _ready = false;
  private _failureReason: string | null = null;
  private readonly config: MambaProviderConfig;
  private readonly workerFactory: WorkerFactory;

  constructor(config: MambaProviderConfig = {}, workerFactory: WorkerFactory = defaultWorkerFactory) {
    this.config = config;
    this.workerFactory = workerFactory;
  }

  async init(): Promise<void> {
    if (this._ready) return;
    this._failureReason = null;

    try {
      // The factory throws when the runtime can't spawn a worker (e.g. `Worker`
      // undefined, or the bundler couldn't emit the worker chunk). That's a
      // graceful not-ready, not a crash — the cascade falls to the next tier.
      this.worker = this.workerFactory();
      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(e.data);
      this.worker.onerror = (e) => this.failAll(new Error(e.message || 'Mamba worker crashed'));
    } catch (err) {
      this._failureReason = err instanceof Error ? err.message : String(err);
      this.worker = null;
      return;
    }

    try {
      const result = (await this.send({ type: 'init', config: this.config })) as InitResult;
      this._ready = result.ready;
      this._failureReason = result.failureReason;
    } catch (err) {
      this._failureReason = err instanceof Error ? err.message : String(err);
      this._ready = false;
    }
  }

  isReady(): boolean {
    return this._ready && this.worker !== null;
  }

  failureReason(): string | null {
    return this._failureReason;
  }

  async generate(input: string, context?: ModelContext): Promise<string> {
    if (!this.isReady()) {
      return `[Mamba worker not ready${this._failureReason ? `: ${this._failureReason}` : ''}]`;
    }
    return (await this.send({ type: 'generate', input, context })) as string;
  }

  async stream(
    input: string,
    context?: ModelContext,
    onToken?: (token: string) => void,
  ): Promise<string> {
    if (!this.isReady()) {
      return this.generate(input, context);
    }
    return (await this.send({ type: 'stream', input, context }, { onToken })) as string;
  }

  async train(
    corpus: string,
    options?: TrainRequestOptions & { onEpochEnd?: (epoch: number, loss: number) => void },
  ): Promise<number[]> {
    if (!this.isReady()) {
      throw new Error(
        this._failureReason
          ? `[MambaWorkerProvider] not ready: ${this._failureReason}`
          : '[MambaWorkerProvider] not ready — call init() first',
      );
    }
    const { onEpochEnd, ...rest } = options ?? {};
    return (await this.send(
      { type: 'train', corpus, options: rest },
      { onEpoch: onEpochEnd },
    )) as number[];
  }

  async exportTrainedWeights(opts?: { fp16?: boolean }): Promise<ArrayBuffer> {
    if (!this.isReady()) throw new Error('[MambaWorkerProvider] not ready — call init() first');
    return (await this.send({ type: 'export', opts })) as ArrayBuffer;
  }

  dispose(): void {
    if (this.worker) {
      // Best-effort graceful teardown, then hard-terminate.
      try {
        this.worker.postMessage({ id: this.nextId++, type: 'dispose' } satisfies WorkerRequest);
      } catch {
        /* worker may already be dead */
      }
      this.worker.terminate();
    }
    this.failAll(new Error('Provider disposed'));
    this.worker = null;
    this._ready = false;
    this._failureReason = null;
  }

  // -------------------------------------------------------------------------

  private send(
    req: WorkerRequestBody,
    handlers: { onToken?: (t: string) => void; onEpoch?: (e: number, l: number) => void } = {},
  ): Promise<unknown> {
    if (!this.worker) return Promise.reject(new Error('Worker not started'));
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onToken: handlers.onToken, onEpoch: handlers.onEpoch });
      this.worker!.postMessage({ ...req, id } as WorkerRequest);
    });
  }

  private onMessage(msg: WorkerResponse): void {
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    switch (msg.type) {
      case 'token':
        entry.onToken?.(msg.token);
        break;
      case 'epoch':
        entry.onEpoch?.(msg.epoch, msg.loss);
        break;
      case 'result':
        this.pending.delete(msg.id);
        entry.resolve(msg.value);
        break;
      case 'error':
        this.pending.delete(msg.id);
        entry.reject(new Error(msg.message));
        break;
    }
  }

  private failAll(err: Error): void {
    for (const [, entry] of this.pending) entry.reject(err);
    this.pending.clear();
  }
}

/**
 * Convenience builder for the FULL local-first cascade including the worker tier:
 * Prompt API → Mamba worker (when a trained local model is wanted) → cloud.
 *
 * Lives here (not in model-provider.ts) so the worker URL import never creates a
 * cycle with the module the worker itself imports. Pass `includeLocalMamba: true`
 * to slot the worker-backed on-device model in as Tier 2.
 */
export function createLocalFirstProvider(
  config: InferenceCascadeConfig & { includeLocalMamba?: boolean; mambaConfig?: MambaProviderConfig },
) {
  const local =
    config.includeLocalMamba && hasWorker()
      ? new MambaWorkerProvider(config.mambaConfig)
      : config.local;
  return createInferenceProvider({ ...config, local });
}
