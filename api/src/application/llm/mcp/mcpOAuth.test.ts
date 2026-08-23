import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAuthorizeUrl,
  createPkcePair,
  discoverAuthorizationServer,
  discoverEndpoints,
  registerClient,
  resourceMetadataUrlFrom,
  type McpOAuthRegistration,
} from './mcpOAuth';

/**
 * `mcpOAuth` calls the global `fetch` directly (both for discovery documents AND,
 * transitively through the SSRF guard, for DNS-over-HTTPS resolution). Stubbing
 * global fetch therefore has to answer BOTH: a DoH request is let through as
 * "no records" (the guard's documented fail-open), and everything else is routed
 * by URL to the fixture the test cares about.
 */
function stubFetch(routes: Record<string, unknown>): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('cloudflare-dns.com')) {
      return new Response(JSON.stringify({ Answer: [] }), { status: 200 });
    }
    const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    if (!hit) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(hit[1]), { status: 200 });
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resourceMetadataUrlFrom', () => {
  it('extracts the resource_metadata param from a WWW-Authenticate challenge', () => {
    expect(resourceMetadataUrlFrom('Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource"'))
      .toBe('https://mcp.example/.well-known/oauth-protected-resource');
  });
  it('returns null when there is no challenge or no param', () => {
    expect(resourceMetadataUrlFrom(null)).toBeNull();
    expect(resourceMetadataUrlFrom('Bearer realm="x"')).toBeNull();
  });
});

describe('discoverAuthorizationServer', () => {
  it('reads authorization_servers[0] off the protected-resource document', async () => {
    stubFetch({
      'https://mcp.example/.well-known/oauth-protected-resource': {
        resource: 'https://mcp.example',
        authorization_servers: ['https://auth.example'],
      },
    });
    const { resource, authorizationServer } = await discoverAuthorizationServer('https://mcp.example', null);
    expect(resource).toBe('https://mcp.example');
    expect(authorizationServer).toBe('https://auth.example');
  });

  it('falls back to the resource itself when the server publishes no protected-resource document', async () => {
    stubFetch({});
    const { authorizationServer } = await discoverAuthorizationServer('https://mcp.example', null);
    expect(authorizationServer).toBe('https://mcp.example');
  });

  it('rejects an advertised resource_metadata URL on a different origin', async () => {
    await expect(
      discoverAuthorizationServer('https://mcp.example', 'Bearer resource_metadata="https://evil.example/steal"'),
    ).rejects.toThrow(/same origin/);
  });
});

describe('discoverEndpoints', () => {
  it('reads RFC 8414 authorization-server metadata', async () => {
    stubFetch({
      'https://auth.example/.well-known/oauth-authorization-server': {
        authorization_endpoint: 'https://auth.example/authorize',
        token_endpoint: 'https://auth.example/token',
        registration_endpoint: 'https://auth.example/register',
        scopes_supported: ['read', 'write'],
      },
    });
    const endpoints = await discoverEndpoints('https://auth.example');
    expect(endpoints).toEqual({
      authorizationEndpoint: 'https://auth.example/authorize',
      tokenEndpoint: 'https://auth.example/token',
      registrationEndpoint: 'https://auth.example/register',
      scopes: ['read', 'write'],
    });
  });

  it('falls back to OIDC discovery when the OAuth metadata document is absent', async () => {
    stubFetch({
      'https://auth.example/.well-known/openid-configuration': {
        authorization_endpoint: 'https://auth.example/authorize',
        token_endpoint: 'https://auth.example/token',
      },
    });
    const endpoints = await discoverEndpoints('https://auth.example');
    expect(endpoints.authorizationEndpoint).toBe('https://auth.example/authorize');
  });

  it('rejects an endpoint the metadata places on a foreign origin', async () => {
    stubFetch({
      'https://auth.example/.well-known/oauth-authorization-server': {
        authorization_endpoint: 'https://evil.example/authorize',
        token_endpoint: 'https://auth.example/token',
      },
    });
    await expect(discoverEndpoints('https://auth.example')).rejects.toThrow(/same origin/);
  });

  it('throws when neither discovery document is usable', async () => {
    stubFetch({});
    await expect(discoverEndpoints('https://auth.example')).rejects.toThrow(/no usable metadata/);
  });
});

describe('registerClient', () => {
  it('registers as a PUBLIC client (no auth method) and returns the issued id', async () => {
    let sentBody: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(_input);
      if (url.includes('cloudflare-dns.com')) return new Response(JSON.stringify({ Answer: [] }), { status: 200 });
      sentBody = JSON.parse((init?.body as string) ?? '{}');
      return new Response(JSON.stringify({ client_id: 'client-123' }), { status: 200 });
    }));
    const result = await registerClient('https://auth.example/register', 'https://api.builderforce.ai/api/mcp-oauth/callback', ['read']);
    expect(result).toEqual({ clientId: 'client-123' });
    expect(sentBody.token_endpoint_auth_method).toBe('none');
    expect(sentBody.redirect_uris).toEqual(['https://api.builderforce.ai/api/mcp-oauth/callback']);
  });

  it('throws when the authorization server returns no client_id', async () => {
    stubFetch({ 'https://auth.example/register': {} });
    await expect(registerClient('https://auth.example/register', 'https://cb', [])).rejects.toThrow(/client_id/);
  });
});

describe('createPkcePair', () => {
  it('produces a verifier and an S256 challenge that are not equal, and are URL-safe', async () => {
    const { codeVerifier, codeChallenge } = await createPkcePair();
    expect(codeVerifier).not.toBe(codeChallenge);
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it('is not deterministic across calls', async () => {
    const a = await createPkcePair();
    const b = await createPkcePair();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });
});

describe('buildAuthorizeUrl', () => {
  const registration: McpOAuthRegistration = {
    resource: 'https://mcp.example',
    authorizationEndpoint: 'https://auth.example/authorize',
    tokenEndpoint: 'https://auth.example/token',
    scopes: ['read', 'write'],
    clientId: 'client-1',
  };

  it('carries PKCE, resource binding, and the redirect/state', () => {
    const url = new URL(buildAuthorizeUrl(registration, {
      redirectUri: 'https://api.builderforce.ai/api/mcp-oauth/callback',
      state: 'signed-state',
      codeChallenge: 'chal',
    }));
    expect(url.origin + url.pathname).toBe('https://auth.example/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('client-1');
    expect(url.searchParams.get('code_challenge')).toBe('chal');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('resource')).toBe('https://mcp.example');
    expect(url.searchParams.get('scope')).toBe('read write');
    expect(url.searchParams.get('state')).toBe('signed-state');
  });
});
