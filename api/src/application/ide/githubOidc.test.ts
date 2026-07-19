import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  verifyGitHubOidcToken,
  GITHUB_OIDC_ISSUER,
  BUILDERFORCE_OIDC_AUDIENCE,
} from './githubOidc';
import type { Env } from '../../env';

/**
 * This verifier IS the authorization boundary for the GitHub deploy path: a
 * token that passes gets to publish to whatever project the claimed repository
 * is linked to. So the tests are written from an attacker's side — every way to
 * present a token that isn't a genuine, current, audience-scoped GitHub one must
 * be rejected, and the happy path must still work.
 *
 * Tokens are signed with a real RSA key generated per-run and served through a
 * stubbed JWKS endpoint, so the signature check exercises real WebCrypto rather
 * than a mock that always says yes.
 */

const env = { KV: undefined } as unknown as Env;

let keyPair: CryptoKeyPair;
let jwk: JsonWebKey;
const KID = 'test-key-1';

function b64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === 'string'
    ? bytes
    : String.fromCharCode(...bytes);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Mint a signed token with the given claims/header overrides. */
async function mintToken(
  claims: Record<string, unknown> = {},
  opts: { kid?: string | null; key?: CryptoKey } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header: Record<string, unknown> = { alg: 'RS256', typ: 'JWT' };
  if (opts.kid !== null) header.kid = opts.kid ?? KID;

  const payload = {
    iss: GITHUB_OIDC_ISSUER,
    aud: BUILDERFORCE_OIDC_AUDIENCE,
    exp: now + 300,
    nbf: now - 10,
    repository: 'acme/widgets',
    repository_owner: 'acme',
    ref: 'refs/heads/main',
    sha: 'abc123',
    workflow_ref: 'acme/widgets/.github/workflows/builderforce-deploy.yml@refs/heads/main',
    run_id: '42',
    ...claims,
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    opts.key ?? keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  ));
  return `${signingInput}.${b64url(signature)}`;
}

beforeEach(async () => {
  keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/.well-known/jwks')) {
      return new Response(JSON.stringify({ keys: [{ ...jwk, kid: KID, alg: 'RS256' }] }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe('verifyGitHubOidcToken', () => {
  it('accepts a well-formed GitHub token and returns its repository claims', async () => {
    const result = await verifyGitHubOidcToken(env, await mintToken());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims.repository).toBe('acme/widgets');
    expect(result.claims.repositoryOwner).toBe('acme');
    expect(result.claims.sha).toBe('abc123');
    expect(result.claims.runId).toBe('42');
  });

  it('accepts an aud ARRAY containing our audience (the JWT spec allows both)', async () => {
    const token = await mintToken({ aud: ['someone-else', BUILDERFORCE_OIDC_AUDIENCE] });
    expect((await verifyGitHubOidcToken(env, token)).ok).toBe(true);
  });

  // --- Rejections ----------------------------------------------------------

  it('rejects a token signed by a DIFFERENT key (the core forgery case)', async () => {
    const attacker = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    ) as CryptoKeyPair;
    const token = await mintToken({}, { key: attacker.privateKey });
    const result = await verifyGitHubOidcToken(env, token);
    expect(result).toEqual({ ok: false, error: 'Token signature is not valid.' });
  });

  it('rejects a tampered payload (claims changed after signing)', async () => {
    const token = await mintToken();
    const [h, , s] = token.split('.');
    const forged = b64url(JSON.stringify({
      iss: GITHUB_OIDC_ISSUER,
      aud: BUILDERFORCE_OIDC_AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 300,
      repository: 'attacker/evil',
    }));
    const result = await verifyGitHubOidcToken(env, `${h}.${forged}.${s}`);
    expect(result.ok).toBe(false);
  });

  it('rejects a token minted for another audience (no cross-service replay)', async () => {
    const token = await mintToken({ aud: 'https://some-other-service.example' });
    const result = await verifyGitHubOidcToken(env, token);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('audience');
  });

  it('rejects a token from another issuer', async () => {
    const token = await mintToken({ iss: 'https://evil.example' });
    const result = await verifyGitHubOidcToken(env, token);
    expect(result).toEqual({ ok: false, error: 'Token was not issued by GitHub Actions.' });
  });

  it('rejects an expired token beyond the clock-skew leeway', async () => {
    const token = await mintToken({ exp: Math.floor(Date.now() / 1000) - 120 });
    const result = await verifyGitHubOidcToken(env, token);
    expect(result).toEqual({ ok: false, error: 'Token has expired.' });
  });

  it('tolerates small clock skew rather than failing a valid deploy', async () => {
    // Expired 30s ago — inside the 60s leeway, so still good.
    const token = await mintToken({ exp: Math.floor(Date.now() / 1000) - 30 });
    expect((await verifyGitHubOidcToken(env, token)).ok).toBe(true);
  });

  it('rejects a not-yet-valid token', async () => {
    const token = await mintToken({ nbf: Math.floor(Date.now() / 1000) + 600 });
    const result = await verifyGitHubOidcToken(env, token);
    expect(result).toEqual({ ok: false, error: 'Token is not yet valid.' });
  });

  it('rejects a token whose key id is unknown to GitHub JWKS', async () => {
    const token = await mintToken({}, { kid: 'not-a-real-key' });
    const result = await verifyGitHubOidcToken(env, token);
    expect(result).toEqual({ ok: false, error: 'Token signature is not valid.' });
  });

  it('rejects a token with no key id', async () => {
    const token = await mintToken({}, { kid: null });
    const result = await verifyGitHubOidcToken(env, token);
    expect(result).toEqual({ ok: false, error: 'Token header has no key id.' });
  });

  it('rejects a token carrying no repository claim', async () => {
    const token = await mintToken({ repository: undefined });
    const result = await verifyGitHubOidcToken(env, token);
    expect(result).toEqual({ ok: false, error: 'Token has no repository claim.' });
  });

  it('rejects malformed and empty tokens', async () => {
    for (const bad of ['', 'not-a-jwt', 'only.two']) {
      expect((await verifyGitHubOidcToken(env, bad)).ok).toBe(false);
    }
  });

  it('rejects a token whose segments are not JSON', async () => {
    const result = await verifyGitHubOidcToken(env, 'aaaa.bbbb.cccc');
    expect(result.ok).toBe(false);
  });
});
