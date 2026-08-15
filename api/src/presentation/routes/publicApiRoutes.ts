/**
 * Public Developer API – /api/v1/*
 *
 * Read-only endpoints accessible with a Developer API key.
 * External sites use this to embed Builderforce.ai agent listings.
 *
 * Auth: Bearer <developer_api_key> (unhashed key generated at creation time).
 * Rate limiting: applied upstream via the shared rate limiter middleware.
 */
import { Hono } from 'hono';
import { eq, and, desc, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import * as schema from '../../infrastructure/database/schema';
import type { HonoEnv } from '../../env';
import { DeveloperOrgError } from '../../application/developer/developerOrgs';
import {
  listDeveloperApiKeys,
  mintDeveloperApiKey,
  resolveDeveloperApiKey,
  revokeDeveloperApiKey,
  type DeveloperApiScope,
} from '../../application/developer/developerApiKeys';

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

/**
 * Resolve the `bfai_*` key on the request, and check it carries `required`.
 *
 * The hash/lookup/revoked triple moved to
 * `application/developer/developerApiKeys.ts` (PRD 24 §5.1) so that the key's
 * OWNER, its scopes and its origin allowlist are decided in one place rather than
 * re-derived per endpoint. This wrapper is what is left: header parsing, which is
 * genuinely the presentation layer's job.
 */
async function requireDevApiKey(
  db: Db,
  authHeader: string | undefined,
  required: DeveloperApiScope,
): Promise<{ ok: false; error: string; status: number } | { ok: true; userId: string; keyId: string; developerOrgId: string | null }> {
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, error: 'Missing or malformed Authorization header', status: 401 };
  }
  const resolved = await resolveDeveloperApiKey(db, authHeader.slice(7), required);
  if (!resolved) return { ok: false, error: 'Invalid or revoked API key', status: 401 };
  return { ok: true, userId: resolved.userId, keyId: resolved.keyId, developerOrgId: resolved.developerOrgId };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPublicApiRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // ── Developer key management (authenticated with main web JWT) ─────────────

  /**
   * POST /api/v1/developer/keys – mint a key for the caller's publisher
   * Requires main Tenant JWT (Authorization: Bearer <tenant_jwt>).
   * Returns the raw key once — it is not stored, only its hash is.
   *
   * The key belongs to a `developer_orgs` row (PRD 24 §5.1), created on demand
   * for a caller who has never registered one — so a developer who has never
   * heard of the portal gets exactly the behaviour they had before.
   */
  router.post('/developer/keys', async (c) => {
    const userId = c.get('userId') as string | undefined;
    if (!userId) return c.json({ error: 'Authentication required' }, 401);

    type Body = { name?: string; developerOrgId?: string; scopes?: string[] };
    const body = await c.req.json<Body>().catch((): Body => ({}));

    try {
      const minted = await mintDeveloperApiKey(db, c.env, {
        userId,
        name: body.name ?? '',
        developerOrgId: body.developerOrgId ?? null,
        scopes: body.scopes ?? null,
      });
      return c.json(minted, 201);
    } catch (error) {
      const status = error instanceof DeveloperOrgError ? error.status : 500;
      return c.json({ error: error instanceof Error ? error.message : 'failed to mint key' }, status);
    }
  });

  /**
   * GET /api/v1/developer/keys – keys the caller can see (theirs, and their
   * publishers'). Never returns a raw key.
   */
  router.get('/developer/keys', async (c) => {
    const userId = c.get('userId') as string | undefined;
    if (!userId) return c.json({ error: 'Authentication required' }, 401);
    return c.json({ keys: await listDeveloperApiKeys(db, userId) });
  });

  /**
   * DELETE /api/v1/developer/keys/:id – revoke a key.
   * Any admin of the owning publisher may, not only the engineer who minted it.
   */
  router.delete('/developer/keys/:id', async (c) => {
    const userId = c.get('userId') as string | undefined;
    if (!userId) return c.json({ error: 'Authentication required' }, 401);
    try {
      await revokeDeveloperApiKey(db, c.req.param('id'), userId);
      return c.json({ ok: true });
    } catch (error) {
      const status = error instanceof DeveloperOrgError ? error.status : 500;
      return c.json({ error: error instanceof Error ? error.message : 'failed to revoke key' }, status);
    }
  });

  // ── Public read endpoints (Developer API key auth) ─────────────────────────

  /**
   * GET /api/v1/agents – list published agents
   * Query: ?q=&skill=&page=1&limit=24
   */
  router.get('/agents', async (c) => {
    const auth = await requireDevApiKey(db, c.req.header('Authorization'), 'read:catalog');
    if (!auth.ok) return c.json({ error: auth.error }, auth.status as 401 | 403);

    // Update last_used_at (fire-and-forget)
    c.executionCtx.waitUntil(
      db.update(schema.developerApiKeys).set({ lastUsedAt: new Date() }).where(eq(schema.developerApiKeys.id, auth.keyId)),
    );

    const { page = '1', limit = '24' } = c.req.query();
    const pageNum  = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const offset   = (pageNum - 1) * limitNum;

    const rows = await db
      .select({
        id:        schema.agents.id,
        name:      schema.agents.name,
        type:      schema.agents.type,
        isActive:  schema.agents.isActive,
        createdAt: schema.agents.createdAt,
      })
      .from(schema.agents)
      .where(eq(schema.agents.isActive, true))
      .orderBy(desc(schema.agents.createdAt))
      .limit(limitNum)
      .offset(offset);

    const [countRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.agents)
      .where(eq(schema.agents.isActive, true));

    return c.json({ agents: rows, total: Number(countRow?.count ?? 0), page: pageNum, limit: limitNum });
  });

  /**
   * GET /api/v1/agents/:id – get a single agent
   */
  router.get('/agents/:id', async (c) => {
    const auth = await requireDevApiKey(db, c.req.header('Authorization'), 'read:catalog');
    if (!auth.ok) return c.json({ error: auth.error }, auth.status as 401 | 403);

    c.executionCtx.waitUntil(
      db.update(schema.developerApiKeys).set({ lastUsedAt: new Date() }).where(eq(schema.developerApiKeys.id, auth.keyId)),
    );

    const agentId = parseInt(c.req.param('id'), 10);
    if (isNaN(agentId)) return c.json({ error: 'Invalid agent ID' }, 400);
    const [row] = await db
      .select({
        id:        schema.agents.id,
        name:      schema.agents.name,
        type:      schema.agents.type,
        isActive:  schema.agents.isActive,
        createdAt: schema.agents.createdAt,
        updatedAt: schema.agents.updatedAt,
      })
      .from(schema.agents)
      .where(and(eq(schema.agents.id, agentId), eq(schema.agents.isActive, true)))
      .limit(1);

    if (!row) return c.json({ error: 'Agent not found' }, 404);
    return c.json({ agent: row });
  });

  /**
   * GET /api/v1/skills – list published marketplace skills
   * Query: ?q=&category=&page=1&limit=24
   */
  router.get('/skills', async (c) => {
    const auth = await requireDevApiKey(db, c.req.header('Authorization'), 'read:catalog');
    if (!auth.ok) return c.json({ error: auth.error }, auth.status as 401 | 403);

    c.executionCtx.waitUntil(
      db.update(schema.developerApiKeys).set({ lastUsedAt: new Date() }).where(eq(schema.developerApiKeys.id, auth.keyId)),
    );

    const { q, category, page = '1', limit = '24' } = c.req.query();
    const pageNum  = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const offset   = (pageNum - 1) * limitNum;

    const conditions = [eq(schema.marketplaceSkills.published, true), ...(category ? [eq(schema.marketplaceSkills.category, category)] : [])];

    let rows;
    if (q) {
      rows = await db
        .select({
          id:            schema.marketplaceSkills.id,
          name:          schema.marketplaceSkills.name,
          slug:          schema.marketplaceSkills.slug,
          description:   schema.marketplaceSkills.description,
          category:      schema.marketplaceSkills.category,
          tags:          schema.marketplaceSkills.tags,
          version:       schema.marketplaceSkills.version,
          icon_url:      schema.marketplaceSkills.iconUrl,
          downloads:     schema.marketplaceSkills.downloads,
          likes:         schema.marketplaceSkills.likes,
          price_cents:   schema.marketplaceSkills.priceCents,
          pricing_model: schema.marketplaceSkills.pricingModel,
          price_unit:    schema.marketplaceSkills.priceUnit,
          author_username: schema.users.username,
        })
        .from(schema.marketplaceSkills)
        .innerJoin(schema.users, eq(schema.marketplaceSkills.authorId, schema.users.id))
        .where(sql`${and(...conditions)} AND ${schema.marketplaceSkills.searchVector} @@ websearch_to_tsquery(${q})`)
        .orderBy(desc(schema.marketplaceSkills.downloads))
        .limit(limitNum)
        .offset(offset);
    } else {
      rows = await db
        .select({
          id:            schema.marketplaceSkills.id,
          name:          schema.marketplaceSkills.name,
          slug:          schema.marketplaceSkills.slug,
          description:   schema.marketplaceSkills.description,
          category:      schema.marketplaceSkills.category,
          tags:          schema.marketplaceSkills.tags,
          version:       schema.marketplaceSkills.version,
          icon_url:      schema.marketplaceSkills.iconUrl,
          downloads:     schema.marketplaceSkills.downloads,
          likes:         schema.marketplaceSkills.likes,
          price_cents:   schema.marketplaceSkills.priceCents,
          pricing_model: schema.marketplaceSkills.pricingModel,
          price_unit:    schema.marketplaceSkills.priceUnit,
          author_username: schema.users.username,
        })
        .from(schema.marketplaceSkills)
        .innerJoin(schema.users, eq(schema.marketplaceSkills.authorId, schema.users.id))
        .where(and(...conditions))
        .orderBy(desc(schema.marketplaceSkills.downloads))
        .limit(limitNum)
        .offset(offset);
    }

    const [countRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.marketplaceSkills)
      .where(and(...conditions));

    return c.json({ skills: rows, total: Number(countRow?.count ?? 0), page: pageNum, limit: limitNum });
  });

  /**
   * GET /api/v1/personas – list built-in persona definitions
   * Returns the canonical list — no auth required.
   */
  router.get('/personas', async (c) => {
    const auth = await requireDevApiKey(db, c.req.header('Authorization'), 'read:catalog');
    if (!auth.ok) return c.json({ error: auth.error }, auth.status as 401 | 403);

    // Platform personas from DB (admin-managed)
    const rows = await db.select().from(schema.platformPersonas).where(eq(schema.platformPersonas.active, true));
    return c.json({ personas: rows });
  });

  return router;
}
