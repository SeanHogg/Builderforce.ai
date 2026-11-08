/** The one compute client of the page, and the seam a host uses to say how its worker is built. */

import { ComputeClient } from './client';
import { currentSpawn, setSpawn, type Spawn } from './workerFactory';

let shared: ComputeClient | null = null;

/** The one client of the page, built on first use. */
export function getComputeClient(): ComputeClient {
    shared ??= new ComputeClient(currentSpawn);
    return shared;
}

/**
 * Tells the package how to build its compute worker (null restores the default). For a host whose runtime refuses the default
 * `new Worker(new URL(...))`: a VS Code webview supplies a blob worker (Vite's `?worker&inline`). Call it before the first
 * view renders; a client that already exists is let go (what it owed finishes in-process) and the next use builds a new one.
 */
export function setWorkerFactory(factory: Spawn | null): void {
    setSpawn(factory);
    shared?.dispose();
    shared = null;
}
