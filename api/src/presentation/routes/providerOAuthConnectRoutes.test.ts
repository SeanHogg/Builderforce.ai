/**
 * The shared connect/callback pair every per-user OAuth surface mounts. The
 * domains only supply `resolveConnect` and `onConnected`, so the redirect
 * vocabulary (declined / invalid_state / unavailable / error / connected) is
 * pinned here once instead of per route.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import { mountProviderOAuthConnect, type ProviderOAuthConnectSpec } from './providerOAuthConnectRoutes';
import { signProviderConnectState, type OAuthProviderConfig } from '../../application/shared/providerOAuthConnect';
import { fakeFetch } from '../../../test/fakeDb';

vi.mock('../../application/observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());

const OAUTH: OAuthProviderConfig = {
  authUrl: 'https://idp.example/authorize',
  tokenUrl: 'https://idp.example/token',
  scopes: ['openid'],
  clientIdKey: 'EX_CLIENT_ID',
  clientSecretKey: 'EX_CLIENT_SECRET',
};
const ENV = { JWT_SECRET: 'test-secret', EX_CLIENT_ID: 'id-1', EX_CLIENT_SECRET: 'sec-1', APP_URL: 'https://app.example' };

function app(overrides: Partial<ProviderOAuthConnectSpec<{ name: string }>> = {}) {
  const onConnected = vi.fn(async () => 'connected');
  const r = new Hono<HonoEnv>();
  // Stands in for the domain router's auth middleware on the connect route.
  r.use('/connect/*', async (c, next) => {
    c.set('userId' as never, 'user-1' as never);
    c.set('tenantId' as never, 7 as never);
    await next();
  });
  mountProviderOAuthConnect<{ name: string }>(r, {
    callbackPath: (name) => `/api/example/callback/${name}`,
    outcomeParam: 'example',
    defaultReturnTo: '/home',
    source: 'test',
    resolveConnect: (name) => (name === 'ex' ? { provider: { name }, oauth: OAUTH, label: 'Example' } : { error: 'Unknown provider.' }),
    onConnected,
    ...overrides,
  });
  return { r, onConnected };
}

const state = (provider = 'ex') => signProviderConnectState(ENV, {
  providerName: provider, userId: 'user-1', tenantId: 7, returnTo: '/home/inbox', returnToFallback: '/home',
});

describe('GET /connect/:provider', () => {
  it('answers 400 with the domain message for an unknown provider', async () => {
    const res = await app().r.request('/connect/nope', {}, ENV);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Unknown provider.' });
  });

  it('answers 503 when the deployment has no client for it', async () => {
    const res = await app().r.request('/connect/ex', {}, { JWT_SECRET: 'test-secret' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Example is not configured on this deployment.' });
  });

  it('returns the consent URL with the registered callback path', async () => {
    const res = await app().r.request('https://api.example/connect/ex?returnTo=/home/inbox', {}, ENV);
    const { authUrl } = await res.json() as { authUrl: string };
    const url = new URL(authUrl);
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.example/api/example/callback/ex');
    expect(url.searchParams.get('state')).toBeTruthy();
  });
});

describe('GET /callback/:provider', () => {
  it('reports a declined consent as declined', async () => {
    const res = await app().r.request('/callback/ex?error=access_denied', {}, ENV);
    expect(res.headers.get('location')).toBe('https://app.example/home?example=declined');
  });

  it('rejects a state signed for another provider', async () => {
    const res = await app().r.request(`/callback/ex?code=c1&state=${encodeURIComponent(await state('other'))}`, {}, ENV);
    expect(res.headers.get('location')).toBe('https://app.example/home?example=invalid_state');
  });

  it('exchanges the code, runs the domain hook, and redirects with its outcome', async () => {
    vi.stubGlobal('fetch', fakeFetch([{ match: '/token', json: { access_token: 'at', refresh_token: 'rt' } }]));
    const { r, onConnected } = app();
    const res = await r.request(`https://api.example/callback/ex?code=c1&state=${encodeURIComponent(await state())}`, {}, ENV);
    expect(res.headers.get('location')).toBe('https://app.example/home/inbox?example=connected');
    expect(onConnected).toHaveBeenCalledTimes(1);
    const [, grant] = onConnected.mock.calls[0] as unknown as [unknown, { state: { userId: string; tenantId: number }; tokens: { access_token: string } }];
    expect(grant.state).toMatchObject({ userId: 'user-1', tenantId: 7 });
    expect(grant.tokens.access_token).toBe('at');
  });

  it('answers a refused exchange and a throwing hook with error', async () => {
    vi.stubGlobal('fetch', fakeFetch([{ match: '/token', status: 400, json: { error: 'invalid_grant' } }]));
    const refused = await app().r.request(`/callback/ex?code=c1&state=${encodeURIComponent(await state())}`, {}, ENV);
    expect(refused.headers.get('location')).toBe('https://app.example/home/inbox?example=error');

    vi.stubGlobal('fetch', fakeFetch([{ match: '/token', json: { access_token: 'at' } }]));
    const throwing = app({ onConnected: async () => { throw new Error('db down'); } });
    const res = await throwing.r.request(`/callback/ex?code=c1&state=${encodeURIComponent(await state())}`, {}, ENV);
    expect(res.headers.get('location')).toBe('https://app.example/home/inbox?example=error');
  });

  it('lets an intercept take over before the code check (Plaid public_token)', async () => {
    const { r } = app({
      interceptCallback: async (_c, { back }) => back('/home', 'intercepted'),
    });
    const res = await r.request('/callback/ex?public_token=p1&state=s', {}, ENV);
    expect(res.headers.get('location')).toBe('https://app.example/home?example=intercepted');
  });
});
