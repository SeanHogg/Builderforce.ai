/**
 * The graph compute worker: a thin binding of the message loop in `workerHost.ts` to this worker's `self`. Tasks run one at a
 * time, first come first served, and a `cancel` reaches a task that has not started or is between steps (see `workerHost.ts`).
 * No logic lives here, so what a profiler drives is exactly what ships.
 */

import type { WorkerIn, WorkerOut } from './protocol';
import { createWorkerHost } from './workerHost';

const scope = self as unknown as { onmessage: ((e: MessageEvent<WorkerIn>) => void) | null; postMessage(message: WorkerOut, transfer?: Transferable[]): void };
const host = createWorkerHost({ reply: (m, t) => scope.postMessage(m, t), tick: () => new Promise((resolve) => setTimeout(resolve, 0)) });

scope.onmessage = (event) => host.handle(event.data);
