/**
 * Signed per-app egress policy ids for the preview origin's process Workers
 * (make.md §4 W10, control 6).
 *
 * Policy is per app: an app may declare external APIs its code calls, and its Workers
 * need those origins in `connect-src` on top of the default allowlist
 * ({@link ./workerCsp} — the runtimes' hosts plus GitHub reads, always applied, so a
 * policy carries only the app's DECLARED extras). The runtime loads a Worker as
 * `/__bfwc/process-worker.js?policy=<id>` on the app's own origin
 * `https://<originKey>.preview.builderforce.ai`; the URL is the cache key, so two
 * policies never share a cached response. A missing, malformed, tampered, expired or
 * mis-bound id serves the most restrictive default — a warm spare started before its app
 * is known gets exactly that.
 *
 * Format: `<payload>.<mac>`, both unpadded base64url, so the id is URL-safe
 * (`[A-Za-z0-9._~-]`) and at most {@link MAX_POLICY_ID_CHARS} long.
 * - `<payload>` is base64url of exactly
 *   `{"v":1,"t":tenantId,"p":projectId,"k":originKey,"a":applicationId,"o":[origins],"e":expSeconds}`
 *   — the canonical serialization; any other byte sequence (reordered, duplicate or extra
 *   keys) is refused even when its MAC is valid.
 * - `<mac>` is HMAC-SHA256 over `bfwc-egress:<payload>` under a subkey derived as
 *   HMAC(JWT_SECRET, 'bfwc-egress-key'): domain-separated from every other use of
 *   `JWT_SECRET`, but it rotates only WITH `JWT_SECRET`. `v` is the key version, so a
 *   dedicated egress secret can be introduced later (a new `v`) without ambiguity.
 * Self-describing, no server state, constant-time verified — the same shape as
 * {@link ./previewToken}. Minted only by `POST /api/runtime/worker-policy`, where the
 * SERVER decides the origins and DERIVES the origin key from a project the caller owns
 * ({@link ./previewOriginKey}); a client names neither.
 *
 * Binding: `k` must equal both the request host's subdomain (the resolver takes the host)
 * and `previewOriginKey(String(p), a)` — so a policy is valid only on the origin of the
 * application it was minted for — and only until `e` (24 h).
 *
 * The origins are re-validated on every verify, not trusted because they were signed:
 * `https:`/`wss:` origins only (no path, query, credentials or wildcard), no IP literal,
 * no localhost/internal/metadata name, and nothing on `builderforce.ai` — the preview
 * origin would re-enter the service worker, and the platform's hosts are same-site with
 * the preview origin, so its cookies would ride along.
 */
import { timingSafeEqual } from '../../infrastructure/crypto/constantTime';
import { hmacSign } from '../../infrastructure/crypto/hmac';
import { base64UrlDecode, base64UrlEncode, bytesToBase64Url } from '../../domain/shared/bytes';
import { PREVIEW_HOST } from './previewIngress';
import { applicationIdPattern, previewOriginKey, runtimeIdOfProject } from './previewOriginKey';
import { hostMatchesPattern, isDeniedName, isIpLiteral, normalizeEgressHost } from './sandbox/egressAllowlist';

/** At most this many declared origins per policy, and this long an id. */
export const MAX_POLICY_ORIGINS = 16;
export const MAX_POLICY_ID_CHARS = 512;

/** How long a minted policy id is honoured. Short: the runtime re-mints per app start. */
export const WORKER_EGRESS_POLICY_TTL_SECONDS = 24 * 60 * 60;

/** The signing key version: 1 = the subkey derived from `JWT_SECRET`. */
export const WORKER_EGRESS_KEY_VERSION = 1;

/** The platform's own names: never declarable (preview re-entry, same-site cookies). */
const PLATFORM_HOSTS = ['builderforce.ai', '*.builderforce.ai'];

/** The derivation label of the egress subkey and the purpose prefix of what it signs. */
const SUBKEY_LABEL = 'bfwc-egress-key';
const signingInput = (payload: string) => `bfwc-egress:${payload}`;

/** The id's shape: base64url payload, `.`, base64url HMAC-SHA256 (32 bytes → 43 chars). */
const POLICY_ID_SHAPE = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/;

/** `<key>.preview.builderforce.ai`, the app's own origin. */
const APP_ORIGIN_HOST = new RegExp(`^([0-9a-f]{32})\\.${PREVIEW_HOST.replace(/\./g, '\\.')}$`);

/** A mint refused because a declared origin is not allowed or the policy is too large. Carries no origin text. */
export class WorkerEgressPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerEgressPolicyError';
  }
}

export interface WorkerEgressPolicy {
  /** The verified id, or null for the default (most restrictive) policy. */
  id: string | null;
  /** Declared origins added to `connect-src`, normalized. Empty for the default. */
  connectSources: readonly string[];
}

export const DEFAULT_WORKER_EGRESS_POLICY: WorkerEgressPolicy = Object.freeze({ id: null, connectSources: Object.freeze([]) });

/** What a policy id binds: one application of one project of one tenant, and the origins it may add. */
export interface WorkerEgressPolicyBinding {
  tenantId: number;
  projectId: number;
  /** `app:<projectId>:<16 hex>` — the runtime's stable application id. */
  applicationId: string;
  /** The app's declared external API origins (each must pass {@link normalizeDeclaredOrigin}). May be empty. */
  origins: readonly string[];
}

export interface MintedWorkerEgressPolicy {
  policy: string;
  /** ISO-8601; after it the id resolves to the default. */
  expiresAt: string;
  /** The app origin's key the policy is bound to (`https://<originKey>.preview.builderforce.ai`). */
  originKey: string;
}

/** The signed payload. Short keys: the whole id must fit {@link MAX_POLICY_ID_CHARS}. */
interface PolicyPayload { v: number; t: number; p: number; k: string; a: string; o: string[]; e: number }

/** The ONE serialization: field order fixed, so verify can demand byte equality. */
const serialize = (b: PolicyPayload): string =>
  JSON.stringify({ v: b.v, t: b.t, p: b.p, k: b.k, a: b.a, o: b.o, e: b.e });

/** The egress subkey for key version 1 — HMAC(secret, 'bfwc-egress-key'). */
function egressKey(secret: string): Promise<ArrayBuffer> {
  return hmacSign(secret, SUBKEY_LABEL);
}

async function macOf(secret: string, payload: string): Promise<string> {
  return bytesToBase64Url(await hmacSign(await egressKey(secret), signingInput(payload)));
}

const isPositiveInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;

/** The origin key of an app-origin host (`<key>.preview.builderforce.ai`), or null for any other host. */
export function previewOriginKeyOf(host: string | null | undefined): string | null {
  if (typeof host !== 'string') return null;
  return APP_ORIGIN_HOST.exec(host.toLowerCase())?.[1] ?? null;
}

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

/**
 * Mint the policy id binding `binding` for {@link WORKER_EGRESS_POLICY_TTL_SECONDS}; the
 * origin key is DERIVED from (projectId, applicationId). Throws
 * {@link WorkerEgressPolicyError} when an origin is not declarable or the id would be too
 * long, and a plain Error for a malformed binding (a caller bug: the route validates first).
 */
export async function mintWorkerEgressPolicyId(
  secret: string,
  binding: WorkerEgressPolicyBinding,
  now: number = Date.now(),
): Promise<MintedWorkerEgressPolicy> {
  if (!secret) throw new Error('No egress signing secret');
  if (!isPositiveInt(binding.tenantId) || !isPositiveInt(binding.projectId)) throw new Error('Not a tenant/project id');
  if (!applicationIdPattern(binding.projectId).test(binding.applicationId)) throw new Error('Not an application id of this project');
  const normalized = binding.origins.map((o) => normalizeDeclaredOrigin(o));
  if (normalized.some((o) => o === null)) throw new WorkerEgressPolicyError('A declared egress origin is not allowed');
  const unique = [...new Set(normalized as string[])];
  if (unique.length > MAX_POLICY_ORIGINS) throw new WorkerEgressPolicyError('Too many declared egress origins');

  const originKey = await previewOriginKey(runtimeIdOfProject(binding.projectId), binding.applicationId);
  const exp = Math.floor(now / 1000) + WORKER_EGRESS_POLICY_TTL_SECONDS;
  const payload = base64UrlEncode(serialize({
    v: WORKER_EGRESS_KEY_VERSION, t: binding.tenantId, p: binding.projectId, k: originKey, a: binding.applicationId, o: unique, e: exp,
  }));
  const policy = `${payload}.${await macOf(secret, payload)}`;
  if (policy.length > MAX_POLICY_ID_CHARS) throw new WorkerEgressPolicyError('The egress policy is too long');
  return { policy, expiresAt: new Date(exp * 1000).toISOString(), originKey };
}

/** The payload when `json` is exactly its canonical serialization (no reordered, duplicate or extra keys). */
function parsePayload(json: string): PolicyPayload | null {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const { v, t, p, k, a, o, e } = parsed as Record<string, unknown>;
  if (v !== WORKER_EGRESS_KEY_VERSION || !isPositiveInt(t) || !isPositiveInt(p) || !isPositiveInt(e)) return null;
  if (typeof k !== 'string' || typeof a !== 'string') return null;
  if (!Array.isArray(o) || o.length > MAX_POLICY_ORIGINS || !o.every((x): x is string => typeof x === 'string')) return null;
  const body: PolicyPayload = { v, t, p, k, a, o, e };
  return serialize(body) === json ? body : null;
}

/**
 * The policy a worker URL's `?policy=` selects on `host`: the verified declared origins,
 * or the default when the param is absent, malformed, non-canonical, tampered, expired,
 * bound to a different origin key than `host`'s subdomain (or `host` is not an app
 * origin), or names a disallowed origin.
 */
export async function resolveWorkerEgressPolicy(
  secret: string | undefined,
  presented: string | null | undefined,
  host?: string | null,
  now: number = Date.now(),
): Promise<WorkerEgressPolicy> {
  if (!secret || typeof presented !== 'string' || !presented || presented.length > MAX_POLICY_ID_CHARS) {
    return DEFAULT_WORKER_EGRESS_POLICY;
  }
  const hostKey = previewOriginKeyOf(host);
  const shape = POLICY_ID_SHAPE.exec(presented);
  if (!hostKey || !shape) return DEFAULT_WORKER_EGRESS_POLICY;
  const [, payload, mac] = shape as unknown as [string, string, string];
  if (!timingSafeEqual(await macOf(secret, payload), mac)) return DEFAULT_WORKER_EGRESS_POLICY;

  let json: string;
  try { json = base64UrlDecode(payload); } catch { return DEFAULT_WORKER_EGRESS_POLICY; }
  const body = parsePayload(json);
  if (!body || body.k !== hostKey || body.e * 1000 <= now || !applicationIdPattern(body.p).test(body.a)) {
    return DEFAULT_WORKER_EGRESS_POLICY;
  }
  if ((await previewOriginKey(runtimeIdOfProject(body.p), body.a)) !== body.k) return DEFAULT_WORKER_EGRESS_POLICY;
  const connectSources: string[] = [];
  for (const origin of body.o) {
    const normalized = normalizeDeclaredOrigin(origin);
    if (!normalized) return DEFAULT_WORKER_EGRESS_POLICY;
    connectSources.push(normalized);
  }
  return { id: presented, connectSources: [...new Set(connectSources)] };
}
