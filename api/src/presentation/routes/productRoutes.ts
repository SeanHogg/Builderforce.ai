/**
 * Product Management — /api/product/*
 *
 * The net-new PM features (doc 02): MVP scenarios, validation results, roadmap,
 * releases, changelog, feature flags, business-value configs, feature ROI. Every
 * one is segment-scoped CRUD, so they all run through the shared tracker factory
 * — a table + a field whitelist each, no bespoke routers.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { mountTrackers, type TrackerOpts } from './segmentTrackerRoutes';
import {
  mvpScenarios, validationResults, roadmapItems, productReleases,
  changelogEntries, featureFlags, businessValueConfigs, featureRoi,
} from '../../infrastructure/database/schema';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const TRACKERS: Array<{ path: string; table: unknown; opts: TrackerOpts }> = [
  { path: '/mvp', table: mvpScenarios, opts: { fields: ['name', 'description', 'pricingModel', 'targetRevenue', 'timelineConstraint', 'budgetConstraint', 'teamSize', 'status', 'notes'], required: ['name'] } },
  { path: '/validation', table: validationResults, opts: { fields: ['hypothesis', 'validationType', 'method', 'result', 'metrics', 'learnings', 'nextSteps', 'notes'], required: ['hypothesis'] } },
  { path: '/roadmap', table: roadmapItems, opts: { fields: ['title', 'horizon', 'status', 'theme', 'targetDate', 'priority', 'notes'], required: ['title'], emit: { field: 'status', value: 'shipped', event: 'roadmap.published' } } },
  { path: '/release-planning', table: productReleases, opts: { fields: ['name', 'version', 'releaseDate', 'status', 'notes'], required: ['name'] } },
  { path: '/changelog', table: changelogEntries, opts: { fields: ['version', 'title', 'body', 'releasedAt', 'status'], required: ['version'] } },
  { path: '/feature-flags', table: featureFlags, opts: { fields: ['key', 'name', 'status', 'rolloutPercentage', 'description', 'notes'], required: ['key'] } },
  { path: '/business-value', table: businessValueConfigs, opts: { fields: ['name', 'valueType', 'displayMode', 'rewardMultiplier', 'isActive', 'notes'], required: ['name'] } },
  { path: '/feature-roi', table: featureRoi, opts: { fields: ['featureName', 'featureType', 'category', 'status', 'metrics', 'notes'], required: ['featureName'] } },
];

export function createProductRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  mountTrackers(router, db, TRACKERS);
  return router;
}
