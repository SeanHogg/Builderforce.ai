import { describe, expect, it, vi } from 'vitest';
import { askRuntimeTools, serveRuntimeTools, type BridgeChannel, type ChannelFactory } from './runtimeToolBridge';
import { closedLogStream, type RunSession } from '../runTarget';
import type { ActiveRun } from '../activeRun';

/** In-memory BroadcastChannel semantics: a post reaches every OTHER channel of the name. */
function bus(): ChannelFactory {
  const channels = new Set<{ listeners: Set<(event: { data: unknown }) => void> }>();
  return () => {
    const self = { listeners: new Set<(event: { data: unknown }) => void>() };
    channels.add(self);
    const channel: BridgeChannel = {
      postMessage(message) {
        for (const other of channels) if (other !== self) for (const l of other.listeners) queueMicrotask(() => l({ data: structuredClone(message) }));
      },
      addEventListener: (_type, listener) => { self.listeners.add(listener); },
      removeEventListener: (_type, listener) => { self.listeners.delete(listener); },
      close: () => { channels.delete(self); },
    };
    return channel;
  };
}

const session = (targetId: RunSession['targetId']): RunSession => ({
  targetId, services: () => [], url: () => undefined, logs: () => closedLogStream(),
  restart: async () => undefined, stop: async () => undefined, onState: () => () => undefined,
});
const run = (targetId: RunSession['targetId'] = 'browser'): ActiveRun => ({ projectId: '7', session: session(targetId), declined: [], blueprint: null });

describe('runtime tool bridge', () => {
  it('reaches the tab that holds the browser run, and only it answers', async () => {
    const channel = bus();
    const holder = vi.fn(async () => ({ ok: true, target: 'browser', from: 'holder' }));
    const bystander = vi.fn(async () => ({ ok: true, from: 'bystander' }));
    const stopHolder = serveRuntimeTools({ channel, runFor: (id) => (id === '7' ? run() : undefined), execute: holder });
    const stopBystander = serveRuntimeTools({ channel, runFor: () => undefined, execute: bystander });
    const answer = await askRuntimeTools('runtime.preview_status', { projectId: 7 }, { channel, discoverMs: 50 });
    expect(answer).toEqual({ answered: true, result: { ok: true, target: 'browser', from: 'holder' } });
    expect(holder).toHaveBeenCalledWith(expect.objectContaining({ projectId: '7' }), 'runtime.preview_status', { projectId: 7 });
    expect(bystander).not.toHaveBeenCalled();
    stopHolder();
    stopBystander();
  });

  it('answers nothing when no tab holds a browser run (a container run does not count)', async () => {
    const channel = bus();
    const stop = serveRuntimeTools({ channel, runFor: () => run('container'), execute: vi.fn() });
    expect(await askRuntimeTools('runtime.preview_logs', { projectId: 7 }, { channel, discoverMs: 20 })).toEqual({ answered: false });
    stop();
  });

  it('reports a holder that never answers instead of waiting forever', async () => {
    const channel = bus();
    const stop = serveRuntimeTools({ channel, runFor: () => run(), execute: () => new Promise(() => undefined) });
    expect(await askRuntimeTools('runtime.run_verify', { projectId: 7 }, { channel, discoverMs: 50, callMs: 30 }))
      .toMatchObject({ answered: true, result: { ok: false, target: 'browser' } });
    stop();
  });

  it('turns a holder’s failure into a tool result', async () => {
    const channel = bus();
    const stop = serveRuntimeTools({ channel, runFor: () => run(), execute: async () => { throw new Error('boom'); } });
    expect(await askRuntimeTools('runtime.preview_restart', { projectId: 7 }, { channel, discoverMs: 50 }))
      .toEqual({ answered: true, result: { ok: false, target: 'browser', error: 'boom' } });
    stop();
  });
});
