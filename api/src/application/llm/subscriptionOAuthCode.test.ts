import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeFetch } from '../../../test/fakeDb';
import {
  exchangeSubscriptionCode,
  refreshSubscriptionToken,
  subscriptionAuthorizeUrl,
  type SubscriptionOAuthClient,
  parsePastedAuthorizationCode,
  isSpentAuthorizationCode,
  spentAuthorizationCodeError,
  throwTokenExchangeFailure,
  OAUTH_CODE_SPENT,
  OAUTH_EXCHANGE_FAILED,
  OAUTH_SUBSCRIPTION_NOT_ENTITLED,
  OAuthExchangeError,
} from './subscriptionOAuthCode';

describe('parsePastedAuthorizationCode', () => {
  it('reads a full redirect URL', () => {
    expect(parsePastedAuthorizationCode('http://localhost:1455/auth/callback?code=abc&state=xyz')).toEqual({ code: 'abc', state: 'xyz' });
  });

  it('reads the code#state pair a consent page renders for copying', () => {
    expect(parsePastedAuthorizationCode('  abc123#xyz789 ')).toEqual({ code: 'abc123', state: 'xyz789' });
  });

  it('reads a bare code, leaving state to the caller', () => {
    expect(parsePastedAuthorizationCode('justacode')).toEqual({ code: 'justacode', state: null });
  });

  it('accepts the console callback URL for the Anthropic flow too', () => {
    // The tolerance used to be per-provider: Anthropic accepted only `code#state`,
    // so a user who copied the address bar instead got a confusing rejection.
    expect(parsePastedAuthorizationCode('https://console.anthropic.com/oauth/code/callback?code=abc&state=xyz'))
      .toEqual({ code: 'abc', state: 'xyz' });
  });

  it('treats an empty fragment as no state rather than an empty one', () => {
    expect(parsePastedAuthorizationCode('abc#')).toEqual({ code: 'abc', state: null });
  });
});

describe('isSpentAuthorizationCode', () => {
  it('recognises the Anthropic rejection that ended a real connect', () => {
    expect(isSpentAuthorizationCode(400, '{"error": "invalid_grant", "error_description": "Invalid \'code\' in request."}')).toBe(true);
  });

  it('recognises OpenAI prose about the authorization code', () => {
    expect(isSpentAuthorizationCode(400, 'the authorization code is invalid')).toBe(true);
  });

  it('does not claim a 500 is the user\'s fault', () => {
    expect(isSpentAuthorizationCode(500, 'invalid_grant')).toBe(false);
  });

  it('leaves an unrelated 400 to the generic path', () => {
    expect(isSpentAuthorizationCode(400, '{"error":"invalid_client"}')).toBe(false);
  });
});

describe('spentAuthorizationCodeError', () => {
  it('answers 400 with the shared wire code so the UI can restart the connect', () => {
    const error = spentAuthorizationCodeError();
    expect(error.status).toBe(400);
    expect(error.code).toBe(OAUTH_CODE_SPENT);
    expect(error.message).toContain('Start the connect again');
  });

  it('appends the provider hint when there is one', () => {
    expect(spentAuthorizationCodeError('Quit the CLI first.').message).toContain('Quit the CLI first.');
  });
});

describe('throwTokenExchangeFailure', () => {
  it('raises the spent-code error for a dead code', () => {
    expect(() => throwTokenExchangeFailure({ status: 400, body: '{"error":"invalid_grant"}', label: 'Anthropic' }))
      .toThrowError(expect.objectContaining({ code: OAUTH_CODE_SPENT, status: 400 }));
  });

  it('answers a genuine upstream failure as a 502, keeping what the provider said for the reporter', () => {
    try {
      throwTokenExchangeFailure({ status: 503, body: 'upstream down', label: 'Anthropic' });
      expect.unreachable('should have thrown');
    } catch (e) {
      const error = e as OAuthExchangeError;
      expect(error).toBeInstanceOf(OAuthExchangeError);
      expect(error.status).toBe(502);
      expect(error.upstreamStatus).toBe(503);
      expect(error.code).toBe(OAUTH_EXCHANGE_FAILED);
      expect(error.message).toContain('Anthropic OAuth token request failed (503)');
    }
  });

  it('answers an unentitled account as a 403 the operator fixes on the billing page', () => {
    expect(() => throwTokenExchangeFailure({ status: 403, body: 'no subscription', label: 'OpenAI' }))
      .toThrowError(expect.objectContaining({ status: 403, code: OAUTH_SUBSCRIPTION_NOT_ENTITLED }));
  });

  it('truncates the upstream body so a huge error page cannot reach the UI', () => {
    try {
      throwTokenExchangeFailure({ status: 500, body: 'x'.repeat(5000), label: 'xAI' });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as Error).message.length).toBeLessThan(300);
    }
  });
});

describe('subscription OAuth descriptor flow', () => {
  const CLIENT: SubscriptionOAuthClient = {
    label: 'Example',
    clientId: 'public-client',
    authUrl: 'https://auth.example/oauth/authorize',
    tokenUrl: 'https://auth.example/oauth/token',
    redirectUri: 'https://auth.example/oauth/code/callback',
    scopes: ['user:inference', 'offline_access'],
    extraAuthParams: { code: 'true' },
    tokenBodyEncoding: 'json',
    spentHint: 'Close the other CLI first.',
  };

  afterEach(() => vi.unstubAllGlobals());

  it('builds the PKCE consent URL from the descriptor', () => {
    const url = new URL(subscriptionAuthorizeUrl(CLIENT, { state: 'st', challenge: 'ch' }));
    expect(url.origin + url.pathname).toBe('https://auth.example/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('public-client');
    expect(url.searchParams.get('redirect_uri')).toBe(CLIENT.redirectUri);
    expect(url.searchParams.get('scope')).toBe('user:inference offline_access');
    expect(url.searchParams.get('code_challenge')).toBe('ch');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code')).toBe('true');
  });

  it('exchanges with the verifier in the descriptor encoding, without a client secret', async () => {
    const fetchImpl = fakeFetch([{ match: '/oauth/token', json: { access_token: 'A', refresh_token: 'R', expires_in: 60 } }]);
    vi.stubGlobal('fetch', fetchImpl);
    const tokens = await exchangeSubscriptionCode(CLIENT, { code: 'c1', verifier: 'v1', extra: { state: 'st' } });
    expect(tokens).toMatchObject({ access_token: 'A', refresh_token: 'R' });
    const body = JSON.parse(fetchImpl.calls[0]?.body ?? '{}') as Record<string, string>;
    expect(body).toMatchObject({ grant_type: 'authorization_code', code: 'c1', code_verifier: 'v1', state: 'st', redirect_uri: CLIENT.redirectUri });
    expect(body).not.toHaveProperty('client_secret');
  });

  it('classifies a spent code once, with the provider hint', async () => {
    vi.stubGlobal('fetch', fakeFetch([{ match: '/oauth/token', status: 400, json: { error: 'invalid_grant' } }]));
    const error = await exchangeSubscriptionCode(CLIENT, { code: 'dead', verifier: 'v1' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OAuthExchangeError);
    expect((error as OAuthExchangeError).code).toBe(OAUTH_CODE_SPENT);
    expect((error as Error).message).toContain('Close the other CLI first.');
  });

  it('refresh failures carry the UPSTREAM status the resolvers read to detect revocation', async () => {
    vi.stubGlobal('fetch', fakeFetch([{ match: '/oauth/token', status: 401, json: { error: 'invalid_grant' } }]));
    const error = await refreshSubscriptionToken(CLIENT, 'r1').catch((e: unknown) => e);
    expect((error as { status?: number }).status).toBe(401);
  });
});
