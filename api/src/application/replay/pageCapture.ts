/**
 * Capturing a site's key pages (PRD 33 §5.2 "Capture") through THE runner — no new
 * queue, no new container: one `page_capture` job per page × device
 * (`dispatchQaRunnerJob`), each with its own capability token (`pageRunnerTokens.ts`).
 *
 *   requestCaptures        queue the key pages of a release (or the given ones)
 *   queueReleaseCaptures   once per release, when the release is first seen
 *   captureNow             a manager's "capture now" — once an hour per site
 *   runWeeklyPageCaptures  the weekly pass over every active site
 *   recordCapture          THE writer of a capture row (the runner's callback)
 *
 * A deploy with no runner, no published page kit, or a site with no address answers
 * `unavailable` with the reason — never a pretend "queued".
 */

import { gte } from 'drizzle-orm';
import {
  REPLAY_PAGE_KIT_GLOBAL,
  type ReplayCaptureDevice,
  type ReplayPageCaptureResultDto,
} from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { replayRouteDaily } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { peekCached, setCached } from '../../infrastructure/cache/readThroughCache';
import { DomainError, UnauthorizedError } from '../../domain/shared/errors';
import { DAY_MS } from '../../domain/shared/time';
import type { ReplayScope } from '../../domain/replay/replayScope';
import { pageScore } from '../../domain/replay/pageScore';
import { dispatchQaRunnerJob, qaRunnerProvisioned } from '../qa/dispatchQaRunner';
import { HOSTING_APEX } from '../ide/siteHosting';
import { siteForProject } from '../ide/siteTraffic';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { loadRecorderManifest } from './ReplayConfigService';
import { ReplayReadService } from './ReplayReadService';
import { pagesToReview } from './pageSelection';
import {
  bumpSiteVersion,
  pageCaptureNowKey,
  pageCaptureReleaseKey,
  pageCaptureWeekKey,
} from './replayCacheKeys';
import { replayTelemetryDb } from './replayDatabase';
import { listCaptures, setCaptureScore, upsertCapture, type CaptureFactsInput, type CaptureRow } from './pageCaptureStore';
import { readPageBehaviour, readPageVitals } from './pageFactsReads';
import { mintCaptureToken, PAGE_RUNNER_PREFIX, type CaptureClaims } from './pageRunnerTokens';
import { getSite, getSiteForTenant, type ReplaySiteRecord } from './replaySites';
import { getSiteDto } from './replaySiteAdmin';

const SOURCE = 'application/replay/pageCapture.ts';
export const PAGE_CAPTURE_JOB = 'page_capture';
/** The two sizes (§5.2): desktop and a modern phone. */
export const CAPTURE_VIEWPORTS: Readonly<Record<ReplayCaptureDevice, { w: number; h: number }>> = {
  desktop: { w: 1440, h: 900 },
  phone: { w: 390, h: 844 },
};
export const CAPTURE_NOW_INTERVAL_SECONDS = 3_600;
const RELEASE_GATE_SECONDS = 30 * 86_400;
const SCORE_WINDOW_DAYS = 30;
const ACTIVE_WINDOW_DAYS = 7;

/** "Capture now" ran within the hour. The route answers 429. */
export class PageCaptureLimitError extends DomainError {
  readonly status = 429;
  constructor() {
    super('Pages were captured less than an hour ago');
    this.name = 'PageCaptureLimitError';
  }
}

/** The page kit bundle the runner injects (from the CDN manifest), or null when not published. */
export function pageKitUrl(manifest: unknown): string | null {
  const url = (manifest as { pageKit?: { url?: unknown } } | null)?.pageKit?.url;
  return typeof url === 'string' && url.startsWith('https://') ? url : null;
}

/** The address the runner opens: a hosted app's subdomain, else the external site's first exact origin. */
export async function siteOrigin(env: Env, db: Db, site: ReplaySiteRecord): Promise<string | null> {
  if (site.kind === 'hosted' && site.projectId !== null) {
    const hosted = await siteForProject(db, site.tenantId, site.projectId);
    return hosted ? `https://${hosted.subdomain}.${HOSTING_APEX}` : null;
  }
  const dto = await getSiteDto(env, db, { tenantId: site.tenantId, siteId: site.id });
  const origin = dto.allowedOrigins.map((o) => o.trim().replace(/\/+$/, '')).find((o) => /^https:\/\/[^*\s/]+$/.test(o));
  return origin ?? null;
}

const unavailable = (reason: string, releaseKey: string | null, pages: string[] = []): ReplayPageCaptureResultDto =>
  ({ status: 'unavailable', releaseKey, queued: 0, pages, reason });

/** The newest release the site has seen ('' before any). */
async function newestRelease(env: Env, db: Db, scope: ReplayScope): Promise<string> {
  const [release] = await new ReplayReadService(env, db).releases(scope);
  return release?.releaseKey ?? '';
}

/** Queue one job per page × device. Honest `unavailable` when it cannot run. */
export async function requestCaptures(
  env: Env,
  db: Db,
  site: ReplaySiteRecord,
  releaseKey: string | null,
  opts: { paths?: readonly string[]; now?: Date } = {},
): Promise<ReplayPageCaptureResultDto> {
  const now = opts.now ?? new Date();
  const scope: ReplayScope = { tenantId: site.tenantId, siteId: site.id };
  const release = releaseKey ?? await newestRelease(env, db, scope);
  if (!qaRunnerProvisioned(env)) return unavailable('runner_unavailable', release);
  const kit = pageKitUrl(await loadRecorderManifest(env));
  if (!kit) return unavailable('page_kit_unavailable', release);
  const origin = await siteOrigin(env, db, site);
  if (!origin) return unavailable('no_origin', release);
  const pages = opts.paths ? [...opts.paths] : await pagesToReview(env, db, scope, { now });
  if (pages.length === 0) return unavailable('no_pages', release);

  const base = (env.INTERNAL_API_BASE_URL ?? 'https://api.builderforce.ai').replace(/\/$/, '');
  let queued = 0;
  for (const path of pages) {
    for (const device of Object.keys(CAPTURE_VIEWPORTS) as ReplayCaptureDevice[]) {
      const token = await mintCaptureToken(env, { tenantId: site.tenantId, siteId: site.id, path, releaseKey: release, device }, now);
      const ok = await dispatchQaRunnerJob(env, {
        kind: PAGE_CAPTURE_JOB,
        jobId: `${site.id}:${release || 'none'}:${device}:${encodeURIComponent(path)}`.slice(0, 200),
        payload: {
          captureToken: token,
          url: `${origin}${path}`,
          path,
          device,
          viewport: CAPTURE_VIEWPORTS[device],
          captureUrl: `${base}${PAGE_RUNNER_PREFIX}/capture`,
          pageKitUrl: kit,
          pageKitGlobal: REPLAY_PAGE_KIT_GLOBAL,
        },
      }).catch((error) => {
        reportCaughtError(error, { source: SOURCE, operation: 'dispatchPageCapture', context: { siteId: site.id } });
        return false;
      });
      if (ok) queued += 1;
    }
  }
  return queued > 0
    ? { status: 'queued', releaseKey: release, queued, pages, reason: null }
    : unavailable('runner_unavailable', release, pages);
}

/** The release-first-seen hook: queue its key pages once. Never throws. */
export async function queueReleaseCaptures(env: Env, db: Db, site: ReplaySiteRecord, releaseKey: string, now: Date = new Date()): Promise<void> {
  try {
    const gate = pageCaptureReleaseKey(site.id, releaseKey);
    if (await peekCached<boolean>(env, gate)) return;
    await setCached(env, gate, true, { kvTtlSeconds: RELEASE_GATE_SECONDS });
    await requestCaptures(env, db, site, releaseKey, { now });
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'queueReleaseCaptures', context: { siteId: site.id } });
  }
}

/** A manager's "capture now": once an hour per site. */
export async function captureNow(
  env: Env,
  db: Db,
  scope: ReplayScope,
  input: { path?: string | null },
  now: Date = new Date(),
): Promise<ReplayPageCaptureResultDto> {
  const site = await getSiteForTenant(env, db, scope.tenantId, scope.siteId);
  const gate = pageCaptureNowKey(site.id);
  if (await peekCached<boolean>(env, gate)) throw new PageCaptureLimitError();
  const path = input.path?.trim() || null;
  const result = await requestCaptures(env, db, site, null, { now, ...(path ? { paths: [path] } : {}) });
  // Only a request that actually queued spends the hour.
  if (result.status === 'queued') await setCached(env, gate, true, { kvTtlSeconds: CAPTURE_NOW_INTERVAL_SECONDS });
  return result;
}

/** ISO-ish week id (`2026-W41`) for the weekly gate. */
export function weekOf(at: Date): string {
  const day = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  const thursday = new Date(day + (3 - ((new Date(day).getUTCDay() + 6) % 7)) * DAY_MS);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return `${thursday.getUTCFullYear()}-W${String(Math.ceil(((thursday.getTime() - yearStart) / DAY_MS + 1) / 7)).padStart(2, '0')}`;
}

/** The weekly pass: every site with traffic this week, its newest release, once per week. */
export async function runWeeklyPageCaptures(env: Env, db: Db, now: Date = new Date()): Promise<{ sites: number; queued: number; unavailable: number }> {
  const out = { sites: 0, queued: 0, unavailable: 0 };
  if (!qaRunnerProvisioned(env)) return out;
  const sinceDay = new Date(now.getTime() - ACTIVE_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  const active = await replayTelemetryDb(env, db)
    .select({ siteId: replayRouteDaily.siteId, tenantId: replayRouteDaily.tenantId })
    .from(replayRouteDaily)
    // A platform sweep over every workspace's sites; each is then captured in its own scope.
    .where(acrossTenants(replayRouteDaily, 'scheduled_sweep', gte(replayRouteDaily.day, sinceDay)))
    .groupBy(replayRouteDaily.siteId, replayRouteDaily.tenantId);
  const week = weekOf(now);
  for (const row of active) {
    try {
      const gate = pageCaptureWeekKey(row.siteId, week);
      if (await peekCached<boolean>(env, gate)) continue;
      const site = await getSite(env, db, row.siteId);
      if (!site || site.status !== 'active' || site.tenantId !== row.tenantId) continue;
      await setCached(env, gate, true, { kvTtlSeconds: 8 * 86_400 });
      const result = await requestCaptures(env, db, site, null, { now });
      out.sites += 1;
      if (result.status === 'queued') out.queued += result.queued;
      else out.unavailable += 1;
    } catch (error) {
      reportCaughtError(error, { source: SOURCE, operation: 'runWeeklyPageCaptures', context: { siteId: row.siteId } });
    }
  }
  return out;
}

/**
 * THE writer of a capture row: the runner's facts for the one (site, path, release,
 * device) its token names, then the capture's score. Returns the row and whether both
 * devices of this page and release are now captured (the vision review's trigger).
 */
export async function recordCapture(
  env: Env,
  db: Db,
  claims: CaptureClaims,
  facts: CaptureFactsInput,
  now: Date = new Date(),
): Promise<{ capture: CaptureRow; reviewReady: boolean }> {
  const site = await getSite(env, db, claims.sid);
  if (!site || site.tenantId !== claims.xt) throw new UnauthorizedError('The capture token names a site outside its workspace');
  const scope: ReplayScope = { tenantId: site.tenantId, siteId: site.id };
  const capture = await upsertCapture(db, {
    tenantId: site.tenantId, siteId: site.id, path: claims.p, releaseKey: claims.rk, device: claims.dc, facts, now,
  });

  try {
    const store = replayTelemetryDb(env, db);
    const sinceDay = new Date(now.getTime() - SCORE_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
    const [behaviour, vitals] = await Promise.all([
      readPageBehaviour(store, scope, [claims.p], sinceDay),
      readPageVitals(store, scope, [claims.p], sinceDay),
    ]);
    const split = behaviour.pages.get(claims.p);
    const score = pageScore({
      seo: facts.seo,
      labPerf: facts.labPerf,
      a11y: facts.a11y,
      behaviour: split ? split[claims.dc] : { sessions: 0, conversions: 0, frustrated: 0 },
      site: behaviour.site,
      vitals: vitals.get(claims.p)?.[claims.dc] ?? { lcpP75: null, clsP75: null, inpP75: null, samples: 0 },
    });
    await setCaptureScore(db, site.id, capture.id, score);
    capture.score = score;
  } catch (error) {
    // A capture without a score is still a capture; the next one scores.
    reportCaughtError(error, { source: SOURCE, operation: 'scoreCapture', context: { siteId: site.id } });
  }

  const siblings = await listCaptures(db, site.id, { paths: [claims.p], limit: 20 });
  const devices = new Set(siblings.filter((r) => r.releaseKey === claims.rk).map((r) => r.deviceClass));
  await bumpSiteVersion(env, site.id);
  return { capture, reviewReady: devices.has('desktop') && devices.has('phone') };
}
