/**
 * Workforce routes — /api/workforce/*
 *
 * Public (no auth):
 *   GET  /agents          — browse published agents (marketing marketplace)
 *   GET  /agents/:id       — public agent detail
 *
 * Authenticated (tenant JWT) — manage a workspace's own cloud agents:
 *   GET    /agents/mine    — the tenant's agents (any publish state)
 *   POST   /agents         — create a cloud agent
 *   PATCH  /agents/:id      — update / publish (price + runtime support)
 *   DELETE /agents/:id      — delete a tenant-owned agent
 *
 * A cloud agent lives in `ide_agents` with project_id NULL + tenant_id set
 * (migration 0075). It can declare runtime support (cloud / agentHost / both) and be
 * published to the marketplace with a price for revenue.
 */
import { Hono } from 'hono';
import { neon } from '@neondatabase/serverless';
import { authMiddleware } from '../middleware/authMiddleware';
import type { HonoEnv } from '../../env';

const RUNTIME_SUPPORT = ['cloud', 'host', 'both'] as const;
const PRICING_MODELS = ['flat_fee', 'consumption'] as const;

/**
 * `ide_agents.skills` is a `text` column holding a JSON string. The
 * `PublishedAgent` contract (and the /workforce edit form) expects a real
 * `string[]`, so normalize every row on the way out. Mirrors the parse in
 * ideRoutes — kept here so all workforce responses honor the contract.
 */
function mapAgentRow<T extends Record<string, unknown>>(row: T | null | undefined): T | null | undefined {
  if (row == null) return row;
  const skills = row.skills;
  const parsed = Array.isArray(skills)
    ? skills
    : typeof skills === 'string'
      ? (() => { try { const v = JSON.parse(skills); return Array.isArray(v) ? v : []; } catch { return []; } })()
      : [];
  return { ...row, skills: parsed };
}

export function createWorkforceRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  const sql = (env: HonoEnv['Bindings']) => neon(env.NEON_DATABASE_URL);

  // ----- Authenticated: the tenant's own agents --------------------------
  // Registered BEFORE GET /agents/:id so "mine" isn't swallowed by the :id route.
  router.get('/agents/mine', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rows = await sql(c.env)`
      SELECT * FROM ide_agents
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at DESC
      LIMIT 200
    `;
    return c.json(rows.map(mapAgentRow));
  });

  router.post('/agents', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{
      name: string;
      title?: string;
      bio?: string;
      skills?: string[];
      baseModel?: string;
      runtimeSupport?: string;
      preferredRuntime?: string | null;
      priceCents?: number;
      pricingModel?: string;
      priceUnit?: string | null;
      published?: boolean;
    }>();

    if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);

    const runtimeSupport = (RUNTIME_SUPPORT as readonly string[]).includes(body.runtimeSupport ?? '')
      ? body.runtimeSupport! : 'cloud';
    const pricingModel = (PRICING_MODELS as readonly string[]).includes(body.pricingModel ?? '')
      ? body.pricingModel! : 'flat_fee';
    // preferred_runtime only meaningful when both are supported
    const preferredRuntime = runtimeSupport === 'both' ? (body.preferredRuntime ?? null) : null;

    const id = crypto.randomUUID();
    const [row] = await sql(c.env)`
      INSERT INTO ide_agents
        (id, tenant_id, project_id, name, title, bio, skills, base_model,
         status, hire_count, runtime_support, preferred_runtime,
         price_cents, pricing_model, price_unit, published)
      VALUES
        (${id}, ${tenantId}, NULL, ${body.name.trim()}, ${body.title?.trim() || body.name.trim()},
         ${body.bio ?? ''}, ${JSON.stringify(body.skills ?? [])}, ${body.baseModel || 'builderforce-default'},
         'active', 0, ${runtimeSupport}, ${preferredRuntime},
         ${Math.max(0, Math.round(body.priceCents ?? 0))}, ${pricingModel}, ${body.priceUnit ?? null},
         ${body.published ?? false})
      RETURNING *
    `;
    return c.json(mapAgentRow(row), 201);
  });

  router.patch('/agents/:id', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const body = await c.req.json<{
      name?: string;
      title?: string;
      bio?: string;
      skills?: string[];
      baseModel?: string;
      runtimeSupport?: string;
      preferredRuntime?: string | null;
      priceCents?: number;
      pricingModel?: string;
      priceUnit?: string | null;
      published?: boolean;
      status?: string;
    }>();

    const [existing] = await sql(c.env)`
      SELECT * FROM ide_agents WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!existing) return c.json({ error: 'Agent not found' }, 404);

    const runtimeSupport = body.runtimeSupport != null && (RUNTIME_SUPPORT as readonly string[]).includes(body.runtimeSupport)
      ? body.runtimeSupport : existing.runtime_support;
    const pricingModel = body.pricingModel != null && (PRICING_MODELS as readonly string[]).includes(body.pricingModel)
      ? body.pricingModel : existing.pricing_model;
    const preferredRuntime = runtimeSupport === 'both'
      ? (body.preferredRuntime !== undefined ? body.preferredRuntime : existing.preferred_runtime)
      : null;

    const [row] = await sql(c.env)`
      UPDATE ide_agents SET
        name              = ${body.name?.trim() ?? existing.name},
        title             = ${body.title?.trim() ?? existing.title},
        bio               = ${body.bio ?? existing.bio},
        skills            = ${body.skills != null ? JSON.stringify(body.skills) : existing.skills},
        base_model        = ${body.baseModel ?? existing.base_model},
        runtime_support   = ${runtimeSupport},
        preferred_runtime = ${preferredRuntime},
        price_cents       = ${body.priceCents != null ? Math.max(0, Math.round(body.priceCents)) : existing.price_cents},
        pricing_model     = ${pricingModel},
        price_unit        = ${body.priceUnit !== undefined ? body.priceUnit : existing.price_unit},
        published         = ${body.published ?? existing.published},
        status            = ${body.status ?? existing.status},
        updated_at        = NOW()
      WHERE id = ${id} AND tenant_id = ${tenantId}
      RETURNING *
    `;
    return c.json(mapAgentRow(row));
  });

  router.delete('/agents/:id', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const rows = await sql(c.env)`
      DELETE FROM ide_agents WHERE id = ${id} AND tenant_id = ${tenantId} RETURNING id
    `;
    if (rows.length === 0) return c.json({ error: 'Agent not found' }, 404);
    return c.json({ deleted: true });
  });

  // ----- Public: browse published agents ---------------------------------
  // GET /api/workforce/agents — list active published agents
  router.get('/agents', async (c) => {
    const rows = await sql(c.env)`
      SELECT *
      FROM ide_agents
      WHERE status = 'active'
      ORDER BY hire_count DESC, created_at DESC
      LIMIT 200
    `;
    return c.json(rows.map(mapAgentRow));
  });

  // GET /api/workforce/agents/:id — public agent detail
  router.get('/agents/:id', async (c) => {
    const [row] = await sql(c.env)`
      SELECT *
      FROM ide_agents
      WHERE id = ${c.req.param('id')} AND status = 'active'
    `;
    if (!row) return c.json({ error: 'Agent not found' }, 404);
    return c.json(mapAgentRow(row));
  });

  return router;
}
