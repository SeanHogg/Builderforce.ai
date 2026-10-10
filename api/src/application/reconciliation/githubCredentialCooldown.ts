/**
 * Back-off for a GitHub credential that GitHub is refusing (403) or throttling
 * (429 / "API rate limit exceeded").
 *
 * The PR reconciliation cron ticks every five minutes. A PAT that GitHub refuses
 * does not heal on that cadence, so without a cooldown every tick re-asks,
 * fails the same way and files the same error — `GitHub GraphQL returned HTTP
 * 403` 28 times in a week, and a burnt rate-limit window on 2026-09-16. The
 * cooldown is keyed by CREDENTIAL (one PAT spans every repo it is bound to) and
 * lives in the platform's shared cache (KV-backed `setCached`/`peekCached`), so
 * every isolate honours it — never an isolate-local map.
 *
 * Its length is GitHub's own answer when it gives one (`retry-after`, or
 * `x-ratelimit-reset` when the window is exhausted), otherwise a fixed default.
 */

import { peekCached, setCached, type CacheEnv } from '../../infrastructure/cache/readThroughCache';

/** Default cooldown when GitHub says nothing about when to come back. */
export const DEFAULT_GITHUB_COOLDOWN_SECONDS = 60 * 60;
/** KV's minimum TTL is 60s; a cooldown shorter than a cron tick is pointless anyway. */
const MIN_COOLDOWN_SECONDS = 60;
/** Never trust a header into a multi-day silence. */
const MAX_COOLDOWN_SECONDS = 6 * 60 * 60;

/** Statuses that mean "this credential is refused or throttled right now". */
const THROTTLE_STATUSES: ReadonlySet<number> = new Set([403, 429]);

const clamp = (s: number): number => Math.min(MAX_COOLDOWN_SECONDS, Math.max(MIN_COOLDOWN_SECONDS, Math.ceil(s)));

/**
 * How long GitHub asked us to wait, from its response headers, or null when it
 * did not say. `retry-after` (seconds or an HTTP date) wins; `x-ratelimit-reset`
 * (epoch seconds) applies only when the window is actually exhausted
 * (`x-ratelimit-remaining: 0`) — a 403 for a missing scope also carries the
 * reset header, and waiting for an unrelated window to roll over is wrong.
 */
export function githubRetryAfterSeconds(headers: Pick<Headers, 'get'>, nowMs: number = Date.now()): number | null {
  const retryAfter = headers.get('retry-after')?.trim();
  if (retryAfter) {
    const asSeconds = Number(retryAfter);
    if (Number.isFinite(asSeconds) && asSeconds >= 0) return clamp(asSeconds);
    const asDate = Date.parse(retryAfter);
    if (Number.isFinite(asDate)) return clamp((asDate - nowMs) / 1000);
  }
  const remaining = headers.get('x-ratelimit-remaining')?.trim();
  const reset = Number(headers.get('x-ratelimit-reset')?.trim());
  if (remaining === '0' && Number.isFinite(reset) && reset > 0) return clamp(reset - nowMs / 1000);
  return null;
}

/** The facts the cooldown needs off a failed GitHub call (a `ReconciliationError`'s details). */
interface GithubFailureShape {
  /** `GITHUB_*` codes only — a credential-resolution 403 is ours, not GitHub's. */
  code?: unknown;
  message?: unknown;
  details?: { status?: unknown; retryAfterSeconds?: unknown };
}

/**
 * The cooldown a failure calls for, in seconds, or null when the failure is not
 * GitHub refusing/throttling the credential (a 5xx or a bug must keep surfacing
 * as an error).
 */
export function githubCooldownFor(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const { code, message, details } = error as GithubFailureShape;
  if (typeof code !== 'string' || !code.startsWith('GITHUB_')) return null;
  const status = typeof details?.status === 'number' ? details.status : null;
  // GraphQL reports an exhausted window as HTTP 200 with a RATE_LIMITED error.
  const rateLimitedText = typeof message === 'string' && /rate limit/i.test(message);
  if ((status == null || !THROTTLE_STATUSES.has(status)) && !rateLimitedText) return null;
  const hinted = typeof details?.retryAfterSeconds === 'number' ? details.retryAfterSeconds : null;
  return hinted != null ? clamp(hinted) : DEFAULT_GITHUB_COOLDOWN_SECONDS;
}

export interface GithubCooldownRecord {
  until: string;
  status: number | null;
  reason: string;
}

export const githubCredentialCooldownKey = (credentialId: string | number): string =>
  `github-credential-cooldown:${credentialId}`;

/** The active cooldown for this credential, or null when it may be used. */
export async function activeGithubCooldown(
  env: CacheEnv,
  credentialId: string | number,
  nowMs: number = Date.now(),
): Promise<GithubCooldownRecord | null> {
  const record = await peekCached<GithubCooldownRecord>(env, githubCredentialCooldownKey(credentialId));
  if (!record) return null;
  return Date.parse(record.until) > nowMs ? record : null;
}

/** Start (or extend) the cooldown for this credential. */
export async function recordGithubCooldown(
  env: CacheEnv,
  credentialId: string | number,
  seconds: number,
  failure: { status: number | null; reason: string },
  nowMs: number = Date.now(),
): Promise<GithubCooldownRecord> {
  const ttl = clamp(seconds);
  const record: GithubCooldownRecord = {
    until: new Date(nowMs + ttl * 1000).toISOString(),
    status: failure.status,
    reason: failure.reason.slice(0, 300),
  };
  await setCached(env, githubCredentialCooldownKey(credentialId), record, { kvTtlSeconds: ttl, l1TtlMs: ttl * 1000 });
  return record;
}
