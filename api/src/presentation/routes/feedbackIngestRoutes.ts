/**
 * Feedback ingest routes — /api/feedback-ingest (PUBLIC, no tenant JWT).
 *
 * The inbound edge of the Product Feedback pillar and the twin of
 * qualityIngestRoutes: the embeddable snippet posts here from whatever
 * application carries it.
 *
 *   GET  /config    widget bootstrap (project label + accepted kinds) — Bearer bff_… or ?key=
 *   POST /submit    one feedback request                              — same key
 *
 * Authorization is the collector's ingest key; volume is bounded twice inside the
 * engine — by the collector's rolling-24h abuse ceiling and by the tenant's
 * monthly plan quota (the consumption meter). Everything a submission becomes
 * — the recorded row, the human-gated backlog ticket — happens in feedbackEngine
 * so this route stays a thin, validating shell.
 */

import { Hono } from 'hono';
import { normalizeFeedback, FEEDBACK_KINDS } from '../../application/feedback/feedbackSpec';
import { submitFeedback } from '../../application/feedback/feedbackEngine';
import { collectorOriginAllowed, resolveCollectorByKey } from '../../application/feedback/feedbackCollectors';
import { respondToFeedbackSubmit } from './feedbackHttp';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { parseBody, zJsonObject } from './requestBody';

/** Pull the ingest key from `Authorization: Bearer <key>` or `?key=` (beacon path). */
function readIngestKey(c: { req: { header: (n: string) => string | undefined; query: (n: string) => string | undefined } }): string | null {
  const auth = c.req.header('Authorization') ?? '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim() || null;
  return c.req.query('key')?.trim() || null;
}

export function createFeedbackIngestRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  /** Widget bootstrap — lets the snippet render a labelled form before any post. */
  router.get('/config', async (c) => {
    const key = readIngestKey(c);
    if (!key) return c.json({ error: 'Missing ingest key' }, 401);
    const collector = await resolveCollectorByKey(db, key);
    if (!collector) return c.json({ error: 'Invalid ingest key' }, 401);
    if (!collectorOriginAllowed(collector.allowedOrigins, c.req.header('Origin'))) {
      return c.json({ error: 'Origin not allowed for this collector' }, 403);
    }
    return c.json({ projectName: collector.projectName, kinds: FEEDBACK_KINDS });
  });

  /** One feedback request from an embedding application. */
  router.post('/submit', async (c) => {
    const key = readIngestKey(c);
    if (!key) return c.json({ error: 'Missing ingest key' }, 401);
    const collector = await resolveCollectorByKey(db, key);
    if (!collector) return c.json({ error: 'Invalid ingest key' }, 401);
    if (!collectorOriginAllowed(collector.allowedOrigins, c.req.header('Origin'))) {
      return c.json({ error: 'Origin not allowed for this collector' }, 403);
    }

    // Any JSON object: `normalizeFeedback` owns the per-field rules (and their
    // messages), so the schema only refuses a body that is not an object at all.
    const body = await parseBody(c, zJsonObject);

    const normalized = normalizeFeedback(body);
    if (!normalized.ok) return c.json({ error: normalized.error }, 400);

    // The submitter's UA is more trustworthy from the header than the payload.
    const value = { ...normalized.value, userAgent: c.req.header('User-Agent')?.slice(0, 1000) ?? normalized.value.userAgent };

    // One shared renderer for every refusal: the collector's rolling-24h ceiling
    // and the tenant's monthly plan quota must read the same on every door.
    return respondToFeedbackSubmit(c, await submitFeedback(db, c.env as Env, collector, value), 202);
  });

  return router;
}
