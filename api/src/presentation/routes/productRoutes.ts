/**
 * Product Management — /api/product/*
 *
 * The net-new PM features (doc 02): MVP scenarios, validation results, roadmap,
 * releases, changelog, feature flags, business-value configs, feature ROI. Every
 * one is segment-scoped CRUD, so they all run through the shared tracker factory
 * — a table + a field whitelist each, no bespoke routers.
 *
 * Except releases: `/release-planning` is a legacy alias of `/api/releases`,
 * served by the ONE release use case (ProductReleaseService) rather than a second
 * tracker writer of `product_releases`. See releasesRoutes.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { mountTrackers, type TrackerOpts } from './segmentTrackerRoutes';
import { createReleasePlanningAliasRoutes } from './releasesRoutes';
import {
  mvpScenarios, validationResults, roadmapItems,
  changelogEntries, featureFlags, businessValueConfigs, featureRoi,
} from '../../infrastructure/database/schema';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { afterRoadmapWrite, ROADMAP_CACHE_NS } from '../../application/delivery/roadmapWrite';
import { optionalExecutionCtx, scope } from './requestScope';
import { waitUntilOf } from '../../application/shared/requestScope';

/** The roadmap tracker's post-write step, bound to the request's scope and execution context. */
const roadmapAfterWrite: NonNullable<TrackerOpts['afterWrite']> = (c, db, before, after) =>
  afterRoadmapWrite({ db, env: c.env, ...scope(c), waitUntil: waitUntilOf(optionalExecutionCtx(c)) }, before, after);

const TRACKERS: Array<{ path: string; table: unknown; opts: TrackerOpts }> = [
  { path: '/mvp', table: mvpScenarios, opts: { fields: ['name', 'description', 'pricingModel', 'targetRevenue', 'timelineConstraint', 'budgetConstraint', 'teamSize', 'status', 'notes'], required: ['name'] } },
  { path: '/validation', table: validationResults, opts: { fields: ['hypothesis', 'validationType', 'method', 'result', 'metrics', 'learnings', 'nextSteps', 'notes'], required: ['hypothesis'] } },
  // The post-write step (cache + `roadmap.published` on a transition into shipped) is the ONE
  // `afterRoadmapWrite` the Brain's roadmap tools call too.
  { path: '/roadmap', table: roadmapItems, opts: { fields: ['title', 'horizon', 'status', 'theme', 'targetDate', 'priority', 'notes'], required: ['title'], projectScoped: true, cacheNs: ROADMAP_CACHE_NS, statusKind: 'roadmap', afterWrite: roadmapAfterWrite } },
  { path: '/changelog', table: changelogEntries, opts: { fields: ['version', 'title', 'body', 'releasedAt', 'status'], required: ['version'] } },
  { path: '/feature-flags', table: featureFlags, opts: { fields: ['key', 'name', 'status', 'rolloutPercentage', 'description', 'notes'], required: ['key'] } },
  { path: '/business-value', table: businessValueConfigs, opts: { fields: ['name', 'valueType', 'displayMode', 'rewardMultiplier', 'isActive', 'notes'], required: ['name'] } },
  { path: '/feature-roi', table: featureRoi, opts: { fields: ['featureName', 'featureType', 'category', 'status', 'metrics', 'notes'], required: ['featureName'], bumpVersionKeys: (t) => [`roi-version:tenant:${t}`] } },
];

export function createProductRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  router.route('/release-planning', createReleasePlanningAliasRoutes(db));
  mountTrackers(router, db, TRACKERS);
  return router;
}
