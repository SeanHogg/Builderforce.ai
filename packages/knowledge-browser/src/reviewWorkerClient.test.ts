import { describe, expect, it, vi } from 'vitest';
import type { DirectorySource, KnowledgeStore } from '@seanhogg/builderforce-memory/knowledge';
import type { IngestManifest } from '@seanhogg/builderforce-memory/ingest';
import { runReview } from './reviewWorkerClient';
import { LIST_ALL, type FromReviewWorker, type ToReviewWorker } from './reviewProtocol';
import type { ReviewPorts } from './reviewJob';

/** A Worker stand-in driven by a script: what it posts, and what it does with each reply. */
class ScriptedWorker {
  onmessage: ((e: MessageEvent<FromReviewWorker>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  sent: ToReviewWorker[] = [];
  terminated = false;
  constructor(private readonly script: (msg: ToReviewWorker, emit: (m: FromReviewWorker) => void) => void) {}
  postMessage(msg: ToReviewWorker) {
    this.sent.push(msg);
    queueMicrotask(() => this.script(msg, (m) => this.onmessage?.({ data: m } as MessageEvent<FromReviewWorker>)));
  }
  terminate() { this.terminated = true; }
}

function ports(): ReviewPorts {
  const source: DirectorySource = {
    rootId: 'rovr:folder:r',
    title: 'r',
    async *list() { yield { path: 'a.md', hash: 'h1', size: 1 }; yield { path: 'b.md', hash: 'h2', size: 2 }; },
    read: async () => ({ id: 'a.md', tenantId: 'r', title: 'a.md', content: { kind: 'text', text: 'a', mediaType: 'text/markdown' } }),
  };
  const manifest: IngestManifest = { get: vi.fn(async () => undefined), set: vi.fn(async () => undefined), delete: vi.fn(async () => undefined) };
  return { source, store: {} as KnowledgeStore, manifest };
}

describe('review worker client', () => {
  it('answers the worker\'s port calls from the page — the listing as one array — and resolves its result', async () => {
    let worker!: ScriptedWorker;
    worker = new ScriptedWorker((msg, emit) => {
      if (msg.type === 'start') {
        expect(msg.source).toEqual({ rootId: 'rovr:folder:r', title: 'r' });
        emit({ type: 'call', id: 1, port: 'source', method: LIST_ALL, args: [] });
      } else if (msg.type === 'reply' && msg.id === 1) {
        expect(msg).toMatchObject({ ok: true, value: [{ path: 'a.md', hash: 'h1', size: 1 }, { path: 'b.md', hash: 'h2', size: 2 }] });
        emit({ type: 'call', id: 2, port: 'manifest', method: 'get', args: ['a.md'] });
      } else if (msg.type === 'reply' && msg.id === 2) {
        emit({ type: 'progress', progress: { phase: 'extract', done: 1, total: 2 } as never });
        emit({ type: 'result', value: { rootId: 'rovr:folder:r', files: 2 } });
      }
    });
    const onProgress = vi.fn();
    const p = ports();
    const plan = await runReview({ mode: 'plan', force: false, modelCalls: 0 }, p, { createWorker: () => worker as unknown as Worker, onProgress });
    expect(plan).toMatchObject({ rootId: 'rovr:folder:r', files: 2 });
    expect(p.manifest.get).toHaveBeenCalledWith('a.md');
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(worker.terminated).toBe(true);
  });

  it('relays abort as its own message and rejects with the worker\'s error', async () => {
    const abort = new AbortController();
    const worker = new ScriptedWorker((msg, emit) => {
      if (msg.type === 'start') abort.abort();
      if (msg.type === 'abort') emit({ type: 'error', error: 'aborted' });
    });
    await expect(runReview({ mode: 'review', force: false, modelCalls: 0 }, ports(), { createWorker: () => worker as unknown as Worker, signal: abort.signal }))
      .rejects.toThrow('aborted');
    expect(worker.sent.map((m) => m.type)).toEqual(['start', 'abort']);
  });

  it('a port failure crosses back as a failed reply, not a dead worker', async () => {
    const p = ports();
    p.manifest.set = async () => { throw new Error('quota'); };
    const worker = new ScriptedWorker((msg, emit) => {
      if (msg.type === 'start') emit({ type: 'call', id: 7, port: 'manifest', method: 'set', args: ['a.md', []] });
      else if (msg.type === 'reply') emit({ type: 'result', value: msg });
    });
    const reply = await runReview({ mode: 'plan', force: false, modelCalls: 0 }, p, { createWorker: () => worker as unknown as Worker });
    expect(reply).toMatchObject({ type: 'reply', id: 7, ok: false, error: 'quota' });
  });
});
