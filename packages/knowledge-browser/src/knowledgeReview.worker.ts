/**
 * The review worker: runs `runReviewJob` off the main thread with every port proxied to
 * the page (`reviewProtocol.ts`). Parsing and extracting a folder is the heavy part of a
 * review, and it must never jank the host's UI. The web bundles it through
 * `reviewWorkerClient`'s `new URL(…)`; Rovr bundles this file as its own entry
 * (`@builderforce/knowledge-browser/worker`) and starts it by URL.
 */

import type { DirectorySource, JudgementPort, KnowledgeStore } from '@seanhogg/builderforce-memory/knowledge';
import type { IngestManifest } from '@seanhogg/builderforce-memory/ingest';
import { bytesHash, textContentHash, withDocumentText } from './directorySourceKit';
import { runReviewJob, type ReviewPorts } from './reviewJob';
import { LIST_ALL, READ_BYTES, type FromReviewWorker, type ReviewPortName, type ToReviewWorker } from './reviewProtocol';

const scope = self as unknown as { postMessage(m: FromReviewWorker): void; onmessage: ((e: MessageEvent<ToReviewWorker>) => void) | null };
const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
let nextId = 1;
const abort = new AbortController();

function call<T>(port: ReviewPortName, method: string, args: unknown[] = []): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    scope.postMessage({ type: 'call', id, port, method, args });
  });
}

function proxyPorts(start: Extract<ToReviewWorker, { type: 'start' }>): ReviewPorts {
  // The page answers a file's BYTES (`READ_BYTES`, a transferred buffer); the pdf/office text extraction runs HERE, off the UI thread.
  const proxied: DirectorySource & { readBytes(path: string): Promise<Uint8Array> } = {
    rootId: start.source.rootId,
    title: start.source.title,
    async *list() { for (const entry of await call<Array<{ path: string; hash: string; size: number }>>('source', LIST_ALL)) yield entry; },
    read: (path) => call('source', 'read', [path]),
    readBytes: async (path: string) => new Uint8Array(await call<ArrayBuffer>('source', READ_BYTES, [path])),
    // Only a source whose hashes ARE textContentHash of the text (the page said so) can check the text it reads against the plan.
    ...(start.hashesAreContentHash ? { hashOf: textContentHash } : {}),
  };
  // `withDocumentText` also maps the extracted text back to the listing hash (`withDocumentHashes`), which stays the file's.
  const source = withDocumentText(proxied, proxied.readBytes, start.hashesAreContentHash ? bytesHash : undefined);
  const store: KnowledgeStore = {
    scopes: () => call('store', 'scopes'),
    facts: (s) => call('store', 'facts', [s]),
    relations: (s) => call('store', 'relations', [s]),
    write: (batch) => call('store', 'write', [batch]),
    markStale: (s, ref, hash) => call('store', 'markStale', [s, ref, hash]),
    getExtracted: (hash) => call('store', 'getExtracted', [hash]),
    putExtracted: (hash, extracted) => call('store', 'putExtracted', [hash, extracted]),
    // Without it the replicated store's read-through (the server's copy of unchanged files) never fires.
    preloadExtracted: (hashes) => call('store', 'preloadExtracted', [hashes]),
    markRecheck: (hashes) => call('store', 'markRecheck', [hashes]),
    recheckHashes: () => call('store', 'recheckHashes'),
    clearRecheck: (hashes) => call('store', 'clearRecheck', [hashes]),
    hasRecheck: (hash) => call('store', 'hasRecheck', [hash]),
  };
  const judgement: JudgementPort = { judge: ({ kind, items }) => call('judgement', 'judge', [{ kind, items }]) };
  const manifest: IngestManifest = {
    get: (id) => call('manifest', 'get', [id]),
    set: (id, fps) => call('manifest', 'set', [id, fps]),
    delete: (id) => call('manifest', 'delete', [id]),
  };
  return { source, store, manifest, ...(start.hasJudgement ? { judgement } : {}) };
}

scope.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === 'reply') {
    const waiter = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.ok) waiter?.resolve(msg.value);
    else waiter?.reject(new Error(msg.error));
    return;
  }
  if (msg.type === 'abort') { abort.abort(); return; }
  runReviewJob(msg.job, proxyPorts(msg), (progress) => scope.postMessage({ type: 'progress', progress }), abort.signal)
    .then((value) => scope.postMessage({ type: 'result', value }))
    .catch((err: unknown) => scope.postMessage({ type: 'error', error: err instanceof Error ? err.message : String(err) }));
};
