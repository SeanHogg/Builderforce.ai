// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/i18n/config', () => ({
  LOCALE_HEADER: 'X-BuilderForce-Locale',
  readLocaleCookie: vi.fn(() => 'en'),
}));

import { apiRequest } from './apiClient';

const b64 = (value: object) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (tag: string, lifeSec = 900) => {
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'HS256' })}.${b64({ tag, iat: now, exp: now + lifeSec })}.sig`;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const OLD_WEB = jwt('old-web');
const NEW_WEB = jwt('new-web');
const OLD_TENANT = jwt('old-tenant');
const NEW_TENANT = jwt('new-tenant');

type Call = { url: string; authorization: string | null };

/** A fake API: `/api/thing` answers 401 until it is sent `acceptedToken`. */
function fakeApi(opts: { acceptedToken: string | null; renew: () => Response }) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const authorization = new Headers(init?.headers).get('Authorization');
    calls.push({ url, authorization });
    if (url.endsWith('/api/auth/web/renew')) return opts.renew();
    if (url.endsWith('/api/auth/tenant-token')) return json(200, { token: NEW_TENANT });
    return authorization === `Bearer ${opts.acceptedToken}` ? json(200, { ok: true }) : json(401, { error: 'Token expired' });
  });
  return { calls, count: (suffix: string) => calls.filter((c) => c.url.endsWith(suffix)).length };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('bf_web_token', OLD_WEB);
  localStorage.setItem('bf_tenant_token', OLD_TENANT);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('apiRequest 401 handling', () => {
  it('renews once and retries the request with the fresh token', async () => {
    const api = fakeApi({ acceptedToken: NEW_WEB, renew: () => json(200, { token: NEW_WEB }) });

    await expect(apiRequest('/api/thing', { auth: 'web' })).resolves.toEqual({ ok: true });

    expect(api.count('/api/thing')).toBe(2);
    expect(api.count('/api/auth/web/renew')).toBe(1);
    expect(api.calls.at(-1)!.authorization).toBe(`Bearer ${NEW_WEB}`);
    expect(localStorage.getItem('bf_web_token')).toBe(NEW_WEB);
  });

  it('re-mints the workspace token after the web token renews, then retries with it', async () => {
    localStorage.setItem('bf_tenant', JSON.stringify({ id: '5', name: 'Acme' }));
    const api = fakeApi({ acceptedToken: NEW_TENANT, renew: () => json(200, { token: NEW_WEB }) });

    await expect(apiRequest('/api/thing')).resolves.toEqual({ ok: true });

    expect(api.count('/api/auth/tenant-token')).toBe(1);
    expect(api.calls.find((c) => c.url.endsWith('/api/auth/tenant-token'))!.authorization).toBe(`Bearer ${NEW_WEB}`);
    expect(localStorage.getItem('bf_tenant_token')).toBe(NEW_TENANT);
  });

  it('retries only once when the fresh token is refused too', async () => {
    const api = fakeApi({ acceptedToken: null, renew: () => json(200, { token: NEW_WEB }) });

    await expect(apiRequest('/api/thing', { auth: 'web' })).rejects.toThrow('Session expired');

    expect(api.count('/api/thing')).toBe(2);
    expect(api.count('/api/auth/web/renew')).toBe(1);
  });

  it('signs out without retrying when the session has reached its maximum age', async () => {
    const api = fakeApi({ acceptedToken: null, renew: () => json(401, { error: 'Session has reached its maximum age', code: 'session_expired' }) });

    await expect(apiRequest('/api/thing', { auth: 'web' })).rejects.toThrow('Session expired');

    expect(api.count('/api/thing')).toBe(1);
    expect(api.count('/api/auth/web/renew')).toBe(1);
    expect(localStorage.getItem('bf_web_token')).toBeNull();
  });

  it('does not renew for a request that carried no credential', async () => {
    localStorage.clear();
    const api = fakeApi({ acceptedToken: null, renew: () => json(200, { token: NEW_WEB }) });

    await expect(apiRequest('/api/thing')).rejects.toThrow('Token expired');

    expect(api.count('/api/auth/web/renew')).toBe(0);
  });
});
