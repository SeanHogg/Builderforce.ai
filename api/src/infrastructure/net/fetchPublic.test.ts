import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPublic, withPublicHostGuard } from './fetchPublic';
import { BlockedUrlError } from './ssrfGuard';

/** A DoH stub: `answers` is consumed one lookup-PAIR at a time, so a test can make the
 *  name resolve public first and private second — the rebinding this module catches.
 *  `resolveAndAssertPublic` issues an A and an AAAA query per call. */
function stubDoh(answersPerCall: string[][]): void {
  let call = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.startsWith('https://cloudflare-dns.com/')) throw new Error(`unexpected fetch ${url}`);
    // A + AAAA are issued together; both read the same slot, and only the A query
    // returns records here (type 1).
    const slot = answersPerCall[Math.floor(call / 2)] ?? [];
    call += 1;
    const isA = url.includes('type=A&') || url.endsWith('type=A');
    return new Response(
      JSON.stringify({ Answer: isA ? slot.map((data) => ({ type: 1, data })) : [] }),
      { status: 200 },
    );
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchPublic', () => {
  it('passes a host that stays public, and the caller sees its response', async () => {
    stubDoh([['93.184.216.34'], ['93.184.216.34']]);
    const res = await fetchPublic('https://example.com/thing', undefined, {
      fetchImpl: async () => new Response('ok', { status: 200 }),
    });
    expect(await res.text()).toBe('ok');
  });

  it('blocks before the request when the host already resolves private', async () => {
    stubDoh([['169.254.169.254']]);
    const send = vi.fn(async () => new Response('metadata!'));
    await expect(fetchPublic('https://rebind.test/', undefined, { fetchImpl: send }))
      .rejects.toBeInstanceOf(BlockedUrlError);
    // The point of the pre-check: we never opened the connection at all.
    expect(send).not.toHaveBeenCalled();
  });

  it('blocks a host that flips to private DURING the request, and discards the body', async () => {
    // This is the TOCTOU case the pre-fetch check alone could not see: public for our
    // first lookup, private by the time the runtime resolved it for the connection.
    stubDoh([['93.184.216.34'], ['127.0.0.1']]);
    const cancel = vi.fn(async () => {});
    const body = { cancel } as unknown as ReadableStream;
    const response = { body, text: async () => 'internal secrets' } as unknown as Response;
    await expect(fetchPublic('https://rebind.test/', undefined, { fetchImpl: async () => response }))
      .rejects.toBeInstanceOf(BlockedUrlError);
    // The response must never reach the caller, and its connection must not leak.
    expect(cancel).toHaveBeenCalled();
  });

  it('fails OPEN when the resolver itself is unreachable', async () => {
    // Defence in depth, not the primary guard: a DoH outage must not take out every
    // server-side fetch. `assertSafeUrl` still rejects literal private targets.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('doh down'); }));
    const res = await fetchPublic('https://example.com/', undefined, {
      fetchImpl: async () => new Response('ok'),
    });
    expect(await res.text()).toBe('ok');
  });
});

describe('withPublicHostGuard', () => {
  it('guards a host the operation dereferences on our behalf', async () => {
    // The screenshot case: we call Cloudflare, Cloudflare resolves the target.
    stubDoh([['93.184.216.34'], ['10.0.0.5']]);
    const discard = vi.fn();
    await expect(withPublicHostGuard('rebind.test', async () => 'rendered', discard))
      .rejects.toBeInstanceOf(BlockedUrlError);
    expect(discard).toHaveBeenCalledWith('rendered');
  });

  it('returns the operation result when the host stays public throughout', async () => {
    stubDoh([['93.184.216.34'], ['93.184.216.34']]);
    await expect(withPublicHostGuard('example.com', async () => 'rendered')).resolves.toBe('rendered');
  });
});
