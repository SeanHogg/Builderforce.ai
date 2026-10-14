/**
 * Insights MP4 EXPORT — under `/api/replay` (PRD 33 §8 S4b).
 *
 * Members (membership + the Insights gate + `?site=` must be theirs, per route):
 *   POST /recordings/:recordingId/export?site     ReplayExportDto (202 while queued)
 *   GET  /exports/:exportId?site                  ReplayExportDto
 *   GET  /exports/:exportId/download?site         the video file
 *
 * The QA runner container (Bearer = the export's own capability token, minted by
 * `replayVideoExport.mintExportToken`; no member session):
 *   GET   /export-runner/:exportId/chunks/:seq    stored gzip chunk of that export's recording
 *   PATCH /export-runner/:exportId                { status: running|failed, error? }
 *   POST  /export-runner/:exportId/video          raw video/mp4 | video/webm body
 *
 * A presentation adapter only: application functions, no tables.
 */
import { Hono, type Context } from 'hono';
import type { HonoEnv } from '../../env';
import { requestDb } from '../../application/shared/dbHandle';
import {
  authorizeExportRunner,
  downloadExport,
  exportStatus,
  requestExport,
  runnerChunk,
  runnerReport,
  runnerUpload,
} from '../../application/replay/replayVideoExport';
import { ValidationError } from '../../domain/shared/errors';
import { authMiddleware } from '../middleware/authMiddleware';
import { parseBody, z } from './requestBody';
import { insightsGate, replayScopeOf } from './replayRouteScope';

const RunnerReportBody = z.object({
  status: z.enum(['running', 'failed']),
  error: z.string().max(400).nullish(),
});

const runnerRow = (c: Context<HonoEnv>) =>
  authorizeExportRunner(c.env, requestDb(c), c.req.header('Authorization'), c.req.param('exportId') ?? '');

export function createReplayExportRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.post('/recordings/:recordingId/export', authMiddleware, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    const userId = (c.get('userId') as string | undefined) ?? null;
    const dto = await requestExport(c.env, requestDb(c), scope, c.req.param('recordingId'), userId);
    return c.json(dto, dto.status === 'queued' || dto.status === 'running' ? 202 : 200);
  });

  router.get('/exports/:exportId', authMiddleware, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    return c.json(await exportStatus(c.env, requestDb(c), scope, c.req.param('exportId')));
  });

  router.get('/exports/:exportId/download', authMiddleware, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    const file = await downloadExport(c.env, requestDb(c), scope, c.req.param('exportId'));
    return c.body(file.body, 200, {
      'Content-Type': file.contentType,
      'Content-Length': String(file.size),
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Cache-Control': 'private, no-store',
    });
  });

  router.get('/export-runner/:exportId/chunks/:seq', async (c) => {
    const row = await runnerRow(c);
    const seq = Number(c.req.param('seq'));
    if (!Number.isInteger(seq) || seq < 0) throw new ValidationError('seq must be a non-negative integer');
    const bytes = await runnerChunk(c.env, requestDb(c), row, seq);
    return c.body(bytes, 200, { 'Content-Type': 'application/gzip', 'Cache-Control': 'no-store' });
  });

  router.patch('/export-runner/:exportId', async (c) => {
    const row = await runnerRow(c);
    const body = await parseBody(c, RunnerReportBody);
    return c.json(await runnerReport(requestDb(c), row, { status: body.status, error: body.error ?? null }));
  });

  router.post('/export-runner/:exportId/video', async (c) => {
    const row = await runnerRow(c);
    const declared = Number(c.req.header('content-length'));
    const body = c.req.raw.body;
    if (!body) throw new ValidationError('The export body is empty');
    return c.json(await runnerUpload(c.env, requestDb(c), row, {
      contentType: c.req.header('content-type'),
      length: Number.isFinite(declared) && declared > 0 ? declared : null,
      body,
    }));
  });

  return router;
}
