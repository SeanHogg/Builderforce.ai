/**
 * ONE engine instance with ONE model resident — WebLLM's shape: the engine is created on
 * first use, a call naming a different model swaps it in, and every load is chained so
 * two never race (a second load would otherwise start while the first is still streaming
 * weights into the same device).
 *
 * How a model is loaded is the engine's own (`reload(id)` for WebLLM); this only owns the
 * instance, the resident id and the chain. `bfi` has an engine PER BACKEND with one model
 * resident across them, so it serializes loads, evictions AND streams through one queue
 * of its own (`engineQueue.ts`).
 */

export interface ResidentModel<E> {
  /**
   * The engine with `id` resident — after any load already in flight. `load` runs only
   * when another model (or none) is resident; `previous` is the one it replaces. A failed
   * load rejects THIS call and leaves nothing resident; the next call starts clean.
   */
  acquire(id: string, load: (engine: E, previous: string | undefined) => Promise<void>): Promise<E>;
  /** The engine, once created. */
  readonly engine: E | undefined;
  /** The model resident now, if any. */
  readonly resident: string | undefined;
  /** Mark `id` no longer resident; returns the engine to unload when it was. */
  evict(id: string): E | undefined;
}

/** A settled link in the chain — the outcome itself reaches its own caller. */
const settled = (): undefined => undefined;

export function createResidentModel<E>(create: () => Promise<E>): ResidentModel<E> {
  let engine: E | undefined;
  let resident: string | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  return {
    acquire(id, load) {
      const run = tail.then(async () => {
        engine ??= await create();
        if (resident !== id) {
          const previous = resident;
          resident = undefined;
          await load(engine, previous);
          resident = id;
        }
        return engine;
      });
      // The chain waits for this load to SETTLE; a failure is the caller's, through `run`.
      tail = run.then(settled, settled);
      return run;
    },
    get engine() {
      return engine;
    },
    get resident() {
      return resident;
    },
    evict(id) {
      if (resident !== id || !engine) return undefined;
      resident = undefined;
      return engine;
    },
  };
}
