/**
 * Insights PAGE REVIEW — `/api/replay/*` (PRD 33 §5.2, §8 S4f, `REPLAY_PATHS`).
 *
 * Members (membership + the Insights gate + `?site=` must be theirs, per route):
 *   GET  /pages?site                                   ReplayPageListDto
 *   GET  /pages/review?site&path                       ReplayPageReviewDto
 *   POST /pages/capture?site                           ReplayPageCaptureResultDto   MANAGER, once an hour (429)
 *   GET  /pages/captures/:captureId/:asset?site[&prescription]   screenshot | fold | rects | after-desktop | after-phone
 *   GET  /pages/prompt?site&path&audience              ReplayImprovementPromptDto (every accepted fix on the page)
 *   GET  /prescriptions/:prescriptionId/prompt?site&audience     ReplayImprovementPromptDto
 *   GET  /releases/:releaseKey/preview?site            ReplayPreviewUrlDto (a hosted release, before it is published)
 *   GET  /sequences?site                               ReplaySequenceChoiceDto[]
 *   GET  /coding-agents?site                           ReplayCodingAgentChoiceDto[]
 *
 * The QA runner (Bearer = the job's own capability token, `pageRunnerTokens.ts`; no member session):
 *   POST /page-runner/capture/assets/:asset            screenshot | fold (image/jpeg) | rects (application/json)
 *   POST /page-runner/capture                          { seo, content, labPerf, a11y } → the one capture row
 *   POST /page-runner/render/:prescriptionId/assets/:device      image/jpeg
 *   POST /page-runner/render/:prescriptionId           { devices: [...] }
 *
 * A presentation adapter only: application functions, no tables.
 */
import { Hono, type Context } from 'hono';
import type { HonoEnv } from '../../env';
import { requestDb } from '../../application/shared/dbHandle';
import { deferPastResponse } from '../../application/shared/requestScope';
import { TenantRole } from '../../domain/shared/types';
import { ValidationError } from '../../domain/shared/errors';
import { captureNow, recordCapture } from '../../application/replay/pageCapture';
import { CAPTURE_ASSETS, captureAssetKey, isCaptureAsset, isCaptureDevice, putObject } from '../../application/replay/pageCaptureStore';
import { captureAsset, listPages, pageReview } from '../../application/replay/pageReviewReads';
import { pagePrompt, parseAudience, prescriptionPrompt } from '../../application/replay/pagePrompts';
import { recordRender, storeRenderAsset } from '../../application/replay/pageRender';
import { verifyCaptureToken, verifyRenderToken } from '../../application/replay/pageRunnerTokens';
import { previewUrlFor } from '../../application/replay/releasePreview';
import { listCodingAgentChoices, listSequenceChoices } from '../../application/replay/prescriptionChoices';
import { reviewPage } from '../../application/replay/visionReview';
import { getSite } from '../../application/replay/replaySites';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { insightsGate, replayScopeOf } from './replayRouteScope';
import { parseBody, parseOptionalBody, z } from './requestBody';

const facts = z.record(z.string(), z.unknown()).nullable().optional();
const CaptureBody = z.object({ seo: facts, content: facts, labPerf: facts, a11y: facts });
const CaptureNowBody = z.object({ path: z.string().max(400).nullish() });
const RenderBody = z.object({ devices: z.array(z.enum(['desktop', 'phone'])).max(2) });

const manager = requireRole(TenantRole.MANAGER);
const db = (c: Context<HonoEnv>) => requestDb(c);
const asFacts = <T>(raw: Record<string, unknown> | null | undefined): T | null => (raw ? (raw as T) : null);

export function createReplayPageRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/pages', authMiddleware, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    return c.json(await listPages(c.env, db(c), scope));
  });

  router.get('/pages/review', authMiddleware, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    return c.json(await pageReview(c.env, db(c), scope, c.req.query('path') ?? ''));
  });

  router.post('/pages/capture', authMiddleware, insightsGate, manager, async (c) => {
    const scope = await replayScopeOf(c);
    const body = await parseOptionalBody(c, CaptureNowBody);
    const result = await captureNow(c.env, db(c), scope, { path: body.path ?? null });
    return c.json(result, result.status === 'queued' ? 202 : 200);
  });

  router.get('/pages/captures/:captureId/:asset', authMiddleware, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    const file = await captureAsset(c.env, db(c), scope, c.req.param('captureId'), c.req.param('asset'), c.req.query('prescription') ?? null);
    return c.body(file.body, 200, {
      'Content-Type': file.contentType,
      'Content-Length': String(file.size),
      'Cache-Control': 'private, max-age=3600',
    });
  });

  router.get('/pages/prompt', authMiddleware, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    return c.json(await pagePrompt(c.env, db(c), scope, c.req.query('path') ?? '', parseAudience(c.req.query('audience'))));
  });

  router.get('/prescriptions/:prescriptionId/prompt', authMiddleware, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    return c.json(await prescriptionPrompt(c.env, db(c), scope, c.req.param('prescriptionId'), parseAudience(c.req.query('audience'))));
  });

  router.get('/releases/:releaseKey/preview', authMiddleware, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    return c.json(await previewUrlFor(c.env, db(c), scope, c.req.param('releaseKey')));
  });

  router.get('/sequences', authMiddleware, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    return c.json(await listSequenceChoices(c.env, db(c), scope));
  });

  router.get('/coding-agents', authMiddleware, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    return c.json(await listCodingAgentChoices(c.env, db(c), scope));
  });

  // ── Runner callbacks ──────────────────────────────────────────────────────

  router.post('/page-runner/capture/assets/:asset', async (c) => {
    const claims = await verifyCaptureToken(c.env, c.req.header('Authorization'));
    const asset = c.req.param('asset');
    if (!isCaptureAsset(asset)) return c.json({ error: 'Unknown asset' }, 404);
    const limits = CAPTURE_ASSETS[asset];
    await putObject(c.env, captureAssetKey({ tenantId: claims.xt, siteId: claims.sid, releaseKey: claims.rk, path: claims.p, device: claims.dc }, asset), {
      contentType: c.req.header('content-type'),
      body: await c.req.arrayBuffer(),
      expected: limits.contentType,
      maxBytes: limits.maxBytes,
    });
    return c.json({ ok: true });
  });

  router.post('/page-runner/capture', async (c) => {
    const claims = await verifyCaptureToken(c.env, c.req.header('Authorization'));
    const body = await parseBody(c, CaptureBody);
    const { capture, reviewReady } = await recordCapture(c.env, db(c), claims, {
      seo: asFacts(body.seo),
      content: asFacts(body.content),
      labPerf: asFacts(body.labPerf),
      a11y: asFacts(body.a11y),
    });
    if (reviewReady) {
      // Both devices are in: the ONE vision request for this page and release, past the response.
      const site = await getSite(c.env, db(c), claims.sid);
      if (site) {
        const review = reviewPage(c.env, db(c), site, claims.p);
        if (!deferPastResponse(review)) await review;
      }
    }
    return c.json({ ok: true, captureId: capture.id });
  });

  router.post('/page-runner/render/:prescriptionId/assets/:device', async (c) => {
    const id = c.req.param('prescriptionId');
    const claims = await verifyRenderToken(c.env, c.req.header('Authorization'), id);
    const device = c.req.param('device');
    if (!isCaptureDevice(device)) throw new ValidationError('device must be desktop or phone');
    await storeRenderAsset(c.env, db(c), claims, device, { contentType: c.req.header('content-type'), body: await c.req.arrayBuffer() });
    return c.json({ ok: true });
  });

  router.post('/page-runner/render/:prescriptionId', async (c) => {
    const id = c.req.param('prescriptionId');
    const claims = await verifyRenderToken(c.env, c.req.header('Authorization'), id);
    const body = await parseBody(c, RenderBody);
    return c.json(await recordRender(c.env, db(c), claims, body.devices));
  });

  return router;
}
