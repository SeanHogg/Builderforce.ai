/**
 * Public Developer API — `/api/v1/*`
 *
 * Read-only endpoints an external site calls with a tenant API key, to embed
 * Builderforce.ai listings.
 *
 * ── ONE CREDENTIAL (migration 0472) ─────────────────────────────────────────
 * These used to authenticate with a `bfai_*` key from `developer_api_keys` — a
 * second key table with a second middleware and a second answer to "what may this
 * caller do". A developer is a tenant, so the key is a `tenant_api_keys` row and
 * the resolver is the shared one. Existing `bfai_*` keys still work: both tables
 * stored a SHA-256 digest and resolution is by hash, so the migration copied them
 * across unchanged.
 *
 * Minting, listing and revoking moved out of this file entirely. They live where
 * every other tenant key is managed — `/api/tenants/:tenantId/api-keys`, owner-only,
 * with the usage trail and the origin allowlist that path already has. A publisher
 * needs `read:catalog` on the key.
 *
 * Auth: `Authorization: Bearer <bfk_… | bfai_…>`.
 * Rate limiting: applied upstream via the shared rate limiter middleware.
 */
import { Hono } from 'hono';
import { eq, and, desc, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import * as schema from '../../infrastructure/database/schema';
import type { HonoEnv } from '../../env';
import {
  originAllowed,
  resolveTenantApiKey,
  touchTenantApiKey,
  type TenantApiScope,
} from '../../application/llm/tenantApiKeyService';

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

interface ApiCaller { keyId: string; tenantId: number }

/**
 * Resolve the key on the request, check it carries `required`, and check the
 * browser origin if there is one.
 *
 * Header parsing is genuinely the presentation layer's job; the hash/lookup/
 * revoked/scope triple is not, and lives in the shared service. The ORIGIN check
 * is new to this surface and is the reason migration 0472 grandfathered every
 * copied key onto the any-origin allowlist: these endpoints exist to be called
 * from an external site's page, and inheriting the tenant default of server-only
 * would have revoked exactly that usage on deploy day.
 */
async function requireApiKey(
  db: Db,
  authHeader: string | undefined,
  origin: string | null,
  required: TenantApiScope,
): Promise<{ ok: false; error: string; status: 401 | 403 } | ({ ok: true } & ApiCaller)> {
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, error: 'Missing or malformed Authorization header', status: 401 };
  }
  const resolved = await resolveTenantApiKey(db, authHeader.slice(7), required);
  if (!resolved) return { ok: false, error: 'Invalid or revoked API key', status: 401 };
  if (!originAllowed(resolved.allowedOrigins, origin)) {
    return { ok: false, error: 'This key is not allowed from this origin', status: 403 };
  }
  return { ok: true, keyId: resolved.keyId, tenantId: resolved.tenantId };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPublicApiRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // ── Public read endpoints (tenant API key, `read:catalog`) ────────────────

  /**
   * GET /api/v1/agents – list published agents
   * Query: ?q=&skill=&page=1&limit=24
   */
  router.get('/agents', async (c) => {
    const auth = await requireApiKey(db, c.req.header('Authorization'), c.req.header('Origin') ?? null, 'read:catalog');
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);

    // Update last_used_at (fire-and-forget)
    c.executionCtx.waitUntil(touchTenantApiKey(db, auth.keyId));

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
    const auth = await requireApiKey(db, c.req.header('Authorization'), c.req.header('Origin') ?? null, 'read:catalog');
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);

    c.executionCtx.waitUntil(touchTenantApiKey(db, auth.keyId));

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
    const auth = await requireApiKey(db, c.req.header('Authorization'), c.req.header('Origin') ?? null, 'read:catalog');
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);

    c.executionCtx.waitUntil(touchTenantApiKey(db, auth.keyId));

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
    const auth = await requireApiKey(db, c.req.header('Authorization'), c.req.header('Origin') ?? null, 'read:catalog');
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);

    // Platform personas from DB (admin-managed)
    const rows = await db.select().from(schema.platformPersonas).where(eq(schema.platformPersonas.active, true));
    return c.json({ personas: rows });
  });

  return router;
}
