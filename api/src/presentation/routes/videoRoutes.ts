/**
 * Video generation — `/llm/v1/videos/*`.
 *
 *   POST /generations   start a clip from a prompt (and optional first frame)  → 202 { id, status }
 *   POST /renders       render a canvas video timeline to MP4 on the server    → 202 { id, status }  (paid plans)
 *   GET  /jobs/:id      a job's status and, once finished, its stored result
 *
 * Both kinds are JOBS: a clip takes from 30 seconds to minutes, so the route
 * only validates, gates and hands the job to its Durable Object
 * (`infrastructure/relay/MediaJobDO.ts`), which advances it on its own alarm.
 * Clients poll `/jobs/:id`. Kept out of `llmRoutes.ts` (which is already the
 * size of three modules) — it borrows only that file's auth resolution.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { HonoEnv } from '../../env';
import { parseBody, z } from './requestBody';
import { requireTenantAccess, respondToAccessError, type TenantAccess } from './llmRoutes';
import { enforceMediaCreditCap, freePlanUpgradeHint, type MediaCreditPolicy } from './mediaCreditGate';
import { VIDEO_PRODUCT_NAMES, VIDEO_SECOND_TOKEN_COST, mediaProductForPlan } from '../../application/llm/mediaProducts';
import { resolveVideoSecondsDailyLimit } from '../../domain/tenant/PlanLimits';
import { toTenantPlan } from '../../application/tenant/featureEntitlements';
import { maxVideoSecondsFor, videoChainConfigured, videoModelChainForPlan } from '../../application/llm/videoVendors/registry';
import { mediaJobView, newClipJob, newRenderJob, type MediaJobState } from '../../application/llm/video/mediaJob';
import { buildMovieRenderRequest } from '../../application/llm/video/movieRenderRequest';
import { buildClipRequest } from '../../application/llm/video/clipRequest';

const VideoGenerationBody = z.looseObject({
  prompt: z.string().trim().min(1).max(2_000),
  duration: z.number().positive().max(15).optional(),
  aspect_ratio: z.string().optional(),
  image_url: z.string().optional(),
  model: z.string().optional(),
  seed: z.number().int().optional(),
  useCase: z.string().max(64).optional(),
});

const VideoRenderBody = z.object({
  timeline: z.unknown(),
  sources: z.unknown(),
  useCase: z.string().max(64).optional(),
});

const VIDEO_CREDIT_POLICY: MediaCreditPolicy = {
  products: VIDEO_PRODUCT_NAMES,
  unitTokens: VIDEO_SECOND_TOKEN_COST,
  code: 'video_credit_limit_exceeded',
  dailyLimit: (access) => resolveVideoSecondsDailyLimit(toTenantPlan(access.effectivePlan)),
  message: (limit, access) => `Daily video generation limit reached (${limit} second${limit === 1 ? '' : 's'} of video / day).${freePlanUpgradeHint(access, 'video')}`,
};

/** Paid plans (or a premium override) get the quality chain and server render. */
function isPaidAccess(access: TenantAccess): boolean {
  return access.premiumOverride || access.effectivePlan !== 'free';
}

async function startJob(c: Context<HonoEnv>, job: MediaJobState): Promise<Response> {
  const ns = c.env.MEDIA_JOB;
  if (!ns) return c.json({ error: 'Video generation is not configured on this deployment' }, 503);
  const stub = ns.get(ns.idFromName(`media-job:${job.id}`));
  const res = await stub.fetch('https://media-job/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job, publicOrigin: new URL(c.req.url).origin }),
  });
  if (!res.ok) return c.json({ error: 'The video job could not be started' }, 502);
  return c.json(mediaJobView(job), 202);
}

export function createVideoRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.post('/generations', async (c) => {
    let access: TenantAccess;
    try { access = await requireTenantAccess(c); } catch (err) { return respondToAccessError(c, err); }
    const body = await parseBody(c, VideoGenerationBody);

    const paid = isPaidAccess(access);
    const planChain = videoModelChainForPlan(paid);
    // A caller-named model is a HINT, honoured only when it is already in the
    // plan's chain — naming Veo does not lift a free plan onto Veo.
    const chain = body.model && planChain.includes(body.model)
      ? [body.model, ...planChain.filter((m) => m !== body.model)]
      : planChain;
    if (!videoChainConfigured(c.env, chain)) {
      return c.json({ error: 'Video generation is not configured: bind POLLINATIONS_API_KEY (or GOOGLE_API_KEY for paid plans).' }, 503);
    }

    const built = buildClipRequest({
      prompt: body.prompt,
      duration: body.duration,
      aspectRatio: body.aspect_ratio,
      imageUrl: body.image_url,
      seed: body.seed,
    });
    if (!built.ok) return c.json({ error: built.error }, 400);
    const request = built.request;

    // Reserve the longest clip any model in the chain could bill, so a cascade
    // that lands on a longer-clip model cannot overshoot the day's allowance.
    const blocked = await enforceMediaCreditCap(c, access, VIDEO_CREDIT_POLICY, maxVideoSecondsFor(chain, request.durationSeconds));
    if (blocked) return blocked;

    return startJob(c, newClipJob({
      id: crypto.randomUUID(),
      tenantId: access.tenantId,
      userId: access.userId,
      product: mediaProductForPlan(VIDEO_PRODUCT_NAMES, paid),
      useCase: body.useCase ?? null,
      request,
      chain,
      now: Date.now(),
    }));
  });

  router.post('/renders', async (c) => {
    let access: TenantAccess;
    try { access = await requireTenantAccess(c); } catch (err) { return respondToAccessError(c, err); }
    if (!isPaidAccess(access)) {
      return c.json({
        error: 'Rendering on the server is part of paid plans. Export in the browser instead, or upgrade at builderforce.ai/pricing.',
        code: 'server_render_requires_paid_plan',
      }, 403);
    }
    if (!c.env.MEDIA_RENDER_CONTAINER) return c.json({ error: 'Server rendering is not configured on this deployment' }, 503);
    const body = await parseBody(c, VideoRenderBody);
    const built = buildMovieRenderRequest({
      timeline: body.timeline,
      sources: body.sources,
      tenantId: access.tenantId,
      publicOrigin: new URL(c.req.url).origin,
    });
    if (!built.ok) return c.json({ error: built.error }, 400);
    return startJob(c, newRenderJob({
      id: crypto.randomUUID(),
      tenantId: access.tenantId,
      userId: access.userId,
      useCase: body.useCase ?? null,
      request: built.request,
      now: Date.now(),
    }));
  });

  router.get('/jobs/:id', async (c) => {
    let access: TenantAccess;
    try { access = await requireTenantAccess(c); } catch (err) { return respondToAccessError(c, err); }
    const ns = c.env.MEDIA_JOB;
    if (!ns) return c.json({ error: 'Video generation is not configured on this deployment' }, 503);
    const id = c.req.param('id');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: 'Not found' }, 404);
    const res = await ns.get(ns.idFromName(`media-job:${id}`)).fetch('https://media-job/status');
    if (!res.ok) return c.json({ error: 'Not found' }, 404);
    const job = (await res.json()) as MediaJobState;
    // Another tenant's job is indistinguishable from no job.
    if (job.tenantId !== access.tenantId) return c.json({ error: 'Not found' }, 404);
    return c.json(mediaJobView(job));
  });

  return router;
}
