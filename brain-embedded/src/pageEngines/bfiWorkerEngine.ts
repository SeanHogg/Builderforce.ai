/**
 * `bfi` in a DEDICATED WEB WORKER — on every page host: the web app, Rovr and the
 * editor's chat webview. Never on the page's own thread, for two reasons:
 *
 *  - without WebGPU, `bfi-web` decodes on the CPU synchronously, token by token; on the
 *    page's main thread that freezes the UI for the whole answer;
 *  - a wasm trap poisons the realm's instance for good (the glue cannot re-initialize),
 *    and only a worker can be thrown away and replaced.
 *
 * So the page runs the whole `bfi` page engine (`createBfiEngine`: the wasm, its WebGPU —
 * `navigator.gpu` exists in dedicated workers — or CPU backend, the model store) in a
 * worker, and talks to it over the remote page-engine frames (`remote/protocol.ts`) the
 * editor uses between its host and webview. The worker's life is the ONE engine-worker
 * lifecycle (`remote/engineWorker.ts`): started on first use, respawned after a crash or
 * a wasm trap, torn down after five idle minutes and on `dispose()`, and a model that
 * keeps crashing it is failed for the session.
 *
 *   page → worker   `bfi.init` (the wasm URLs, the backends, the store) · `bfi.support`
 *                   · `bfi.stored` · the lifecycle and page-engine frames
 *   worker → page   `bfi.supported` · `bfi.store` · `bfi.threadsFailed`
 *                   · the lifecycle and page-engine frames
 *
 * Model downloads stay on the page (the picker's store). The worker reads the same
 * origin's Cache Storage — or, with `relayStore`, the page's own store over `bfi.store`
 * frames (the editor's webview, whose models are the extension host's files). A finished
 * download invalidates its memoized probe. With nothing downloaded, `support()` answers
 * from the page itself (`bfiSupportWithoutWasm`) — the picker listing the catalog never
 * starts the worker or compiles the wasm.
 *
 * The THREADED artifact is offered in `bfi.init` until it once fails to start
 * (`bfi.threadsFailed`): the worker is then replaced by a single-threaded one — never two
 * wasm instances in one realm — and a probe, support read or turn the restart cut off is
 * asked again once.
 *
 * This file is the PAGE half (root entry, no wasm import); the worker half is
 * `bfiWorker.ts` (`/bfi` entry). A host provides the worker module — one line,
 * `runBfiWorker()` — through its own bundler.
 */
import { BFI_ENGINE_BASE_URL, type LocalBackend, type LocalDeviceSupport } from '@builderforce/local-inference';
import type { BfiPageEngine } from './bfiEngine';
import type { BfiThreadsSource } from './bfiLoader';
import { BFI_UNSUPPORTED, anyBfiModelDownloaded, bfiSupportWithoutWasm, withPeerBackends } from './bfiSupport';
import type { HfModelStore } from './hfModelStore';
import { createPageEngineClient } from './remote/client';
import { createEngineWorker, type EngineWorkerHandle } from './remote/engineWorker';
import { PageEngineError, errorMessage, type ChatCompletionChunk, type ChatCompletionsRequest } from './types';

/** What the worker does with the page's store (`relayStore`). */
export type BfiStoreOp = 'status' | 'open' | 'read' | 'close';

export interface BfiInitFrame {
  type: 'bfi.init';
  wasmUrl: string;
  threads?: BfiThreadsSource;
  /** The backends the worker SERVES (probe and chat); default both. */
  backends?: readonly LocalBackend[];
  /** Read models through the page (`bfi.store`), not this origin's Cache Storage. */
  relayStore?: boolean;
}

export type BfiWorkerFrame =
  | BfiInitFrame
  | { type: 'bfi.support'; id: string }
  | { type: 'bfi.supported'; id: string; support?: LocalDeviceSupport }
  | { type: 'bfi.store'; id: string; op: BfiStoreOp; ref?: string; handle?: string }
  | { type: 'bfi.stored'; id: string; ok: boolean; result?: unknown; error?: string }
  | { type: 'bfi.threadsFailed'; message: string };

/** The slice of `DedicatedWorkerGlobalScope` the worker half uses. */
export interface MessageEndpointLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

/** The slice of a browser `Worker` the page half uses. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message' | 'error' | 'messageerror', listener: (event: { data?: unknown; message?: string }) => void): void;
  terminate(): void;
}

export const bfiWorkerFrame = (data: unknown): BfiWorkerFrame | undefined =>
  data && typeof data === 'object' && typeof (data as { type?: unknown }).type === 'string' && (data as { type: string }).type.startsWith('bfi.')
    ? (data as BfiWorkerFrame)
    : undefined;

export interface BfiWorkerEngineOptions {
  /** Start the worker (whose module calls `runBfiWorker`). Called on first real use. */
  create: () => WorkerLike;
  /** The wasm binary's URL, as the host's bundler emitted it (absolute). */
  wasmUrl: () => string | URL | Promise<string | URL>;
  /** The THREADED artifact the host serves (absolute URLs), if any. The worker loads it
   *  instead when cross-origin isolated with no WebGPU adapter (`loadBfiWeb`). */
  threads?: () => BfiThreadsSource | undefined | Promise<BfiThreadsSource | undefined>;
  /** The backends the worker SERVES (default both). The editor's webview passes
   *  `['webgpu']`: its CPU turns go to the extension host's worker. */
  backends?: readonly LocalBackend[];
  /** The support record of whoever serves the OTHER backends (the editor's host worker,
   *  read without its wasm): the picker's record is this worker's backends plus the
   *  peer's (`withPeerBackends`), so a model that fits only there is still offered. */
  peerSupport?: () => Promise<LocalDeviceSupport | undefined>;
  /** The worker reads models through this page's `store` instead of the origin's Cache
   *  Storage. */
  relayStore?: boolean;
  /** The page's view of the model store: whether the wasm is needed yet, and (with
   *  `relayStore`) what the worker reads. Absent: always ask the worker. */
  store?: Pick<HfModelStore, 'status'> & Partial<Pick<HfModelStore, 'open'>>;
  /** How long a probe or support read waits for the worker. A cold worker compiles
   *  ~3.7 MB of wasm first, so this is generous. */
  timeoutMs?: number;
  /** Idle teardown (default `ENGINE_WORKER_IDLE_MS`). */
  idleMs?: number;
}

/** A {@link BfiPageEngine} whose engine runs in a worker, plus its teardown. */
export interface BfiWorkerEngine extends BfiPageEngine {
  dispose(): void;
}

/** The PAGE half: a `bfi` page engine whose engine runs in the worker. */
export function createBfiWorkerEngine(options: BfiWorkerEngineOptions): BfiWorkerEngine {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const backends = options.backends ?? (['webgpu', 'cpu'] as const);
  const client = createPageEngineClient({
    probeTimeoutMs: timeoutMs,
    unavailableMessage: 'The bfi worker could not start.',
    detachedMessage: 'The bfi worker stopped while answering.',
  });
  const supports = new Map<string, (support: LocalDeviceSupport) => void>();
  let seq = 0;
  /** Whether the threaded artifact is still offered (it once failed to start: no more). */
  let threadsOffered = true;
  /** Bumped when the worker is replaced for its threads, so a cut-off request retries. */
  let threadRestarts = 0;
  /** The page store's reads the worker has open (`relayStore`). */
  const reads = new Map<string, ReadableStreamDefaultReader<Uint8Array>>();

  const replyToStore = async (f: Extract<BfiWorkerFrame, { type: 'bfi.store' }>): Promise<unknown> => {
    const store = options.store;
    if (!store) throw new Error('no store on this page');
    switch (f.op) {
      case 'status':
        return store.status(f.ref!);
      case 'open': {
        if (!store.open) throw new Error('this page store cannot be read');
        const { stream, bytes } = await store.open(f.ref!);
        const handle = `r${++seq}`;
        reads.set(handle, stream.getReader());
        return { handle, bytes };
      }
      case 'read': {
        const reader = reads.get(f.handle!);
        if (!reader) return null;
        const next = await reader.read();
        if (next.done) {
          reads.delete(f.handle!);
          return null;
        }
        return next.value instanceof Uint8Array ? next.value : new Uint8Array(next.value as ArrayBufferLike);
      }
      case 'close': {
        const reader = reads.get(f.handle!);
        reads.delete(f.handle!);
        await reader?.cancel().catch(() => undefined);
        return undefined;
      }
    }
  };
  const closeReads = (): void => {
    for (const reader of reads.values()) void reader.cancel().catch(() => undefined);
    reads.clear();
  };

  const worker = createEngineWorker({
    async spawn(events): Promise<EngineWorkerHandle> {
      const w = options.create();
      w.addEventListener('message', (event) => events.onMessage(event.data));
      w.addEventListener('error', (event) => events.onGone(event.message ?? 'error'));
      w.addEventListener('messageerror', () => events.onGone('messageerror'));
      const threads = threadsOffered ? await options.threads?.() : undefined;
      const init: BfiInitFrame = {
        type: 'bfi.init',
        wasmUrl: String(await options.wasmUrl()),
        ...(threads ? { threads } : {}),
        ...(options.backends ? { backends: options.backends } : {}),
        ...(options.relayStore ? { relayStore: true } : {}),
      };
      w.postMessage(init);
      return { post: (message) => w.postMessage(message), terminate: () => w.terminate() };
    },
    onMessage(message) {
      const f = bfiWorkerFrame(message);
      if (!f) {
        client.receive(message);
        return;
      }
      if (f.type === 'bfi.supported') {
        supports.get(f.id)?.(f.support ?? BFI_UNSUPPORTED);
        supports.delete(f.id);
      } else if (f.type === 'bfi.store') {
        void replyToStore(f).then(
          (result) => f.id && worker.running() && worker.port().post({ type: 'bfi.stored', id: f.id, ok: true, result } as never),
          (e: unknown) => f.id && worker.running() && worker.port().post({ type: 'bfi.stored', id: f.id, ok: false, error: errorMessage(e) } as never),
        );
      } else if (f.type === 'bfi.threadsFailed') {
        console.warn(`bfi: the threaded build did not start (${f.message}); restarting single-threaded`);
        threadsOffered = false;
        threadRestarts++;
        worker.restart('threads_failed');
      }
    },
    onStopped(port) {
      client.drop(port);
      closeReads();
      for (const settle of [...supports.values()]) settle(BFI_UNSUPPORTED);
      supports.clear();
    },
    ...(options.idleMs !== undefined ? { idleMs: options.idleMs } : {}),
  });

  const anyDownloaded = (): Promise<boolean> => (options.store ? anyBfiModelDownloaded(options.store) : Promise.resolve(true));

  /** `ask`, asked once more when the worker was replaced for its threads meanwhile. */
  const onceMore = async <T>(ask: () => Promise<T>, failed: (value: T) => boolean): Promise<T> => {
    const before = threadRestarts;
    const value = await ask();
    return failed(value) && threadRestarts !== before ? ask() : value;
  };

  const ownSupport = (): Promise<LocalDeviceSupport> => {
    const id = `s${++seq}`;
    return new Promise<LocalDeviceSupport>((resolve) => {
      const timer = setTimeout(() => settle(BFI_UNSUPPORTED), timeoutMs);
      function settle(support: LocalDeviceSupport): void {
        clearTimeout(timer);
        supports.delete(id);
        resolve(support);
      }
      supports.set(id, settle);
      worker.port().post({ type: 'bfi.support', id } as never);
    });
  };

  const engine = client.engine('bfi', BFI_ENGINE_BASE_URL, () => worker.port());

  /** A turn, re-sent once when the threads restart cut it off before its first chunk. */
  async function* retried(body: ChatCompletionsRequest, signal?: AbortSignal): AsyncGenerator<ChatCompletionChunk> {
    for (let attempt = 0; ; attempt++) {
      const before = threadRestarts;
      let yielded = false;
      try {
        for await (const chunk of await engine.chatCompletions(body, signal)) {
          yielded = true;
          yield chunk;
        }
        return;
      } catch (e) {
        const cutOff = e instanceof PageEngineError && e.code === 'page_engine_detached' && threadRestarts !== before;
        if (yielded || attempt > 0 || !cutOff || signal?.aborted) throw e;
      }
    }
  }

  return {
    ...engine,
    async probe(probeOptions) {
      // Nothing downloaded: nothing to serve, and no reason to start the worker.
      if (!(await anyDownloaded())) return null;
      return onceMore(() => engine.probe(probeOptions), (probe) => probe === null);
    },
    invalidate() {
      worker.invalidate();
    },
    // A refusal surfaces on the first `next()`, before anything streamed — where the
    // shim answers it with its status, exactly as an in-place engine's would.
    chatCompletions: async (body, signal) => retried(body, signal),
    async support() {
      const [own, peer] = await Promise.all([
        (async () => {
          if (!(await anyDownloaded())) return bfiSupportWithoutWasm();
          return onceMore(ownSupport, (s) => s === BFI_UNSUPPORTED);
        })(),
        options.peerSupport?.().catch(() => undefined),
      ]);
      return withPeerBackends(own, backends, peer);
    },
    dispose() {
      worker.dispose();
      closeReads();
    },
  };
}
