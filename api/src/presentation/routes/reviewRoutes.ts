/**
 * Employers and reviews — /api/employers
 *
 * ── WHO MAY DO WHAT, AND WHY ─────────────────────────────────────────────────
 * Reading the directory and the published reviews is what the feature IS, so any
 * member may. Writing a review is any member too — the whole point is that the
 * people who worked somewhere get to say so. MODERATING is manager+, because
 * approving a claim about a named third party is the decision that carries legal
 * weight, and `check:rbac` treats it as one.
 *
 * ── THE MODERATION POLICY IS SET HERE, ONCE ──────────────────────────────────
 * `moderated: true` on every employer review, per the operator decision of
 * 2026-08-22 (pending until approved). It is passed explicitly rather than
 * inferred inside `submitReview`, because that function serves every reviewable
 * subject and most of them are not claims about somebody who never consented.
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import {
  getEmployer, listEmployers, markAsEmployer,
} from '../../application/companies/companyDirectory';
import {
  listPublishedReviews, myReview, ratingSummary, submitReview, withdrawReview,
} from '../../application/reviews/objectReviews';
import {
  decideReview, pendingReviewCount, pendingReviews,
} from '../../application/reviews/reviewModeration';
import { axesFor, keepKnownAxes } from '../../application/reviews/reviewAxes';
import { COMPANY_OBJECT_KIND } from '../../application/companies/companyDirectory';
import { resolveHumanActor } from '../../application/activity/activityLog';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

/** Employer reviews publish user-authored claims about a NAMED organisation that
 *  never agreed to be described. They are held until a human approves them. */
const EMPLOYER_REVIEWS_ARE_MODERATED = true;

interface ReviewBody {
  rating?: number;
  title?: string;
  body?: string;
  subRatings?: Record<string, number>;
  metadata?: Record<string, string>;
}

export function createReviewRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // ── The directory ───────────────────────────────────────────────────────
  router.get('/', async (c) => {
    return c.json({
      rows: await listEmployers(db, c.env as Env, {
        tenantId: c.get('tenantId') as number,
        q: c.req.query('q'),
        limit: Number(c.req.query('limit') ?? 50),
      }),
    });
  });

  /** Put a company in the directory. Manager+: it decides which of this
   *  workspace's companies are presented as employers people may review. */
  router.post('/:id/employer-role', requireRole(TenantRole.MANAGER), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid company id' }, 400);
    const tenantId = c.get('tenantId') as number;

    const employer = await getEmployer(db, c.env as Env, tenantId, id);
    if (!employer) return c.json({ error: 'not_found' }, 404);

    await markAsEmployer(db, tenantId, id);
    return c.json({ ok: true, employer });
  });

  // ── Moderation ──────────────────────────────────────────────────────────
  //
  // Registered BEFORE `/:id`, and that ordering is load-bearing: Hono matches in
  // registration order, so a `/:id` declared first swallows `/moderation/queue`,
  // parses "moderation" as a company id and answers 400. The queue would have
  // been unreachable while every individual route looked correct.
  router.get('/moderation/queue', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const [rows, waiting] = await Promise.all([
      pendingReviews(db, tenantId, Number(c.req.query('limit') ?? 50)),
      pendingReviewCount(db, tenantId),
    ]);
    return c.json({ rows, waiting });
  });

  router.post('/moderation/:reviewId', requireRole(TenantRole.MANAGER), async (c) => {
    const reviewId = Number(c.req.param('reviewId'));
    if (!Number.isInteger(reviewId)) return c.json({ error: 'invalid review id' }, 400);

    const body = await c.req.json<{ decision?: string; reason?: string }>()
      .catch((): { decision?: string; reason?: string } => ({}));
    if (body.decision !== 'published' && body.decision !== 'rejected') {
      return c.json({ error: "decision must be 'published' or 'rejected'" }, 400);
    }

    const applied = await decideReview(db, c.env as Env, {
      tenantId: c.get('tenantId') as number,
      reviewId,
      decision: body.decision,
      reason: body.reason ?? null,
      moderatorRef: (c.get('userId') as string | undefined) ?? 'unknown',
    });
    return applied ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  });


  // ── One employer, and what was said about it ────────────────────────────
  router.get('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid company id' }, 400);
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;

    const employer = await getEmployer(db, c.env as Env, tenantId, id);
    if (!employer) return c.json({ error: 'not_found' }, 404);

    const [reviews, summary, mine] = await Promise.all([
      listPublishedReviews(db, tenantId, employer.objectId),
      ratingSummary(db, tenantId, employer.objectId),
      // The author's OWN review comes back whatever its state, so somebody whose
      // review is pending sees that rather than an empty form inviting them to
      // write it again.
      userId ? myReview(db, tenantId, employer.objectId, userId) : Promise.resolve(null),
    ]);

    // The axes come from the SERVER's registry, so the form renders exactly what
    // the submit path will accept — a second list in the browser is how a form
    // collects an axis the server then silently drops.
    return c.json({ employer, reviews, summary, mine, axes: axesFor(COMPANY_OBJECT_KIND) });
  });

  // ── Writing one ─────────────────────────────────────────────────────────
  router.post('/:id/reviews', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid company id' }, 400);
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    if (!userId) return c.json({ error: 'a signed-in user is required' }, 401);

    const body = await c.req.json<ReviewBody>().catch((): ReviewBody => ({}));
    if (typeof body.rating !== 'number') return c.json({ error: 'rating is required' }, 400);
    if (!body.title?.trim()) return c.json({ error: 'title is required' }, 400);

    const employer = await getEmployer(db, c.env as Env, tenantId, id);
    if (!employer) return c.json({ error: 'not_found' }, 404);

    const result = await submitReview(db, c.env as Env, {
      tenantId,
      objectId: employer.objectId,
      authorRef: userId,
      // Resolved through the platform's ONE actor-naming path (cached per
      // tenant+user), not from a context key — the JWT carries no display name and
      // a second way to name a person is a second way to name them differently.
      authorName: (await resolveHumanActor(c.env as Env, db, tenantId, userId)).name,
      rating: body.rating,
      title: body.title,
      body: body.body ?? null,
      // Unknown axis keys are dropped: `anchor` is jsonb, and without this a
      // client could write arbitrary keys that later forms would render.
      subRatings: keepKnownAxes(COMPANY_OBJECT_KIND, body.subRatings),
      metadata: body.metadata,
      // NOT taken from the request: a client that can set its own verification
      // badge is a client that can award itself one. Nothing verifies employment
      // yet, so nothing is claimed.
      verifiedAs: null,
      moderated: EMPLOYER_REVIEWS_ARE_MODERATED,
    });

    if (!result.ok) return c.json({ error: result.reason, ...result }, 400);
    return c.json(result);
  });

  router.delete('/:id/reviews/mine', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid company id' }, 400);
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    if (!userId) return c.json({ error: 'a signed-in user is required' }, 401);

    const employer = await getEmployer(db, c.env as Env, tenantId, id);
    if (!employer) return c.json({ error: 'not_found' }, 404);

    const removed = await withdrawReview(db, c.env as Env, tenantId, employer.objectId, userId);
    return removed ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  });

  return router;
}
