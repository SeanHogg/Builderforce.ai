/**
 * Insights ANALYSIS — `/api/replay/*` (PRD 33 §2.1, §8 S4c, `REPLAY_PATHS`).
 *
 *   GET    /segments?site                          ReplaySegmentDto[]
 *   POST   /segments?site  { name, filter }        ReplaySegmentDto (201)            MANAGER
 *   PATCH  /segments/:segmentId?site               ReplaySegmentDto                  MANAGER
 *   DELETE /segments/:segmentId?site               204                               MANAGER
 *   GET    /filter-options?site&days&field         ReplayFilterOptionsDto[]
 *   GET    /overview?site&days&f.*                 ReplayOverviewDto          (also a `replay:read` key)
 *   GET    /smart-events?site&days                 ReplaySmartEventDto[]
 *   POST   /smart-events?site  ReplaySmartEventInput  ReplaySmartEventDto (201)       MANAGER
 *   POST   /smart-events/preview?site&days         { count }
 *   DELETE /smart-events/:eventId?site             204                               MANAGER
 *   GET    /funnels?site                           ReplayFunnelDto[]
 *   POST   /funnels?site  ReplayFunnelInput        ReplayFunnelDto (201)             MANAGER
 *   GET    /funnels/:funnelId?site                 ReplayFunnelDto
 *   PUT    /funnels/:funnelId?site                 ReplayFunnelDto                   MANAGER
 *   DELETE /funnels/:funnelId?site                 204                               MANAGER
 *   GET    /funnels/:funnelId/evaluate?site&days&f.*  ReplayFunnelEvalDto      (also a `replay:read` key)
 *   GET    /flow?site&days&f.*                     ReplayFlowDto
 *   POST   /recordings/:recordingId/summary?site  { regenerate? }  ReplaySummaryDto   (429 { error: 'limit' })
 *   POST   /summary?site  { days?, filter? }       ReplaySegmentSummaryDto            (429 { error: 'limit' })
 *
 * Same guards as every Insights route (membership, the Insights gate, `?site=` must be
 * the caller's — `replayRouteScope.ts`), attached PER ROUTE because this router shares
 * the `/api/replay` prefix. Writes need MANAGER, like the site writes. The three reads
 * marked above also accept a `replay:read` tenant key (`replayReadAuth.ts`) — no
 * other route here does. A presentation adapter only: services, no tables.
 */
import { Hono, type Context } from 'hono';
import { filterFromQuery, parseReplayFilter, type ReplayFilter } from '@builderforce/interaction-contract';
import type { HonoEnv } from '../../env';
import { requestDb } from '../../application/shared/dbHandle';
import { TenantRole } from '../../domain/shared/types';
import { ValidationError } from '../../domain/shared/errors';
import { createSegment, deleteSegment, listSegments, updateSegment } from '../../application/replay/replaySegments';
import { filterOptions } from '../../application/replay/replayFilterOptions';
import { ReplayOverviewService } from '../../application/replay/ReplayOverviewService';
import { createSmartEvent, deleteSmartEvent, listSmartEvents, previewSmartEvent } from '../../application/replay/replaySmartEvents';
import { ReplayFunnelService } from '../../application/replay/ReplayFunnelService';
import { replayFlow } from '../../application/replay/replayFlow';
import { summarizeRecording, summarizeSegment } from '../../application/replay/replaySummaries';
import { ReplayAiLimitError } from '../../application/replay/replayAiBudget';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { replayReadKeyOrMember } from '../middleware/replayReadAuth';
import { insightsGate, optionalNumber, replayScopeOf } from './replayRouteScope';
import { parseBody, parseOptionalBody, z } from './requestBody';

const MATCH_MODE = z.enum(['equals', 'prefix', 'contains']);

const SegmentBody = z.object({ name: z.string(), filter: z.unknown() });
const SegmentPatchBody = z.object({ name: z.string().optional(), filter: z.unknown().optional() });
const SmartEventBody = z.object({
  name: z.string().optional(),
  ruleKind: z.enum(['page', 'click', 'custom']),
  match: z.string(),
  matchMode: MATCH_MODE,
});
const FunnelBody = z.object({
  name: z.string(),
  windowMinutes: z.number().optional(),
  steps: z.array(z.object({ stepKind: z.enum(['page', 'click', 'event']), match: z.string(), matchMode: MATCH_MODE })),
});
const RecordingSummaryBody = z.object({ regenerate: z.boolean().optional() });
const SegmentSummaryBody = z.object({ days: z.number().optional(), filter: z.unknown().optional() });

const manager = requireRole(TenantRole.MANAGER);
const userOf = (c: Context<HonoEnv>): string | null => (c.get('userId') as string | undefined) ?? null;
const daysOf = (c: Context<HonoEnv>) => optionalNumber(c.req.query('days'));
const queryFilter = (c: Context<HonoEnv>): ReplayFilter => filterFromQuery(new URL(c.req.url).searchParams);

function bodyFilter(raw: unknown): ReplayFilter | null {
  if (raw === undefined || raw === null) return null;
  const filter = parseReplayFilter(raw);
  if (!filter) throw new ValidationError('That filter is not valid');
  return filter;
}

/** The AI budget answer: 429 `{ error: 'limit' }` (`ReplayAiLimitErrorDto`). */
async function limited(c: Context<HonoEnv>, work: () => Promise<unknown>): Promise<Response> {
  try {
    return c.json(await work());
  } catch (error) {
    if (error instanceof ReplayAiLimitError) return c.json({ error: 'limit' as const }, 429);
    throw error;
  }
}

export function createReplayAnalysisRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const db = (c: Context<HonoEnv>) => requestDb(c);
  const funnels = (c: Context<HonoEnv>) => new ReplayFunnelService(c.env, requestDb(c));

  // ── Segments ──────────────────────────────────────────────────────────────
  router.get('/segments', authMiddleware, insightsGate, async (c) => c.json(await listSegments(c.env, db(c), await replayScopeOf(c))));

  router.post('/segments', authMiddleware, insightsGate, manager, async (c) => {
    const scope = await replayScopeOf(c);
    const body = await parseBody(c, SegmentBody);
    return c.json(await createSegment(c.env, db(c), scope, { name: body.name, filter: body.filter, userId: userOf(c) }), 201);
  });

  router.patch('/segments/:segmentId', authMiddleware, insightsGate, manager, async (c) => {
    const scope = await replayScopeOf(c);
    const body = await parseBody(c, SegmentPatchBody);
    return c.json(await updateSegment(c.env, db(c), scope, c.req.param('segmentId'), body));
  });

  router.delete('/segments/:segmentId', authMiddleware, insightsGate, manager, async (c) => {
    await deleteSegment(c.env, db(c), await replayScopeOf(c), c.req.param('segmentId'));
    return c.body(null, 204);
  });

  router.get('/filter-options', authMiddleware, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    return c.json(await filterOptions(c.env, db(c), scope, { days: daysOf(c), field: c.req.query('field') || null }));
  });

  // ── Overview (read API) ───────────────────────────────────────────────────
  router.get('/overview', replayReadKeyOrMember, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    return c.json(await new ReplayOverviewService(c.env, db(c)).overview(scope, { days: daysOf(c), filter: queryFilter(c) }));
  });

  // ── Smart events ──────────────────────────────────────────────────────────
  router.get('/smart-events', authMiddleware, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    return c.json(await listSmartEvents(c.env, db(c), scope, { days: daysOf(c) }));
  });

  router.post('/smart-events/preview', authMiddleware, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    const body = await parseBody(c, SmartEventBody);
    return c.json(await previewSmartEvent(c.env, db(c), scope, body, { days: daysOf(c) }));
  });

  router.post('/smart-events', authMiddleware, insightsGate, manager, async (c) => {
    const scope = await replayScopeOf(c);
    const body = await parseBody(c, SmartEventBody);
    return c.json(await createSmartEvent(c.env, db(c), scope, body, userOf(c)), 201);
  });

  router.delete('/smart-events/:eventId', authMiddleware, insightsGate, manager, async (c) => {
    await deleteSmartEvent(c.env, db(c), await replayScopeOf(c), c.req.param('eventId'));
    return c.body(null, 204);
  });

  // ── Funnels ───────────────────────────────────────────────────────────────
  router.get('/funnels', authMiddleware, insightsGate, async (c) => c.json(await funnels(c).list(await replayScopeOf(c))));

  router.post('/funnels', authMiddleware, insightsGate, manager, async (c) => {
    const scope = await replayScopeOf(c);
    const body = await parseBody(c, FunnelBody);
    return c.json(await funnels(c).create(scope, body, userOf(c)), 201);
  });

  router.get('/funnels/:funnelId/evaluate', replayReadKeyOrMember, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    return c.json(await funnels(c).evaluate(scope, c.req.param('funnelId'), { days: daysOf(c), filter: queryFilter(c) }));
  });

  router.get('/funnels/:funnelId', authMiddleware, insightsGate, async (c) => c.json(await funnels(c).get(await replayScopeOf(c), c.req.param('funnelId'))));

  router.put('/funnels/:funnelId', authMiddleware, insightsGate, manager, async (c) => {
    const scope = await replayScopeOf(c);
    const body = await parseBody(c, FunnelBody);
    return c.json(await funnels(c).update(scope, c.req.param('funnelId'), body));
  });

  router.delete('/funnels/:funnelId', authMiddleware, insightsGate, manager, async (c) => {
    await funnels(c).remove(await replayScopeOf(c), c.req.param('funnelId'));
    return c.body(null, 204);
  });

  // ── Flow ──────────────────────────────────────────────────────────────────
  router.get('/flow', authMiddleware, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    return c.json(await replayFlow(c.env, db(c), scope, { days: daysOf(c), filter: queryFilter(c) }));
  });

  // ── AI summaries (cited; the daily budget answers 429) ────────────────────
  router.post('/recordings/:recordingId/summary', authMiddleware, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    const body = await parseOptionalBody(c, RecordingSummaryBody);
    return limited(c, () => summarizeRecording(c.env, db(c), scope, c.req.param('recordingId'), {
      regenerate: body.regenerate === true,
      actorId: userOf(c),
    }));
  });

  router.post('/summary', authMiddleware, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    const body = await parseOptionalBody(c, SegmentSummaryBody);
    return limited(c, () => summarizeSegment(c.env, db(c), scope, {
      days: body.days,
      filter: bodyFilter(body.filter),
      actorId: userOf(c),
    }));
  });

  return router;
}
