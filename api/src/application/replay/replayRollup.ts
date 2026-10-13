/**
 * The nightly Insights issue rollup (PRD 33 D15, §3.2 `replay_issue_representatives`,
 * `replay_issues.status = regressed`). Registered as the `replay-rollup` daily sweep
 * in `cronSweeps.ts`.
 *
 * Per site that kept recordings in the last two days, once per UTC day (a KV gate
 * makes a re-run a no-op; the writes themselves are replace-not-append, so a run
 * the gate missed is still idempotent):
 *   1. REPRESENTATIVES — for each open issue with sessions this week, the kept
 *      recordings whose `issue_fps` hold its fingerprint (newest 200) are clustered by
 *      visit shape (`pickRepresentatives`, k-medoids over Jaccard of step 2-grams) and
 *      up to three are written, replacing yesterday's.
 *   2. REGRESSIONS — when the site shipped a release in the last 28 days, an issue
 *      whose daily rate after the release sits above its interval before it
 *      (`isRegressed`) is flagged `regressed` (only from new / ongoing / verified —
 *      a status a person or the prescription flow set is never overwritten).
 */

import { and, arrayContains, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  replayIssueDaily,
  replayIssueRepresentatives,
  replayIssues,
  replayRecordings,
  replayReleases,
  replayRouteDaily,
} from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { DAY_MS } from '../../domain/shared/time';
import type { ReplayScope } from '../../domain/replay/replayScope';
import { isRegressed, MAX_CANDIDATES, pickRepresentatives, type RateWindow } from '../../domain/replay/issueClusters';
import { bumpSiteVersion, replayRollupGateKey } from './replayCacheKeys';
import { replayTelemetryDb } from './replayDatabase';

const SOURCE = 'application/replay/replayRollup.ts';
/** Sites with kept recordings this recent are rolled up. */
const ACTIVE_WINDOW_DAYS = 2;
/** Issues with sessions this recent get representatives. */
const ISSUE_WINDOW_DAYS = 7;
/** Most issues one site rolls up per night (by sessions). */
export const ISSUES_PER_SITE = 100;
/** A release this recent can regress an issue; the "before" window is this long too. */
const REGRESSION_LOOKBACK_DAYS = 28;
const REGRESSABLE = ['new', 'ongoing', 'verified'];

const num = (value: unknown): number => Number(value ?? 0) || 0;
const dayOf = (at: Date) => at.toISOString().slice(0, 10);

export interface ReplayRollupResult {
  sites: number;
  issues: number;
  representatives: number;
  regressed: number;
}

interface OpenIssue {
  id: string;
  fingerprint: string;
  route: string;
  status: string;
}

/** Up to three representatives per open issue, replacing the previous ones. */
async function writeRepresentatives(store: Db, scope: ReplayScope, issues: OpenIssue[]): Promise<number> {
  let written = 0;
  for (const issue of issues) {
    const candidates = await store
      .select({ recordingId: replayRecordings.id, steps: replayRecordings.steps })
      .from(replayRecordings)
      .where(and(
        eq(replayRecordings.tenantId, scope.tenantId),
        eq(replayRecordings.siteId, scope.siteId),
        arrayContains(replayRecordings.issueFps, [issue.fingerprint]),
      ))
      .orderBy(desc(replayRecordings.startedAt))
      .limit(MAX_CANDIDATES);
    const reps = pickRepresentatives(candidates);
    await store.delete(replayIssueRepresentatives).where(eq(replayIssueRepresentatives.issueId, issue.id));
    if (reps.length === 0) continue;
    await store.insert(replayIssueRepresentatives).values(reps.map((rep) => ({ issueId: issue.id, ...rep })));
    written += reps.length;
  }
  return written;
}

/** Flag issues whose rate rose past their interval after the newest release. */
async function flagRegressions(store: Db, scope: ReplayScope, issues: OpenIssue[], now: Date): Promise<number> {
  const regressable = issues.filter((i) => REGRESSABLE.includes(i.status));
  if (regressable.length === 0) return 0;
  const [release] = await store
    .select({ releaseKey: replayReleases.releaseKey, firstSeenAt: replayReleases.firstSeenAt })
    .from(replayReleases)
    .where(and(eq(replayReleases.tenantId, scope.tenantId), eq(replayReleases.siteId, scope.siteId)))
    .orderBy(desc(replayReleases.firstSeenAt))
    .limit(1);
  if (!release) return 0;
  const releasedAt = new Date(release.firstSeenAt);
  if (now.getTime() - releasedAt.getTime() > REGRESSION_LOOKBACK_DAYS * DAY_MS) return 0;
  const releaseDay = dayOf(releasedAt);
  const beforeStart = dayOf(new Date(releasedAt.getTime() - REGRESSION_LOOKBACK_DAYS * DAY_MS));

  const [issueDaily, routeDaily] = await Promise.all([
    store
      .select({ issueId: replayIssueDaily.issueId, day: replayIssueDaily.day, sessions: sql<string>`sum(${replayIssueDaily.sessions})` })
      .from(replayIssueDaily)
      .where(and(inArray(replayIssueDaily.issueId, regressable.map((i) => i.id)), gte(replayIssueDaily.day, beforeStart)))
      .groupBy(replayIssueDaily.issueId, replayIssueDaily.day),
    store
      .select({ route: replayRouteDaily.route, day: replayRouteDaily.day, sessions: sql<string>`sum(${replayRouteDaily.pageviews})` })
      .from(replayRouteDaily)
      .where(and(
        eq(replayRouteDaily.tenantId, scope.tenantId),
        eq(replayRouteDaily.siteId, scope.siteId),
        gte(replayRouteDaily.day, beforeStart),
        inArray(replayRouteDaily.route, [...new Set(regressable.map((i) => i.route))]),
      ))
      .groupBy(replayRouteDaily.route, replayRouteDaily.day),
  ]);

  const windows = (rows: Array<{ day: unknown; sessions: unknown }>) => {
    const before: RateWindow = { hits: 0, sessions: 0 };
    const after: RateWindow = { hits: 0, sessions: 0 };
    for (const row of rows) {
      const target = String(row.day) < releaseDay ? before : after;
      target.sessions += num(row.sessions);
    }
    return { before, after };
  };

  const regressed: string[] = [];
  for (const issue of regressable) {
    const route = windows(routeDaily.filter((r) => r.route === issue.route));
    const hits = windows(issueDaily.filter((d) => d.issueId === issue.id));
    const before = { hits: hits.before.sessions, sessions: route.before.sessions };
    const after = { hits: hits.after.sessions, sessions: route.after.sessions };
    if (isRegressed(before, after)) regressed.push(issue.id);
  }
  if (regressed.length === 0) return 0;
  const updated = await store
    .update(replayIssues)
    .set({ status: 'regressed', updatedAt: now })
    .where(and(
      eq(replayIssues.tenantId, scope.tenantId),
      eq(replayIssues.siteId, scope.siteId),
      inArray(replayIssues.id, regressed),
      inArray(replayIssues.status, REGRESSABLE),
    ))
    .returning({ id: replayIssues.id });
  return updated.length;
}

/** One site's nightly pass. Exported for the route-free test and a manual re-run. */
export async function rollupSite(store: Db, scope: ReplayScope, now: Date): Promise<Omit<ReplayRollupResult, 'sites'>> {
  const since = dayOf(new Date(now.getTime() - ISSUE_WINDOW_DAYS * DAY_MS));
  const sessions = sql<string>`sum(${replayIssueDaily.sessions})`;
  const issues: OpenIssue[] = await store
    .select({ id: replayIssues.id, fingerprint: replayIssues.fingerprint, route: replayIssues.route, status: replayIssues.status })
    .from(replayIssues)
    .innerJoin(replayIssueDaily, eq(replayIssueDaily.issueId, replayIssues.id))
    .where(and(
      eq(replayIssues.tenantId, scope.tenantId),
      eq(replayIssues.siteId, scope.siteId),
      gte(replayIssueDaily.day, since),
      sql`${replayIssues.status} <> 'ignored'`,
    ))
    .groupBy(replayIssues.id)
    .orderBy(desc(sessions))
    .limit(ISSUES_PER_SITE);
  if (issues.length === 0) return { issues: 0, representatives: 0, regressed: 0 };
  const representatives = await writeRepresentatives(store, scope, issues);
  const regressed = await flagRegressions(store, scope, issues, now);
  return { issues: issues.length, representatives, regressed };
}

/** The daily sweep: every site with recent kept recordings, once per UTC day. */
export async function runReplayRollup(env: Env, db: Db, now: Date = new Date()): Promise<ReplayRollupResult> {
  const store = replayTelemetryDb(env, db);
  const active = await store
    .select({ siteId: replayRecordings.siteId, tenantId: replayRecordings.tenantId })
    .from(replayRecordings)
    // A platform sweep over every workspace's sites; each site is then processed in its own scope.
    .where(acrossTenants(replayRecordings, 'scheduled_sweep', gte(replayRecordings.startedAt, new Date(now.getTime() - ACTIVE_WINDOW_DAYS * DAY_MS))))
    .groupBy(replayRecordings.siteId, replayRecordings.tenantId);

  const result: ReplayRollupResult = { sites: 0, issues: 0, representatives: 0, regressed: 0 };
  const kv = env.AUTH_CACHE_KV;
  const day = dayOf(now);
  for (const site of active) {
    const scope: ReplayScope = { tenantId: site.tenantId, siteId: site.siteId };
    const gate = replayRollupGateKey(scope.siteId, day);
    try {
      if (kv && (await kv.get(gate))) continue;
      const out = await rollupSite(store, scope, now);
      result.sites += 1;
      result.issues += out.issues;
      result.representatives += out.representatives;
      result.regressed += out.regressed;
      if (out.representatives > 0 || out.regressed > 0) await bumpSiteVersion(env, scope.siteId);
      if (kv) await kv.put(gate, '1', { expirationTtl: 2 * 86_400 });
    } catch (error) {
      reportCaughtError(error, { source: SOURCE, operation: 'runReplayRollup', context: { details: { siteId: scope.siteId } } });
    }
  }
  return result;
}
