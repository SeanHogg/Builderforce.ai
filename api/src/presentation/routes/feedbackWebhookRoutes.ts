/**
 * Feedback provider webhooks — /api/feedback-ingest/webhooks (PUBLIC, no tenant JWT).
 *
 * `POST /:collectorId/:provider` is where Sentry and PostHog deliver. It is the
 * third door onto the SAME ingest path as the embeddable snippet and the in-app
 * panel: everything a submission becomes — the metered row, the two ceilings, the
 * duplicate collapse, the human-gated backlog ticket — happens in
 * `feedbackWebhookIngest` → `submitFeedback`, so this file is a status-code map
 * and nothing else.
 *
 * ── AUTHORIZATION ───────────────────────────────────────────────────────────
 * The URL is the ADDRESS, never the credential. Authorization is the provider's
 * signature over the raw body, verified against the tenant's stored secret; a
 * delivery with no valid signature is refused before anything is parsed or
 * written. The route therefore reads `c.req.text()` and hands those exact bytes
 * down — re-serialising the parsed object would verify a different string than the
 * one the provider signed, which is how a signature check quietly starts passing
 * tampered payloads.
 *
 * ── WHY THE REFUSALS DO NOT ALL COLLAPSE TO 400 ─────────────────────────────
 * A webhook sender is a robot deciding whether to retry, so each status is a
 * deliberate instruction: 404 for an address that will never work, 401 for a
 * signature that will never verify, 409 for an integration that is not configured
 * yet, 429 for a ceiling that WILL clear (retry later — and the delivery is
 * un-claimed so that retry can actually land), and 200 for a duplicate so a sender
 * retrying something we already accepted stops rather than escalating.
 */

import { Hono } from 'hono';
import { ingestFeedbackWebhook } from '../../application/feedback/feedbackWebhookIngest';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

export function createFeedbackWebhookRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.post('/:collectorId/:provider', async (c) => {
    const outcome = await ingestFeedbackWebhook(db, c.env as Env, {
      collectorId: c.req.param('collectorId'),
      provider: c.req.param('provider'),
      rawBody: await c.req.text(),
      getHeader: (name) => c.req.header(name),
    });

    switch (outcome.kind) {
      case 'unknown_provider':
        return c.json({ error: 'Unknown feedback provider' }, 404);
      case 'unknown_collector':
        return c.json({ error: 'Unknown or disabled feedback collector' }, 404);
      case 'not_connected':
        return c.json({ error: 'This provider is not connected to this collector' }, 404);
      case 'not_configured':
        return c.json({ error: 'This integration has no webhook secret configured' }, 409);
      case 'invalid_signature':
        return c.json({ error: 'Invalid signature' }, 401);
      case 'invalid_body':
        return c.json({ error: 'Invalid JSON body' }, 400);
      case 'duplicate':
        // 200, not 409: the sender did nothing wrong and there is nothing left to
        // do. Answering with an error here is what makes a provider escalate a
        // successful retry into a paging alert on their side.
        return c.json({ ok: true, duplicate: true, eventId: outcome.eventId }, 200);
      case 'ignored':
        return c.json({ ok: true, imported: 0, ignored: true, eventId: outcome.eventId }, 202);
      case 'rate_limited':
        return c.json({ error: 'Daily feedback limit reached for this collector', rateLimited: true }, 429);
      case 'quota_exceeded':
        return c.json({
          error: 'Monthly feedback submission limit reached for this workspace',
          quotaExceeded: true,
          effectivePlan: outcome.effectivePlan,
          used: outcome.used,
          limit: outcome.limit,
        }, 429);
      case 'accepted':
        return c.json({
          ok: true,
          imported: outcome.submissionIds.length,
          deduped: outcome.deduped,
          eventId: outcome.eventId,
          taskIds: outcome.taskIds,
        }, 202);
    }
  });

  return router;
}
