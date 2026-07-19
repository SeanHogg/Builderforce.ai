/**
 * GitHub Actions OIDC verification — how a workflow proves which repository it
 * is, without the repo holding any secret of ours.
 *
 * The obvious way to let a user's GitHub Action deploy to us is to mint a deploy
 * token and store it as a repo secret. That means writing a long-lived
 * credential into infrastructure we don't control, per project, and rotating it
 * is then our problem forever.
 *
 * Instead the workflow asks GitHub for a short-lived OIDC token (`id-token:
 * write`) scoped to our audience. GitHub signs it; we verify that signature
 * against GitHub's published JWKS and read the `repository` claim, which GitHub
 * guarantees. Nothing secret ever lives in the user's repo, tokens expire in
 * minutes, and a stolen one is useless for any other audience.
 *
 * This is the same trust model as the npm "trusted publishing" already used by
 * `publish-npm-package.yml`.
 */

import type { Env } from '../../env';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';

/** GitHub's OIDC issuer. Tokens claiming any other issuer are rejected. */
export const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';

/** The audience a workflow must request. Narrow, so a token minted for some
 *  other service can never be replayed against us. */
export const BUILDERFORCE_OIDC_AUDIENCE = 'builderforce.ai/deploy';

/** JWKS cache TTL. GitHub rotates rarely; an unknown `kid` forces a refresh
 *  regardless, so this can be long without risking a stale-key outage. */
const JWKS_TTL_SECONDS = 3600;

/** The subset of GitHub's OIDC claims this deploy path relies on. */
export interface GitHubOidcClaims {
  /** `owner/repo` — the claim the whole trust model rests on. */
  repository: string;
  repositoryOwner: string;
  /** e.g. `refs/heads/main`. */
  ref: string;
  sha: string;
  workflowRef: string;
  runId: string | null;
}

interface Jwks { keys: Array<JsonWebKey & { kid?: string; alg?: string }> }

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as Record<string, unknown>;
}

/** Fetch GitHub's signing keys, cached. `force` bypasses the cache for the
 *  key-rotation case (a `kid` we've never seen). */
async function fetchJwks(env: Env, force: boolean): Promise<Jwks> {
  const load = async (): Promise<Jwks> => {
    const res = await fetch(`${GITHUB_OIDC_ISSUER}/.well-known/jwks`);
    if (!res.ok) throw new Error(`GitHub JWKS fetch failed: ${res.status}`);
    return await res.json() as Jwks;
  };
  if (force) return load();
  return getOrSetCached(env, 'github:oidc:jwks', load, { kvTtlSeconds: JWKS_TTL_SECONDS });
}

async function verifySignature(
  key: JsonWebKey,
  signingInput: string,
  signature: Uint8Array,
): Promise<boolean> {
  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    key,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    signature,
    new TextEncoder().encode(signingInput),
  );
}

export type OidcVerification =
  | { ok: true; claims: GitHubOidcClaims }
  | { ok: false; error: string };

/**
 * Verify a GitHub Actions OIDC token and return its repository claims.
 *
 * Checks, in order: shape, issuer, audience, expiry/not-before, then the RSA
 * signature against GitHub's JWKS. Every failure returns a reason rather than
 * throwing, because the caller answers with 401 and the reason is the only clue
 * the workflow author gets.
 */
export async function verifyGitHubOidcToken(
  env: Env,
  token: string,
  /**
   * The audience the caller requires. Defaults to the deploy audience so the
   * original call site is unchanged.
   *
   * Passing this is NOT optional in spirit for new surfaces: the audience is the
   * only thing stopping a token minted by one Builderforce workflow being
   * replayed against another. A deploy token must not be able to drive an agent
   * run (which spends LLM budget and writes code), and vice versa — so each
   * workflow requests its own audience and each route demands exactly that one.
   */
  expectedAudience: string = BUILDERFORCE_OIDC_AUDIENCE,
): Promise<OidcVerification> {
  const [headerSeg, payloadSeg, signatureSeg] = token.split('.');
  if (!headerSeg || !payloadSeg || !signatureSeg) {
    return { ok: false, error: 'Malformed token.' };
  }

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = decodeSegment(headerSeg);
    payload = decodeSegment(payloadSeg);
  } catch {
    return { ok: false, error: 'Token is not valid JSON.' };
  }

  if (payload.iss !== GITHUB_OIDC_ISSUER) {
    return { ok: false, error: 'Token was not issued by GitHub Actions.' };
  }
  // `aud` may be a string or an array per the JWT spec.
  const aud = payload.aud;
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(expectedAudience)) {
    return { ok: false, error: `Token audience must be "${expectedAudience}".` };
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  const nbf = typeof payload.nbf === 'number' ? payload.nbf : 0;
  // 60s leeway absorbs clock skew between the runner and the edge.
  if (exp && now > exp + 60) return { ok: false, error: 'Token has expired.' };
  if (nbf && now < nbf - 60) return { ok: false, error: 'Token is not yet valid.' };

  const kid = typeof header.kid === 'string' ? header.kid : null;
  if (!kid) return { ok: false, error: 'Token header has no key id.' };

  const signature = base64UrlToBytes(signatureSeg);
  const signingInput = `${headerSeg}.${payloadSeg}`;

  // Try the cached keys, then force a refresh once — that covers a rotation
  // where GitHub signs with a key newer than our cache.
  let verified = false;
  for (const force of [false, true]) {
    const jwks = await fetchJwks(env, force).catch(() => null);
    const key = jwks?.keys.find((k) => k.kid === kid);
    if (!key) continue;
    verified = await verifySignature(key, signingInput, signature).catch(() => false);
    break;
  }
  if (!verified) return { ok: false, error: 'Token signature is not valid.' };

  const repository = typeof payload.repository === 'string' ? payload.repository : '';
  if (!repository.includes('/')) return { ok: false, error: 'Token has no repository claim.' };

  return {
    ok: true,
    claims: {
      repository,
      repositoryOwner: typeof payload.repository_owner === 'string'
        ? payload.repository_owner
        : (repository.split('/')[0] ?? ''),
      ref: typeof payload.ref === 'string' ? payload.ref : '',
      sha: typeof payload.sha === 'string' ? payload.sha : '',
      workflowRef: typeof payload.workflow_ref === 'string' ? payload.workflow_ref : '',
      runId: typeof payload.run_id === 'string' ? payload.run_id : null,
    },
  };
}
