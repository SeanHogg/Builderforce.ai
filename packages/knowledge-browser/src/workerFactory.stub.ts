/**
 * Server / edge stand-in for `workerFactory.ts` (aliased in by the frontend's webpack
 * config for `isServer` builds). A server has no Web Worker, and the real module's
 * `new URL(…, import.meta.url)` would emit a browser chunk loader into the server bundle.
 * The review client catches this and runs the job in-thread.
 */
export function createReviewWorker(): Worker {
  throw new Error('knowledge review worker is unavailable on the server');
}
