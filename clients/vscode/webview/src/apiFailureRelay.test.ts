import { describe, expect, it, vi } from 'vitest';
import { installApiFailureRelay, type ApiFailure } from './apiFailureRelay';

function target(respond: () => Response) {
  const calls: Array<{ input: unknown; init?: RequestInit; self: unknown }> = [];
  const t = {
    fetch: function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      calls.push({ input, init, self: this });
      return Promise.resolve(respond());
    } as typeof fetch,
  };
  return { t, calls };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('installApiFailureRelay', () => {
  it('reports a 5xx with its method, path (no query), sentence and reference', async () => {
    const { t } = target(() => new Response(JSON.stringify({ error: 'Something went wrong on our side. Reference: 3f9a1c2b7d4e', errorId: '3f9a1c2b7d4e' }), { status: 500 }));
    const report = vi.fn<(f: ApiFailure) => void>();
    installApiFailureRelay(report, t);

    const res = await t.fetch('https://builderforce.ai/api/brain/chats/122/messages?token=secret', { method: 'post' });
    await settle();

    expect(report).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/brain/chats/122/messages',
      status: 500,
      error: 'Something went wrong on our side. Reference: 3f9a1c2b7d4e',
      errorId: '3f9a1c2b7d4e',
    });
    // The caller's body is untouched — the relay read a clone.
    expect(await res.json()).toMatchObject({ errorId: '3f9a1c2b7d4e' });
  });

  it('stays silent on success and keeps a non-JSON failure to status and path', async () => {
    let next = new Response('{}', { status: 200 });
    const { t } = target(() => next);
    const report = vi.fn();
    installApiFailureRelay(report, t);

    await t.fetch('https://builderforce.ai/api/ok');
    await settle();
    expect(report).not.toHaveBeenCalled();

    next = new Response('<html>Bad gateway</html>', { status: 502 });
    await t.fetch('https://builderforce.ai/api/edge');
    await settle();
    expect(report).toHaveBeenCalledWith({ method: 'GET', path: '/api/edge', status: 502 });
  });

  it('calls the original fetch bound to its owner, and never wraps twice', async () => {
    const { t, calls } = target(() => new Response(null, { status: 404 }));
    const report = vi.fn();
    installApiFailureRelay(report, t);
    installApiFailureRelay(report, t);

    await t.fetch('https://builderforce.ai/api/missing');
    await settle();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.self).toBe(t);
    expect(report).toHaveBeenCalledTimes(1);
  });
});
