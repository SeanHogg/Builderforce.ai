/** @vitest-environment jsdom */
/**
 * THE platform gate on WebSockets (`openSocket`): the same decision `fetch` gets, read from
 * the shared route table. Under Local only (an anonymous visitor's default) a socket that
 * carries the person's content — live canvas sync, a room, an execution stream — is never
 * CONSTRUCTED, and its reconnector parks quietly (no retry loop) until the person opts
 * into Hybrid; a "something changed" socket still opens.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_ORIGIN } from '../apiOrigin';
import { WEB_INFERENCE_MODE_STORAGE_KEY, notifyWebInferenceMode } from '../localFirst/webInferenceMode';
import { createReconnector, openSocket } from './reconnectPolicy';

const wsOrigin = API_ORIGIN.replace(/^http/, 'ws');
const CANVAS_SYNC = `${wsOrigin}/api/creation-sessions/abc/ws?token=t`;
const ROOM = `${wsOrigin}/api/guest/rooms/XY12/ws?channel=chat&token=t`;
const EXECUTION = `${wsOrigin}/api/runtime/executions/9/stream?token=t`;
const BROADCASTS = `${wsOrigin}/api/guest/messages/ws`;

let constructed: string[];

class FakeSocket {
  constructor(readonly url: string) { constructed.push(url); }
  close(): void {}
}

beforeEach(() => {
  constructed = [];
  window.localStorage.clear();
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('openSocket — the platform gate', () => {
  it('Local only (the anonymous default): content sockets are never constructed', () => {
    expect(openSocket(CANVAS_SYNC)).toBeNull();
    expect(openSocket(ROOM)).toBeNull();
    expect(openSocket(EXECUTION)).toBeNull();
    expect(constructed).toEqual([]);
  });

  it('Local only: a socket that only says "something changed" still opens', () => {
    expect(openSocket(BROADCASTS)).not.toBeNull();
    expect(constructed).toEqual([BROADCASTS]);
  });

  it('Hybrid: content sockets open', () => {
    window.localStorage.setItem(WEB_INFERENCE_MODE_STORAGE_KEY, 'hybrid');
    expect(openSocket(CANVAS_SYNC)).not.toBeNull();
    expect(constructed).toEqual([CANVAS_SYNC]);
  });

  it('a refused socket parks its reconnector — one quiet give-up, no retries — and it resumes on Hybrid', () => {
    const onGiveUp = vi.fn();
    const onRetryScheduled = vi.fn();
    const connect = vi.fn(() => {
      const socket = openSocket(CANVAS_SYNC);
      if (!socket) reconnector.closed();
    });
    const reconnector = createReconnector({ connect, onGiveUp, onRetryScheduled });
    reconnector.start();
    expect(onGiveUp).toHaveBeenCalledWith('local-only');
    expect(onRetryScheduled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10 * 60_000);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(constructed).toEqual([]);

    // The person opts into Hybrid: the parked reconnector tries again, and the socket opens.
    window.localStorage.setItem(WEB_INFERENCE_MODE_STORAGE_KEY, 'hybrid');
    notifyWebInferenceMode();
    expect(connect).toHaveBeenCalledTimes(2);
    expect(constructed).toEqual([CANVAS_SYNC]);
    reconnector.stop();
  });
});
