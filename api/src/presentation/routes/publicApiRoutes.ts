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
import { Hono, type Context } from 'hono';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';
import { touchTenantApiKey } from '../../application/llm/tenantApiKeyService';
// THE `/api/v1` credential check, shared with the canvas, webhook and widget
// routers mounted below — see `publicApiAuth.ts`.
import { requirePublicApiKey } from '../../application/publicApi/publicApiAuth';
import { listPublishedSkills } from '../../application/marketplace/marketplaceSkillCatalog';
import { getPublicAgent, listWorkforceAgents } from '../../application/workforce/agentDirectory';
import { pagePublicAgents, toPublicApiAgent } from '../../application/publicApi/publicAgentListing';
import { listPlatformPersonas } from '../../application/persona/platformPersonaCatalog';
import { createPublicCanvasRoutes } from './publicCanvasApiRoutes';
import { createPublicWebhookRoutes } from './publicWebhookApiRoutes';
import { createPublicWidgetRoutes } from './publicWidgetApiRoutes';
import { createPublicExtensionRoutes } from './publicExtensionApiRoutes';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPublicApiRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // ── The canvas surface (spec: `docs/public-canvas-api.md`) ────────────────
  // Board + item CRUD, outbound webhooks, and the third-party widget registry.
  // Mounted here rather than at their own top-level path so ONE credential, one
  // origin allowlist and one rate limiter govern the whole public API.
  router.route('/', createPublicCanvasRoutes(db));
  router.route('/', createPublicWebhookRoutes(db));
  router.route('/', createPublicWidgetRoutes(db));
  // ── The marketplace VENDOR surface (PRD 24 §5.3/§5.4) ────────────────────
  // The install-token exchange and the metered-usage report. Mounted here for
  // the same reason as the three above: one credential, one origin allowlist,
  // one rate limiter for every machine caller on this platform.
  router.route('/', createPublicExtensionRoutes(db));

  // ── Public read endpoints (tenant API key, `read:catalog`) ────────────────
  // Each is a thin adapter over the catalogue that owns the read, so the developer
  // API lists exactly what the marketplace lists, from the same cache.

  /** The key check + last-used touch every catalogue read starts with. */
  const authorize = async (c: Context<HonoEnv>, touch = true) => {
    const auth = await requirePublicApiKey(db, c.req.header('Authorization'), c.req.header('Origin') ?? null, 'read:catalog');
    if (auth.ok && touch) c.executionCtx.waitUntil(touchTenantApiKey(db, auth.keyId));
    return auth;
  };

  /**
   * GET /api/v1/agents – list published marketplace agents
   * Query: ?q=&skill=&page=1&limit=24
   */
  router.get('/agents', async (c) => {
    const auth = await authorize(c);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);
    const { q, skill, page, limit } = c.req.query();
    return c.json(pagePublicAgents(
      await listWorkforceAgents(c.env as Env, db, { scope: 'public' }),
      { q, skill, page, limit },
    ));
  });

  /**
   * GET /api/v1/agents/:id – get a single published agent
   */
  router.get('/agents/:id', async (c) => {
    const auth = await authorize(c);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);
    const row = await getPublicAgent(db, c.req.param('id'));
    if (!row) return c.json({ error: 'Agent not found' }, 404);
    return c.json({ agent: toPublicApiAgent(row) });
  });

  /**
   * GET /api/v1/skills – list published marketplace skills
   * Query: ?q=&category=&page=1&limit=24
   */
  router.get('/skills', async (c) => {
    const auth = await authorize(c);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);
    return c.json(await listPublishedSkills(c.env as Env, db, c.req.query()));
  });

  /**
   * GET /api/v1/personas – list the active platform persona catalogue
   */
  router.get('/personas', async (c) => {
    const auth = await authorize(c, false);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);
    return c.json({ personas: await listPlatformPersonas(c.env as Env, db, 'active') });
  });

  return router;
}
