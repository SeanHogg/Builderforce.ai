/**
 * githubApp — GitHub App authentication for the Worker runtime.
 *
 * WHY THIS EXISTS
 * Every GitHub call in the platform currently authenticates as a *user*, with a
 * PAT or OAuth token pulled from `integration_credentials` by
 * `resolveRepoCredential`. That has three structural problems:
 *
 *   1. Access dies with the granting user. Offboard the person who connected the
 *      repo and every agent run against it breaks, silently, later.
 *   2. No least privilege. A user token carries that user's full `repo` scope
 *      across every repo they can see — not just the one the tenant linked.
 *   3. No rotation. The token lives encrypted at rest until someone revokes it.
 *
 * A GitHub App fixes all three: the tenant installs it on specific repos, and we
 * mint a short-lived (1h) installation token scoped to exactly that install.
 *
 * This module is deliberately dependency-free. Octokit is not used anywhere in
 * this codebase and pulling it in for JWT signing alone would be a large
 * dependency on a Worker hot path; `crypto.subtle` does RS256 natively.
 *
 * ── The PKCS#1 problem (the non-obvious part) ────────────────────────────────
 * GitHub hands you a private key in PKCS#1 PEM ("BEGIN RSA PRIVATE KEY").
 * WebCrypto's importKey only accepts PKCS#8 ("BEGIN PRIVATE KEY"). Node papers
 * over this; Workers does not. So a PKCS#1 body has to be re-wrapped in a
 * PKCS#8 PrivateKeyInfo envelope before import — see `pkcs1ToPkcs8`. Getting
 * this wrong yields an opaque "DataError: Invalid key data", which is why the
 * conversion is unit-tested rather than trusted.
 *
 * All functions return tagged results rather than throwing, matching the
 * convention in the sibling repos/ modules (RepoSourceError is confined to
 * sources/).
 */
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';

/** Installation tokens are valid for 1h. Cache short of that so a token is never
 *  handed to a caller that is about to expire mid-run (agent runs are long). */
const INSTALLATION_TOKEN_TTL_SECONDS = 45 * 60;

/** App JWTs may not exceed 10 minutes of validity per GitHub's spec. Use 9 to
 *  leave room for clock skew on both ends. */
const APP_JWT_TTL_SECONDS = 9 * 60;

/** GitHub rejects a JWT whose `iat` is in the future relative to their clock.
 *  Backdating by 60s is the documented mitigation for skew. */
const APP_JWT_CLOCK_SKEW_SECONDS = 60;

export interface GitHubAppConfig {
  appId: string;
  privateKeyPem: string;
}

export type GitHubAppResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: 'not_configured' | 'bad_key' | 'no_installation' | 'provider_error'; reason: string };

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Read App config from the environment. Returns null when the App is not
 * configured — that is a normal, supported state, not an error: the platform
 * falls back to per-user PAT/OAuth credentials and behaves exactly as before.
 */
export function readGitHubAppConfig(env: Env): GitHubAppConfig | null {
  const appId = env.GITHUB_APP_ID?.trim();
  const privateKeyPem = env.GITHUB_APP_PRIVATE_KEY?.trim();
  if (!appId || !privateKeyPem) return null;
  return { appId, privateKeyPem };
}

export function isGitHubAppConfigured(env: Env): boolean {
  return readGitHubAppConfig(env) !== null;
}

// ---------------------------------------------------------------------------
// DER / PEM handling
// ---------------------------------------------------------------------------

/** Minimal DER length prefix: short form under 128, else long form. */
function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

/**
 * Wrap a PKCS#1 RSAPrivateKey body in a PKCS#8 PrivateKeyInfo envelope:
 *
 *   SEQUENCE {
 *     INTEGER 0,                                  -- version
 *     SEQUENCE { OID 1.2.840.113549.1.1.1, NULL } -- rsaEncryption
 *     OCTET STRING { <pkcs1 der> }
 *   }
 *
 * Exported for unit testing — the failure mode if this is subtly wrong is an
 * opaque WebCrypto DataError with no indication of which byte is bad.
 */
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = [0x02, 0x01, 0x00];
  // AlgorithmIdentifier for rsaEncryption, with the required explicit NULL params.
  const algorithmIdentifier = [
    0x30, 0x0d,
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
    0x05, 0x00,
  ];
  const octetString = [0x04, ...derLength(pkcs1.length)];

  const innerLength = version.length + algorithmIdentifier.length + octetString.length + pkcs1.length;
  const header = [0x30, ...derLength(innerLength)];

  const out = new Uint8Array(header.length + innerLength);
  let o = 0;
  for (const b of header) out[o++] = b;
  for (const b of version) out[o++] = b;
  for (const b of algorithmIdentifier) out[o++] = b;
  for (const b of octetString) out[o++] = b;
  out.set(pkcs1, o);
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlFromString(s: string): string {
  return bytesToBase64Url(new TextEncoder().encode(s));
}

/**
 * Parse a PEM private key into PKCS#8 DER, accepting both the PKCS#1 form
 * GitHub issues and the PKCS#8 form some secret managers normalise to.
 *
 * Newlines are commonly mangled when a PEM is pasted into a secret store, so
 * literal "\n" sequences are tolerated alongside real ones.
 */
export function pemToPkcs8Der(pem: string): { ok: true; der: Uint8Array } | { ok: false; reason: string } {
  const normalised = pem.replace(/\\n/g, '\n').trim();

  const pkcs1Match = /-----BEGIN RSA PRIVATE KEY-----([\s\S]*?)-----END RSA PRIVATE KEY-----/.exec(normalised);
  if (pkcs1Match) {
    try {
      return { ok: true, der: pkcs1ToPkcs8(base64ToBytes((pkcs1Match[1] ?? '').replace(/\s+/g, ''))) };
    } catch (e) {
      return { ok: false, reason: `malformed PKCS#1 body: ${(e as Error).message}` };
    }
  }

  const pkcs8Match = /-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/.exec(normalised);
  if (pkcs8Match) {
    try {
      return { ok: true, der: base64ToBytes((pkcs8Match[1] ?? '').replace(/\s+/g, '')) };
    } catch (e) {
      return { ok: false, reason: `malformed PKCS#8 body: ${(e as Error).message}` };
    }
  }

  return {
    ok: false,
    reason: 'private key is not a recognised PEM (expected BEGIN RSA PRIVATE KEY or BEGIN PRIVATE KEY)',
  };
}

// ---------------------------------------------------------------------------
// App JWT
// ---------------------------------------------------------------------------

/**
 * Mint a short-lived RS256 JWT proving we are the App. This authenticates
 * *as the App itself* — it can enumerate installations but cannot touch repo
 * content; that requires the installation token minted below.
 */
export async function mintAppJwt(
  cfg: GitHubAppConfig,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<GitHubAppResult<string>> {
  const parsed = pemToPkcs8Der(cfg.privateKeyPem);
  if (!parsed.ok) return { ok: false, code: 'bad_key', reason: parsed.reason };

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      'pkcs8',
      // Copy into a fresh ArrayBuffer — a Uint8Array view over a larger buffer
      // would import trailing bytes and fail confusingly.
      parsed.der.slice().buffer as ArrayBuffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  } catch (e) {
    return { ok: false, code: 'bad_key', reason: `key import failed: ${(e as Error).message}` };
  }

  const header = base64UrlFromString(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64UrlFromString(
    JSON.stringify({
      iat: nowSeconds - APP_JWT_CLOCK_SKEW_SECONDS,
      exp: nowSeconds + APP_JWT_TTL_SECONDS,
      iss: cfg.appId,
    }),
  );
  const signingInput = `${header}.${payload}`;

  try {
    const sig = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      key,
      new TextEncoder().encode(signingInput),
    );
    return { ok: true, value: `${signingInput}.${bytesToBase64Url(new Uint8Array(sig))}` };
  } catch (e) {
    return { ok: false, code: 'bad_key', reason: `signing failed: ${(e as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Installation tokens
// ---------------------------------------------------------------------------

/** GitHub's own API host for App endpoints. Enterprise installs override via host. */
function appApiBase(host: string | null): string {
  return host && host !== 'github.com' ? `https://${host}/api/v3` : 'https://api.github.com';
}

const APP_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'Builderforce-App/1.0',
} as const;

/**
 * Find the installation id for a specific repo. Scoping the lookup to the repo
 * (rather than listing all installations) means the token we mint is the one
 * that install actually grants — and it fails closed when the App is simply not
 * installed on that repo, which is the common and recoverable case.
 */
export async function findRepoInstallationId(
  cfg: GitHubAppConfig,
  coords: { host: string | null; owner: string; repo: string },
  fetchFn: typeof fetch = fetch,
): Promise<GitHubAppResult<number>> {
  const jwt = await mintAppJwt(cfg);
  if (!jwt.ok) return jwt;

  const url = `${appApiBase(coords.host)}/repos/${encodeURIComponent(coords.owner)}/${encodeURIComponent(coords.repo)}/installation`;
  let res: Response;
  try {
    res = await fetchFn(url, { headers: { ...APP_HEADERS, Authorization: `Bearer ${jwt.value}` } });
  } catch (e) {
    return { ok: false, code: 'provider_error', reason: `installation lookup failed: ${(e as Error).message}` };
  }

  if (res.status === 404) {
    return {
      ok: false,
      code: 'no_installation',
      reason: `GitHub App is not installed on ${coords.owner}/${coords.repo}`,
    };
  }
  if (!res.ok) {
    return { ok: false, code: 'provider_error', reason: `installation lookup returned ${res.status}` };
  }

  const body = (await res.json().catch(() => null)) as { id?: number } | null;
  if (!body?.id) return { ok: false, code: 'provider_error', reason: 'installation response had no id' };
  return { ok: true, value: body.id };
}

/**
 * Mint an installation access token (1h, scoped to that installation's repos).
 *
 * Cached through the shared read-through cache: an agent run makes many GitHub
 * calls and re-minting per call would both burn subrequests and hit GitHub's
 * App-endpoint rate limit. The cache key is keyed by installation, and the TTL
 * is deliberately shorter than the real expiry so a cached token always has
 * headroom left.
 */
export async function getInstallationToken(
  env: Env,
  coords: { host: string | null; owner: string; repo: string },
  fetchFn: typeof fetch = fetch,
): Promise<GitHubAppResult<string>> {
  const cfg = readGitHubAppConfig(env);
  if (!cfg) return { ok: false, code: 'not_configured', reason: 'GitHub App is not configured' };

  const installation = await findRepoInstallationId(cfg, coords, fetchFn);
  if (!installation.ok) return installation;

  const key = installationTokenCacheKey(cfg.appId, installation.value);

  // getOrSetCached cannot cache a failure, so the loader throws on error and the
  // throw is converted back to a tagged result here. That also means a failed
  // mint is never cached — correct, since the usual causes (revoked install,
  // rotated key) resolve out-of-band and should be retried immediately.
  try {
    const token = await getOrSetCached<string>(
      env,
      key,
      async () => {
        const jwt = await mintAppJwt(cfg);
        if (!jwt.ok) throw new Error(jwt.reason);

        const url = `${appApiBase(coords.host)}/app/installations/${installation.value}/access_tokens`;
        const res = await fetchFn(url, {
          method: 'POST',
          headers: { ...APP_HEADERS, Authorization: `Bearer ${jwt.value}` },
        });
        if (!res.ok) {
          throw new Error(`token mint returned ${res.status}`);
        }
        const body = (await res.json().catch(() => null)) as { token?: string } | null;
        if (!body?.token) throw new Error('token mint response had no token');
        return body.token;
      },
      { kvTtlSeconds: INSTALLATION_TOKEN_TTL_SECONDS, l1TtlMs: INSTALLATION_TOKEN_TTL_SECONDS * 1000 },
    );
    return { ok: true, value: token };
  } catch (e) {
    return { ok: false, code: 'provider_error', reason: (e as Error).message };
  }
}

export function installationTokenCacheKey(appId: string, installationId: number): string {
  return `gh-app-token:${appId}:${installationId}`;
}

/**
 * Drop a cached installation token. Called when GitHub rejects a token with 401
 * mid-flight (revoked install, rotated key) so the next call re-mints instead of
 * serving the dead token for the rest of the TTL.
 */
export async function invalidateInstallationToken(
  env: Env,
  appId: string,
  installationId: number,
): Promise<void> {
  await invalidateCached(env, installationTokenCacheKey(appId, installationId));
}
