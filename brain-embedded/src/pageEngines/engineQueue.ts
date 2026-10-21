/**
 * ONE queue per engine instance set: a turn holds it from the moment it needs a model
 * resident until its stream ends, so a load, an eviction, an unload and a stream never
 * overlap — not on one backend, and not across two (a CPU turn arriving while a GPU load
 * is in flight waits for that load, then evicts it; a turn arriving during another
 * stream waits for that stream to finish — a running answer is never aborted for it).
 *
 * A waiter whose signal aborts leaves the queue without ever holding it.
 */
import { abortReason } from './types';

export interface EngineQueue {
  /** Wait for the queue; resolves with the release (idempotent). Rejects with the abort
   *  reason when `signal` aborts first. */
  acquire(signal?: AbortSignal): Promise<() => void>;
}

export function createEngineQueue(): EngineQueue {
  let tail: Promise<void> = Promise.resolve();
  return {
    acquire(signal) {
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const previous = tail;
      tail = previous.then(() => held);
      let released = false;
      const once = (): void => {
        if (released) return;
        released = true;
        release();
      };
      return new Promise<() => void>((resolve, reject) => {
        const onAbort = (): void => {
          reject(abortReason(signal!));
          // Never held: hand the turn on as soon as the one before it is done.
          void previous.then(once);
        };
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });
        void previous.then(() => {
          if (signal?.aborted) return;
          signal?.removeEventListener('abort', onAbort);
          resolve(once);
        });
      });
    },
  };
}
