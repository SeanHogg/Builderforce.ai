/**
 * Agile Survival — /api/agile/*
 *
 * Net-new Agile CRUD features (doc 03): sprints, velocity, capacity, cost, RICE
 * feature scoring. All segment-scoped CRUD → the shared tracker factory.
 * (Planning poker + retrospectives are realtime rooms, built separately.)
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { mountTrackers, type TrackerOpts } from './segmentTrackerRoutes';
import { createPokerRoutes, createRetroRoutes } from './pokerRetroRoutes';
import {
  sprints, teamVelocity, capacityPlanning, costCalculations, featureScores,
} from '../../infrastructure/database/schema';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const TRACKERS: Array<{ path: string; table: unknown; opts: TrackerOpts }> = [
  { path: '/sprints', table: sprints, opts: { fields: ['name', 'goal', 'startDate', 'endDate', 'capacity', 'status', 'runwayBudget', 'actualBurn', 'notes'], required: ['name'], emit: { field: 'status', value: 'completed', event: 'sprint.completed' } } },
  { path: '/velocity', table: teamVelocity, opts: { fields: ['period', 'teamId', 'periodStart', 'periodEnd', 'committedPoints', 'completedPoints', 'velocityScore', 'trend', 'notes'], required: ['period'] } },
  { path: '/capacity', table: capacityPlanning, opts: { fields: ['planningPeriod', 'teamId', 'totalCapacity', 'allocatedCapacity', 'availableCapacity', 'utilizationRate', 'teamSize', 'notes'], required: ['planningPeriod'] } },
  { path: '/cost', table: costCalculations, opts: { fields: ['label', 'calculationType', 'laborCost', 'overheadCost', 'toolingCost', 'infrastructureCost', 'totalCost', 'runwayImpactDays', 'notes'], required: ['label'] } },
  { path: '/feature-scoring', table: featureScores, opts: { fields: ['name', 'reach', 'impact', 'confidence', 'effort', 'score', 'status', 'notes'], required: ['name'] } },
];

export function createAgileRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  mountTrackers(router, db, TRACKERS);
  // Nested session models (not flat trackers).
  router.route('/poker', createPokerRoutes(db));
  router.route('/retros', createRetroRoutes(db));
  return router;
}
