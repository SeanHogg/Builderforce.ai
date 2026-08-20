/**
 * Model-assisted résumé work — /api/career-ai/*
 *
 *   POST /rewrite-bullets      → the XYZ rewrite, verified against the document
 *   POST /merge-bullets        → near-duplicate bullets merged across résumés
 *   POST /grade                → the measured score AND the model's, with named gaps
 *   GET  /reviews              → the review queue for this workspace
 *   POST /reviews              → ask for feedback on a résumé
 *   GET  /reviews/:id          → one request: the frozen document and the thread
 *   POST /reviews/:id          → answer it (and optionally move its status)
 *   POST /reviews/:id/status   → claim / close without saying anything
 *   POST /reviews/:id/ai       → ask the model into the thread
 *   POST /reviews/:id/read     → move this reader's cursor
 *
 * ── WHAT THIS ROUTE IS FOR ───────────────────────────────────────────────────────
 * The deterministic résumé tools have been in this repo, and in the MCP catalog, for
 * some time: `scoreResume`, `optimizeResume`, `consolidateResumes`, `compareResumeToJob`.
 * They measure, and they deliberately write nothing — `resumeAnalysis.ts` argues that
 * case at length, and it is the right call for a tool whose caller is itself a model.
 *
 * It is the wrong call for a PERSON with a browser. Somebody who is out of work and has
 * been handed "12 bullets carry no number" needs the next sentence written, and there was
 * no route in this product that would write it. These four capabilities are that next
 * sentence, and every one of them is grounded on the measurement rather than replacing
 * it — see `application/career/resumeAi.ts` for the ordering and why it is fixed.
 *
 * ── NO PROSE IS TRUSTED ON ITS WAY BACK ──────────────────────────────────────────
 * Every generative response passes the invented-number guard in
 * `application/career/resumeAiPrompts.ts` before it reaches this layer. A rewrite that
 * asserts a metric the résumé does not contain is discarded and its original stands. The
 * route never sees the difference; it only ever forwards a verified answer.
 *
 * Not cached HERE: the model replies are content-addressed and cached one layer down, in
 * the service, keyed on a hash of the exact inputs plus the tenant. The review queue is a
 * per-reader read with unread counts, which is not a cacheable shape.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { ResumeAiService } from '../../application/career/resumeAi';
import {
  ResumeReviewService, RESUME_REVIEW_STATUSES, isResumeReviewStatus,
} from '../../application/career/resumeReview';

/** Below this a "résumé" is a sentence, and every reading of it would be noise. */
const MIN_RESUME_CHARS = 40;

/**
 * Read a JSON body, treating an absent or malformed one as an empty object.
 *
 * Kept as one helper rather than a `.catch(() => ({}))` per handler because that inline
 * form widens the parsed type to a union with `{}`, and the fix people reach for when it
 * does is `any` — which turns every field read below into an unchecked one.
 */
async function readJson<T>(c: { req: { json: <B>() => Promise<B> } }): Promise<Partial<T>> {
  return c.req.json<Partial<T>>().catch(() => ({} as Partial<T>));
}

export function createCareerAiRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  const ai = (c: { env: unknown }) => new ResumeAiService(c.env as Env);
  const reviews = (c: { env: unknown }) => new ResumeReviewService(db, c.env as Env);

  // ── The three generative capabilities ────────────────────────────────────

  router.post('/rewrite-bullets', async (c) => {
    const body = await readJson<{ resumeText?: string; limit?: number }>(c);
    const resumeText = String(body.resumeText ?? '').trim();
    if (resumeText.length < MIN_RESUME_CHARS) return c.json({ error: 'Paste the résumé text first — there is nothing here to rewrite.' }, 400);
    const outcome = await ai(c).rewriteToXyz(c.get('tenantId'), resumeText, {
      ...(body.limit == null ? {} : { limit: Number(body.limit) }),
      userId: c.get('userId') ?? null,
    });
    return c.json(outcome);
  });

  router.post('/merge-bullets', async (c) => {
    const body = await readJson<{ resumeTexts?: unknown }>(c);
    const texts = Array.isArray(body.resumeTexts)
      ? body.resumeTexts.map((value) => String(value ?? '').trim()).filter((value) => value.length >= MIN_RESUME_CHARS)
      : [];
    if (texts.length < 2) return c.json({ error: 'Merging needs at least two résumés. With one, use the rewrite instead.' }, 400);
    const outcome = await ai(c).mergeBullets(c.get('tenantId'), texts, { userId: c.get('userId') ?? null });
    return c.json(outcome);
  });

  router.post('/grade', async (c) => {
    const body = await readJson<{ resumeText?: string; jobDescription?: string }>(c);
    const resumeText = String(body.resumeText ?? '').trim();
    if (resumeText.length < MIN_RESUME_CHARS) return c.json({ error: 'Paste the résumé text first — there is nothing here to grade.' }, 400);
    const jobDescription = String(body.jobDescription ?? '').trim();
    const outcome = await ai(c).gradeResume(
      c.get('tenantId'), resumeText, jobDescription || undefined, { userId: c.get('userId') ?? null },
    );
    return c.json(outcome);
  });

  // ── The review queue ─────────────────────────────────────────────────────

  router.get('/reviews', async (c) => {
    const status = c.req.query('status');
    const queue = await reviews(c).queue(
      c.get('tenantId'),
      c.get('userId') ?? '',
      isResumeReviewStatus(status) ? status : undefined,
    );
    return c.json({
      reviews: queue,
      statuses: RESUME_REVIEW_STATUSES,
      unread: queue.reduce((sum, review) => sum + review.unread, 0),
    });
  });

  router.post('/reviews', async (c) => {
    const body = await readJson<{
      title?: string; resumeText?: string; jobDescription?: string; note?: string; reviewerUserIds?: unknown;
    }>(c);
    const thread = await reviews(c).open(c.get('tenantId'), c.get('userId') ?? '', {
      title: String(body.title ?? ''),
      resumeText: String(body.resumeText ?? ''),
      jobDescription: String(body.jobDescription ?? ''),
      note: String(body.note ?? ''),
      reviewerUserIds: Array.isArray(body.reviewerUserIds) ? body.reviewerUserIds.map((value: unknown) => String(value ?? '')) : [],
    });
    return thread ? c.json({ review: thread }, 201) : c.json({ error: 'A review needs the résumé text it is about.' }, 400);
  });

  router.get('/reviews/:id', async (c) => {
    const thread = await reviews(c).thread(c.get('tenantId'), c.get('userId') ?? '', c.req.param('id'));
    return thread ? c.json({ review: thread }) : c.json({ error: 'Review request not found.' }, 404);
  });

  router.post('/reviews/:id', async (c) => {
    const body = await readJson<{ body?: string; status?: string }>(c);
    const status = isResumeReviewStatus(body.status) ? body.status : undefined;
    const thread = await reviews(c).reply(
      c.get('tenantId'), c.get('userId') ?? '', c.req.param('id'), String(body.body ?? ''), status,
    );
    return thread ? c.json({ review: thread }, 201) : c.json({ error: 'That reply could not be posted.' }, 400);
  });

  router.post('/reviews/:id/status', async (c) => {
    const body = await readJson<{ status?: string }>(c);
    if (!isResumeReviewStatus(body.status)) return c.json({ error: `Status must be one of: ${RESUME_REVIEW_STATUSES.join(', ')}.` }, 400);
    const thread = await reviews(c).setStatus(c.get('tenantId'), c.get('userId') ?? '', c.req.param('id'), body.status);
    return thread ? c.json({ review: thread }) : c.json({ error: 'Review request not found.' }, 404);
  });

  router.post('/reviews/:id/ai', async (c) => {
    const thread = await reviews(c).requestModelReview(c.get('tenantId'), c.get('userId') ?? '', c.req.param('id'));
    return thread ? c.json({ review: thread }, 201) : c.json({ error: 'Review request not found.' }, 404);
  });

  router.post('/reviews/:id/read', async (c) => {
    const ok = await reviews(c).markRead(c.get('tenantId'), c.get('userId') ?? '', c.req.param('id'));
    return ok ? c.json({ ok: true }) : c.json({ error: 'Review request not found.' }, 404);
  });

  return router;
}
