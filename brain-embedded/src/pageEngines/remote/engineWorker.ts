/**
 * ONE lifecycle for a page engine that runs in a worker — a page's dedicated Web Worker
 * (`bfiWorkerEngine.ts`, every host's page), the editor host's `worker_threads` worker
 * (`hostBfi/`):
 *
 *  - started on the first request, never before;
 *  - respawned after it goes away — a crash, an exit, or an explicit FATAL frame (a wasm
 *    trap is not an `error` event, so the worker reports it; its instance is poisoned
 *    and only a fresh worker has a fresh one);
 *  - INVALIDATE tells its engines to drop their memoized probes;
 *  - torn down after {@link ENGINE_WORKER_IDLE_MS} with nothing in flight, and on
 *    `dispose()`; the next request starts a new one;
 *  - a CIRCUIT BREAKER: a model whose turn was in flight when the worker crashed
 *    {@link ENGINE_WORKER_CRASH_LIMIT} times within {@link ENGINE_WORKER_CRASH_WINDOW_MS}
 *    is failed for the session — its probe rows are withheld and a turn for it is refused
 *    with `model_keeps_crashing` instead of loading it into a fresh worker again.
 *
 * Whatever was in flight when a worker stops fails through `onStopped(port)` (the
 * remote client's `drop`), so a turn never hangs. A host supplies only `spawn` — how a
 * worker is made on its platform — and where non-lifecycle messages go.
 *
 * The worker half, {@link serveEngineWorker}, serves the engines, answers the lifecycle
 * frames, and turns a trap however it surfaces (an engine's `onTrap`, an uncaught error,
 * an unhandled rejection) into the FATAL frame. Pure — no DOM, no Node.
 */
import type { LocalRuntimeProbe } from '@builderforce/local-inference';
import type { PageEngine } from '../types';
import type { PageEnginePort } from './client';
import { isPageEngineRequest, type PageEngineRequest } from './protocol';
import { servePageEngines } from './serve';

/** A worker with nothing in flight for this long is terminated (it respawns on demand). */
export const ENGINE_WORKER_IDLE_MS = 5 * 60_000;
/** caller → worker: drop memoized probes (a model was downloaded or removed). */
export const ENGINE_WORKER_INVALIDATE = 'engineWorker.invalidate';
/** worker → caller: the engine trapped; terminate me and start a fresh worker. */
export const ENGINE_WORKER_FATAL = 'engineWorker.fatal';
/** Crashes of one model's turns that fail it for the session… */
export const ENGINE_WORKER_CRASH_LIMIT = 2;
/** …when they fall within this window. */
export const ENGINE_WORKER_CRASH_WINDOW_MS = 10 * 60_000;
/** The refusal for a model the breaker failed — its message carries the code the chat's
 *  error banner localizes (with the remove / try-another remedy). */
export const MODEL_KEEPS_CRASHING = 'model_keeps_crashing';

/** A started worker, as the lifecycle drives it. */
export interface EngineWorkerHandle {
  post(message: unknown): void;
  terminate(): void;
}

export interface EngineWorkerEvents {
  onMessage(message: unknown): void;
  /** The worker errored or exited. */
  onGone(reason: string): void;
}

export interface EngineWorkerOptions {
  /** Start a worker (a host's platform: `new Worker(…)`, `new worker_threads.Worker(…)`). */
  spawn(events: EngineWorkerEvents): EngineWorkerHandle | Promise<EngineWorkerHandle>;
  /** Every message from the worker that is not a lifecycle frame. */
  onMessage(message: unknown): void;
  /** A worker stopped: fail what was in flight on `port` (the remote client's `drop`). */
  onStopped(port: PageEnginePort, reason: string): void;
  idleMs?: number;
  /** Logs why a worker went away (a crash, a trap). Default `console.warn`. */
  warn?: (message: string) => void;
  now?: () => number;
}

export interface EngineWorker {
  /** The live worker's port, starting one if none runs. */
  port(): PageEnginePort;
  /** Whether a worker runs now. */
  running(): boolean;
  /** Tell a running worker's engines to drop their memos (no worker is started for it). */
  invalidate(): void;
  /** Terminate it; the next `port()` starts a new one. */
  dispose(): void;
  /** Terminate it as a crash would (`reason` is logged) — the next `port()` starts a
   *  fresh one. For a worker that reported it cannot go on (its threads did not start). */
  restart(reason: string): void;
}

type Generation = {
  port: PageEnginePort;
  handle: Promise<EngineWorkerHandle>;
  /** Chats in flight → the model each is for (`runtime/model`). */
  open: Map<string, string>;
  timer?: ReturnType<typeof setTimeout>;
};

/** Stops that are not a crash: nothing is held against the models in flight. */
const ORDERLY = new Set(['idle', 'disposed', 'spawn_failed', 'restart']);

const modelKey = (runtime: unknown, model: unknown): string => `${String(runtime)}/${typeof model === 'string' ? model : ''}`;

export function createEngineWorker(options: EngineWorkerOptions): EngineWorker {
  const idleMs = options.idleMs ?? ENGINE_WORKER_IDLE_MS;
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const now = options.now ?? (() => Date.now());
  let live: Generation | undefined;
  /** The circuit breaker: crash times per model, and the models it failed. */
  const crashes = new Map<string, number[]>();
  const failed = new Set<string>();

  const recordCrash = (key: string): void => {
    const at = now();
    const recent = (crashes.get(key) ?? []).filter((t) => at - t < ENGINE_WORKER_CRASH_WINDOW_MS);
    recent.push(at);
    crashes.set(key, recent);
    if (recent.length >= ENGINE_WORKER_CRASH_LIMIT && !failed.has(key)) {
      failed.add(key);
      warn(`engine worker: ${key} crashed ${recent.length}× in ${ENGINE_WORKER_CRASH_WINDOW_MS / 60_000} min; not loading it again this session`);
    }
  };

  const stop = (gen: Generation, reason: string): void => {
    if (live !== gen) return;
    live = undefined;
    if (gen.timer) clearTimeout(gen.timer);
    if (!ORDERLY.has(reason)) for (const key of new Set(gen.open.values())) recordCrash(key);
    void gen.handle.then((h) => h.terminate(), () => undefined);
    options.onStopped(gen.port, reason);
  };

  /** Re-arm the idle timer — only while nothing is in flight. */
  const touch = (gen: Generation): void => {
    if (gen.timer) clearTimeout(gen.timer);
    gen.timer = undefined;
    if (gen.open.size === 0 && idleMs > 0 && Number.isFinite(idleMs)) gen.timer = setTimeout(() => stop(gen, 'idle'), idleMs);
  };

  /** A probe answer without the rows the breaker failed. */
  const withoutFailed = (message: { probe?: LocalRuntimeProbe | null }): unknown => {
    const probe = message.probe;
    if (!probe || failed.size === 0) return message;
    const models = probe.models.filter((m) => !failed.has(modelKey(probe.provider, m.model)));
    if (models.length === probe.models.length) return message;
    return { ...message, probe: models.length > 0 ? { ...probe, models } : null };
  };

  const start = (): Generation => {
    const gen = { open: new Map<string, string>() } as Generation;
    const events: EngineWorkerEvents = {
      onMessage(message) {
        if (live !== gen) return;
        const m = message as { type?: unknown; id?: unknown; message?: unknown; probe?: LocalRuntimeProbe | null };
        if (m && m.type === ENGINE_WORKER_FATAL) {
          warn(`engine worker trapped (${String(m.message ?? 'fatal')}); starting a fresh one on the next request`);
          stop(gen, 'fatal');
          return;
        }
        if (m && (m.type === 'pageEngine.end' || m.type === 'pageEngine.error') && typeof m.id === 'string') gen.open.delete(m.id);
        options.onMessage(m && m.type === 'pageEngine.probed' ? withoutFailed(m) : message);
        touch(gen);
      },
      onGone(reason) {
        if (live !== gen) return;
        warn(`engine worker stopped (${reason})`);
        stop(gen, reason);
      },
    };
    gen.handle = Promise.resolve().then(() => options.spawn(events));
    gen.handle.catch((e: unknown) => {
      warn(`engine worker could not start (${e instanceof Error ? e.message : String(e)})`);
      stop(gen, 'spawn_failed');
    });
    gen.port = {
      post(message: PageEngineRequest | Record<string, unknown>) {
        const m = message as { type?: unknown; id?: unknown; runtime?: unknown; body?: { model?: unknown } };
        if (m.type === 'pageEngine.chat' && typeof m.id === 'string') {
          const key = modelKey(m.runtime, m.body?.model);
          if (failed.has(key)) {
            // Refused here: the model is never loaded into a worker again this session.
            const id = m.id;
            queueMicrotask(() =>
              options.onMessage({
                type: 'pageEngine.error',
                id,
                status: 503,
                code: MODEL_KEEPS_CRASHING,
                message: `${MODEL_KEEPS_CRASHING}: ${key} crashed this device's engine ${ENGINE_WORKER_CRASH_LIMIT} times; remove it or try another model`,
              }),
            );
            return;
          }
          gen.open.set(m.id, key);
        }
        if (m.type === 'pageEngine.abort' && typeof m.id === 'string') gen.open.delete(m.id);
        touch(gen);
        void gen.handle.then((h) => h.post(message), () => undefined);
      },
    } as PageEnginePort;
    live = gen;
    touch(gen);
    return gen;
  };

  return {
    port: () => (live ?? start()).port,
    running: () => live !== undefined,
    invalidate() {
      live?.port.post({ type: ENGINE_WORKER_INVALIDATE } as never);
    },
    dispose() {
      if (live) stop(live, 'disposed');
    },
    restart(reason) {
      if (!live) return;
      warn(`engine worker restarting (${reason})`);
      stop(live, 'restart');
    },
  };
}

/** The worker side's transport. */
export interface EngineWorkerEndpoint {
  post(message: unknown): void;
  /** Subscribe to the caller's messages; returns the unsubscribe. */
  listen(onMessage: (message: unknown) => void): () => void;
  /** Subscribe to this realm's uncaught errors and unhandled rejections — where a trap
   *  inside an engine's async work surfaces (a Web Worker's `error` /
   *  `unhandledrejection`, Node's `unhandledRejection`). The listener answers true when
   *  the error was a trap it reported, so the host may suppress the realm's default
   *  report (a Web Worker's `preventDefault`, so the page sees one FATAL, not also an
   *  `error` event). */
  onUncaught?(listener: (error: unknown) => boolean): void;
}

export interface EngineWorkerServeOptions {
  /** Runs once, before the FATAL frame: forget the poisoned module (`forgetBfiWeb`). */
  onFatal?: () => void;
}

export interface ServedEngineWorker {
  /** Report a trap (or any unrecoverable state) — the caller terminates and respawns.
   *  Pass it as an engine's `onTrap`. Only the first report is sent. */
  fatal(error: unknown): void;
}

/**
 * The WORKER half: serve `engines` over `endpoint`, honour INVALIDATE, hand every other
 * message to `onOther` (an engine's own frames, e.g. `bfi.init`), and report a trap —
 * from `fatal`, or uncaught in this realm — as the ONE FATAL frame.
 */
export function serveEngineWorker(
  endpoint: EngineWorkerEndpoint,
  engines: () => readonly PageEngine[],
  onOther: (message: unknown) => void = () => undefined,
  options: EngineWorkerServeOptions = {},
): ServedEngineWorker {
  servePageEngines(engines, {
    reply: (type, payload) => endpoint.post({ type, ...payload }),
    listen: (onRequest) =>
      endpoint.listen((message) => {
        if (isPageEngineRequest(message)) onRequest(message);
      }),
  });
  endpoint.listen((message) => {
    if (isPageEngineRequest(message)) return;
    if ((message as { type?: unknown } | null)?.type === ENGINE_WORKER_INVALIDATE) {
      for (const engine of engines()) engine.invalidate();
      return;
    }
    onOther(message);
  });
  let reported = false;
  const fatal = (error: unknown): void => {
    if (reported) return;
    reported = true;
    options.onFatal?.();
    endpoint.post({ type: ENGINE_WORKER_FATAL, message: error instanceof Error ? error.message : String(error) });
  };
  endpoint.onUncaught?.((error) => {
    if (!isWasmTrap(error)) return false;
    fatal(error);
    return true;
  });
  return { fatal };
}

/** Whether `e` is a WebAssembly trap — the instance that threw it is poisoned. */
export function isWasmTrap(e: unknown): boolean {
  const RuntimeError = (globalThis as { WebAssembly?: { RuntimeError?: new (...args: never[]) => Error } }).WebAssembly?.RuntimeError;
  return (RuntimeError !== undefined && e instanceof RuntimeError) || (e instanceof Error && e.name === 'RuntimeError');
}
