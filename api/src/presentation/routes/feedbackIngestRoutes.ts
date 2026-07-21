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
 * Authorization is the collector's ingest key; abuse is bounded by the
 * collector's rolling-24h ceiling inside the engine. Everything a submission
 * becomes — the recorded row, the human-gated backlog ticket — happens in
 * feedbackEngine so this route stays a thin, validating shell.
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { feedbackCollectors, projects } from '../../infrastructure/database/schema';
import { hashSecret } from '../../infrastructure/auth/HashService';
import { normalizeFeedback, FEEDBACK_KINDS } from '../../application/feedback/feedbackSpec';
import { submitFeedback, type FeedbackTarget } from '../../application/feedback/feedbackEngine';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

/** Pull the ingest key from `Authorization: Bearer <key>` or `?key=` (beacon path). */
function readIngestKey(c: { req: { header: (n: string) => string | undefined; query: (n: string) => string | undefined } }): string | null {
  const auth = c.req.header('Authorization') ?? '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim() || null;
  return c.req.query('key')?.trim() || null;
}

interface ResolvedCollector extends FeedbackTarget {
  projectName: string;
  allowedOrigins: string;
}

/** Resolve a collector (and its project label) from a raw ingest key. */
async function resolveCollectorByKey(db: Db, key: string): Promise<ResolvedCollector | null> {
  const keyHash = await hashSecret(key);
  const [row] = await db
    .select({
      id: feedbackCollectors.id,
      tenantId: feedbackCollectors.tenantId,
      projectId: feedbackCollectors.projectId,
      enabled: feedbackCollectors.enabled,
      autoCreateTask: feedbackCollectors.autoCreateTask,
      dailyLimit: feedbackCollectors.dailyLimit,
      allowedOrigins: feedbackCollectors.allowedOrigins,
      projectName: projects.name,
    })
    .from(feedbackCollectors)
    .innerJoin(projects, eq(projects.id, feedbackCollectors.projectId))
    .where(eq(feedbackCollectors.keyHash, keyHash))
    .limit(1);
  if (!row || !row.enabled) return null;
  return {
    collectorId: row.id,
    tenantId: row.tenantId,
    projectId: row.projectId,
    autoCreateTask: row.autoCreateTask,
    dailyLimit: row.dailyLimit,
    projectName: row.projectName,
    allowedOrigins: row.allowedOrigins,
  };
}

/**
 * Per-collector origin policy, layered ON TOP of the CORS allowance that lets any
 * origin reach an ingest path. '*' (the default) accepts anywhere; otherwise the
 * posting Origin must be listed, so a leaked key cannot be driven from a site the
 * owner never authorized. A same-origin/serverless post sends no Origin at all
 * and is allowed — the key is the credential there.
 */
function originAllowed(allowedOrigins: string, origin: string | undefined): boolean {
  const policy = allowedOrigins.trim();
  if (!policy || policy === '*') return true;
  if (!origin) return true;
  return policy.split(',').map((s) => s.trim()).filter(Boolean).includes(origin);
}

export function createFeedbackIngestRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  /** Widget bootstrap — lets the snippet render a labelled form before any post. */
  router.get('/config', async (c) => {
    const key = readIngestKey(c);
    if (!key) return c.json({ error: 'Missing ingest key' }, 401);
    const collector = await resolveCollectorByKey(db, key);
    if (!collector) return c.json({ error: 'Invalid ingest key' }, 401);
    if (!originAllowed(collector.allowedOrigins, c.req.header('Origin'))) {
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
    if (!originAllowed(collector.allowedOrigins, c.req.header('Origin'))) {
      return c.json({ error: 'Origin not allowed for this collector' }, 403);
    }

    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

    const normalized = normalizeFeedback(body);
    if (!normalized.ok) return c.json({ error: normalized.error }, 400);

    // The submitter's UA is more trustworthy from the header than the payload.
    const value = { ...normalized.value, userAgent: c.req.header('User-Agent')?.slice(0, 1000) ?? normalized.value.userAgent };

    const result = await submitFeedback(db, c.env as Env, collector, value);
    if ('rateLimited' in result && result.rateLimited) {
      return c.json({ error: 'Daily feedback limit reached for this collector' }, 429);
    }
    return c.json(result, 202);
  });

  return router;
}
