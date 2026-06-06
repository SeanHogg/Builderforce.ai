/**
 * /v1/semantic-cache — the shared (L2) tier of the SemanticCache.
 *
 * Tenant-scoped embedding-keyed response cache. Clients (the web app and the
 * agent runtime, both via `FetchSemanticCacheBackend` in `@builderforce/memory`)
 * POST a query embedding to /lookup to reuse a paraphrased answer, and POST the
 * embedding+response to /store after a frontier call. Auth is the same tenant
 * bearer key as the chat endpoint.
 */

import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import { requireTenantAccess, respondToAccessError } from './llmRoutes';
import { semanticLookup, semanticStore } from '../../application/llm/semanticCache';

const DEFAULT_THRESHOLD = 0.92;

/** Keep namespaces to safe, bounded KV-key characters (tenant scoping is separate). */
function sanitizeNamespace(ns: unknown): string {
  if (typeof ns !== 'string' || ns.length === 0) return 'default';
  return ns.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 64);
}

export function createSemanticCacheRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // POST /v1/semantic-cache/lookup → { hit?: { response, score } }
  router.post('/lookup', async (c) => {
    let access;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }

    const body = await c.req
      .json<{ embedding?: unknown; threshold?: unknown; namespace?: unknown }>()
      .catch(() => ({} as { embedding?: unknown; threshold?: unknown; namespace?: unknown }));

    if (!Array.isArray(body.embedding) || body.embedding.length === 0) {
      return c.json({ error: 'embedding (number[]) is required' }, 400);
    }
    const embedding = (body.embedding as unknown[]).map(Number).filter(Number.isFinite);
    const threshold = typeof body.threshold === 'number' ? body.threshold : DEFAULT_THRESHOLD;
    const namespace = sanitizeNamespace(body.namespace);

    const hit = await semanticLookup(c.env, access.tenantId, namespace, embedding, threshold);
    return c.json({ hit: hit ?? undefined });
  });

  // POST /v1/semantic-cache/store → { ok: true }
  router.post('/store', async (c) => {
    let access;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }

    const body = await c.req
      .json<{ embedding?: unknown; response?: unknown; namespace?: unknown }>()
      .catch(() => ({} as { embedding?: unknown; response?: unknown; namespace?: unknown }));

    if (!Array.isArray(body.embedding) || typeof body.response !== 'string') {
      return c.json({ error: 'embedding (number[]) and response (string) are required' }, 400);
    }
    const embedding = (body.embedding as unknown[]).map(Number).filter(Number.isFinite);
    const namespace = sanitizeNamespace(body.namespace);

    // Store off the response path — the client only needs the 2xx ack.
    c.executionCtx.waitUntil(
      semanticStore(c.env, access.tenantId, namespace, embedding, body.response),
    );
    return c.json({ ok: true });
  });

  return router;
}
