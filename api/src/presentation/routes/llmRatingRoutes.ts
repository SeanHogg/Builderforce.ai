/**
 * LLM rating routes — /api/llm/ratings
 *
 * ONE surface-agnostic capture endpoint for "was this good?". The Brain panel, the
 * Creation Canvas dock and the VS Code webview all mount the same shared transcript
 * and therefore the same thumbs; they post here with the id of whatever THEY are
 * showing (`subjectRef`) plus the model that served it. Nothing about a brain chat,
 * a canvas session or an execution is baked in, which is why there is one route
 * rather than one per surface.
 *
 *   POST /api/llm/ratings           Record (or clear) this user's thumb
 *   GET  /api/llm/ratings/summary   This tenant's own rollup (manager surface)
 *
 * The platform-wide rollup lives in adminRoutes (`/api/admin/llm-ratings`) because
 * it crosses tenants and is superadmin-only.
 */
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import {
  recordActionRating,
  summarizeActionRatings,
  normalizeRatingValue,
  RATING_SUMMARY_DAYS_DEFAULT,
  type ActionRatingInput,
} from '../../application/llm/actionRatings';
import { resolveTenantPlan } from './llmRoutes';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';

export function createLlmRatingRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.post('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = (c.get('userId') as string | undefined) ?? '';
    if (!userId) return c.json({ error: 'Sign in to rate a response' }, 401);

    const body = await c.req.json<Partial<ActionRatingInput>>().catch((): Partial<ActionRatingInput> => ({}));
    if (!body.subjectRef) return c.json({ error: 'subjectRef is required' }, 400);

    // The plan is stamped on the row so the rollup can separate "the free pool was
    // rated badly" from "a frontier model was rated badly" — very different findings.
    const plan = await resolveTenantPlan(c.env as Env, tenantId)
      .then((p) => p.effectivePlan)
      .catch(() => 'free' as const);

    const result = await recordActionRating(c.env as Env, db, { tenantId, userId, plan }, {
      ...body,
      subjectRef: body.subjectRef,
      resolvedModel: body.resolvedModel ?? '',
      rating: normalizeRatingValue(body.rating),
    });
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json({ ok: true, rating: result.rating });
  });

  router.get('/summary', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const days = Number(c.req.query('days')) || RATING_SUMMARY_DAYS_DEFAULT;
    return c.json(await summarizeActionRatings(c.env as Env, db, { tenantId, days }));
  });

  return router;
}
