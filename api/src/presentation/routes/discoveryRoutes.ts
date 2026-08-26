/**
 * Discovery tier — /api/discovery/*
 *
 * Customer interviews and research notes: the two artifacts a founder produces
 * during Read/Prove, before there is a company to run. Both are the generic
 * segment-tracker factory (`segmentTrackerRoutes.ts`) — same scoping,
 * whitelisting and manager-gated mutations every other simple tracker in the
 * product uses (PMO's portfolios/objectives, governance's compliance tools) —
 * plus `serverFieldsOnCreate` to stamp `createdBy` from the authenticated
 * request rather than trusting the body.
 */

import { Hono, type Context } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { mountTrackers } from './segmentTrackerRoutes';
import { customerInterviews, researchNotes } from '../../infrastructure/database/schema';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

export function createDiscoveryRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  const serverFieldsOnCreate = (c: Context<HonoEnv>) => ({ createdBy: c.get('userId') ?? null });

  mountTrackers(router, db, [
    {
      path: '/interviews',
      table: customerInterviews,
      opts: {
        fields: ['title', 'participantName', 'notes', 'projectId'],
        required: ['title'],
        cacheNs: 'discovery-interviews',
        serverFieldsOnCreate,
      },
    },
    {
      path: '/research-notes',
      table: researchNotes,
      opts: {
        fields: ['title', 'sourceUrl', 'body', 'projectId'],
        required: ['title'],
        cacheNs: 'discovery-research-notes',
        serverFieldsOnCreate,
      },
    },
  ]);

  return router;
}
