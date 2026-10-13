/**
 * Insights DATA — `/api/replay/*` (PRD 33 §3, `REPLAY_PATHS`, D17).
 *
 *   GET   /recordings?site&days&cursor&limit&f.*     ReplayPage<ReplayRecordingSummaryDto>  (also a `replay:read` key)
 *   GET   /recordings/:recordingId?site               ReplayRecordingDto (traces replay.session.viewed)
 *   GET   /recordings/:recordingId/chunks/:seq?site   stored gzip bytes (immutable)
 *   GET   /releases?site                              ReplayReleaseDto[]
 *   PATCH /releases/:releaseKey?site  { label }        ReplayReleaseDto (MANAGER; traces replay.release.renamed)
 *   GET   /kpis?site&days&release&f.*                 ReplayKpisDto (≈ `estimated` under a filter)
 *   GET   /issues?site&days&status&cursor&limit&f.*   ReplayPage<ReplayIssueDto> (≈ `estimated` under a filter)
 *   GET   /issues/:issueId?site&days                  ReplayIssueDetailDto
 *   GET   /live?site                                  ReplayLiveDto
 *   GET   /usage                                      ReplayUsageDto (the workspace's, no site)
 *   DELETE /visitors/:visitorId?site                  ReplayVisitorErasureDto (MANAGER; traces replay.visitor.erased)
 *
 * Every route: a workspace member (`authMiddleware`) of a workspace holding Insights
 * (`requireFeature('sessionReplay')`), and every `?site=` must be that workspace's —
 * a foreign or unknown site is the same 403. The guards are attached PER ROUTE so this
 * router, which shares the `/api/replay` prefix with the sites router, never wraps a
 * path it does not own. A presentation adapter only: services, no tables.
 */
import { Hono, type Context } from 'hono';
import { filterFromQuery, VISITOR_ID_PATTERN, type ReplayVisitorErasureDto } from '@builderforce/interaction-contract';
import type { HonoEnv } from '../../env';
import { TenantRole } from '../../domain/shared/types';
import { requestDb } from '../../application/shared/dbHandle';
import { deferPastResponse } from '../../application/shared/requestScope';
import { ValidationError } from '../../domain/shared/errors';
import { ReplayReadService } from '../../application/replay/ReplayReadService';
import { recordReplayTrace, REPLAY_TRACE_VERBS } from '../../application/replay/replayTrace';
import { usageSnapshot } from '../../application/replay/replayUsage';
import { eraseReplayVisitor } from '../../application/replay/replayVisitorEraser';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { replayReadKeyOrMember } from '../middleware/replayReadAuth';
import { requireTenantId } from '../middleware/tenantContext';
import { parseBody, z } from './requestBody';
import { insightsGate, optionalNumber, replayScopeOf as scopeOf } from './replayRouteScope';

const RenameReleaseBody = z.object({ label: z.string().max(200).nullable() });

/** Let the trace finish after the response; await it where the runtime cannot defer. */
async function afterResponse(task: Promise<unknown>): Promise<void> {
  if (!deferPastResponse(task)) await task;
}

export function createReplayRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const reads = (c: Context<HonoEnv>) => new ReplayReadService(c.env, requestDb(c));

  // The read API: a `replay:read` tenant key is accepted here (and only on the three
  // documented GETs — see `replayReadAuth.ts`), as well as a member session.
  router.get('/recordings', replayReadKeyOrMember, insightsGate, async (c) => {
    const scope = await scopeOf(c);
    return c.json(await reads(c).listRecordings(scope, {
      days: optionalNumber(c.req.query('days')),
      cursor: c.req.query('cursor') ?? null,
      limit: optionalNumber(c.req.query('limit')),
      filter: filterFromQuery(new URL(c.req.url).searchParams),
    }));
  });

  router.get('/recordings/:recordingId', authMiddleware, insightsGate, async (c) => {
    const scope = await scopeOf(c);
    const recordingId = c.req.param('recordingId');
    const recording = await reads(c).getRecording(scope, recordingId);
    await afterResponse(recordReplayTrace(c.env, requestDb(c), {
      tenantId: scope.tenantId,
      siteId: scope.siteId,
      verb: REPLAY_TRACE_VERBS.sessionViewed,
      actorId: (c.get('userId') as string | undefined) ?? null,
      metadata: { recordingId },
    }));
    return c.json(recording);
  });

  router.get('/recordings/:recordingId/chunks/:seq', authMiddleware, insightsGate, async (c) => {
    const scope = await scopeOf(c);
    const seq = Number(c.req.param('seq'));
    if (!Number.isInteger(seq) || seq < 0) throw new ValidationError('seq must be a non-negative integer');
    const bytes = await reads(c).chunk(scope, c.req.param('recordingId'), seq);
    return c.body(bytes, 200, {
      'Content-Type': 'application/gzip',
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
  });

  router.get('/releases', authMiddleware, insightsGate, async (c) => {
    return c.json(await reads(c).releases(await scopeOf(c)));
  });

  router.patch('/releases/:releaseKey', authMiddleware, insightsGate, requireRole(TenantRole.MANAGER), async (c) => {
    const scope = await scopeOf(c);
    const body = await parseBody(c, RenameReleaseBody);
    const releaseKey = c.req.param('releaseKey');
    const release = await reads(c).renameRelease(scope, releaseKey, body.label);
    await afterResponse(recordReplayTrace(c.env, requestDb(c), {
      tenantId: scope.tenantId,
      siteId: scope.siteId,
      verb: REPLAY_TRACE_VERBS.releaseRenamed,
      actorId: (c.get('userId') as string | undefined) ?? null,
      metadata: { releaseKey, label: release.label },
    }));
    return c.json(release);
  });

  router.get('/kpis', authMiddleware, insightsGate, async (c) => {
    const scope = await scopeOf(c);
    return c.json(await reads(c).kpis(scope, {
      days: optionalNumber(c.req.query('days')),
      release: c.req.query('release') || null,
      filter: filterFromQuery(new URL(c.req.url).searchParams),
    }));
  });

  router.get('/issues', authMiddleware, insightsGate, async (c) => {
    const scope = await scopeOf(c);
    return c.json(await reads(c).issues(scope, {
      days: optionalNumber(c.req.query('days')),
      status: c.req.query('status') || null,
      cursor: c.req.query('cursor') ?? null,
      limit: optionalNumber(c.req.query('limit')),
      filter: filterFromQuery(new URL(c.req.url).searchParams),
    }));
  });

  router.get('/issues/:issueId', authMiddleware, insightsGate, async (c) => {
    const scope = await scopeOf(c);
    return c.json(await reads(c).issue(scope, c.req.param('issueId'), { days: optionalNumber(c.req.query('days')) }));
  });

  router.get('/live', authMiddleware, insightsGate, async (c) => {
    return c.json(await reads(c).live(await scopeOf(c)));
  });

  router.get('/usage', authMiddleware, insightsGate, async (c) => {
    return c.json(await usageSnapshot(c.env, requestDb(c), requireTenantId(c)));
  });

  // A privacy request a customer actions itself: this site's recordings of the visitor, nothing else (D17).
  router.delete('/visitors/:visitorId', authMiddleware, insightsGate, requireRole(TenantRole.MANAGER), async (c) => {
    const scope = await scopeOf(c);
    const visitorId = c.req.param('visitorId');
    if (!VISITOR_ID_PATTERN.test(visitorId)) throw new ValidationError('visitorId is not a visitor id');
    const erased = await eraseReplayVisitor(c.env, requestDb(c), visitorId, scope);
    await recordReplayTrace(c.env, requestDb(c), {
      tenantId: scope.tenantId,
      siteId: scope.siteId,
      verb: REPLAY_TRACE_VERBS.visitorErased,
      actorId: (c.get('userId') as string | undefined) ?? null,
      metadata: { visitorId, erased },
    });
    const body: ReplayVisitorErasureDto = { visitorId, erased };
    return c.json(body);
  });

  return router;
}
