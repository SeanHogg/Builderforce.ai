/**
 * Every Insights cache key, in ONE place (PRD 33 §6 "Caching").
 *
 * Reads are cached per site under the site's VERSION TOKEN: ingest bumps the token
 * (at most once a minute per site, gated by a KV timestamp — a busy site must not
 * turn KV into a write hot spot), and every key built from the old token is orphaned
 * at once and ages out on its TTL. A write a person makes (renaming a release) bumps
 * it immediately.
 *
 * The site-RECORD keys (resolution by token, the site row, a tenant's site list) are
 * a second family: they change when a site is edited, not when a visitor arrives.
 * `bumpReplaySitesVersion` is what the site-admin writes call.
 */

import type { Env } from '../../env';
import {
  bumpCacheVersion,
  getCacheVersion,
  invalidateCached,
} from '../../infrastructure/cache/readThroughCache';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { ReplayScope } from '../../domain/replay/replayScope';

const SOURCE = 'application/replay/replayCacheKeys.ts';

/** How often ingest may bump one site's version token. */
export const SITE_VERSION_BUMP_INTERVAL_SECONDS = 60;

const siteVersionKey = (siteId: string) => `replay-site:${siteId}`;
const bumpGateKey = (siteId: string) => `replay:ver-bumped:${siteId}`;
const tenantSitesVersionKey = (tenantId: number) => `replay-sites:t:${tenantId}`;

/** The site's current read-cache token. */
export async function getSiteVersion(env: Env, siteId: string): Promise<string> {
  return getCacheVersion(env, siteVersionKey(siteId));
}

/** Orphan every cached read of this site now (a person's write). */
export async function bumpSiteVersion(env: Env, siteId: string): Promise<void> {
  await bumpCacheVersion(env, siteVersionKey(siteId)).catch((error) => {
    reportCaughtError(error, { source: SOURCE, operation: 'bumpSiteVersion' });
  });
}

/**
 * Ingest's bump: at most once per {@link SITE_VERSION_BUMP_INTERVAL_SECONDS} per site.
 * The gate is a KV key that expires after the interval (KV's own minimum TTL is
 * 60 s, which is exactly this window). Returns whether it bumped. Fails open to
 * "no bump" — stale-by-a-minute reads are the designed behaviour, not an outage.
 */
export async function bumpSiteVersionThrottled(env: Env, siteId: string): Promise<boolean> {
  const kv = env.AUTH_CACHE_KV;
  if (!kv) return false;
  try {
    if (await kv.get(bumpGateKey(siteId))) return false;
    await kv.put(bumpGateKey(siteId), String(Date.now()), { expirationTtl: SITE_VERSION_BUMP_INTERVAL_SECONDS });
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'bumpSiteVersionThrottled' });
    return false;
  }
  await bumpSiteVersion(env, siteId);
  return true;
}

/** `replay:v:<token>:t<tenant>:s<site>:<what>:<parts…>` — the shape of every read key. */
function readKey(version: string, scope: ReplayScope, what: string, parts: ReadonlyArray<string | number>): string {
  return ['replay', 'v', version, `t${scope.tenantId}`, `s${scope.siteId}`, what, ...parts.map(String)].join(':');
}

/** Builds the read keys for one scope under its current version token. */
export interface ReplayReadKeys {
  recordings(days: number, cursor: string | null, filterKey: string): string;
  recording(recordingId: string): string;
  releases(): string;
  kpis(days: number): string;
  issues(days: number, status: string | null, cursor: string | null): string;
  issue(issueId: string, days: number): string;
  /** Live is bucketed to 5 s in the key itself, since KV cannot hold a sub-minute TTL. */
  live(bucket: number): string;
}

export async function replayReadKeys(env: Env, scope: ReplayScope): Promise<ReplayReadKeys> {
  const version = await getSiteVersion(env, scope.siteId);
  const k = (what: string, ...parts: Array<string | number>) => readKey(version, scope, what, parts);
  return {
    recordings: (days, cursor, filterKey) => k('recordings', days, cursor ?? '-', filterKey || '-'),
    recording: (recordingId) => k('recording', recordingId),
    releases: () => k('releases'),
    kpis: (days) => k('kpis', days),
    issues: (days, status, cursor) => k('issues', days, status ?? '-', cursor ?? '-'),
    issue: (issueId, days) => k('issue', issueId, days),
    live: (bucket) => k('live', bucket),
  };
}

// ── Site records ─────────────────────────────────────────────────────────────

/** Resolution of a public site token (hashed) to its site; 5-minute TTL. */
export const siteTokenKey = (tokenHash: string): string => `replay:site-token:${tokenHash}`;

/** One site row, by id. */
export const siteRecordKey = (siteId: string): string => `replay:site:${siteId}`;

/** A tenant's site list, under the tenant's sites version. */
export async function tenantSitesKey(env: Env, tenantId: number): Promise<string> {
  const version = await getCacheVersion(env, tenantSitesVersionKey(tenantId));
  return `replay:sites:v:${version}:t${tenantId}`;
}

/**
 * Call after ANY write to `replay_sites` (create, settings, key rotation, disable).
 * Drops the tenant's list and the site's record; a token resolution expires on its
 * own five-minute TTL (it is keyed by the token hash, which the writer does not hold).
 */
export async function bumpReplaySitesVersion(env: Env, tenantId: number, siteId?: string): Promise<void> {
  try {
    await bumpCacheVersion(env, tenantSitesVersionKey(tenantId));
    if (siteId) {
      await invalidateCached(env, siteRecordKey(siteId));
      await bumpSiteVersion(env, siteId);
    }
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'bumpReplaySitesVersion' });
  }
}

// ── Ingest gates (KV-only, never a database round trip) ─────────────────────

/** "Already traced today" for `replay.loader.hit`. */
export const loaderTraceKey = (siteId: string, day: string): string => `replay:trace:loader:${siteId}:${day}`;

/** "Already traced this period" for `replay.allowance.exhausted`. */
export const exhaustedTraceKey = (tenantId: number, period: string): string => `replay:trace:exhausted:t${tenantId}:${period}`;

/** "This site has ingested before" for `replay.ingest.first_event`. */
export const firstEventKey = (siteId: string): string => `replay:first-event:${siteId}`;

/** The recorder manifest, read from `REPLAY_MANIFEST_URL`. */
export const MANIFEST_CACHE_KEY = 'replay:manifest';

/** Per-tenant entitlement verdict at ingest. */
export const entitlementKey = (tenantId: number): string => `replay:entitled:t${tenantId}`;
