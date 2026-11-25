/**
 * The page-side binding of the runtime's `CodeScanner` port to `@builderforce/code-shield`, running in
 * a Web Worker (`codeScan.worker.ts`). The runtime depends on the port, never on this file.
 *
 * Fail to incomplete, never to clean: a Worker that cannot start, crashes or is aborted rejects the
 * pending scans, and the runtime reads a rejected scan as incomplete (`code.scan_incomplete`).
 */
import type { CodeScanner, CodeScanVerdict } from '@seanhogg/builderforce-webcontainers-core';
import type { CodeScanRequest, CodeScanResponse } from './codeScan.worker';

interface Pending {
  resolve(verdicts: readonly CodeScanVerdict[]): void;
  reject(reason: unknown): void;
}

export function createWorkerCodeScanner(): CodeScanner {
  let worker: Worker | undefined;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  const failAll = (reason: unknown): void => {
    for (const request of pending.values()) request.reject(reason);
    pending.clear();
    worker?.terminate();
    worker = undefined; // the next scan starts a fresh Worker
  };

  const start = (): Worker => {
    const created = new Worker(new URL('./codeScan.worker.ts', import.meta.url), { type: 'module' });
    created.addEventListener('message', (event: MessageEvent<CodeScanResponse>) => {
      pending.get(event.data.id)?.resolve(event.data.verdicts);
      pending.delete(event.data.id);
    });
    created.addEventListener('error', () => failAll(new Error('The code scanner Worker failed.')));
    return created;
  };

  return {
    scan(origin, subjects, signal) {
      signal?.throwIfAborted();
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        signal?.addEventListener('abort', () => (pending.delete(id), reject(signal.reason)), { once: true });
        worker ??= start();
        const request: CodeScanRequest = { id, origin, subjects };
        worker.postMessage(request);
      });
    },
  };
}
