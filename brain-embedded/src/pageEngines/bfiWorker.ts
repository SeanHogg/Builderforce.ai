/**
 * The WORKER half of `bfi` in a dedicated Web Worker (see `bfiWorkerEngine.ts` for the
 * page half and the frames). A host's worker module is one line: `runBfiWorker()`.
 * Lives in the `/bfi` entry because it loads the vendored wasm.
 *
 * What differs per host arrives in the `bfi.init` frame: the wasm URLs, the backends
 * this worker serves, and whether it reads models from this origin's Cache Storage or
 * through the page (`relayStore` — the editor's webview, whose models live in the
 * extension host's file cache and are reached only over the page's bridge).
 *
 * A wasm trap poisons this worker's instance (the glue cannot re-initialize in the same
 * realm), so it is reported as the lifecycle's FATAL frame — `serveEngineWorker` does
 * that for an engine's `onTrap` and for a trap surfacing as an uncaught error or an
 * unhandled rejection — and the page starts a fresh worker. A threaded artifact that
 * does not start is reported as `bfi.threadsFailed`: the page replaces this worker with a
 * single-threaded one.
 */
import { createBfiEngine, type BfiModule, type BfiPageEngine } from './bfiEngine';
import { forgetBfiWeb, isBfiThreadsError, loadBfiWeb, type BfiThreadsSource } from './bfiLoader';
import { bfiWorkerFrame, type BfiInitFrame, type BfiStoreOp, type MessageEndpointLike } from './bfiWorkerEngine';
import { createHfModelStore, type HfModelStore } from './hfModelStore';
import { serveEngineWorker } from './remote/engineWorker';
import { errorMessage } from './types';

export interface RunBfiWorkerOptions {
  /** The model store the engine reads when the page does not relay one; default this
   *  origin's Cache Storage. */
  store?: Pick<HfModelStore, 'status' | 'open'>;
  /** Load the wasm module; default the vendored `bfi-web` (tests inject). */
  loadBfi?: (wasmUrl: string, threads?: BfiThreadsSource) => Promise<BfiModule>;
}

/** A realm's error events, as far as a trap report needs them. */
type UncaughtScope = {
  addEventListener?(type: 'error' | 'unhandledrejection', listener: (event: { error?: unknown; reason?: unknown; preventDefault?(): void }) => void): void;
};

/** The page's model store, read over the worker's port (`bfi.store` → `bfi.stored`). */
function relayedStore(post: (message: unknown) => void): {
  store: Pick<HfModelStore, 'status' | 'open'>;
  answer(frame: { id: string; ok: boolean; result?: unknown; error?: string }): void;
} {
  let seq = 0;
  const waiting = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const ask = <T>(op: BfiStoreOp, args: { ref?: string; handle?: string }): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = `q${++seq}`;
      waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
      post({ type: 'bfi.store', id, op, ...args });
    });
  return {
    store: {
      status: (ref) => ask<'ready' | 'absent'>('status', { ref }),
      async open(ref) {
        const { handle, bytes } = await ask<{ handle: string; bytes: number }>('open', { ref });
        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            const chunk = await ask<Uint8Array | null>('read', { handle });
            if (!chunk || chunk.byteLength === 0) controller.close();
            else controller.enqueue(chunk);
          },
          cancel() {
            post({ type: 'bfi.store', id: '', op: 'close', handle });
          },
        });
        return { stream, bytes };
      },
    },
    answer(frame) {
      const w = waiting.get(frame.id);
      if (!w) return;
      waiting.delete(frame.id);
      if (frame.ok) w.resolve(frame.result);
      else w.reject(new Error(frame.error ?? 'store_failed'));
    },
  };
}

/** The WORKER half: call once at the top of the worker module. */
export function runBfiWorker(
  scope: MessageEndpointLike = globalThis as unknown as MessageEndpointLike,
  options: RunBfiWorkerOptions = {},
): void {
  const post = (message: unknown): void => scope.postMessage(message);
  const relay = relayedStore(post);
  let engine: BfiPageEngine | undefined;
  let init: BfiInitFrame | undefined;

  const load = async (): Promise<BfiModule> => {
    const { wasmUrl, threads } = init!;
    try {
      if (options.loadBfi) return await (threads ? options.loadBfi(wasmUrl, threads) : options.loadBfi(wasmUrl));
      return await loadBfiWeb(wasmUrl, undefined, threads ? { threads } : {});
    } catch (e) {
      // Posted before the rejection reaches the turn, so the page replaces this worker
      // (single-threaded) before it reads the failure.
      if (isBfiThreadsError(e)) post({ type: 'bfi.threadsFailed', message: errorMessage(e) });
      throw e;
    }
  };

  const served = serveEngineWorker(
    {
      post,
      listen: (onMessage) => {
        const listener = (event: { data: unknown }) => onMessage(event.data);
        scope.addEventListener('message', listener);
        return () => scope.removeEventListener('message', listener);
      },
      onUncaught(listener) {
        const realm = scope as unknown as UncaughtScope;
        realm.addEventListener?.('error', (event) => {
          if (listener(event.error)) event.preventDefault?.();
        });
        realm.addEventListener?.('unhandledrejection', (event) => {
          if (listener(event.reason)) event.preventDefault?.();
        });
      },
    },
    () => (engine ? [engine] : []),
    (message) => {
      const f = bfiWorkerFrame(message);
      if (f?.type === 'bfi.init') {
        if (engine) return;
        init = f;
        engine = createBfiEngine({
          loadBfi: load,
          store: f.relayStore ? relay.store : (options.store ?? createHfModelStore()),
          ...(f.backends ? { backends: f.backends } : {}),
          onTrap: (error) => served.fatal(error),
        });
      } else if (f?.type === 'bfi.support') {
        const answer = engine ? engine.support() : Promise.reject(new Error('bfi.init has not arrived'));
        void answer.then(
          (support) => post({ type: 'bfi.supported', id: f.id, support }),
          () => post({ type: 'bfi.supported', id: f.id }),
        );
      } else if (f?.type === 'bfi.stored') relay.answer(f);
    },
    { onFatal: forgetBfiWeb },
  );
}
