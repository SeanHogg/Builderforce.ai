import { describe, expect, it } from 'vitest';
import {
  parsePastedAuthorizationCode,
  isSpentAuthorizationCode,
  spentAuthorizationCodeError,
  throwTokenExchangeFailure,
  OAUTH_CODE_SPENT,
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

  it('carries the status through for a genuine upstream failure', () => {
    try {
      throwTokenExchangeFailure({ status: 503, body: 'upstream down', label: 'Anthropic' });
      expect.unreachable('should have thrown');
    } catch (e) {
      const error = e as Error & { status?: number; code?: string };
      expect(error.status).toBe(503);
      expect(error.code).toBeUndefined();
      expect(error.message).toContain('Anthropic OAuth token request failed (503)');
    }
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
