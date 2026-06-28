import { describe, it, expect, vi } from 'vitest';
import { pullSentryIssues, type FetchLike } from './sentryPull';

function jsonResponse(body: unknown, link?: string): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (link) headers.Link = link;
  return new Response(JSON.stringify(body), { status: 200, headers });
}

describe('pullSentryIssues', () => {
  it('normalizes issues from the Sentry issues API (fingerprint = issue id)', async () => {
    const fetchFn: FetchLike = vi.fn(async () =>
      jsonResponse([
        { id: 'i1', title: 'TypeError: boom', culprit: 'foo()', status: 'unresolved', level: 'error', lastSeen: '2026-01-01T00:00:00Z', permalink: 'https://sentry/i1' },
        { id: 'i2', title: 'RangeError: oops', culprit: 'bar()', status: 'unresolved', lastSeen: '2026-01-02T00:00:00Z' },
      ]),
    );
    const events = await pullSentryIssues({ apiToken: 't', scope: 'org/proj' }, fetchFn);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ fingerprint: 'i1', message: 'TypeError: boom', source: 'sentry' });
    expect(events[1]).toMatchObject({ fingerprint: 'i2', message: 'RangeError: oops' });
    // Hits the project issues endpoint with the bearer token.
    const call0 = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    const url = call0[0] as string;
    const init = call0[1] as RequestInit;
    expect(url).toContain('/api/0/projects/org/proj/issues/');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
  });

  it('follows the rel="next" cursor across pages (bounded)', async () => {
    let call = 0;
    const fetchFn: FetchLike = vi.fn(async () => {
      call++;
      if (call === 1) {
        return jsonResponse([{ id: 'a', title: 'A', lastSeen: '2026-01-01T00:00:00Z' }], '<https://sentry/next>; rel="next"; results="true"; cursor="c1"');
      }
      return jsonResponse([{ id: 'b', title: 'B', lastSeen: '2026-01-02T00:00:00Z' }]);
    });
    const events = await pullSentryIssues({ apiToken: 't', scope: 'org/proj' }, fetchFn);
    expect(events.map((e) => e.fingerprint)).toEqual(['a', 'b']);
    expect(call).toBe(2);
  });

  it('throws on a bad scope', async () => {
    const fetchFn: FetchLike = vi.fn();
    await expect(pullSentryIssues({ apiToken: 't', scope: 'bad' }, fetchFn)).rejects.toThrow();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
