/**
 * ONE `SiteAggregates` per site (PRD 33 §5.1.1) — what every prescription rule reads.
 *
 * Built from the Insights reads that already exist, cached, so a rule sees exactly
 * the numbers the screen shows: routes (`ReplayHeatmapService.routes`), issues and
 * their representatives (`ReplayReadService.issues` / `.issue`), releases
 * (`ReplayReadService.releases`), funnels (`ReplayFunnelService.list` / `.evaluate`)
 * and the heat + scroll folds (`readElementCells` / `foldElementCells`,
 * `readScrollDeciles` / `scrollReach`). The few facts nothing else answers are one
 * bounded aggregate statement each (`prescriptionAggregateReads.ts`). No new scan of
 * recordings: the funnel drops come from the funnel's own sample, the patterns from
 * the cached segment summary (never generated here — that would spend AI budget).
 *
 * The whole aggregate is cached under the site's version token.
 */

import { GRID, type ReplaySegmentSummaryDto } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { getOrSetCached, peekCached } from '../../infrastructure/cache/readThroughCache';
import { foldElementCells, scrollReach } from '../../domain/replay/heatFold';
import type { ReplayScope } from '../../domain/replay/replayScope';
import type {
  ElementAggregate,
  FunnelStepAggregate,
  IssueAggregate,
  ReleaseAggregate,
  ScrollAggregate,
  SiteAggregates,
} from '../../domain/replay/prescriptions/types';
import { replayReadKeys } from './replayCacheKeys';
import { replayTelemetryDb } from './replayDatabase';
import { readElementCells, readScrollDeciles } from './replayHeatReads';
import { ReplayHeatmapService } from './ReplayHeatmapService';
import { ReplayReadService } from './ReplayReadService';
import { ReplayFunnelService } from './ReplayFunnelService';
import { windowDays } from './replayReadModel';
import {
  readDropIssueFps,
  readErrorIssues,
  readGradedProofs,
  readIssueCohorts,
  readKnownCohorts,
  readSplits,
} from './prescriptionAggregateReads';
import type { ReplaySiteRecord } from './replaySites';

/** The window every rule reads. */
export const PRESCRIPTION_WINDOW_DAYS = 30;
/** Issues read (by sessions). */
const ISSUES_READ = 50;
/** Issues whose representatives and cohorts are read. */
const ISSUES_DETAILED = 20;
/** Routes whose elements and scroll reach are read. */
const ROUTES_DETAILED = 10;
const FUNNELS_READ = 5;
const TTL = { kvTtlSeconds: 600, l1TtlMs: 60_000 };

async function funnelSteps(env: Env, db: Db, store: Db, scope: ReplayScope, days: number, now: Date): Promise<FunnelStepAggregate[]> {
  const service = new ReplayFunnelService(env, db, () => now);
  const funnels = (await service.list(scope)).slice(0, FUNNELS_READ);
  const evaluated = await Promise.all(funnels.map(async (f) => ({ funnel: f, result: await service.evaluate(scope, f.id, { days }) })));
  const dropIds = evaluated.flatMap(({ result }) => result.steps.flatMap((s) => s.droppedRecordingIds));
  const fpsByRecording = await readDropIssueFps(store, scope, dropIds);
  const errors = await readErrorIssues(store, scope, [...new Set([...fpsByRecording.values()].flat())]);
  const errorByFp = new Map(errors.map((e) => [e.fingerprint, e]));

  const out: FunnelStepAggregate[] = [];
  for (const { funnel, result } of evaluated) {
    result.steps.forEach((step, i) => {
      if (i === 0) return;
      const sampled = step.droppedRecordingIds.filter((id) => fpsByRecording.has(id));
      const byFp = new Map<string, string[]>();
      for (const recordingId of sampled) {
        for (const fp of fpsByRecording.get(recordingId) ?? []) {
          if (!errorByFp.has(fp)) continue;
          byFp.set(fp, [...(byFp.get(fp) ?? []), recordingId]);
        }
      }
      out.push({
        funnelId: funnel.id,
        funnelName: funnel.name,
        ord: step.ord,
        label: step.label,
        prevVisits: result.steps[i - 1]!.visits,
        visits: step.visits,
        droppedSampled: sampled.length,
        dropErrors: [...byFp].map(([fp, recordingIds]) => {
          const issue = errorByFp.get(fp)!;
          return { issueId: issue.id, fingerprint: fp, subject: issue.subject, route: issue.route, drops: recordingIds.length, recordingIds };
        }),
      });
    });
  }
  return out;
}

async function heatFor(store: Db, scope: ReplayScope, routes: string[], sinceDay: string): Promise<{ elements: ElementAggregate[]; scroll: ScrollAggregate[] }> {
  const perRoute = await Promise.all(routes.map(async (route) => {
    const q = { route, release: null, device: null, since: sinceDay };
    const [cells, deciles] = await Promise.all([readElementCells(store, scope, q), readScrollDeciles(store, scope, q)]);
    const elements = foldElementCells(cells).map((e): ElementAggregate => ({
      route, selector: e.selector, label: e.label, clicks: e.clicks, rage: e.rage, dead: e.dead, medianGy: e.medianGy,
    }));
    return { elements, scroll: { route, ...scrollReach(deciles) } };
  }));
  return { elements: perRoute.flatMap((r) => r.elements), scroll: perRoute.map((r) => r.scroll) };
}

/** Build (or read the cached) aggregates of one site. */
export async function buildSiteAggregates(
  env: Env,
  db: Db,
  site: ReplaySiteRecord,
  opts: { days?: number; now?: Date } = {},
): Promise<SiteAggregates> {
  const scope: ReplayScope = { tenantId: site.tenantId, siteId: site.id };
  const days = opts.days ?? PRESCRIPTION_WINDOW_DAYS;
  const now = opts.now ?? new Date();
  const keys = await replayReadKeys(env, scope);
  return getOrSetCached(env, keys.prescriptionAggregates(days), async (): Promise<SiteAggregates> => {
    const store = replayTelemetryDb(env, db);
    const clock = () => now;
    const reads = new ReplayReadService(env, db, clock);
    const sinceDay = windowDays(now, days)[0]!;
    const since = new Date(`${sinceDay}T00:00:00.000Z`);

    const [routes, issuePage, releaseList, splits] = await Promise.all([
      new ReplayHeatmapService(env, db, clock).routes(scope, days),
      reads.issues(scope, { days, limit: ISSUES_READ }),
      reads.releases(scope),
      readSplits(store, scope, sinceDay),
    ]);

    const detailed = issuePage.items.slice(0, ISSUES_DETAILED);
    const [details, cohorts] = await Promise.all([
      Promise.all(detailed.map((issue) => reads.issue(scope, issue.id, { days }))),
      readIssueCohorts(store, scope, since, detailed),
    ]);
    const repsById = new Map(details.map((d) => [d.id, d.representatives.map((r) => r.recordingId)]));
    const issues: IssueAggregate[] = issuePage.items.map((issue) => ({
      id: issue.id,
      fingerprint: issue.fingerprint,
      kind: issue.kind,
      route: issue.route,
      subject: issue.subject,
      title: issue.title,
      status: issue.status,
      sessions: issue.sessions,
      share: issue.share,
      routeSessions: issue.share > 0 ? Math.round(issue.sessions / issue.share) : 0,
      recordingIds: repsById.get(issue.id) ?? [],
      cohorts: cohorts.get(issue.fingerprint) ?? null,
    }));

    const [heat, steps, knownCohorts, proofs, cachedPatterns] = await Promise.all([
      heatFor(store, scope, routes.slice(0, ROUTES_DETAILED).map((r) => r.route), sinceDay),
      funnelSteps(env, db, store, scope, days, now),
      readKnownCohorts(store, scope, since),
      site.kind === 'hosted' && site.projectId !== null ? readGradedProofs(db, site.tenantId, site.projectId) : Promise.resolve([]),
      peekCached<ReplaySegmentSummaryDto>(env, keys.segmentSummary(days, '')),
    ]);

    const releaseSplit = new Map(splits.releases.map((r) => [r.value, r]));
    const releases: ReleaseAggregate[] = releaseList.map((r) => ({
      releaseKey: r.releaseKey,
      label: r.label,
      firstSeenAt: r.firstSeenAt,
      sessions: releaseSplit.get(r.releaseKey)?.sessions ?? 0,
      conversions: releaseSplit.get(r.releaseKey)?.conversions ?? 0,
    }));
    const site_ = splits.devices.reduce((acc, d) => ({ sessions: acc.sessions + d.sessions, conversions: acc.conversions + d.conversions }), { sessions: 0, conversions: 0 });

    return {
      siteId: site.id,
      days,
      grid: GRID,
      site: site_,
      routes: routes.map((r) => ({ route: r.route, sessions: r.sessions, pageviews: r.pageviews })),
      issues,
      elements: heat.elements,
      scroll: heat.scroll,
      funnelSteps: steps,
      devices: splits.devices,
      releases,
      knownCohorts,
      proofs,
      patterns: cachedPatterns?.patterns ?? [],
    };
  }, TTL);
}
