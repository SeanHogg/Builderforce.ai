/**
 * The shared refresh lifecycle every per-user grant runs through (mailbox, drive,
 * calendar, ledger, YouTube, MCP). Each domain only maps the verdict onto its own
 * row, so the verdicts themselves are pinned here once.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import {
  grantFromTokenResponse,
  providerGrantRefresher,
  refreshGrantIfStale,
  type SealedOAuthTokens,
} from './oauthTokenVault';
import { TokenEndpointError } from '../shared/providerOAuthConnect';
import { fakeFetch } from '../../../test/fakeDb';

afterEach(() => vi.unstubAllGlobals());

const STALE: SealedOAuthTokens = { accessToken: 'old-access', refreshToken: 'old-refresh', expiresAtMs: Date.now() - 1_000, scope: 'mail' };
const FRESH: SealedOAuthTokens = { ...STALE, expiresAtMs: Date.now() + 3_600_000 };

describe('refreshGrantIfStale', () => {
  it('hands back a still-fresh grant without calling the provider', async () => {
    const refresher = vi.fn();
    expect(await refreshGrantIfStale(FRESH, refresher)).toEqual({ ok: true, refreshed: false, tokens: FRESH });
    expect(refresher).not.toHaveBeenCalled();
  });

  it('reports a stale grant with no refresh token, before asking for a client', async () => {
    expect(await refreshGrantIfStale({ ...STALE, refreshToken: undefined }, null)).toEqual({ ok: false, reason: 'no_refresh_token' });
  });

  it('reports unconfigured when there is no client to refresh through', async () => {
    expect(await refreshGrantIfStale(STALE, null)).toEqual({ ok: false, reason: 'unconfigured' });
  });

  it('merges a refresh that did not rotate the refresh token (Google) and keeps the old one', async () => {
    const result = await refreshGrantIfStale(STALE, async () => ({ access_token: 'new-access', expires_in: 3600 }));
    expect(result.ok && result.refreshed).toBe(true);
    if (!result.ok) return;
    expect(result.tokens).toMatchObject({ accessToken: 'new-access', refreshToken: 'old-refresh', scope: 'mail' });
    expect(result.tokens.expiresAtMs).toBeGreaterThan(Date.now());
  });

  it('calls a 400/401 refusal revoked — the person must reconnect', async () => {
    const result = await refreshGrantIfStale(STALE, async () => {
      throw new TokenEndpointError('Token refresh failed: 401', 401, '{"error":"invalid_grant"}');
    });
    expect(result).toMatchObject({ ok: false, reason: 'revoked', message: 'Token refresh failed: 401' });
  });

  it('calls anything else transient, so an outage never looks like withdrawn consent', async () => {
    const result = await refreshGrantIfStale(STALE, async () => {
      throw new TokenEndpointError('Token refresh failed: 503', 503, '');
    });
    expect(result).toMatchObject({ ok: false, reason: 'failed' });
  });
});

describe('providerGrantRefresher', () => {
  const DESCRIPTOR = { tokenUrl: 'https://idp.example/token', clientIdKey: 'X_CLIENT_ID', clientSecretKey: 'X_CLIENT_SECRET' };

  it('is null when the deployment has no client for the descriptor', () => {
    expect(providerGrantRefresher({} as unknown as Env, DESCRIPTOR)).toBeNull();
  });

  it('refreshes through the shared token request with the deployment client', async () => {
    const fetchImpl = fakeFetch([{ match: '/token', json: { access_token: 'new-access', refresh_token: 'rotated' } }]);
    vi.stubGlobal('fetch', fetchImpl);
    const refresher = providerGrantRefresher({ X_CLIENT_ID: 'id-1', X_CLIENT_SECRET: 'sec-1' } as unknown as Env, DESCRIPTOR)!;
    const result = await refreshGrantIfStale(STALE, refresher);
    expect(result.ok && result.tokens.refreshToken).toBe('rotated');
    const body = new URLSearchParams(fetchImpl.calls[0]?.body);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('old-refresh');
    expect(body.get('client_id')).toBe('id-1');
  });
});

describe('grantFromTokenResponse', () => {
  it('stamps the relative expiry absolute and drops absent fields', () => {
    const grant = grantFromTokenResponse({ access_token: 'a', expires_in: 60 });
    expect(grant.accessToken).toBe('a');
    expect(grant).not.toHaveProperty('refreshToken');
    expect(grant.expiresAtMs).toBeGreaterThan(Date.now());
  });
});
