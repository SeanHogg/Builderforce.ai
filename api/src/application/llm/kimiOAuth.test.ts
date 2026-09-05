import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KIMI_OAUTH_CLIENT_ID,
  kimiOAuthHost,
  pollKimiDeviceToken,
  refreshKimiOAuth,
  startKimiDeviceAuthorization,
} from './kimiOAuth';

/**
 * Kimi is the first subscription provider here that uses a DEVICE grant, and the first
 * whose refresh token ROTATES. Both are pinned by test because both fail silently when
 * they are wrong: a mis-shaped device request looks like "Kimi is down", and a dropped
 * rotation looks like a working connection that stops working a quarter of an hour later.
 */

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const NOW = 1_788_640_000_000;

describe('device authorization', () => {
  it('asks Kimi for a code with the public client id, form-encoded', async () => {
    let seen: { url: string; body: string; headers: Record<string, string> } | null = null;
    globalThis.fetch = vi.fn(async (url: string, init: RequestInit) => {
      seen = { url, body: init.body as string, headers: init.headers as Record<string, string> };
      return jsonResponse({
        device_code: 'dev-1', user_code: 'ABCD-EFGH',
        verification_uri: 'https://kimi.com/device',
        verification_uri_complete: 'https://kimi.com/device?code=ABCD-EFGH',
        interval: 5, expires_in: 900,
      });
    }) as unknown as typeof fetch;

    const authorization = await startKimiDeviceAuthorization();
    expect(seen!.url).toBe('https://auth.kimi.com/api/oauth/device_authorization');
    expect(seen!.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(new URLSearchParams(seen!.body).get('client_id')).toBe(KIMI_OAUTH_CLIENT_ID);
    // `verification_uri_complete` already carries the code — that is what makes this a
    // redirect-and-approve flow with nothing for the operator to type.
    expect(authorization.verificationUriComplete).toContain('ABCD-EFGH');
    expect(authorization.interval).toBe(5);
  });

  it('refuses a response missing the completed URL rather than opening a broken tab', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ device_code: 'd', user_code: 'U' })) as unknown as typeof fetch;
    await expect(startKimiDeviceAuthorization()).rejects.toThrow(/verification_uri_complete/);
  });

  it('surfaces a non-200 with the provider’s own detail', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ error_description: 'client disabled' }, 400)) as unknown as typeof fetch;
    await expect(startKimiDeviceAuthorization()).rejects.toThrow(/client disabled/);
  });
});

describe('device polling', () => {
  it('sends the RFC 8628 device_code grant', async () => {
    let body = '';
    globalThis.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      body = init.body as string;
      return jsonResponse({ access_token: 'a', refresh_token: 'r', expires_in: 900 });
    }) as unknown as typeof fetch;

    const result = await pollKimiDeviceToken('dev-1', { nowMs: NOW });
    const form = new URLSearchParams(body);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code');
    expect(form.get('device_code')).toBe('dev-1');
    expect(result).toEqual({
      kind: 'tokens',
      tokens: { access: 'a', refresh: 'r', expires: NOW + 900_000 },
    });
  });

  it('keeps the four waiting/terminal states apart', async () => {
    // Collapsing these into "not yet" is how an expired or declined request becomes a
    // spinner that never resolves.
    for (const [error, kind] of [
      ['authorization_pending', 'pending'],
      ['slow_down', 'slow_down'],
      ['expired_token', 'expired'],
      ['access_denied', 'denied'],
    ] as const) {
      globalThis.fetch = vi.fn(async () => jsonResponse({ error }, 400)) as unknown as typeof fetch;
      expect((await pollKimiDeviceToken('d')).kind, error).toBe(kind);
    }
  });

  it('throws on an error it does not recognize instead of waiting forever', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ error: 'server_exploded' }, 500)) as unknown as typeof fetch;
    await expect(pollKimiDeviceToken('d')).rejects.toThrow(/server_exploded/);
  });
});

describe('refresh', () => {
  it('stores the ROTATED refresh token, not the one it presented', async () => {
    // Kimi retires the presented token on every grant. Keeping the old one would leave
    // the tenant holding a credential the server has already invalidated.
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ access_token: 'a2', refresh_token: 'r2', expires_in: 900 })) as unknown as typeof fetch;
    expect(await refreshKimiOAuth('r1', { nowMs: NOW })).toEqual({
      access: 'a2', refresh: 'r2', expires: NOW + 900_000,
    });
  });

  it('falls back to the presented token when the server rotates nothing', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ access_token: 'a2', expires_in: 900 })) as unknown as typeof fetch;
    expect((await refreshKimiOAuth('r1', { nowMs: NOW })).refresh).toBe('r1');
  });

  it('maps invalid_grant to 401 so the resolver disconnects instead of retrying', async () => {
    // The credential resolver reads `status` to decide `revoked` vs a transient blip;
    // a bare 400 there would keep a dead account looking merely unlucky.
    globalThis.fetch = vi.fn(async () => jsonResponse({ error: 'invalid_grant' }, 400)) as unknown as typeof fetch;
    await expect(refreshKimiOAuth('r1')).rejects.toMatchObject({ status: 401 });
  });

  it('honours Kimi Code’s own host overrides', () => {
    expect(kimiOAuthHost({ KIMI_CODE_OAUTH_HOST: 'https://staging.example/' })).toBe('https://staging.example');
    expect(kimiOAuthHost({})).toBe('https://auth.kimi.com');
  });
});
