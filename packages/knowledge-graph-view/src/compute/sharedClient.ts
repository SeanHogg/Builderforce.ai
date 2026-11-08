/** The one compute client of the page, and the seam a host uses to say how its worker is built. */

import { ComputeClient, type ComputeProbe } from './client';
import { currentSpawn, setSpawn, type Spawn } from './workerFactory';

let shared: ComputeClient | null = null;
let probe: ComputeProbe | null = null;

/** The one client of the page, built on first use. */
export function getComputeClient(): ComputeClient {
    if (!shared) { shared = new ComputeClient(currentSpawn); shared.probe = probe; }
    return shared;
}

/**
 * Observes where every compute task runs (internal: a profiler imports it by path). Kept here, not on a client, so it
 * survives `setWorkerFactory` replacing the shared client.
 */
export function setComputeProbe(next: ComputeProbe | null): void {
    probe = next;
    if (shared) shared.probe = next;
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
