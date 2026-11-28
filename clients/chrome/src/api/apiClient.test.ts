import { describe, expect, it, vi } from 'vitest';
import type { Session } from '../auth/session';
import { createAuthenticatedFetch, flattenErrorMessage, type ApiFetch } from './apiClient';

describe('flattenErrorMessage', () => {
  it('reads flat and nested envelopes without rendering [object Object]', () => {
    expect(flattenErrorMessage({ error: 'nope' })).toBe('nope');
    expect(flattenErrorMessage({ error: { message: 'bad', code: 'X' } })).toBe('bad');
    expect(flattenErrorMessage({ error: 'code_x', message: 'Explained' })).toBe('Explained');
    expect(flattenErrorMessage('x')).toBeUndefined();
  });
});

function setup(fetch: ApiFetch) {
  let scope = 'tenant:1';
  const session: Session = {
    ready: async () => {},
    key: async () => null,
    isSignedIn: () => true,
    scope: () => scope,
    tenantId: () => Number(scope.split(':')[1]),
    userId: () => null,
    signIn: async () => {},
    signOut: async () => {},
    jwt: vi.fn<Session['jwt']>(async (force) => force ? 'fresh' : 'cached'),
    subscribe: () => () => {},
  };
  return {
    send: createAuthenticatedFetch({ session, baseUrl: 'https://api.example.test', fetch }),
    jwt: session.jwt,
    select: (tenantId: number) => { scope = `tenant:${tenantId}`; },
  };
}

describe('authenticated tenant requests', () => {
  it('refreshes on 401 and replays the same idempotent write once', async () => {
    const fetch = vi.fn<ApiFetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { send, jwt } = setup(fetch);
    const response = await send('/api/tasks', {
      method: 'POST', json: { name: 'Review' }, asScope: 'tenant:1', idempotencyKey: 'queued-1',
    });

    expect(response.status).toBe(204);
    expect(vi.mocked(jwt).mock.calls).toEqual([[undefined], [true]]);
    expect(fetch.mock.calls.map(([url, init]) => ({
      url, method: init?.method, body: init?.body, headers: Object.fromEntries(new Headers(init?.headers)),
    }))).toEqual(['cached', 'fresh'].map((token) => ({
      url: 'https://api.example.test/api/tasks', method: 'POST', body: '{"name":"Review"}',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': 'queued-1' },
    })));
  });

  it('parks the retry if the workspace changes while refreshing', async () => {
    const fetch = vi.fn<ApiFetch>().mockResolvedValue(new Response(null, { status: 401 }));
    const { send, jwt, select } = setup(fetch);
    vi.mocked(jwt).mockImplementationOnce(async () => 'cached').mockImplementationOnce(async () => {
      select(2);
      return 'other-workspace';
    });

    await expect(send('/api/tasks', { asScope: 'tenant:1' })).rejects.toThrow('parked');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('returns the second 401 without trying again', async () => {
    const fetch = vi.fn<ApiFetch>().mockResolvedValue(new Response(null, { status: 401 }));
    const { send } = setup(fetch);
    expect((await send('/api/tasks')).status).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns a 401 for a streamed body without replaying it', async () => {
    const fetch = vi.fn<ApiFetch>().mockResolvedValue(new Response(null, { status: 401 }));
    const { send, jwt } = setup(fetch);
    expect((await send('/api/tasks', { method: 'POST', body: new ReadableStream() })).status).toBe(401);
    expect(jwt).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });
});
