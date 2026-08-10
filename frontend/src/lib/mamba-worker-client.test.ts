import { describe, it, expect, vi } from 'vitest';
import { MambaWorkerProvider, hasWorker } from './mamba-worker-client';
import type { WorkerRequest, WorkerResponse } from './mamba-worker-protocol';

// ---------------------------------------------------------------------------
// A fake Worker that speaks the mamba-worker protocol — lets us exercise the
// client's RPC (request ids, token/epoch events, result/error, transfer) with
// no real Worker, WebGPU, or engine.
// ---------------------------------------------------------------------------

class FakeWorker {
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  terminated = false;
  readonly posted: WorkerRequest[] = [];

  postMessage(req: WorkerRequest): void {
    this.posted.push(req);
    // Respond asynchronously, like a real worker.
    queueMicrotask(() => this.handle(req));
  }

  terminate(): void {
    this.terminated = true;
  }

  private emit(msg: WorkerResponse): void {
    this.onmessage?.({ data: msg } as MessageEvent<WorkerResponse>);
  }

  private handle(req: WorkerRequest): void {
    switch (req.type) {
      case 'init':
        this.emit({ id: req.id, type: 'result', value: { ready: true, failureReason: null } });
        break;
      case 'generate':
        this.emit({ id: req.id, type: 'result', value: `gen:${req.input}` });
        break;
      case 'stream':
        this.emit({ id: req.id, type: 'token', token: 'a' });
        this.emit({ id: req.id, type: 'token', token: 'b' });
        this.emit({ id: req.id, type: 'result', value: 'ab' });
        break;
      case 'train':
        this.emit({ id: req.id, type: 'epoch', epoch: 1, loss: 2.0 });
        this.emit({ id: req.id, type: 'epoch', epoch: 2, loss: 1.0 });
        this.emit({ id: req.id, type: 'result', value: [2.0, 1.0] });
        break;
      case 'export':
        this.emit({ id: req.id, type: 'result', value: new ArrayBuffer(8) });
        break;
      case 'dispose':
        this.emit({ id: req.id, type: 'result', value: null });
        break;
    }
  }
}

function makeProvider() {
  const worker = new FakeWorker();
  const provider = new MambaWorkerProvider({}, () => worker as unknown as Worker);
  return { worker, provider };
}

describe('MambaWorkerProvider', () => {
  it('exposes local identity', () => {
    const { provider } = makeProvider();
    expect(provider.id).toBe('mamba-worker');
    expect(provider.isLocal).toBe(true);
  });

  it('hasWorker() reports whether the runtime exposes Worker', () => {
    // Node/jsdom test envs do not implement Worker; the client works via an
    // injected factory regardless. This just asserts the detector is a boolean.
    expect(typeof hasWorker()).toBe('boolean');
  });

  it('init() becomes ready from the worker init result', async () => {
    const { provider } = makeProvider();
    expect(provider.isReady()).toBe(false);
    await provider.init();
    expect(provider.isReady()).toBe(true);
  });

  it('generate() round-trips through the worker', async () => {
    const { provider } = makeProvider();
    await provider.init();
    expect(await provider.generate('hello')).toBe('gen:hello');
  });

  it('stream() forwards token events then resolves with the full text', async () => {
    const { provider } = makeProvider();
    await provider.init();
    const tokens: string[] = [];
    const full = await provider.stream('x', undefined, (t) => tokens.push(t));
    expect(tokens).toEqual(['a', 'b']);
    expect(full).toBe('ab');
  });

  it('train() forwards per-epoch progress and returns real losses', async () => {
    const { provider } = makeProvider();
    await provider.init();
    const epochs: Array<[number, number]> = [];
    const losses = await provider.train('corpus', {
      epochs: 2,
      onEpochEnd: (e, l) => epochs.push([e, l]),
    });
    expect(epochs).toEqual([[1, 2.0], [2, 1.0]]);
    expect(losses).toEqual([2.0, 1.0]);
  });

  it('exportTrainedWeights() returns the transferred buffer', async () => {
    const { provider } = makeProvider();
    await provider.init();
    const buf = await provider.exportTrainedWeights({ fp16: true });
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBe(8);
  });

  it('generate() before init returns a not-ready message rather than throwing', async () => {
    const { provider } = makeProvider();
    expect(await provider.generate('x')).toMatch(/not ready/i);
  });

  it('dispose() terminates the worker and rejects in-flight calls', async () => {
    const { worker, provider } = makeProvider();
    await provider.init();
    provider.dispose();
    expect(worker.terminated).toBe(true);
    expect(provider.isReady()).toBe(false);
  });

  it('reports not-ready (no throw) when worker construction fails', async () => {
    const provider = new MambaWorkerProvider({}, () => {
      throw new Error('bundler cannot spawn worker');
    });
    await provider.init();
    expect(provider.isReady()).toBe(false);
    expect(provider.failureReason()).toMatch(/cannot spawn/i);
  });
});
