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
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import type { Env, HonoEnv } from '../../env';

/** Cache key for a tenant's purchased (marketplace-acquired) agents. */
const purchasedCacheKey = (tenantId: number): string => `wf:purchased:${tenantId}`;

const RUNTIME_SUPPORT = ['cloud', 'host', 'both'] as const;
const PRICING_MODELS = ['flat_fee', 'consumption'] as const;
const AGENT_ENGINES = ['builderforce-v1', 'builderforce-v2'] as const;

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

  // GET /agents/purchased — agents this tenant acquired from the marketplace
  // (distinct from /agents/mine, which is the tenant's OWN created agents).
  // Read-through cached; invalidated on hire.
  router.get('/agents/purchased', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rows = await getOrSetCached(c.env as Env, purchasedCacheKey(tenantId), () =>
      sql(c.env)`
        SELECT a.* FROM ide_agents a
        JOIN agent_purchases p ON p.agent_id = a.id
        WHERE p.tenant_id = ${tenantId} AND p.unhired_at IS NULL AND a.status = 'active'
        ORDER BY p.created_at DESC
        LIMIT 200
      ` as unknown as Promise<Record<string, unknown>[]>,
    );
    return c.json(rows.map(mapAgentRow));
  });

  // POST /agents/:id/hire — acquire a published marketplace agent into this
  // tenant's workforce. Records the purchase (idempotent) and bumps the agent's
  // aggregate hire counter. Authenticated so the buyer (tenant) is known.
  router.post('/agents/:id/hire', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [agent] = await sql(c.env)`
      SELECT id, published, status, tenant_id FROM ide_agents WHERE id = ${id} AND status = 'active'
    `;
    if (!agent) return c.json({ error: 'Agent not found' }, 404);
    // You can't hire your own agent — owned agents are already in your workforce
    // (they show under /agents/mine). Allowing it created a self-duplicate that
    // inflated hire_count and could not be unhired or deleted (see migration 0102).
    if (Number(agent.tenant_id) === Number(tenantId)) {
      return c.json({ error: 'You already own this agent — it is already in your workforce.' }, 409);
    }
    if (!agent.published) return c.json({ error: 'Agent is not published to the marketplace' }, 409);

    // Insert a fresh purchase OR revive a previously soft-deleted (unhired) one.
    // The WHERE on the conflict path means re-hiring an ALREADY-active agent is a
    // true no-op (returns no row) — so hire_count only moves on a real
    // inactive→active transition, never on a redundant re-hire.
    const changed = await sql(c.env)`
      INSERT INTO agent_purchases (tenant_id, agent_id) VALUES (${tenantId}, ${id})
      ON CONFLICT (tenant_id, agent_id) DO UPDATE SET unhired_at = NULL
        WHERE agent_purchases.unhired_at IS NOT NULL
      RETURNING id
    `;
    const [row] = changed.length > 0
      ? await sql(c.env)`
          UPDATE ide_agents SET hire_count = hire_count + 1, updated_at = NOW() WHERE id = ${id} RETURNING *
        `
      : await sql(c.env)`SELECT * FROM ide_agents WHERE id = ${id}`;
    await invalidateCached(c.env as Env, purchasedCacheKey(tenantId));
    return c.json(mapAgentRow(row));
  });

  // DELETE /agents/:id/hire — release a previously-hired marketplace agent from
  // this tenant's workforce. SOFT delete: the purchase row stays (with unhired_at
  // stamped) so any work the agent did keeps its hire provenance for contributor
  // and performance history; it just drops out of the active "purchased" list.
  // Decrements the aggregate hire counter (floored at 0). Idempotent: unhiring
  // something not actively held is a no-op success.
  router.delete('/agents/:id/hire', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const removed = await sql(c.env)`
      UPDATE agent_purchases SET unhired_at = NOW()
      WHERE tenant_id = ${tenantId} AND agent_id = ${id} AND unhired_at IS NULL
      RETURNING agent_id
    `;
    if (removed.length === 0) {
      await invalidateCached(c.env as Env, purchasedCacheKey(tenantId));
      return c.json({ unhired: false });
    }
    await sql(c.env)`
      UPDATE ide_agents SET hire_count = GREATEST(hire_count - 1, 0), updated_at = NOW() WHERE id = ${id}
    `;
    await invalidateCached(c.env as Env, purchasedCacheKey(tenantId));
    return c.json({ unhired: true });
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
      engine?: string;
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
    const engine = (AGENT_ENGINES as readonly string[]).includes(body.engine ?? '')
      ? body.engine! : 'builderforce-v1';
    // preferred_runtime only meaningful when both are supported
    const preferredRuntime = runtimeSupport === 'both' ? (body.preferredRuntime ?? null) : null;

    const id = crypto.randomUUID();
    const [row] = await sql(c.env)`
      INSERT INTO ide_agents
        (id, tenant_id, project_id, name, title, bio, skills, base_model,
         status, hire_count, runtime_support, preferred_runtime, engine,
         price_cents, pricing_model, price_unit, published)
      VALUES
        (${id}, ${tenantId}, NULL, ${body.name.trim()}, ${body.title?.trim() || body.name.trim()},
         ${body.bio ?? ''}, ${JSON.stringify(body.skills ?? [])}, ${body.baseModel || 'builderforce-default'},
         'active', 0, ${runtimeSupport}, ${preferredRuntime}, ${engine},
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
      engine?: string;
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
    const engine = body.engine != null && (AGENT_ENGINES as readonly string[]).includes(body.engine)
      ? body.engine : existing.engine;
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
        engine            = ${engine},
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

    // Only a tenant's OWN agent that is unpublished AND has no purchases may be
    // deleted — never pull a published/purchased agent out from under buyers.
    const [existing] = await sql(c.env)`
      SELECT published, hire_count FROM ide_agents WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!existing) return c.json({ error: 'Agent not found' }, 404);
    if (existing.published) {
      return c.json({ error: 'Unpublish this agent before deleting it.' }, 409);
    }
    // Only ACTIVE purchases block deletion — a soft-deleted (unhired) purchase is
    // just history and must not pin the agent in place forever.
    const [purchase] = await sql(c.env)`
      SELECT 1 FROM agent_purchases WHERE agent_id = ${id} AND unhired_at IS NULL LIMIT 1
    `;
    if (purchase || Number(existing.hire_count ?? 0) > 0) {
      return c.json({ error: 'This agent has been purchased and cannot be deleted.' }, 409);
    }

    // Drop the agent and its canonical identity bridge + per-agent assignments.
    const rows = await sql(c.env)`
      DELETE FROM ide_agents WHERE id = ${id} AND tenant_id = ${tenantId} RETURNING id
    `;
    if (rows.length === 0) return c.json({ error: 'Agent not found' }, 404);

    const bridges = await sql(c.env)`
      DELETE FROM project_agents
      WHERE tenant_id = ${tenantId} AND agent_kind = 'workforce' AND agent_ref = ${id} AND project_id IS NULL
      RETURNING id
    `;
    const bridgeId = bridges[0]?.id;
    if (bridgeId != null) {
      await sql(c.env)`
        DELETE FROM artifact_assignments
        WHERE tenant_id = ${tenantId} AND scope = 'agent' AND scope_id = ${bridgeId}
      `;
    }
    return c.json({ deleted: true });
  });

  // ----- Canonical agent identity (for per-agent capability assignment) ----
  // Ensures the tenant-wide, project-less project_agents row for a cloud agent
  // and returns its numeric id. Per-agent skills/personas are assigned against
  // it via artifact_assignments scope='agent' + scope_id = projectAgentId, so
  // they follow the agent everywhere (IDE / Workflow / on-prem / cloud) rather
  // than being tied to any one project (swimlane).
  router.post('/agents/:id/bridge', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const id = c.req.param('id');

    const [agent] = await sql(c.env)`
      SELECT id, name FROM ide_agents WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!agent) return c.json({ error: 'Agent not found' }, 404);

    const [existing] = await sql(c.env)`
      SELECT id FROM project_agents
      WHERE tenant_id = ${tenantId} AND agent_kind = 'workforce' AND agent_ref = ${id} AND project_id IS NULL
    `;
    if (existing) return c.json({ projectAgentId: existing.id });

    const [created] = await sql(c.env)`
      INSERT INTO project_agents (tenant_id, project_id, agent_kind, agent_ref, name, added_by)
      VALUES (${tenantId}, NULL, 'workforce', ${id}, ${agent.name}, ${userId})
      ON CONFLICT (tenant_id, agent_kind, agent_ref) WHERE project_id IS NULL DO NOTHING
      RETURNING id
    `;
    if (created) return c.json({ projectAgentId: created.id }, 201);

    // Lost an insert race — read the row the other request created.
    const [row] = await sql(c.env)`
      SELECT id FROM project_agents
      WHERE tenant_id = ${tenantId} AND agent_kind = 'workforce' AND agent_ref = ${id} AND project_id IS NULL
    `;
    if (!row) return c.json({ error: 'Failed to create agent identity' }, 500);
    return c.json({ projectAgentId: row.id });
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
