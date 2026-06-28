/**
 * Agile Survival — /api/agile/*
 *
 * Net-new Agile CRUD features (doc 03): sprints, velocity, capacity, cost, RICE
 * feature scoring. All segment-scoped CRUD → the shared tracker factory.
 * (Planning poker + retrospectives are realtime rooms, built separately.)
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { mountTrackers, scope, type TrackerOpts } from './segmentTrackerRoutes';
import { createPokerRoutes, createRetroRoutes } from './pokerRetroRoutes';
import { createCeremonyRoutes } from './ceremonyRoutes';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { computeVelocityInsights } from '../../application/insights/velocityInsights';
import {
  sprints, teamVelocity, capacityPlanning, costCalculations, featureScores,
} from '../../infrastructure/database/schema';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const TRACKERS: Array<{ path: string; table: unknown; opts: TrackerOpts }> = [
  { path: '/sprints', table: sprints, opts: { fields: ['name', 'goal', 'startDate', 'endDate', 'capacity', 'status', 'runwayBudget', 'actualBurn', 'notes'], required: ['name'], projectScoped: true, cacheNs: 'sprints', emit: { field: 'status', value: 'completed', event: 'sprint.completed' }, bumpVersionKeys: (t) => [`roi-version:tenant:${t}`] } },
  { path: '/velocity', table: teamVelocity, opts: { fields: ['period', 'teamId', 'periodStart', 'periodEnd', 'committedPoints', 'completedPoints', 'velocityScore', 'trend', 'notes'], required: ['period'] } },
  { path: '/capacity', table: capacityPlanning, opts: { fields: ['planningPeriod', 'teamId', 'totalCapacity', 'allocatedCapacity', 'availableCapacity', 'utilizationRate', 'teamSize', 'notes'], required: ['planningPeriod'] } },
  { path: '/cost', table: costCalculations, opts: { fields: ['label', 'calculationType', 'laborCost', 'overheadCost', 'toolingCost', 'infrastructureCost', 'totalCost', 'runwayImpactDays', 'notes'], required: ['label'], bumpVersionKeys: (t) => [`roi-version:tenant:${t}`] } },
  { path: '/feature-scoring', table: featureScores, opts: { fields: ['name', 'reach', 'impact', 'confidence', 'effort', 'score', 'status', 'notes'], required: ['name'], projectScoped: true, cacheNs: 'rice' } },
];

export function createAgileRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  mountTrackers(router, db, TRACKERS);

  // Derived velocity (EMP-4): committed vs completed STORY POINTS per sprint from
  // real task estimates + the rolling-average planning forecast. Short TTL (tasks
  // are hot-write). Read-only — the manual /velocity tracker stays for overrides.
  router.get('/velocity/derived', async (c) => {
    const { tenantId } = scope(c);
    const env = c.env as Env;
    return c.json(await getOrSetCached(
      env, `agile:velocity-derived:t:${tenantId}`,
      () => computeVelocityInsights(db, tenantId),
      { kvTtlSeconds: 60, l1TtlMs: 15_000 },
    ));
  });

  // Nested session models (not flat trackers).
  router.route('/poker', createPokerRoutes(db));
  router.route('/retros', createRetroRoutes(db));
  // Live standup/planning round-table room (WebSocket transport).
  router.route('/ceremonies', createCeremonyRoutes(db));
  return router;
}
