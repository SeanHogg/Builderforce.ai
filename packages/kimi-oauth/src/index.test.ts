import { describe, expect, it } from 'vitest';
import {
  KIMI_DEFAULT_EXPIRES_IN_SECONDS,
  KIMI_DEVICE_CODE_GRANT_TYPE,
  KIMI_OAUTH_CLIENT_ID,
  kimiDeviceAuthorizationRequest,
  kimiDeviceTokenRequest,
  kimiExpiresInSeconds,
  kimiOAuthHost,
  kimiRefreshTokenRequest,
  parseKimiDeviceAuthorization,
  parseKimiResponseBody,
  parseKimiTokenResponse,
} from './index';

/**
 * This package exists because two surfaces — the API Worker's web device-connect and the
 * VS Code extension's local refresh — used to spell Kimi's protocol out separately. These
 * tests pin the shapes both now depend on, so a change here is visibly a change to BOTH.
 */

function form(body: string): URLSearchParams {
  return new URLSearchParams(body);
}

/** A JSON body, as the response reader would hand it to a parser. */
function json(data: Record<string, unknown>) {
  return parseKimiResponseBody(JSON.stringify(data));
}

describe('host resolution', () => {
  it('defaults to Kimi and honours Kimi Code’s own overrides', () => {
    expect(kimiOAuthHost()).toBe('https://auth.kimi.com');
    expect(kimiOAuthHost({})).toBe('https://auth.kimi.com');
    expect(kimiOAuthHost({ KIMI_CODE_OAUTH_HOST: 'https://staging.example/' })).toBe('https://staging.example');
    expect(kimiOAuthHost({ KIMI_OAUTH_HOST: 'https://alt.example//' })).toBe('https://alt.example');
  });

  it('ignores a blank override rather than building an empty-host URL', () => {
    // A cleared env var must not produce `POST /api/oauth/token` against nothing.
    expect(kimiOAuthHost({ KIMI_CODE_OAUTH_HOST: '   ' })).toBe('https://auth.kimi.com');
  });
});

describe('request shapes', () => {
  it('sends the public client id, form-encoded, on all three grants', () => {
    for (const request of [
      kimiDeviceAuthorizationRequest(),
      kimiDeviceTokenRequest('dev-1'),
      kimiRefreshTokenRequest('r1'),
    ]) {
      expect(request.method).toBe('POST');
      expect(request.headers['content-type']).toBe('application/x-www-form-urlencoded');
      expect(form(request.body).get('client_id')).toBe(KIMI_OAUTH_CLIENT_ID);
    }
  });

  it('targets Kimi’s two endpoints', () => {
    expect(kimiDeviceAuthorizationRequest().url).toBe('https://auth.kimi.com/api/oauth/device_authorization');
    expect(kimiDeviceTokenRequest('d').url).toBe('https://auth.kimi.com/api/oauth/token');
    expect(kimiRefreshTokenRequest('r').url).toBe('https://auth.kimi.com/api/oauth/token');
  });

  it('uses the RFC 8628 grant type for device polling and refresh_token for renewal', () => {
    expect(form(kimiDeviceTokenRequest('dev-1').body).get('grant_type')).toBe(KIMI_DEVICE_CODE_GRANT_TYPE);
    expect(form(kimiDeviceTokenRequest('dev-1').body).get('device_code')).toBe('dev-1');
    expect(form(kimiRefreshTokenRequest('r1').body).get('grant_type')).toBe('refresh_token');
    expect(form(kimiRefreshTokenRequest('r1').body).get('refresh_token')).toBe('r1');
  });
});

describe('token responses', () => {
  it('reads a grant and keeps the ROTATED refresh token', () => {
    // Kimi retires the presented token on every grant; keeping the old one would leave the
    // caller holding a credential the server has already invalidated.
    const outcome = parseKimiTokenResponse(200, json({
      access_token: 'a2', refresh_token: 'r2', expires_in: 900, scope: 's', token_type: 'Bearer',
    }), 'r1');
    expect(outcome).toEqual({
      kind: 'tokens',
      tokens: { accessToken: 'a2', refreshToken: 'r2', expiresInSeconds: 900, scope: 's', tokenType: 'Bearer' },
    });
  });

  it('falls back to the presented refresh token when the server rotates nothing', () => {
    const outcome = parseKimiTokenResponse(200, json({ access_token: 'a2', expires_in: 900 }), 'r1');
    expect(outcome.kind === 'tokens' && outcome.tokens.refreshToken).toBe('r1');
  });

  it('reports a missing expires_in as null and lets ONE policy fill it', () => {
    // Divergence here is exactly what this package removes: the Worker used to assume
    // fifteen minutes while the extension refused to continue.
    const outcome = parseKimiTokenResponse(200, json({ access_token: 'a' }));
    expect(outcome.kind === 'tokens' && outcome.tokens.expiresInSeconds).toBeNull();
    expect(kimiExpiresInSeconds(null)).toBe(KIMI_DEFAULT_EXPIRES_IN_SECONDS);
    expect(kimiExpiresInSeconds(60)).toBe(60);
  });

  it('keeps the four RFC 8628 waiting/terminal states apart', () => {
    // Collapsing these into "not yet" is how an expired or declined request becomes a
    // spinner that never resolves.
    for (const [error, kind] of [
      ['authorization_pending', 'pending'],
      ['slow_down', 'slow_down'],
      ['expired_token', 'expired'],
      ['access_denied', 'denied'],
    ] as const) {
      expect(parseKimiTokenResponse(400, json({ error })).kind, error).toBe(kind);
    }
  });

  it('separates a spent credential from a transient failure', () => {
    // Only `unauthorized` is terminal for the credential — retrying it forever is how a
    // dead account keeps looking merely unlucky.
    for (const response of [
      { status: 400, data: { error: 'invalid_grant' } },
      { status: 401, data: {} },
      { status: 403, data: {} },
    ]) {
      expect(parseKimiTokenResponse(response.status, json(response.data)).kind).toBe('unauthorized');
    }
    expect(parseKimiTokenResponse(503, json({}))).toMatchObject({ kind: 'failed', retryable: true });
    expect(parseKimiTokenResponse(418, json({}))).toMatchObject({ kind: 'failed', retryable: false });
  });

  it('treats a 200 with no access token as a failure, not a grant', () => {
    expect(parseKimiTokenResponse(200, json({ token_type: 'Bearer' })).kind).toBe('failed');
  });

  it('prefers the provider’s own description over its error code', () => {
    const outcome = parseKimiTokenResponse(400, json({ error: 'invalid_client', error_description: 'client disabled' }));
    expect(outcome).toMatchObject({ kind: 'failed', detail: 'client disabled' });
  });
});

describe('device authorization responses', () => {
  const complete = {
    device_code: 'dev-1', user_code: 'ABCD-EFGH',
    verification_uri: 'https://kimi.com/device',
    verification_uri_complete: 'https://kimi.com/device?code=ABCD-EFGH',
    interval: 5, expires_in: 900,
  };

  it('reads the completed URL that makes this a redirect-and-approve flow', () => {
    const outcome = parseKimiDeviceAuthorization(200, json(complete));
    expect(outcome.kind === 'authorization' && outcome.authorization.verificationUriComplete).toContain('ABCD-EFGH');
    expect(outcome.kind === 'authorization' && outcome.authorization.interval).toBe(5);
  });

  it('refuses an incomplete response rather than opening a broken tab', () => {
    for (const missing of ['device_code', 'user_code', 'verification_uri_complete'] as const) {
      const { [missing]: _dropped, ...partial } = complete;
      expect(parseKimiDeviceAuthorization(200, json(partial))).toMatchObject({ kind: 'failed', detail: expect.stringContaining(missing) });
    }
  });

  it('defaults a missing or nonsense interval to five seconds', () => {
    // Polling with NaN would either spin hot or never fire.
    const { interval: _dropped, ...noInterval } = complete;
    const outcome = parseKimiDeviceAuthorization(200, json({ ...noInterval, interval: 'soon' }));
    expect(outcome.kind === 'authorization' && outcome.authorization.interval).toBe(5);
  });

  it('surfaces a non-200 with the provider’s detail', () => {
    expect(parseKimiDeviceAuthorization(400, json({ error_description: 'client disabled' })))
      .toMatchObject({ kind: 'failed', status: 400, detail: 'client disabled' });
  });
});

describe('response bodies', () => {
  it('reads a JSON object and reports nothing unparsed', () => {
    expect(parseKimiResponseBody('{"error":"slow_down"}')).toEqual({
      data: { error: 'slow_down' }, nonJsonBody: null,
    });
  });

  it('keeps a non-JSON body instead of discarding the parse failure', () => {
    // This is the Kimi case exactly: an HTML page means something IN FRONT OF Kimi
    // answered, before any credential was read. Swallowing it reports "unknown error"
    // and sends the reader looking at the credential.
    const parsed = parseKimiResponseBody('<html><body>403 Forbidden</body></html>');
    expect(parsed.data).toEqual({});
    expect(parsed.nonJsonBody).toContain('403 Forbidden');
  });

  it('surfaces that body as the outcome detail', () => {
    const outcome = parseKimiTokenResponse(403, parseKimiResponseBody('<html>blocked</html>'));
    expect(outcome).toMatchObject({ kind: 'unauthorized' });
    expect(outcome.kind === 'unauthorized' && outcome.detail).toContain('blocked');
  });

  it('truncates a long body rather than pasting a document into an error', () => {
    const parsed = parseKimiResponseBody('<html>' + 'x'.repeat(5_000) + '</html>');
    expect(parsed.nonJsonBody!.length).toBeLessThan(400);
  });

  it('treats an empty body as simply absent', () => {
    expect(parseKimiResponseBody('   ')).toEqual({ data: {}, nonJsonBody: null });
  });

  it('treats valid-but-scalar JSON as opaque, not as fields', () => {
    expect(parseKimiResponseBody('"just a string"')).toMatchObject({ data: {} });
  });
});
