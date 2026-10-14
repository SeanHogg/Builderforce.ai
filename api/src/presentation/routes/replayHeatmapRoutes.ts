/**
 * Insights HEATMAPS — `/api/replay/heatmap/*` (PRD 33 §8 S4, `REPLAY_PATHS.heat*`).
 *
 *   GET /heatmap/grid?site&route&release&device&kind&days          ReplayHeatGridDto
 *   GET /heatmap/elements?site&route&release&compare&device&days   ReplayElementRowDto[]
 *   GET /heatmap/scroll?site&route&release&device&days             ReplayScrollDepthDto
 *   GET /heatmap/routes?site&days                                  ReplayRouteStatDto[]
 *   GET /heatmap/insights?site&route&release&compare&device&days   ReplayHeatInsightDto[]
 *   GET /heatmap/snapshot?site&route&release&device&days           ReplayHeatSnapshotDto
 *
 * Same guards as every Insights read (membership, the Insights gate, `?site=` must be
 * the caller's — `replayRouteScope.ts`), attached per route. A presentation adapter
 * only: it builds `ReplayHeatmapService` and touches no table.
 */
import { Hono, type Context } from 'hono';
import type { HonoEnv } from '../../env';
import { requestDb } from '../../application/shared/dbHandle';
import { ReplayHeatmapService } from '../../application/replay/ReplayHeatmapService';
import type { RawHeatQuery } from '../../application/replay/replayHeatReads';
import { authMiddleware } from '../middleware/authMiddleware';
import { insightsGate, optionalNumber, replayScopeOf } from './replayRouteScope';

/** The shared heatmap query parameters, raw — the service validates them. */
function heatQuery(c: Context<HonoEnv>): RawHeatQuery {
  return {
    route: c.req.query('route') ?? null,
    release: c.req.query('release') ?? null,
    compare: c.req.query('compare') ?? null,
    device: c.req.query('device') ?? null,
    kind: c.req.query('kind') ?? null,
    days: optionalNumber(c.req.query('days')),
  };
}

export function createReplayHeatmapRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const heat = (c: Context<HonoEnv>) => new ReplayHeatmapService(c.env, requestDb(c));

  router.get('/heatmap/grid', authMiddleware, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    return c.json(await heat(c).grid(scope, heatQuery(c)));
  });

  router.get('/heatmap/elements', authMiddleware, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    return c.json(await heat(c).elements(scope, heatQuery(c)));
  });

  router.get('/heatmap/scroll', authMiddleware, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    return c.json(await heat(c).scrollDepth(scope, heatQuery(c)));
  });

  router.get('/heatmap/routes', authMiddleware, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    return c.json(await heat(c).routes(scope, optionalNumber(c.req.query('days'))));
  });

  router.get('/heatmap/insights', authMiddleware, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    return c.json(await heat(c).insights(scope, heatQuery(c)));
  });

  router.get('/heatmap/snapshot', authMiddleware, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    return c.json(await heat(c).snapshot(scope, heatQuery(c)));
  });

  return router;
}
