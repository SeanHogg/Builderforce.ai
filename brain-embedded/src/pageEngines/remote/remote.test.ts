import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageEngineError } from '../types';
import { PAGE_ENGINE_CHAT_IDLE_MS, createPageEngineClient, type PageEnginePort } from './client';
import { ENGINE_WORKER_CRASH_WINDOW_MS, ENGINE_WORKER_FATAL, createEngineWorker, serveEngineWorker } from './engineWorker';
import type { PageEngineRequest } from './protocol';

/**
 * The remote page-engine primitives on their own. Load-bearing:
 *
 *  - an answer whose far side goes silent (no chunk, no heartbeat) for
 *    PAGE_ENGINE_CHAT_IDLE_MS ends with `page_engine_detached` — and a heartbeat holds it
 *    open through a long load;
 *  - a probe that times out with nothing heard from its port is reported, a late answer
 *    revives it;
 *  - the crash breaker counts only crashes inside its window;
 *  - a trap surfacing uncaught in the worker's realm becomes the ONE fatal frame.
 */

afterEach(() => vi.useRealTimers());

const body = { model: 'bonsai-1.7b-q1_0', messages: [] };

describe('createPageEngineClient — the inactivity timeout', () => {
  it('fails a silent answer with page_engine_detached and stops the far engine', async () => {
    vi.useFakeTimers();
    const posted: PageEngineRequest[] = [];
    const port: PageEnginePort = { post: (m) => void posted.push(m) };
    const client = createPageEngineClient({ probeTimeoutMs: 1_000 });
    const chunks = (await client.engine('bfi', 'http://bfi.local', () => port).chatCompletions(body))[Symbol.asyncIterator]();
    const next = chunks.next();
    next.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(PAGE_ENGINE_CHAT_IDLE_MS);
    const failure = await next.catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(PageEngineError);
    expect((failure as PageEngineError).code).toBe('page_engine_detached');
    expect((failure as PageEngineError).message).toContain('page_engine_detached');
    expect(posted.map((m) => m.type)).toEqual(['pageEngine.chat', 'pageEngine.abort']);
  });

  it('is held open by heartbeats and chunks', async () => {
    vi.useFakeTimers();
    const posted: PageEngineRequest[] = [];
    const port: PageEnginePort = { post: (m) => void posted.push(m) };
    const client = createPageEngineClient({ probeTimeoutMs: 1_000 });
    const chunks = (await client.engine('bfi', 'http://bfi.local', () => port).chatCompletions(body))[Symbol.asyncIterator]();
    const id = (posted[0] as { id: string }).id;
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(PAGE_ENGINE_CHAT_IDLE_MS - 1);
      client.receive({ type: 'pageEngine.alive', id });
    }
    client.receive({ type: 'pageEngine.chunk', id, chunk: { choices: [] } });
    client.receive({ type: 'pageEngine.end', id });
    expect((await chunks.next()).done).toBe(false);
    expect((await chunks.next()).done).toBe(true);
    expect(posted.map((m) => m.type)).toEqual(['pageEngine.chat']);
  });

  it('reports a probe that timed out with nothing heard from its port, and a late answer as proof of life', async () => {
    vi.useFakeTimers();
    const posted: PageEngineRequest[] = [];
    const port: PageEnginePort = { post: (m) => void posted.push(m) };
    const onProbeTimeout = vi.fn();
    const onHeard = vi.fn();
    const client = createPageEngineClient({ probeTimeoutMs: 100, onProbeTimeout, onHeard });
    const probe = client.engine('bfi', 'http://bfi.local', () => port).probe();
    await vi.advanceTimersByTimeAsync(100);
    expect(await probe).toBeNull();
    expect(onProbeTimeout).toHaveBeenCalledWith(port);
    client.receive({ type: 'pageEngine.probed', id: (posted[0] as { id: string }).id, probe: null });
    expect(onHeard).toHaveBeenCalledWith(port);
  });
});

describe('createEngineWorker — the crash breaker', () => {
  function lifecycle(now: () => number) {
    const delivered: unknown[] = [];
    const events: Array<{ onMessage(m: unknown): void }> = [];
    const worker = createEngineWorker({
      spawn: (e) => {
        events.push(e);
        return { post: () => undefined, terminate: () => undefined };
      },
      onMessage: (m) => void delivered.push(m),
      onStopped: () => undefined,
      warn: () => undefined,
      now,
      idleMs: Infinity,
    });
    const chat = (id: string) => worker.port().post({ type: 'pageEngine.chat', id, runtime: 'bfi', body });
    const crash = async () => {
      await Promise.resolve();
      await Promise.resolve();
      events[events.length - 1]!.onMessage({ type: ENGINE_WORKER_FATAL, message: 'unreachable' });
    };
    return { delivered, chat, crash };
  }

  it('counts only crashes inside the window', async () => {
    let at = 0;
    const { delivered, chat, crash } = lifecycle(() => at);
    chat('a');
    await crash();
    at += ENGINE_WORKER_CRASH_WINDOW_MS + 1;
    chat('b');
    await crash();
    chat('c');
    await Promise.resolve();
    expect(delivered).toEqual([]);
    await crash();
    chat('d');
    await Promise.resolve();
    expect(delivered).toEqual([expect.objectContaining({ type: 'pageEngine.error', id: 'd', status: 503, code: 'model_keeps_crashing' })]);
  });
});

describe('serveEngineWorker — a trap however it surfaces', () => {
  it('turns an uncaught trap into ONE fatal frame, after forgetting the poisoned module', () => {
    const posted: unknown[] = [];
    let uncaught!: (error: unknown) => boolean;
    const onFatal = vi.fn();
    const served = serveEngineWorker(
      { post: (m) => void posted.push(m), listen: () => () => undefined, onUncaught: (l) => (uncaught = l) },
      () => [],
      undefined,
      { onFatal },
    );
    expect(uncaught(new Error('not a trap'))).toBe(false);
    const trap = Object.assign(new Error('unreachable'), { name: 'RuntimeError' });
    expect(uncaught(trap)).toBe(true);
    served.fatal(trap);
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(posted).toEqual([{ type: ENGINE_WORKER_FATAL, message: 'unreachable' }]);
  });
});
