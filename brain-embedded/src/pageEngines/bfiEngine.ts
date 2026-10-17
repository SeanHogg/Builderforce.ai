/**
 * Our transformer — Synapse's `bfi` compiled to WebAssembly over WebGPU (`bfi-web`,
 * PRD 34 §3.1) — as a page engine answering the `bfi` runtime's chat route.
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
 * trained 65,536 tokens become ~14k in a browser. Before a load that is
 * `BfiEngine.contextFor` over the row's KV shape — the engine's own formula, never a
 * copy of it — and after one it is what the load actually allocated.
 */

import {
  BFI_ENGINE_BASE_URL,
  formatLocalModelRef,
  localCatalogFor,
  localCatalogModel,
  type LocalCatalogModel,
  type LocalDeviceSupport,
} from '@builderforce/local-inference';
import { catalogProbe } from './catalogProbe';
import { reportPageEngineFailure } from './engineFailure';
import type { HfModelStore } from './hfModelStore';
import { createResidentModel } from './residentModel';
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
  kvBudgetBytes?: number;
  f16?: boolean;
  maxBufferBytes?: number;
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
  create(): Promise<BfiEngineInstance>;
  support(): Promise<LocalDeviceSupport>;
  /** The context a load will serve on this shape and device (pure; 0 on a bad shape). */
  contextFor(shape: BfiContextShape): number;
}

export interface BfiModule {
  BfiEngine: BfiEngineStatic;
}

export interface BfiPageEngine extends PageEngine {
  /** The device's support record, from `BfiEngine.support()` (no device is created). */
  support(): Promise<LocalDeviceSupport>;
}

export interface BfiEngineOptions {
  /** Loads the vendored `bfi-web` module (a dynamic import of its URL, in a host). */
  loadBfi: () => Promise<BfiModule>;
  store: Pick<HfModelStore, 'status' | 'open'>;
  ttlMs?: number;
  now?: () => number;
}

/** `bfi-web` rejects with `<code>: <detail>`; the codes that are not a 500 map here. */
const BFI_STATUS: Readonly<Record<string, number>> = {
  webgpu_unavailable: 503,
  context_exceeded: 413,
  invalid_request: 400,
};

function bfiError(e: unknown): unknown {
  if (e instanceof PageEngineError) return e;
  const message = errorMessage(e);
  const code = /^([a-z_]+):/.exec(message)?.[1];
  return code && BFI_STATUS[code] ? new PageEngineError(BFI_STATUS[code], code, message) : e;
}

/** `bfi`'s context floor — a load never goes below it — so a row with no KV shape is
 *  predicted at the honest minimum, never at its trained window. */
const BFI_CONTEXT_FLOOR = 2_048;

/** The window `bfi` will serve for `row` on this device, before anything is loaded. */
function predictedContext(engine: BfiEngineStatic, row: LocalCatalogModel, support: LocalDeviceSupport): number {
  const planned = row.kv
    ? engine.contextFor({
        ...row.kv,
        trainedContext: row.contextTokens,
        f16: support.f16,
        maxBufferBytes: support.maxBufferBytes,
      })
    : 0;
  return planned > 0 ? planned : Math.min(BFI_CONTEXT_FLOOR, row.contextTokens);
}

const UNSUPPORTED: LocalDeviceSupport = { supported: false, reason: 'bfi_unavailable', f16: false, maxBufferBytes: 0 };

export function createBfiEngine(options: BfiEngineOptions): BfiPageEngine {
  let module: Promise<BfiModule> | undefined;
  const bfi = (): Promise<BfiModule> => (module ??= options.loadBfi());
  // A wasm that will not load (or a support read that throws) is "this device cannot run
  // bfi" for the picker — with the reason reported, not dropped.
  const support = (): Promise<LocalDeviceSupport> =>
    bfi()
      .then((m) => m.BfiEngine.support())
      .catch((e: unknown) => {
        reportPageEngineFailure('bfi', 'support', e);
        return UNSUPPORTED;
      });

  // One engine, one resident model; loads are chained so two never race.
  const resident = createResidentModel(async () => (await bfi()).BfiEngine.create());
  // What each load actually allocated — the probe's answer once a model has been loaded.
  const served = new Map<string, number>();

  const residentEngine = (row: LocalCatalogModel): Promise<BfiEngineInstance> =>
    resident.acquire(row.ref, async (engine, previous) => {
      if (previous) engine.unload();
      const { stream, bytes } = await options.store.open(row.ref);
      const info = await engine.load(stream, bytes);
      if (info.contextTokens > 0 && served.get(row.ref) !== info.contextTokens) {
        served.set(row.ref, info.contextTokens);
        prober.invalidate();
      }
    });

  const prober = memoizedProbe('bfi', async () => {
    // Look in the store first: with nothing downloaded the wasm is never loaded.
    const rows = localCatalogFor('bfi');
    const states = await Promise.all(rows.map((row) => options.store.status(row.ref)));
    const ready = new Set(rows.filter((_, i) => states[i] === 'ready').map((row) => row.ref));
    if (ready.size === 0) return null;
    const device = await support();
    const { BfiEngine } = await bfi();
    return catalogProbe(
      'bfi',
      BFI_ENGINE_BASE_URL,
      device,
      async (row) => ready.has(row.ref),
      (row) => served.get(row.ref) ?? predictedContext(BfiEngine, row, device),
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
    let live: BfiEngineInstance;
    try {
      live = await residentEngine(row);
    } catch (e) {
      const mapped = bfiError(e);
      throw mapped instanceof PageEngineError ? mapped : new PageEngineError(503, 'bfi_engine_unavailable', errorMessage(e));
    }
    return bfiChunks(live, JSON.stringify({ ...body, stream: true }), signal);
  }

  return { runtime: 'bfi', baseUrl: BFI_ENGINE_BASE_URL, ...prober, support, chatCompletions };
}

/** The completion's closing chunk — its finish reason and usage — so the streamer sees
 *  them even when the engine's own chunks did not carry them. */
function closingChunk(finalJson: string): ChatCompletionChunk | null {
  try {
    const final = JSON.parse(finalJson) as {
      model?: string;
      choices?: Array<{ finish_reason?: string | null }>;
      usage?: Record<string, unknown>;
    };
    const finish = final.choices?.[0]?.finish_reason ?? null;
    if (!finish && !final.usage) return null;
    return {
      ...(final.model ? { model: final.model } : {}),
      choices: [{ index: 0, delta: {}, finish_reason: finish }],
      ...(final.usage ? { usage: final.usage } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * `BfiEngine.chat`'s callback stream as an async iterable. The engine runs under its own
 * controller, linked to the request's signal and aborted when the consumer stops early
 * (the shim returns the iterator on a cancelled body), so generation never outlives the
 * turn.
 */
async function* bfiChunks(
  engine: BfiEngineInstance,
  requestJson: string,
  signal: AbortSignal | undefined,
): AsyncGenerator<ChatCompletionChunk> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const queue: ChatCompletionChunk[] = [];
  let wake: (() => void) | undefined;
  // A holder, not a `let`: it is settled inside callbacks, which control-flow narrowing
  // cannot see.
  const state: { outcome?: { ok: true; final: string } | { ok: false; error: unknown } } = {};
  const notify = (): void => {
    wake?.();
    wake = undefined;
  };
  engine
    .chat(
      requestJson,
      (json) => {
        try {
          queue.push(JSON.parse(json) as ChatCompletionChunk);
          notify();
        } catch (e) {
          // A malformed chunk is dropped (the closing chunk still carries the outcome),
          // and said so.
          reportPageEngineFailure('bfi', 'chunk', e);
        }
      },
      controller.signal,
    )
    .then(
      (final) => {
        state.outcome = { ok: true, final };
        notify();
      },
      (error: unknown) => {
        state.outcome = { ok: false, error };
        notify();
      },
    );
  try {
    for (;;) {
      const next = queue.shift();
      if (next) {
        yield next;
        continue;
      }
      if (state.outcome) break;
      await new Promise<void>((resolve) => (wake = resolve));
    }
    const settled = state.outcome!;
    if (!settled.ok) throw signal?.aborted ? abortReason(signal) : bfiError(settled.error);
    const closing = closingChunk(settled.final);
    if (closing) yield closing;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (!state.outcome) controller.abort();
  }
}
