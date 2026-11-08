/**
 * The page's side of the review worker: starts a job, answers the worker's port calls
 * from the real ports, relays progress and abort. Without a Worker (SSR, a test, a
 * runtime that cannot spawn one) the same job runs in-thread — one implementation.
 *
 * The default worker is the web's `createReviewWorker` (`workerFactory.ts`, the only
 * module that names the worker by URL, so a server build can alias it to its stub —
 * see that file). A host whose bundler has no such asset step
 * (Rovr's esbuild) bundles `@builderforce/knowledge-browser/worker` as an entry of its own
 * and passes `createWorker`.
 */

import type { ReviewPlan, ReviewProgress, ReviewReport } from '@seanhogg/builderforce-memory/knowledge';
import { runReviewJob, type ReviewJob, type ReviewPorts } from './reviewJob';
import { LIST_ALL, READ_BYTES, type FromReviewWorker, type ReviewPortName, type ToReviewWorker } from './reviewProtocol';
import { isByteReadable, isContentHashed, withDocumentText } from './directorySourceKit';
import { createReviewWorker } from './workerFactory';

export type WorkerFactory = () => Worker | null;

function defaultWorker(): Worker | null {
  // The window guard keeps server layers from reaching it.
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;
  try {
    return createReviewWorker();
  } catch {
    return null;
  }
}

async function answer(ports: ReviewPorts, port: ReviewPortName, method: string, args: unknown[]): Promise<unknown> {
  if (port === 'source' && method === LIST_ALL) {
    const out: Array<{ path: string; hash: string; size: number }> = [];
    for await (const entry of ports.source.list()) out.push(entry);
    return out;
  }
  if (port === 'source' && method === READ_BYTES) {
    const bytes = isByteReadable(ports.source) ? await ports.source.readBytes(String(args[0])) : new Uint8Array();
    // Own the buffer: a view can window a larger one, and the reply transfers it.
    return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer;
  }
  const target = ports[port] as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined> | undefined;
  const fn = target?.[method];
  return fn ? fn.apply(target, args) : undefined;
}

function inThread(ports: ReviewPorts): ReviewPorts {
  const { source } = ports;
  return isByteReadable(source) ? { ...ports, source: withDocumentText(source, (path, signal) => source.readBytes(path, signal)) } : ports;
}

export interface RunReviewOptions {
  onProgress?: (p: ReviewProgress) => void;
  signal?: AbortSignal;
  createWorker?: WorkerFactory;
}

export function runReview(job: ReviewJob & { mode: 'plan' }, ports: ReviewPorts, opts?: RunReviewOptions): Promise<ReviewPlan>;
export function runReview(job: ReviewJob & { mode: 'review' }, ports: ReviewPorts, opts?: RunReviewOptions): Promise<ReviewReport>;
export function runReview(job: ReviewJob, ports: ReviewPorts, opts: RunReviewOptions = {}): Promise<ReviewPlan | ReviewReport> {
  const worker = (opts.createWorker ?? defaultWorker)();
  // No Worker: the extraction runs in-thread, wrapped here — the ONE place a page source's bytes become document text.
  if (!worker) return runReviewJob(job, inThread(ports), opts.onProgress, opts.signal);
  return new Promise((resolve, reject) => {
    const post = (m: ToReviewWorker, transfer: Transferable[] = []) => worker.postMessage(m, transfer);
    const finish = () => { worker.terminate(); opts.signal?.removeEventListener('abort', onAbort); };
    const onAbort = () => post({ type: 'abort' });
    opts.signal?.addEventListener('abort', onAbort);
    worker.onmessage = (event: MessageEvent<FromReviewWorker>) => {
      const msg = event.data;
      if (msg.type === 'call') {
        answer(ports, msg.port, msg.method, msg.args)
          .then((value) => post({ type: 'reply', id: msg.id, ok: true, value }, value instanceof ArrayBuffer ? [value] : []))
          .catch((err: unknown) => post({ type: 'reply', id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) }));
      } else if (msg.type === 'progress') {
        opts.onProgress?.(msg.progress);
      } else if (msg.type === 'result') {
        finish();
        resolve(msg.value as ReviewPlan | ReviewReport);
      } else {
        finish();
        reject(new Error(msg.error));
      }
    };
    worker.onerror = (e) => { finish(); reject(new Error(e.message || 'knowledge review worker failed')); };
    post({ type: 'start', job, source: { rootId: ports.source.rootId, title: ports.source.title }, hasJudgement: !!ports.judgement, hashesAreContentHash: isContentHashed(ports.source) });
  });
}
