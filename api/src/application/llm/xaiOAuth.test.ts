import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildXaiAuthorizeUrl, exchangeXaiCode, parseXaiCallback } from './xaiOAuth';

afterEach(() => vi.unstubAllGlobals());

const discovery = { authorization_endpoint: 'https://auth.x.ai/oauth/authorize', token_endpoint: 'https://auth.x.ai/oauth/token' };

describe('xAI OAuth', () => {
  it('discovers xAI endpoints and builds the required PKCE/scopes URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(discovery), { status: 200 })));
    const url = new URL(await buildXaiAuthorizeUrl({ state: 's', challenge: 'c' }));
    expect(url.origin).toBe('https://auth.x.ai');
    expect(url.searchParams.get('scope')).toContain('api:access');
    expect(url.searchParams.get('scope')).toContain('grok-cli:access');
    expect(url.searchParams.get('code_challenge')).toBe('c');
  });

  it('exchanges a callback code with PKCE challenge and verifier', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method) return new Response(JSON.stringify(discovery), { status: 200 });
      const body = String(init.body);
      expect(body).toContain('code_verifier=verifier');
      expect(body).toContain('code_challenge=challenge');
      return new Response(JSON.stringify({ access_token: 'A', refresh_token: 'R', expires_in: 3600 }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const tokens = await exchangeXaiCode({ code: 'code', verifier: 'verifier', challenge: 'challenge' });
    expect(tokens).toMatchObject({ access: 'A', refresh: 'R' });
  });

  it('parses the loopback callback URL', () => {
    expect(parseXaiCallback('http://127.0.0.1:56121/callback?code=a&state=b')).toEqual({ code: 'a', state: 'b' });
  });
});
