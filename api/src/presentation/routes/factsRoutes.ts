/**
 * FACTS library — /api/facts
 *
 * A structured, queryable tenant knowledge store of (subject, predicate, object)
 * triples with provenance. Reads are cached against a per-tenant version token
 * bumped on every write; writes are gated at developer+ (mirrors the frontend
 * `facts.manage` capability). Any member can read.
 *
 *   GET    /            list/query facts (?subject=&predicate=&q=&projectId=)   [member]
 *   GET    /schema      distinct subjects + predicates (filter dropdowns)       [member]
 *   POST   /            create a fact                                           [developer]
 *   PATCH  /:id         update a fact                                           [developer]
 *   DELETE /:id         delete a fact                                           [developer]
 */

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { facts } from '../../infrastructure/database/schema';
import { getOrSetCached, getCacheVersion, bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { queryFacts, factsSchema, toFactRow } from '../../application/facts/factsQuery';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const SHORT_TTL = { kvTtlSeconds: 120, l1TtlMs: 15_000 };

function factsVersionKey(tenantId: number): string {
  return `facts:t:${tenantId}`;
}

function parseIntOr(raw: string | undefined, def: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : def;
}

function clampConfidence(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(n, 0), 1);
}

interface FactBody {
  subject?: string;
  predicate?: string;
  object?: string;
  source?: string | null;
  confidence?: number | null;
  projectId?: number | null;
}

export function createFactsRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // Distinct subjects + predicates (defined before /:id-style paths — no clash).
  router.get('/schema', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const env = c.env as Env;
    const ver = await getCacheVersion(env, factsVersionKey(tenantId));
    const key = `facts:schema:t:${tenantId}:v:${ver}`;
    return c.json(await getOrSetCached(env, key, () => factsSchema(db, tenantId), SHORT_TTL));
  });

  // List / query.
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const env = c.env as Env;
    const subject = c.req.query('subject')?.trim() || undefined;
    const predicate = c.req.query('predicate')?.trim() || undefined;
    const q = c.req.query('q')?.trim() || undefined;
    const projectIdRaw = c.req.query('projectId');
    const projectId = projectIdRaw != null && projectIdRaw !== '' ? parseIntOr(projectIdRaw, NaN) : null;
    const limit = parseIntOr(c.req.query('limit'), 200);
    const offset = parseIntOr(c.req.query('offset'), 0);

    const ver = await getCacheVersion(env, factsVersionKey(tenantId));
    const key = `facts:list:t:${tenantId}:s:${subject ?? ''}:p:${predicate ?? ''}:q:${q ?? ''}:pr:${projectId ?? ''}:l:${limit}:o:${offset}:v:${ver}`;
    const rows = await getOrSetCached(
      env, key,
      () => queryFacts(db, tenantId, { subject, predicate, q, projectId: Number.isNaN(projectId as number) ? null : projectId, limit, offset }),
      SHORT_TTL,
    );
    return c.json({ facts: rows });
  });

  // Create.
  router.post('/', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    const body = await c.req.json<FactBody>().catch(() => ({} as FactBody));
    if (!body.subject?.trim() || !body.predicate?.trim() || !body.object?.trim()) {
      return c.json({ error: 'subject, predicate and object are required' }, 400);
    }
    const [row] = await db.insert(facts).values({
      tenantId,
      projectId: body.projectId ?? null,
      subject: body.subject.trim().slice(0, 255),
      predicate: body.predicate.trim().slice(0, 255),
      object: body.object.trim(),
      source: body.source?.trim().slice(0, 255) || null,
      confidence: clampConfidence(body.confidence),
      createdBy: userId ?? null,
    }).returning();
    if (!row) return c.json({ error: 'Failed to create fact' }, 500);
    await bumpCacheVersion(c.env as Env, factsVersionKey(tenantId));
    return c.json(toFactRow(row), 201);
  });

  // Update.
  router.patch('/:id', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const body = await c.req.json<FactBody>().catch(() => ({} as FactBody));
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (body.subject !== undefined) set.subject = String(body.subject).trim().slice(0, 255);
    if (body.predicate !== undefined) set.predicate = String(body.predicate).trim().slice(0, 255);
    if (body.object !== undefined) set.object = String(body.object).trim();
    if (body.source !== undefined) set.source = body.source?.toString().trim().slice(0, 255) || null;
    if (body.confidence !== undefined) set.confidence = clampConfidence(body.confidence);
    if (body.projectId !== undefined) set.projectId = body.projectId ?? null;

    const [row] = await db
      .update(facts)
      .set(set)
      .where(and(eq(facts.id, id), eq(facts.tenantId, tenantId)))
      .returning();
    if (!row) return c.json({ error: 'Fact not found' }, 404);
    await bumpCacheVersion(c.env as Env, factsVersionKey(tenantId));
    return c.json(toFactRow(row));
  });

  // Delete.
  router.delete('/:id', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    await db.delete(facts).where(and(eq(facts.id, id), eq(facts.tenantId, tenantId)));
    await bumpCacheVersion(c.env as Env, factsVersionKey(tenantId));
    return c.json({ deleted: id });
  });

  return router;
}
