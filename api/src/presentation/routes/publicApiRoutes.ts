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
import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import * as schema from '../../infrastructure/database/schema';
import type { HonoEnv } from '../../env';

// ---------------------------------------------------------------------------
// Key hashing — SHA-256 hex (same as PBKDF2 would be overkill for API keys)
// ---------------------------------------------------------------------------

async function hashApiKey(key: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

async function requireDevApiKey(db: Db, authHeader: string | undefined): Promise<{ ok: false; error: string; status: number } | { ok: true; userId: string; keyId: string }> {
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, error: 'Missing or malformed Authorization header', status: 401 };
  }
  const raw = authHeader.slice(7);
  const hash = await hashApiKey(raw);

  const [row] = await db
    .select({ id: schema.developerApiKeys.id, userId: schema.developerApiKeys.userId })
    .from(schema.developerApiKeys)
    .where(and(eq(schema.developerApiKeys.keyHash, hash), isNull(schema.developerApiKeys.revokedAt)))
    .limit(1);

  if (!row) return { ok: false, error: 'Invalid or revoked API key', status: 401 };
  return { ok: true, userId: row.userId, keyId: row.id };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPublicApiRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // ── Developer key management (authenticated with main web JWT) ─────────────

  /**
   * POST /api/v1/developer/keys – generate a new developer API key
   * Requires main Tenant JWT (Authorization: Bearer <tenant_jwt>).
   * Returns the raw key once — it is not stored, only its hash is.
   */
  router.post('/developer/keys', async (c) => {
    const userId = c.get('userId') as string | undefined;
    if (!userId) return c.json({ error: 'Authentication required' }, 401);

    const body = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }));
    const name = (body.name ?? '').trim() || 'My API Key';

    // Generate a cryptographically random key: bfai_<48 random hex chars>
    const rawBytes = crypto.getRandomValues(new Uint8Array(24));
    const rawKey = 'bfai_' + Array.from(rawBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    const keyHash = await hashApiKey(rawKey);

    const [row] = await db
      .insert(schema.developerApiKeys)
      .values({ userId, name, keyHash })
      .returning({ id: schema.developerApiKeys.id, name: schema.developerApiKeys.name, createdAt: schema.developerApiKeys.createdAt });

    return c.json({ key: rawKey, id: row!.id, name: row!.name, createdAt: row!.createdAt }, 201);
  });

  /**
   * GET /api/v1/developer/keys – list own developer API keys (does NOT return raw keys)
   */
  router.get('/developer/keys', async (c) => {
    const userId = c.get('userId') as string | undefined;
    if (!userId) return c.json({ error: 'Authentication required' }, 401);

    const rows = await db
      .select({
        id:         schema.developerApiKeys.id,
        name:       schema.developerApiKeys.name,
        lastUsedAt: schema.developerApiKeys.lastUsedAt,
        revokedAt:  schema.developerApiKeys.revokedAt,
        createdAt:  schema.developerApiKeys.createdAt,
      })
      .from(schema.developerApiKeys)
      .where(eq(schema.developerApiKeys.userId, userId))
      .orderBy(desc(schema.developerApiKeys.createdAt));

    return c.json({ keys: rows });
  });

  /**
   * DELETE /api/v1/developer/keys/:id – revoke a key
   */
  router.delete('/developer/keys/:id', async (c) => {
    const userId = c.get('userId') as string | undefined;
    if (!userId) return c.json({ error: 'Authentication required' }, 401);

    const keyId = c.req.param('id');
    const [row] = await db
      .select({ userId: schema.developerApiKeys.userId })
      .from(schema.developerApiKeys)
      .where(eq(schema.developerApiKeys.id, keyId))
      .limit(1);

    if (!row) return c.json({ error: 'Key not found' }, 404);
    if (row.userId !== userId) return c.json({ error: 'Forbidden' }, 403);

    await db
      .update(schema.developerApiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(schema.developerApiKeys.id, keyId));

    return c.json({ ok: true });
  });

  // ── Public read endpoints (Developer API key auth) ─────────────────────────

  /**
   * GET /api/v1/agents – list published agents
   * Query: ?q=&skill=&page=1&limit=24
   */
  router.get('/agents', async (c) => {
    const auth = await requireDevApiKey(db, c.req.header('Authorization'));
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
    const auth = await requireDevApiKey(db, c.req.header('Authorization'));
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
    const auth = await requireDevApiKey(db, c.req.header('Authorization'));
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
    const auth = await requireDevApiKey(db, c.req.header('Authorization'));
    if (!auth.ok) return c.json({ error: auth.error }, auth.status as 401 | 403);

    // Platform personas from DB (admin-managed)
    const rows = await db.select().from(schema.platformPersonas).where(eq(schema.platformPersonas.active, true));
    return c.json({ personas: rows });
  });

  return router;
}
