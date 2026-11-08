/**
 * How the compute client gets its worker, and the seam a host uses to supply its own.
 *
 * The DEFAULT is the form webpack 5 / Turbopack and Vite all bundle statically (a `new Worker(new URL(...))`). The
 * `typeof window` test is load-bearing for the BUILD, not the browser: the edge SSR compile must never walk the
 * constructor (see `frontend/src/lib/brain/localFirst.ts`, the same rule), so it stays INSIDE the guarded branch.
 *
 * A HOST may need something else. A VS Code webview can refuse a worker loaded from the webview resource origin, and the
 * client would then silently run in-process (the freeze the worker exists to prevent): the webview hands in a factory that
 * builds a blob worker (`?worker&inline`) through {@link setWorkerFactory}, before the first view renders.
 */

import type { WorkerIn, WorkerOut } from './protocol';

/** The slice of a Worker the client uses (so a test can hand in a fake). */
export interface WorkerLike {
    postMessage(message: WorkerIn, transfer?: Transferable[]): void;
    terminate(): void;
    onmessage: ((event: { data: WorkerOut }) => void) | null;
    onerror: ((event: unknown) => void) | null;
    /** A reply that could not be deserialised. Optional on a fake. */
    onmessageerror?: ((event: unknown) => void) | null;
}

/** Builds the worker, or returns null when this runtime has none. Throws when it has one it cannot start. */
export type Spawn = () => WorkerLike | null;

/** The package's own worker, in the statically bundled form. Null where there is none (a server render, jsdom). */
export function spawnComputeWorker(): WorkerLike | null {
    if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
        return new Worker(new URL('./graphCompute.worker.ts', import.meta.url), { type: 'module', name: 'kg-compute' }) as unknown as WorkerLike;
    }
    return null;
}

let override: Spawn | null = null;

/** The factory in effect: the host's, else the package's own. Read at every spawn, so a client built earlier picks a later one up on its next. */
export const currentSpawn: Spawn = () => (override ?? spawnComputeWorker)();

/** Replaces how workers are built (null restores the default). Call before the first view renders. */
export function setSpawn(spawn: Spawn | null): void { override = spawn; }
