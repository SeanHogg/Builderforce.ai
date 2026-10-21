/**
 * Our transformer — Synapse's `bfi` compiled to WebAssembly over WebGPU, or over the CPU
 * where there is no GPU (`bfi-web`, PRD 34 §3.1) — as a page engine answering the `bfi`
 * runtime's chat route. The backend is the fit's: `localModelFit` offers a Bonsai row on
 * WebGPU when the adapter fits it, else on the engine's CPU backend when the device has
 * the memory, and the engine opens exactly that backend (`create({ backend })`) — the
 * probe's predicted context and the load always agree.
 *
 * The wasm package is vendored by the host, so this adapter takes its loader as a
 * dependency (`loadBfi`) rather than importing it: brain-embedded compiles and tests
 * without it, and a host that never offers `bfi` never fetches the wasm.
 *
 * The host owns download and cache (the `hf-file` model store); `bfi` only ever reads
 * weights the store already holds. A probe looks in the store FIRST and answers null
 * without loading the wasm when no Bonsai file is there; a chat call for a model that is
 * not downloaded is a 503 before anything streams. `tools` is honoured for every model —
 * `bfi` grammar-constrains the call.
 *
 * The window a probe reports is the one the engine will SERVE: `bfi` sizes its KV cache
 * to the device (a 2 GiB budget, f16 when the adapter has `shader-f16`), so Bonsai 8B's
 * trained 65,536 tokens become ~14k in a browser; on the CPU an f32 cache under 512 MiB
 * (Bonsai 1.7B ≈ 2.3k). Before a load that is
 * `BfiEngine.contextFor` over the row's KV shape — the engine's own formula, never a
 * copy of it — and after one it is what the load actually allocated.
 *
 * This engine always runs in a WORKER — a page's dedicated Web Worker (`bfiWorker.ts`,
 * every host's page, the editor's webview included) or the editor host's
 * `worker_threads` worker (`hostBfi/worker.ts`). A wasm trap poisons the realm's
 * instance, so `onTrap` reports it and the host starts a fresh worker. Every load,
 * eviction and stream runs through ONE queue (`engineQueue.ts`).
 */

import {
  BFI_ENGINE_BASE_URL,
  cpuMemoryCeiling,
  formatLocalModelRef,
  localCatalogFor,
  localCatalogModel,
  localModelFit,
  type LocalBackend,
  type LocalCatalogModel,
  type LocalDeviceSupport,
} from '@builderforce/local-inference';
import { bfiChunks, type BfiCrashes } from './bfiChunks';
import { BFI_UNSUPPORTED, anyBfiModelDownloaded, bfiSupportWithoutWasm, restrictBackends } from './bfiSupport';
import { catalogProbe } from './catalogProbe';
import { reportPageEngineFailure } from './engineFailure';
import { createEngineQueue } from './engineQueue';
import type { HfModelStore } from './hfModelStore';
import { isWasmTrap } from './remote/engineWorker';
import {
  PageEngineError,
  abortReason,
  errorMessage,
  memoizedProbe,
  type ChatCompletionChunk,
  type ChatCompletionsRequest,
  type PageEngine,
} from './types';

/** `bfi-web`'s model summary (§3.1). */
export interface BfiModelInfo {
  arch: string;
  /** The backend the engine runs on. */
  backend?: LocalBackend;
  /** The context the load actually allocated (≤ the trained window). */
  contextTokens: number;
  vocab: number;
  params: number;
  kvF16?: boolean;
}

/** `BfiEngine.contextFor`'s input: a model's attention shape plus the device. */
export interface BfiContextShape {
  layers: number;
  kvHeads: number;
  headDim: number;
  trainedContext: number;
  /** Which backend's rule (default WebGPU); `cpu` = f32 KV, no buffer cap. */
  backend?: LocalBackend;
  kvBudgetBytes?: number;
  f16?: boolean;
  maxStorageBufferBindingSizeBytes?: number;
}

/** A live `BfiEngine` (§3.1) — structurally typed so the wasm package is not a build dep. */
export interface BfiEngineInstance {
  load(
    chunks: ReadableStream<Uint8Array>,
    totalBytes: number,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<BfiModelInfo>;
  chat(requestJson: string, onChunk: (chunkJson: string) => void, signal?: AbortSignal): Promise<string>;
  unload(): void;
}

/** The `BfiEngine` class's statics (§3.1). */
export interface BfiEngineStatic {
  /** `auto` (default) = WebGPU when an adapter exists, else the CPU. */
  create(options?: { backend?: LocalBackend | 'auto' }): Promise<BfiEngineInstance>;
  support(): Promise<LocalDeviceSupport>;
  /** The context a load will serve on this shape and device (pure; 0 on a bad shape). */
  contextFor(shape: BfiContextShape): number;
}

export interface BfiModule {
  BfiEngine: BfiEngineStatic;
}

export interface BfiPageEngine extends PageEngine {
  /** The device's support record for the PICKER — every backend, whether or not this
   *  host serves it (`backends` restricts the probe and the chat only). */
  support(): Promise<LocalDeviceSupport>;
}

export interface BfiEngineOptions {
  /** Loads the vendored `bfi-web` module (a dynamic import of its URL, in a host). */
  loadBfi: () => Promise<BfiModule>;
  store: Pick<HfModelStore, 'status' | 'open'>;
  /** The device's RAM where the engine cannot read it itself — a Node host passes
   *  `os.totalmem()`; a page leaves it to `navigator.deviceMemory`. */
  deviceMemoryBytes?: number;
  /** The backends this host SERVES `bfi` on (default both): the probe and the chat. The
   *  editor's webview worker serves `['webgpu']` and the extension host's worker
   *  `['cpu']`, so CPU decoding never runs beside the chat UI. `support()` — the
   *  picker's record — is never restricted. */
  backends?: readonly LocalBackend[];
  /** A wasm trap poisoned the instance: the host terminates this worker and starts a
   *  fresh one (`serveEngineWorker`'s `fatal`). */
  onTrap?: (error: unknown) => void;
  ttlMs?: number;
  now?: () => number;
}

/** `bfi-web` rejects with `<code>: <detail>`; the codes that are not a 500 map here. */
const BFI_STATUS: Readonly<Record<string, number>> = {
  webgpu_unavailable: 503,
  cpu_memory_exceeded: 503,
  context_exceeded: 413,
  invalid_request: 400,
};

function bfiError(e: unknown): unknown {
  if (e instanceof PageEngineError) return e;
  const message = errorMessage(e);
  const code = /^([a-z_]+):/.exec(message)?.[1];
  return code && BFI_STATUS[code] ? new PageEngineError(BFI_STATUS[code], code, message) : e;
}

/** The refusal a trap ends a turn with — its message carries the code the chat's error
 *  banner localizes (`chatErrorAction`). */
const crashError = (e: unknown): PageEngineError =>
  new PageEngineError(503, 'bfi_engine_crashed', `bfi_engine_crashed: ${errorMessage(e)}`);

/** `bfi`'s context floor — a load never goes below it — so a row with no KV shape is
 *  predicted at the honest minimum, never at its trained window. */
const BFI_CONTEXT_FLOOR = 2_048;

/** The window `bfi` will serve for `row` on this device and backend, before anything
 *  is loaded. */
function predictedContext(
  engine: BfiEngineStatic,
  row: LocalCatalogModel,
  support: LocalDeviceSupport,
  backend: LocalBackend,
): number {
  const cpuBudget = support.backends?.cpu?.kvBudgetBytes;
  const planned = !row.kv
    ? 0
    : backend === 'cpu'
      ? engine.contextFor({
          ...row.kv,
          trainedContext: row.contextTokens,
          backend: 'cpu',
          ...(cpuBudget ? { kvBudgetBytes: cpuBudget } : {}),
        })
      : engine.contextFor({
          ...row.kv,
          trainedContext: row.contextTokens,
          f16: support.f16,
          maxStorageBufferBindingSizeBytes: support.maxStorageBufferBindingSizeBytes ?? support.maxBufferBytes,
        });
  return planned > 0 ? planned : Math.min(BFI_CONTEXT_FLOOR, row.contextTokens);
}

/** The store's byte stream behind a reader this engine owns, so a load that fails
 *  part-way (or never reads to the end) still cancels it — closing the file, or the
 *  bridge read, behind it. */
function cancellable(source: ReadableStream<Uint8Array>): { stream: ReadableStream<Uint8Array>; cancel(): void } {
  const reader = source.getReader();
  let finished = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await reader.read();
      if (next.done) {
        finished = true;
        controller.close();
      } else controller.enqueue(next.value);
    },
    cancel(reason) {
      finished = true;
      return reader.cancel(reason);
    },
  });
  return {
    stream,
    cancel() {
      if (finished) return;
      finished = true;
      void reader.cancel().catch(() => undefined);
    },
  };
}

/** `chunks`, releasing the engine queue when the stream ends — however it ends. */
async function* releasing(chunks: AsyncGenerator<ChatCompletionChunk>, release: () => void): AsyncGenerator<ChatCompletionChunk> {
  try {
    yield* chunks;
  } finally {
    release();
  }
}

export function createBfiEngine(options: BfiEngineOptions): BfiPageEngine {
  const backends = options.backends ?? (['webgpu', 'cpu'] as const);
  let module: Promise<BfiModule> | undefined;
  /** Set when a trap poisoned the current module; cleared when a fresh one loads. */
  let poisoned = false;
  const crashes: BfiCrashes = new Set();
  const bfi = (): Promise<BfiModule> => {
    if (!module) {
      poisoned = false;
      const loading = options.loadBfi();
      module = loading;
      // A failed load is not kept: the next call (a retry after going online) tries again.
      loading.catch(() => {
        if (module === loading) module = undefined;
      });
    }
    return module;
  };

  /** The engine per backend, and the ONE model resident across them. */
  const engines = new Map<LocalBackend, BfiEngineInstance>();
  let resident: { ref: string; backend: LocalBackend } | undefined;
  const queue = createEngineQueue();
  // What each load actually allocated — the probe's answer once a model has been loaded.
  const served = new Map<string, number>();

  /** A trap: drop every cached piece (the module, the engines, the probe), end what is
   *  streaming, and tell the host — which replaces this worker. */
  const trapped = (error: unknown): boolean => {
    if (!isWasmTrap(error)) return false;
    if (poisoned) return true;
    poisoned = true;
    module = undefined;
    engines.clear();
    resident = undefined;
    prober.invalidate();
    reportPageEngineFailure('bfi', 'trap', error);
    const failure = crashError(error);
    for (const end of [...crashes]) end(failure);
    options.onTrap?.(error);
    return true;
  };

  // The wasm reports the RAM it can read (`navigator.deviceMemory`) and otherwise plans
  // for the conservative phone size; the host knows better — its own RAM (`os.totalmem`),
  // or whether an unreported device is a desktop (`cpuMemoryCeiling`).
  const withDeviceMemory = (s: LocalDeviceSupport): LocalDeviceSupport => {
    const cpu = s.backends?.cpu;
    if (!cpu || cpu.deviceMemoryBytes !== undefined) return s;
    const deviceMemoryBytes = options.deviceMemoryBytes;
    return {
      ...s,
      backends: {
        ...s.backends,
        cpu: {
          ...cpu,
          ...(deviceMemoryBytes !== undefined ? { deviceMemoryBytes } : {}),
          maxMemoryBytes: cpuMemoryCeiling(deviceMemoryBytes),
        },
      },
    };
  };
  // With nothing downloaded the picker's support read must not compile the wasm: the
  // record comes from what the realm can read itself. A wasm that will not load (or a
  // support read that throws) is "this device cannot run bfi" — with the reason
  // reported, not dropped.
  const support = async (): Promise<LocalDeviceSupport> => {
    try {
      return (await anyBfiModelDownloaded(options.store))
        ? withDeviceMemory(await (await bfi()).BfiEngine.support())
        : await bfiSupportWithoutWasm(options.deviceMemoryBytes);
    } catch (e) {
      reportPageEngineFailure('bfi', 'support', e);
      return BFI_UNSUPPORTED;
    }
  };
  /** What THIS host serves — the probe's and the chat's record. */
  const servable = async (): Promise<LocalDeviceSupport> => restrictBackends(await support(), backends);

  /** `row` resident on `backend`. Called holding the queue, so nothing else loads, evicts
   *  or streams meanwhile; a model resident on another backend (or another model on this
   *  one) is unloaded first. */
  const residentEngine = async (row: LocalCatalogModel, backend: LocalBackend): Promise<BfiEngineInstance> => {
    const current = engines.get(backend);
    if (current && resident?.ref === row.ref && resident.backend === backend) return current;
    if (resident) {
      const previous = engines.get(resident.backend);
      resident = undefined;
      try {
        previous?.unload();
      } catch (e) {
        reportPageEngineFailure('bfi', 'unload', e);
      }
    }
    let engine = engines.get(backend);
    if (!engine) {
      engine = await (await bfi()).BfiEngine.create({ backend });
      engines.set(backend, engine);
    }
    const { stream, bytes } = await options.store.open(row.ref);
    const source = cancellable(stream);
    let info: BfiModelInfo;
    try {
      info = await engine.load(source.stream, bytes);
    } finally {
      source.cancel();
    }
    resident = { ref: row.ref, backend };
    if (info.contextTokens > 0 && served.get(row.ref) !== info.contextTokens) {
      served.set(row.ref, info.contextTokens);
      prober.invalidate();
    }
    return engine;
  };

  const prober = memoizedProbe('bfi', async () => {
    // Look in the store first: with nothing downloaded the wasm is never loaded.
    const rows = localCatalogFor('bfi');
    const states = await Promise.all(rows.map((row) => options.store.status(row.ref)));
    const ready = new Set(rows.filter((_, i) => states[i] === 'ready').map((row) => row.ref));
    if (ready.size === 0) return null;
    const device = await servable();
    const { BfiEngine } = await bfi();
    return catalogProbe(
      'bfi',
      BFI_ENGINE_BASE_URL,
      device,
      async (row) => ready.has(row.ref),
      (row, backend) => served.get(row.ref) ?? predictedContext(BfiEngine, row, device, backend),
    );
  }, options);

  async function chatCompletions(
    body: ChatCompletionsRequest,
    signal?: AbortSignal,
  ): Promise<AsyncIterable<ChatCompletionChunk>> {
    const row = localCatalogModel(formatLocalModelRef('bfi', typeof body.model === 'string' ? body.model : ''));
    if (!row) throw new PageEngineError(404, 'model_not_found');
    if ((await options.store.status(row.ref)) !== 'ready') throw new PageEngineError(503, 'model_not_downloaded');
    if (signal?.aborted) throw abortReason(signal);
    // The SAME fit the probe reported decides the backend the engine opens.
    const fit = localModelFit(row, await servable());
    if (!fit.fits) throw new PageEngineError(503, 'model_unfit', fit.reason);
    // Held from the load through the last chunk (`engineQueue.ts`): a turn arriving
    // while another loads or streams waits for it — never aborting the running answer.
    const release = await queue.acquire(signal);
    let live: BfiEngineInstance;
    try {
      live = await residentEngine(row, fit.backend);
    } catch (e) {
      release();
      if (trapped(e)) throw crashError(e);
      const mapped = bfiError(e);
      throw mapped instanceof PageEngineError ? mapped : new PageEngineError(503, 'bfi_engine_unavailable', errorMessage(e));
    }
    const mapError = (e: unknown): unknown => (trapped(e) ? crashError(e) : bfiError(e));
    return releasing(bfiChunks(live, JSON.stringify({ ...body, stream: true }), signal, mapError, crashes), release);
  }

  return { runtime: 'bfi', baseUrl: BFI_ENGINE_BASE_URL, ...prober, support, chatCompletions };
}
