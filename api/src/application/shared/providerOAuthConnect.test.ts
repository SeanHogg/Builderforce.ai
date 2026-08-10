import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildProviderConsentUrl,
  completeProviderOAuthCallback,
  isProviderOAuthConfigured,
  providerOAuthCredentials,
  safeReturnTo,
  type OAuthProviderConfig,
} from './providerOAuthConnect';
import { signState } from '../../infrastructure/auth/oauthState';
import { fakeFetch } from '../../../test/fakeDb';

const PROVIDER: OAuthProviderConfig = {
  authUrl: 'https://accounts.example.com/authorize',
  tokenUrl: 'https://accounts.example.com/token',
  scopes: ['openid', 'mail.read'],
  clientIdKey: 'EXAMPLE_CLIENT_ID',
  clientSecretKey: 'EXAMPLE_CLIENT_SECRET',
  extraAuthParams: { access_type: 'offline' },
};

const ENV = {
  JWT_SECRET: 'test-secret',
  EXAMPLE_CLIENT_ID: 'client-123',
  EXAMPLE_CLIENT_SECRET: 'secret-456',
};

const REDIRECT_URI = 'https://api.example.com/api/mailbox/callback/example';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('safeReturnTo', () => {
  it('keeps a path on our own app', () => {
    expect(safeReturnTo('/growth/campaigns', '/growth')).toBe('/growth/campaigns');
  });

  it('refuses an absolute or protocol-relative target', () => {
    // The whole point: `returnTo` round-trips through the provider, so an
    // attacker-chosen value would otherwise come back as an open redirect.
    expect(safeReturnTo('https://evil.example', '/growth')).toBe('/growth');
    expect(safeReturnTo('//evil.example', '/growth')).toBe('/growth');
  });

  it('falls back on empty, whitespace and missing input', () => {
    expect(safeReturnTo(undefined, '/create')).toBe('/create');
    expect(safeReturnTo('   ', '/create')).toBe('/create');
  });
});

describe('providerOAuthCredentials', () => {
  it('resolves both halves of the client', () => {
    expect(providerOAuthCredentials(ENV, PROVIDER)).toEqual({
      clientId: 'client-123',
      clientSecret: 'secret-456',
    });
  });

  it('is null when EITHER half is missing', () => {
    expect(providerOAuthCredentials({ EXAMPLE_CLIENT_ID: 'client-123' }, PROVIDER)).toBeNull();
    expect(providerOAuthCredentials({ EXAMPLE_CLIENT_SECRET: 'secret-456' }, PROVIDER)).toBeNull();
    expect(isProviderOAuthConfigured({}, PROVIDER)).toBe(false);
    expect(isProviderOAuthConfigured(ENV, PROVIDER)).toBe(true);
  });

  it('treats an empty-string secret as unconfigured', () => {
    // A blank Worker secret is how a half-provisioned deployment looks.
    expect(isProviderOAuthConfigured({ ...ENV, EXAMPLE_CLIENT_SECRET: '' }, PROVIDER)).toBe(false);
  });
});

describe('buildProviderConsentUrl', () => {
  it('builds the consent URL with scopes, redirect and provider extras', async () => {
    const authUrl = await buildProviderConsentUrl(ENV, PROVIDER, {
      providerName: 'example',
      redirectUri: REDIRECT_URI,
      userId: 'user-1',
      tenantId: 7,
      returnTo: '/growth/campaigns',
      returnToFallback: '/growth',
    });
    const url = new URL(authUrl!);
    expect(url.origin + url.pathname).toBe('https://accounts.example.com/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid mail.read');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('state')).toBeTruthy();
    // The secret is never handed to the browser.
    expect(authUrl).not.toContain('secret-456');
  });

  it('is null when the provider is not configured on this deployment', async () => {
    const authUrl = await buildProviderConsentUrl({ JWT_SECRET: 'test-secret' }, PROVIDER, {
      providerName: 'example',
      redirectUri: REDIRECT_URI,
      userId: 'user-1',
      tenantId: 7,
      returnTo: undefined,
      returnToFallback: '/growth',
    });
    expect(authUrl).toBeNull();
  });

  it('constrains returnTo before it is signed into the state', async () => {
    const authUrl = await buildProviderConsentUrl(ENV, PROVIDER, {
      providerName: 'example',
      redirectUri: REDIRECT_URI,
      userId: 'user-1',
      tenantId: 7,
      returnTo: 'https://evil.example/steal',
      returnToFallback: '/growth',
    });
    const state = new URL(authUrl!).searchParams.get('state')!;
    vi.stubGlobal('fetch', fakeFetch([{ match: '/token', json: { access_token: 'at-1' } }]));
    const result = await completeProviderOAuthCallback(ENV, PROVIDER, {
      providerName: 'example', code: 'code-1', rawState: state, redirectUri: REDIRECT_URI,
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.state.returnTo).toBe('/growth');
  });
});

describe('completeProviderOAuthCallback', () => {
  async function stateFor(overrides: Partial<Record<string, unknown>> = {}): Promise<string> {
    return signState(ENV.JWT_SECRET, {
      provider: 'example', userId: 'user-1', tenantId: 7, returnTo: '/growth', ...overrides,
    });
  }

  it('verifies the state and exchanges the code', async () => {
    const fetchImpl = fakeFetch([{
      match: '/token',
      json: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, scope: 'openid mail.read' },
    }]);
    vi.stubGlobal('fetch', fetchImpl);

    const result = await completeProviderOAuthCallback(ENV, PROVIDER, {
      providerName: 'example', code: 'code-1', rawState: await stateFor(), redirectUri: REDIRECT_URI,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens.access_token).toBe('at-1');
    expect(result.tokens.refresh_token).toBe('rt-1');
    expect(result.state).toMatchObject({ userId: 'user-1', tenantId: 7, returnTo: '/growth' });
    expect(fetchImpl.calls[0]?.body).toContain('grant_type=authorization_code');
    expect(fetchImpl.calls[0]?.body).toContain('client_secret=secret-456');
  });

  it('rejects a state signed for a DIFFERENT provider', async () => {
    const result = await completeProviderOAuthCallback(ENV, PROVIDER, {
      providerName: 'example',
      code: 'code-1',
      rawState: await stateFor({ provider: 'other' }),
      redirectUri: REDIRECT_URI,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_state', returnTo: null });
  });

  it('rejects a state signed with a different secret', async () => {
    const forged = await signState('not-our-secret', {
      provider: 'example', userId: 'attacker', tenantId: 999, returnTo: '/growth',
    });
    const result = await completeProviderOAuthCallback(ENV, PROVIDER, {
      providerName: 'example', code: 'code-1', rawState: forged, redirectUri: REDIRECT_URI,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_state', returnTo: null });
  });

  it('reports unavailable — with the returnTo — when credentials are missing', async () => {
    const result = await completeProviderOAuthCallback(
      { JWT_SECRET: ENV.JWT_SECRET },
      PROVIDER,
      { providerName: 'example', code: 'code-1', rawState: await stateFor(), redirectUri: REDIRECT_URI },
    );
    expect(result).toEqual({ ok: false, reason: 'unavailable', returnTo: '/growth' });
  });

  it('reports a refused exchange without throwing, carrying the error for reporting', async () => {
    vi.stubGlobal('fetch', fakeFetch([{ match: '/token', status: 400, json: { error: 'invalid_grant' } }]));
    const result = await completeProviderOAuthCallback(ENV, PROVIDER, {
      providerName: 'example', code: 'stale', rawState: await stateFor(), redirectUri: REDIRECT_URI,
    });
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'exchange_failed') throw new Error(`unexpected result: ${JSON.stringify(result)}`);
    expect(result.returnTo).toBe('/growth');
    expect(result.error).toBeInstanceOf(Error);
  });
});
