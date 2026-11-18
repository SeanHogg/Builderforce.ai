/**
 * Signed per-app egress policy ids for the preview origin's process Workers
 * (make.md §4 W10, control 6).
 *
 * Policy is per app: an app may declare external APIs its code calls, and its Workers
 * need those origins in `connect-src` on top of the default allowlist
 * ({@link ./workerCsp}). The runtime loads a Worker as
 * `/__bfwc/process-worker.js?policy=<id>.<hmac>`; the URL is the cache key, so two
 * policies never share a cached response. A missing, malformed, tampered or invalid id
 * serves the most restrictive default — a warm spare started before its app is known
 * gets exactly that.
 *
 * Format: `<id>.<hmacHex>` where `<id>` is base64url of the space-separated origins and
 * the HMAC is over `bfwc-egress:<id>` under `JWT_SECRET` (the preview token's secret,
 * domain-separated by the prefix). Self-describing, no server state, constant-time
 * verified — the same shape as {@link ./previewToken}.
 *
 * The origins are re-validated on every verify, not trusted because they were signed:
 * `https:`/`wss:` origins only (no path, query, credentials or wildcard), no IP literal,
 * no localhost/internal/metadata name, and nothing on `builderforce.ai` — the preview
 * origin would re-enter the service worker, and the platform's hosts are same-site with
 * the preview origin, so its cookies would ride along.
 */
import { timingSafeEqual } from '../../infrastructure/crypto/constantTime';
import { hmacHex } from '../../infrastructure/crypto/hmac';
import { base64UrlDecode, base64UrlEncode } from '../../domain/shared/bytes';
import { hostMatchesPattern, isDeniedName, isIpLiteral, normalizeEgressHost } from './sandbox/egressAllowlist';

/** At most this many declared origins per policy, and this long an id. */
export const MAX_POLICY_ORIGINS = 32;
export const MAX_POLICY_ID_CHARS = 2048;

/** The platform's own names: never declarable (preview re-entry, same-site cookies). */
const PLATFORM_HOSTS = ['builderforce.ai', '*.builderforce.ai'];

export interface WorkerEgressPolicy {
  /** The verified id, or null for the default (most restrictive) policy. */
  id: string | null;
  /** Declared origins added to `connect-src`, normalized. Empty for the default. */
  connectSources: readonly string[];
}

export const DEFAULT_WORKER_EGRESS_POLICY: WorkerEgressPolicy = Object.freeze({ id: null, connectSources: Object.freeze([]) });

const signingInput = (id: string) => `bfwc-egress:${id}`;

/** A declared origin in its canonical form (`https://host[:port]`), or null when it is not allowed. */
export function normalizeDeclaredOrigin(raw: string): string | null {
  if (typeof raw !== 'string' || raw.includes('*')) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'wss:') return null;
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) return null;
  if (raw.replace(/\/$/, '') !== `${url.protocol}//${url.host}`) return null;
  const host = normalizeEgressHost(url.hostname);
  if (!host || !host.includes('.') || isIpLiteral(host) || isDeniedName(host)) return null;
  if (PLATFORM_HOSTS.some((p) => hostMatchesPattern(host, p))) return null;
  return `${url.protocol}//${url.host}`;
}

/** Mint the policy id for `origins` (each must pass {@link normalizeDeclaredOrigin}). */
export async function mintWorkerEgressPolicyId(secret: string, origins: readonly string[]): Promise<string> {
  const normalized = origins.map((o) => normalizeDeclaredOrigin(o));
  const bad = origins.find((_, i) => normalized[i] === null);
  if (bad !== undefined) throw new Error(`Not a declarable egress origin: ${bad}`);
  const unique = [...new Set(normalized as string[])];
  if (unique.length === 0 || unique.length > MAX_POLICY_ORIGINS) {
    throw new Error(`An egress policy declares 1-${MAX_POLICY_ORIGINS} origins`);
  }
  const id = base64UrlEncode(unique.join(' '));
  const token = `${id}.${await hmacHex(secret, signingInput(id))}`;
  if (token.length > MAX_POLICY_ID_CHARS) throw new Error('The egress policy is too long');
  return token;
}

/**
 * The policy a worker URL's `?policy=` selects: the verified declared origins, or the
 * default when the param is absent, malformed, tampered, or names a disallowed origin.
 */
export async function resolveWorkerEgressPolicy(
  secret: string | undefined,
  presented: string | null | undefined,
): Promise<WorkerEgressPolicy> {
  if (!secret || typeof presented !== 'string' || !presented || presented.length > MAX_POLICY_ID_CHARS) {
    return DEFAULT_WORKER_EGRESS_POLICY;
  }
  const dot = presented.lastIndexOf('.');
  const id = presented.slice(0, dot);
  const sig = presented.slice(dot + 1);
  if (dot <= 0 || !/^[A-Za-z0-9_-]+$/.test(id) || !/^[0-9a-f]{64}$/.test(sig)) return DEFAULT_WORKER_EGRESS_POLICY;
  const expected = await hmacHex(secret, signingInput(id));
  if (!timingSafeEqual(expected, sig)) return DEFAULT_WORKER_EGRESS_POLICY;

  let origins: string[];
  try { origins = base64UrlDecode(id).split(' '); } catch { return DEFAULT_WORKER_EGRESS_POLICY; }
  if (origins.length === 0 || origins.length > MAX_POLICY_ORIGINS) return DEFAULT_WORKER_EGRESS_POLICY;
  const connectSources: string[] = [];
  for (const origin of origins) {
    const normalized = normalizeDeclaredOrigin(origin);
    if (!normalized) return DEFAULT_WORKER_EGRESS_POLICY;
    connectSources.push(normalized);
  }
  return { id: presented, connectSources: [...new Set(connectSources)] };
}
