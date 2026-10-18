import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAuthorizationUrl,
  buildProviderConsentUrl,
  completeProviderOAuthCallback,
  exchangeCodeForTokens,
  isProviderOAuthConfigured,
  providerOAuthCredentials,
  providerTokenClient,
  refreshAccessToken,
  safeReturnTo,
  signProviderConnectState,
  TokenEndpointError,
  verifyProviderConnectState,
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

describe('buildAuthorizationUrl', () => {
  it('sets the standard params, joins array scopes and adds PKCE S256', () => {
    const url = new URL(buildAuthorizationUrl('https://idp.example/authorize', {
      clientId: 'c1', redirectUri: 'https://app.example/cb', scopes: ['a', 'b'], state: 's1', codeChallenge: 'ch',
      extra: { resource: 'https://mcp.example' },
    }));
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('c1');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example/cb');
    expect(url.searchParams.get('scope')).toBe('a b');
    expect(url.searchParams.get('state')).toBe('s1');
    expect(url.searchParams.get('code_challenge')).toBe('ch');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('resource')).toBe('https://mcp.example');
  });

  it('keeps a query string the endpoint already carries instead of adding a second "?"', () => {
    // Discovered endpoints (an MCP AS, an enterprise IdP) can carry their own query.
    const raw = buildAuthorizationUrl('https://idp.example/authorize?tenant=acme', {
      clientId: 'c1', redirectUri: 'https://app.example/cb', scopes: 'openid email',
    });
    expect(raw.split('?')).toHaveLength(2);
    const url = new URL(raw);
    expect(url.searchParams.get('tenant')).toBe('acme');
    expect(url.searchParams.get('scope')).toBe('openid email');
  });

  it('omits empty scope, state and PKCE rather than sending blanks', () => {
    const url = new URL(buildAuthorizationUrl('https://idp.example/authorize', {
      clientId: 'c1', redirectUri: 'https://app.example/cb', scopes: [],
    }));
    expect(url.searchParams.has('scope')).toBe(false);
    expect(url.searchParams.has('state')).toBe(false);
    expect(url.searchParams.has('code_challenge')).toBe(false);
  });
});

describe('signProviderConnectState / verifyProviderConnectState', () => {
  it('round-trips the connecting user, tenant, returnTo and per-flow extras', async () => {
    const raw = await signProviderConnectState(ENV, {
      providerName: 'mcp-extension', userId: 'user-1', tenantId: 7,
      returnTo: '/settings/integrations?tab=mcp', returnToFallback: '/settings',
      extra: { extensionId: 'ext-9' },
    });
    const state = await verifyProviderConnectState(ENV, 'mcp-extension', raw, '/settings');
    expect(state).toMatchObject({
      provider: 'mcp-extension', userId: 'user-1', tenantId: 7,
      returnTo: '/settings/integrations?tab=mcp', extensionId: 'ext-9',
    });
  });

  it('rejects a state verified for a different provider', async () => {
    const raw = await signProviderConnectState(ENV, {
      providerName: 'google', userId: 'user-1', tenantId: 7, returnTo: undefined, returnToFallback: '/x',
    });
    expect(await verifyProviderConnectState(ENV, 'microsoft', raw, '/x')).toBeNull();
  });

  it('never lets `extra` overwrite the signed identity fields', async () => {
    const raw = await signProviderConnectState(ENV, {
      providerName: 'google', userId: 'user-1', tenantId: 7, returnTo: '/ok', returnToFallback: '/x',
      extra: { userId: 'attacker', tenantId: 999, provider: 'other', returnTo: 'https://evil.example' },
    });
    const state = await verifyProviderConnectState(ENV, 'google', raw, '/x');
    expect(state).toMatchObject({ userId: 'user-1', tenantId: 7, provider: 'google', returnTo: '/ok' });
  });

  it('constrains returnTo at signing time', async () => {
    const raw = await signProviderConnectState(ENV, {
      providerName: 'google', userId: 'user-1', tenantId: 7, returnTo: '//evil.example', returnToFallback: '/home',
    });
    expect((await verifyProviderConnectState(ENV, 'google', raw, '/home'))?.returnTo).toBe('/home');
  });
});

describe('descriptor-driven token exchange', () => {
  it('builds the token client from the descriptor and env, carrying the body encoding', () => {
    expect(providerTokenClient(ENV, { ...PROVIDER, tokenBodyEncoding: 'json' })).toEqual({
      tokenUrl: PROVIDER.tokenUrl, clientId: 'client-123', clientSecret: 'secret-456', bodyEncoding: 'json',
    });
    expect(providerTokenClient({}, PROVIDER)).toBeNull();
  });

  it('form-encodes by default and sends PKCE extras', async () => {
    const fetchImpl = fakeFetch([{ match: '/token', json: { access_token: 'at', refresh_token: 'rt', expires_in: 60 } }]);
    vi.stubGlobal('fetch', fetchImpl);
    const tokens = await exchangeCodeForTokens(providerTokenClient(ENV, PROVIDER)!, 'code-1', REDIRECT_URI, { code_verifier: 'v1' });
    expect(tokens).toMatchObject({ access_token: 'at', refresh_token: 'rt', expires_in: 60 });
    expect(fetchImpl.calls[0]?.headers['content-type']).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(fetchImpl.calls[0]?.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('code-1');
    expect(body.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(body.get('client_secret')).toBe('secret-456');
    expect(body.get('code_verifier')).toBe('v1');
  });

  it('JSON-encodes when the descriptor says so (Anthropic), and omits the secret for a public client', async () => {
    const fetchImpl = fakeFetch([{ match: '/token', json: { access_token: 'at' } }]);
    vi.stubGlobal('fetch', fetchImpl);
    await exchangeCodeForTokens(
      { tokenUrl: 'https://idp.example/token', clientId: 'public-1', bodyEncoding: 'json' },
      'code-1', REDIRECT_URI, { state: 's1' },
    );
    expect(fetchImpl.calls[0]?.headers['content-type']).toBe('application/json');
    const body = JSON.parse(fetchImpl.calls[0]?.body ?? '{}') as Record<string, string>;
    expect(body).toMatchObject({ grant_type: 'authorization_code', client_id: 'public-1', code: 'code-1', state: 's1' });
    expect(body).not.toHaveProperty('client_secret');
  });

  it('throws TokenEndpointError carrying the upstream status and body', async () => {
    vi.stubGlobal('fetch', fakeFetch([{ match: '/token', status: 401, json: { error: 'invalid_grant' } }]));
    const error = await refreshAccessToken(providerTokenClient(ENV, PROVIDER)!, 'rt').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TokenEndpointError);
    expect((error as TokenEndpointError).status).toBe(401);
    expect((error as TokenEndpointError).body).toContain('invalid_grant');
    // The message shape `isTerminalRefreshFailure` parses.
    expect((error as Error).message).toBe('Token refresh failed: 401');
  });
});
