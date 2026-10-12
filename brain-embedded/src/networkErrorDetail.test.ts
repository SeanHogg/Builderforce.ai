import { describe, expect, it } from 'vitest';
import { describeNetworkError } from './networkErrorDetail';
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
