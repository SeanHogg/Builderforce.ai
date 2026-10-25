import { describe, expect, it, vi } from 'vitest';
import { fetchLocal } from './endpoint.js';

const URL = 'https://api.kimi.ai/coding/v1/chat/completions';
const authOf = (init: RequestInit) => new Headers(init.headers).get('authorization');

// A run is routed once but makes many calls; the fifteen-minute Kimi token it was routed
// with expired before its second step and the turn died "API Key … expired".
describe('fetchLocal', () => {
  it('sends the headers it was given when the endpoint has no credential', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    await fetchLocal({ baseUrl: 'http://127.0.0.1:11434' }, fetchImpl, URL, { headers: { 'x-a': '1' } });
    expect(fetchImpl).toHaveBeenCalledWith(URL, { headers: { 'x-a': '1' } });
  });

  it('asks the credential for the current token before every request', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}'));
    const credential = vi.fn(async () => 'current');
    const endpoint = { baseUrl: 'https://api.kimi.ai/coding/v1', token: 'routed-with', credential };
    await fetchLocal(endpoint, fetchImpl, URL, { headers: { Authorization: 'Bearer routed-with', 'content-type': 'application/json' } });
    expect(authOf(fetchImpl.mock.calls[0]![1])).toBe('Bearer current');
    expect(new Headers(fetchImpl.mock.calls[0]![1].headers).get('content-type')).toBe('application/json');
  });

  it('retries a 401 once with the replacement token', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) =>
      new Response('{}', { status: authOf(init) === 'Bearer stale' ? 401 : 200 }));
    const credential = vi.fn(async (rejected?: string) => (rejected ? 'fresh' : 'stale'));
    const res = await fetchLocal({ baseUrl: 'x', credential }, fetchImpl, URL, { method: 'POST', body: '{}' });
    expect(res.status).toBe(200);
    expect(credential).toHaveBeenLastCalledWith('stale');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('returns the 401 when no better token exists', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 }));
    const res = await fetchLocal({ baseUrl: 'x', credential: async () => 'same' }, fetchImpl, URL, {});
    expect(res.status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
