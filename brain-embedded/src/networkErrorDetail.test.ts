import { describe, expect, it, vi } from 'vitest';
import { describeNetworkError, isConnectFailure, retryOnConnectFailure } from './networkErrorDetail';
import { streamChatCompletion, TransportError } from './streamChatCompletion';

/** The shape undici throws: an opaque TypeError whose reason is in `cause`. */
function undiciFailure(message: string, cause: unknown): TypeError {
  return new TypeError(message, { cause });
}

function coded(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('describeNetworkError', () => {
  it('names the cause behind an opaque `fetch failed`', () => {
    const e = undiciFailure('fetch failed', coded('Headers Timeout Error', 'UND_ERR_HEADERS_TIMEOUT'));
    expect(describeNetworkError(e)).toBe('fetch failed ← UND_ERR_HEADERS_TIMEOUT: Headers Timeout Error');
  });

  it('does not repeat a code the message already carries', () => {
    const e = undiciFailure('fetch failed', coded('read ECONNRESET', 'ECONNRESET'));
    expect(describeNetworkError(e)).toBe('fetch failed ← read ECONNRESET');
  });

  it('follows a nested chain and lists every address an AggregateError tried', () => {
    const agg = new AggregateError([coded('connect ECONNREFUSED 1.2.3.4:443', 'ECONNREFUSED'), coded('connect ETIMEDOUT ::1:443', 'ETIMEDOUT')], '');
    const e = undiciFailure('fetch failed', agg);
    expect(describeNetworkError(e)).toBe('fetch failed ← connect ECONNREFUSED 1.2.3.4:443 | connect ETIMEDOUT ::1:443');
  });

  it('falls back to the plain message with no cause, and stringifies non-errors', () => {
    expect(describeNetworkError(new TypeError('fetch failed'))).toBe('fetch failed');
    expect(describeNetworkError('boom')).toBe('boom');
  });
});

describe('streamChatCompletion transport failure', () => {
  it('throws a TransportError that carries the cause in its message and as `cause`', async () => {
    const original = undiciFailure('fetch failed', coded('other side closed', 'UND_ERR_SOCKET'));
    const err = await streamChatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
      transport: { baseUrl: 'https://gw.test', getToken: () => null, fetch: () => Promise.reject(original) },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportError);
    expect((err as TransportError).message).toBe('fetch failed ← UND_ERR_SOCKET: other side closed');
    expect((err as TransportError).cause).toBe(original);
  });
});

/** Node's error for a socket that could not be opened — `code`, `syscall`, address. */
function connectError(code: string, address: string): Error {
  return Object.assign(new Error(`connect ${code} ${address}:443`), { code, syscall: 'connect' });
}

/** The exact shape chats #141/#142 hit: every Cloudflare address timed out or had no route. */
const UNREACHABLE = undiciFailure('fetch failed', new AggregateError([
  connectError('ETIMEDOUT', '172.67.182.187'),
  connectError('ENETUNREACH', '2606:4700:3034::ac43:b6bb'),
]));

describe('isConnectFailure', () => {
  it('recognises a connection that never opened', () => {
    expect(isConnectFailure(UNREACHABLE)).toBe(true);
    expect(isConnectFailure(undiciFailure('fetch failed', coded('getaddrinfo ENOTFOUND builderforce.ai', 'ENOTFOUND')))).toBe(true);
  });

  it('does not treat a failure on an OPEN socket as one — the request may have arrived', () => {
    expect(isConnectFailure(undiciFailure('fetch failed', coded('other side closed', 'UND_ERR_SOCKET')))).toBe(false);
    expect(isConnectFailure(undiciFailure('fetch failed', coded('read ECONNRESET', 'ECONNRESET')))).toBe(false);
    expect(isConnectFailure(undiciFailure('fetch failed', Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT', syscall: 'read' })))).toBe(false);
  });
});

describe('retryOnConnectFailure', () => {
  it('sends again after a connect failure and returns the answer once the network is back', async () => {
    let calls = 0;
    const onRetry = vi.fn();
    const out = await retryOnConnectFailure(async () => {
      calls++;
      if (calls < 3) throw UNREACHABLE;
      return 'ok';
    }, { delaysMs: [0, 0, 0], onRetry });
    expect(out).toBe('ok');
    expect(calls).toBe(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0]![2]).toContain('connect ETIMEDOUT');
  });

  it('gives up after its last delay with the original error', async () => {
    let calls = 0;
    const err = await retryOnConnectFailure(async () => { calls++; throw UNREACHABLE; }, { delaysMs: [0, 0] }).catch((e: unknown) => e);
    expect(err).toBe(UNREACHABLE);
    expect(calls).toBe(3);
  });

  it('never repeats a request that may have arrived', async () => {
    let calls = 0;
    const reset = undiciFailure('fetch failed', coded('read ECONNRESET', 'ECONNRESET'));
    await retryOnConnectFailure(async () => { calls++; throw reset; }, { delaysMs: [0, 0] }).catch(() => undefined);
    expect(calls).toBe(1);
  });

  it('stops waiting on a Stop', async () => {
    const ctl = new AbortController();
    const pending = retryOnConnectFailure(async () => { throw UNREACHABLE; }, { delaysMs: [60_000], signal: ctl.signal });
    ctl.abort(new Error('stopped'));
    await expect(pending).rejects.toThrow('stopped');
  });
});
