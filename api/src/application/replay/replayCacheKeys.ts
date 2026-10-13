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
  /** A heatmap read (`grid`, `elements`, `scroll`, `routes`, `snapshot`, `insights`); free-text parts are URI-encoded. */
  heat(what: string, parts: ReadonlyArray<string | number | null>): string;
  /** An MP4 export's status, bucketed to 5 s like live. */
  exportStatus(exportId: string, bucket: number): string;
  /** S4c analysis reads. `filterKey` is `filterCacheKey(filter)` ('' for none). */
  segments(): string;
  filterOptions(field: string, days: number): string;
  overview(days: number, filterKey: string): string;
  smartEventRules(): string;
  smartEvents(days: number): string;
  smartEventPreview(ruleKey: string, days: number): string;
  funnels(): string;
  funnelEval(funnelId: string, days: number, filterKey: string): string;
  flow(days: number, filterKey: string): string;
  segmentSummary(days: number, filterKey: string): string;
  /** S4d: a proof's measured counts. `measureKey` hashes the measure and the proof's start. */
  proofMeasure(realizationId: string, measureKey: string): string;
  /** S4d: a ticket's before/after on its route (`ticketEffect.ts`). */
  ticketEffect(taskId: number, momentKey: string): string;
  /** S4e: the `SiteAggregates` the prescription rules read (`prescriptionAggregates.ts`). */
  prescriptionAggregates(days: number): string;
  /** S4e: the ranked prescription list (`area`/`status` '' for all). */
  prescriptions(area: string, status: string, filterKey: string): string;
  /** S4e: the improvement ledger of one release. */
  releaseReport(releaseKey: string): string;
  /** S4f: the key pages a review captures (`pageSelection.ts`). */
  pageSelection(): string;
  /** S4f: the scored key-page list. */
  pages(): string;
  /** S4f: one page's review (captures, fixes, score by release). */
  pageReview(path: string): string;
  /** S4f: the `PageFacts` of the key pages the page rules read (`pageAggregates.ts`). */
  pageFacts(days: number): string;
  /** S4f: the pickers a fix's actions need (`sequences`, `coding-agents`); short TTL — they change outside Insights. */
  choices(kind: string): string;
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
    heat: (what, parts) => k(`heat-${what}`, ...parts.map((part) => (part === null ? '-' : encodeURIComponent(String(part))))),
    exportStatus: (exportId, bucket) => k('export', exportId, bucket),
    segments: () => k('segments'),
    filterOptions: (field, days) => k('filter-options', field, days),
    overview: (days, filterKey) => k('overview', days, filterKey || '-'),
    smartEventRules: () => k('smart-event-rules'),
    smartEvents: (days) => k('smart-events', days),
    smartEventPreview: (ruleKey, days) => k('smart-event-preview', ruleKey, days),
    funnels: () => k('funnels'),
    funnelEval: (funnelId, days, filterKey) => k('funnel-eval', funnelId, days, filterKey || '-'),
    flow: (days, filterKey) => k('flow', days, filterKey || '-'),
    segmentSummary: (days, filterKey) => k('segment-summary', days, filterKey || '-'),
    proofMeasure: (realizationId, measureKey) => k('proof-measure', realizationId, measureKey),
    ticketEffect: (taskId, momentKey) => k('ticket-effect', taskId, momentKey),
    prescriptionAggregates: (days) => k('rx-aggregates', days),
    prescriptions: (area, status, filterKey) => k('rx-list', area || '-', status || '-', filterKey || '-'),
    releaseReport: (releaseKey) => k('rx-release', encodeURIComponent(releaseKey)),
    pageSelection: () => k('page-selection'),
    pages: () => k('pages'),
    pageReview: (path) => k('page-review', encodeURIComponent(path)),
    pageFacts: (days) => k('page-facts', days),
    choices: (kind) => k('choices', kind),
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

/**
 * `tenants.settings.replayFreeAllowanceOverride` (D8), read by `replayUsage.ts` and
 * dropped by the operator's settings write (`replayTenantSettings.ts`).
 */
export const allowanceOverrideKey = (tenantId: number): string => `replay:allowance-override:t${tenantId}`;

/** Per-tenant, per-UTC-day count of AI summaries (`replayAiBudget.ts`). */
export const replayAiBudgetKey = (tenantId: number, day: string): string => `replay:ai-budget:t${tenantId}:${day}`;

/** S4d: "this site belongs to a project with a live, measured proof" (`realization/proofSite.ts`). */
export const proofSiteKey = (siteId: string): string => `replay:proof-site:${siteId}`;

/** "This site's nightly issue rollup ran today" (`replayRollup.ts`). */
export const replayRollupGateKey = (siteId: string, day: string): string => `replay:rollup:${siteId}:${day}`;

// ── S4e prescriptions (KV gates) ────────────────────────────────────────────

/** "This site's daily prescription sweep ran today" (`prescriptionSweep.ts`). */
export const prescriptionSweepGateKey = (siteId: string, day: string): string => `replay:rx-sweep:${siteId}:${day}`;

/** "Find fixes now" ran within the hour for this site. */
export const prescriptionSweepNowKey = (siteId: string): string => `replay:rx-sweep-now:${siteId}`;

/** How many prescriptions were drafted by AI for this site today (cap 5). */
export const prescriptionDraftCountKey = (siteId: string, day: string): string => `replay:rx-drafted:${siteId}:${day}`;

/** "This visit's conversion was already counted for this A/B test" (`replayAbConversion.ts`). */
export const abConversionKey = (testId: number, visitId: string): string => `replay:ab-conv:${testId}:${visitId}`;

/** "This prescription was verified on read recently" (`prescriptionVerify.ts`). */
export const prescriptionVerifyGateKey = (prescriptionId: string): string => `replay:rx-verify:${prescriptionId}`;

// ── S4f page review (KV gates) ─────────────────────────────────────────────

/** "Capture now" ran within the hour for this site (`pageCapture.ts`). */
export const pageCaptureNowKey = (siteId: string): string => `replay:page-capture-now:${siteId}`;

/** "This release's key pages were already queued for capture." */
export const pageCaptureReleaseKey = (siteId: string, releaseKey: string): string =>
  `replay:page-capture:${siteId}:${encodeURIComponent(releaseKey)}`;

/** "This page was already reviewed by vision on this release" (`visionReview.ts`). */
export const pageVisionKey = (siteId: string, path: string, releaseKey: string): string =>
  `replay:page-vision:${siteId}:${encodeURIComponent(releaseKey)}:${encodeURIComponent(path)}`;

/** "This site's weekly page capture ran this week" (`pageCapture.runWeeklyPageCaptures`). */
export const pageCaptureWeekKey = (siteId: string, week: string): string => `replay:page-capture-week:${siteId}:${week}`;
