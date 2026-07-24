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
import { runtimeHiredAgentsCacheKey } from './runtimeRoutes';
import { tenantHasFeature } from '../middleware/featureGate';
import { sanitizePsychometricProfile } from '../../application/persona/psychometricCatalog';
import { assigneeProfilesCacheKey } from '../../application/kanban/assigneeProfiles';
import { assignableWorkforceCacheKey } from '../../application/kanban/assignableWorkforce';
import { parseJsonArray } from '../../domain/shared/json';
import { CLOUD_SURFACES } from '../../application/runtime/cloudDispatch';
import type { Env, HonoEnv } from '../../env';

/** Cache key for a tenant's purchased (marketplace-acquired) agents. */
const purchasedCacheKey = (tenantId: number): string => `wf:purchased:${tenantId}`;

/** Cache key for the PUBLIC marketplace agent listing (no tenant scope — it is the
 *  same world-readable registry for everyone). Read-heavy + open to the world →
 *  served through getOrSetCached; invalidated on any write that changes a row that
 *  could appear in it (create/update/hire/delete), including an eval-score change. */
export const PUBLIC_LIST_CACHE_KEY = 'wf:public:agents';
const PUBLIC_LIST_CACHE_TTL_SECONDS = 120;

/** Every cached read an agent create/update/delete can stale: the public listing,
 *  this tenant's assignee-hovercard profiles, and the assignable-workforce union the
 *  role/ticket pickers read (so a just-created agent is pickable immediately). */
async function invalidateAgentCaches(env: Env, tenantId: number): Promise<void> {
  await Promise.all([
    invalidateCached(env, PUBLIC_LIST_CACHE_KEY),
    invalidateCached(env, assigneeProfilesCacheKey(tenantId)),
    invalidateCached(env, assignableWorkforceCacheKey(tenantId)),
  ]);
}

/**
 * Every cached read a HIRE or UNHIRE staled. Hiring adds a callable role to the
 * tenant's workforce and unhiring removes one, so both change exactly the same
 * surfaces an agent create/delete does — plus the buyer's purchased list and the
 * runtime's hired-agent registry.
 *
 * This exists because the two hire handlers hand-rolled their own invalidation
 * list and it had drifted from {@link invalidateAgentCaches}: neither cleared
 * `kanban:assignable:t:<tenant>`, so a freshly-hired agent was missing from the
 * role/ticket picker for up to that key's 60s TTL (hire → assign made you wait),
 * and neither cleared the assignee hovercard profiles the picker then reads.
 * One helper, so the next key added to the roster can't miss the hire path.
 *
 * `publicListing` is conditional because `hire_count` drives the public listing's
 * ordering and only moves on a real inactive→active transition — a redundant
 * re-hire must not bust a cache shared by every tenant.
 */
export async function invalidateHireCaches(env: Env, tenantId: number, opts: { publicListing: boolean }): Promise<void> {
  await Promise.all([
    invalidateCached(env, purchasedCacheKey(tenantId)),
    invalidateCached(env, runtimeHiredAgentsCacheKey(tenantId)),
    invalidateCached(env, assignableWorkforceCacheKey(tenantId)),
    invalidateCached(env, assigneeProfilesCacheKey(tenantId)),
    opts.publicListing ? invalidateCached(env, PUBLIC_LIST_CACHE_KEY) : Promise.resolve(),
  ]);
}

/**
 * The PUBLIC projection of a marketplace agent. Marketing promises agents listed
 * "with evaluation scores", so a single non-sensitive `evalScore` (the agent's
 * 0..1 evaluation/quality score from training — `ide_agents.eval_score`) ships
 * here. The owner-only perf rollup (successRate / latency / per-tenant feedback)
 * NEVER appears on a public route — only this one aggregate quality number.
 */
function mapPublicAgentRow(row: Record<string, unknown>): Record<string, unknown> {
  const raw = row.eval_score;
  const score = typeof raw === 'number' ? raw : raw == null ? null : Number(raw);
  // EXPLICIT allowlist — never spread the raw row onto a world-readable route.
  // Excludes tenant_id, project_id, role_keys (internal config/dispatch) and
  // psychometric (unpublished persona internals). Only marketplace-facing fields ship.
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    bio: row.bio,
    skills: parseJsonArray(row.skills),
    base_model: row.base_model,
    builtin_kind: row.builtin_kind ?? null,
    status: row.status,
    hire_count: row.hire_count,
    runtime_support: row.runtime_support,
    preferred_runtime: row.preferred_runtime ?? null,
    runtime_surface: row.runtime_surface ?? null,
    price_cents: row.price_cents,
    pricing_model: row.pricing_model,
    price_unit: row.price_unit ?? null,
    published: row.published,
    created_at: row.created_at,
    updated_at: row.updated_at,
    evalScore: score != null && Number.isFinite(score) ? score : null,
  };
}

/** Cache key for an agent's owner-only performance + feedback rollup (gap [1247]).
 *  Keyed on agent_id (not tenant) — the rollup spans every tenant that hired it.
 *  Invalidated on a new feedback row; a short TTL covers fresh-run drift since
 *  run completion is written from many out-of-scope runtime sites. */
const perfCacheKey = (agentId: string): string => `wf:perf:${agentId}`;
const PERF_CACHE_TTL_SECONDS = 60;

const RUNTIME_SUPPORT = ['cloud', 'host', 'both'] as const;
const PRICING_MODELS = ['flat_fee', 'consumption'] as const;
// There is ONE agent engine — the current version (CURRENT_ENGINE_ID), resolved at run
// time from the constant. It is not user-selectable and is not persisted (the vestigial
// `ide_agents.engine` column was dropped in migration 0321).
/** The cloud-agent execution surfaces (see migration 0105 / cloudDispatch). */
/**
 * Re-exported from cloudDispatch rather than re-declared: this validation
 * whitelist and the `CloudSurface` union were two hand-maintained lists of the
 * same thing, so adding a surface to one silently left the other rejecting it.
 * One list, one place.
 */
const RUNTIME_SURFACES = CLOUD_SURFACES;

/**
 * `ide_agents.skills` is a `text` column holding a JSON string. The
 * `PublishedAgent` contract (and the /workforce edit form) expects a real
 * `string[]`, so normalize every row on the way out. Mirrors the parse in
 * ideRoutes — kept here so all workforce responses honor the contract.
 */
function mapAgentRow<T extends Record<string, unknown>>(row: T | null | undefined): T | null | undefined {
  if (row == null) return row;
  const parsed = parseJsonArray(row.skills);
  // Parse the agent's own personality JSON so the editor round-trips it as an object
  // (stored as text; mirrors how `skills` is parsed). null when unset.
  const psy = row.psychometric;
  const psychometric = typeof psy === 'string'
    ? (() => { try { return JSON.parse(psy) as unknown; } catch { return null; } })()
    : (psy ?? null);
  return { ...row, skills: parsed, psychometric };
}

/**
 * Owner-only performance + buyer-feedback rollup for one agent (gap [1247]).
 * Read-heavy (fan-out over telemetry + feedback) → served through getOrSetCached.
 *
 * Perf is computed from the `executions` telemetry for the agent's PAST runs that
 * ran AS this agent (`cloud_agent_ref`), restricted to the tenants currently
 * holding an active hire — i.e. "how well is the agent performing per hired
 * tenant". `success rate` = completed / terminal runs; `avg latency` is the mean
 * completed-minus-started duration over completed runs. Feedback is the buyers'
 * ratings/comments. All cross-tenant numbers — owner-only, never on a public route.
 */
export interface AgentPerfRollup {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  successRate: number | null;       // completed / (completed+failed+cancelled), null when no terminal runs
  avgLatencyMs: number | null;      // mean completed-started over completed runs, null when none
  hiredTenants: number;             // distinct tenants currently holding an active hire
  ratingCount: number;
  avgRating: number | null;
  feedback: { rating: number; comment: string | null; createdAt: string }[];
}

/** The neon tagged-template the routes build via `sql(c.env)` (array-mode false). */
type SqlClient = ReturnType<typeof neon<false, false>>;

export async function loadAgentPerfRollup(
  q: SqlClient,
  agentId: string,
): Promise<AgentPerfRollup> {
  // Perf telemetry, scoped to runs that ran AS this agent for a currently-active
  // hirer. Latency is server-side seconds*1000 so it survives JSON without TZ drift.
  const [perf] = await q`
    SELECT
      COUNT(*)::int                                                        AS total_runs,
      COUNT(*) FILTER (WHERE e.status = 'completed')::int                  AS completed_runs,
      COUNT(*) FILTER (WHERE e.status IN ('failed','cancelled'))::int      AS failed_runs,
      AVG(EXTRACT(EPOCH FROM (e.completed_at - e.started_at)) * 1000)
        FILTER (WHERE e.status = 'completed'
                AND e.started_at IS NOT NULL AND e.completed_at IS NOT NULL) AS avg_latency_ms
    FROM executions e
    WHERE e.cloud_agent_ref = ${agentId}
      AND EXISTS (
        SELECT 1 FROM agent_purchases p
        WHERE p.agent_id = ${agentId} AND p.tenant_id = e.tenant_id AND p.unhired_at IS NULL
      )
  `;
  const [hires] = await q`
    SELECT COUNT(*)::int AS hired_tenants
    FROM agent_purchases p WHERE p.agent_id = ${agentId} AND p.unhired_at IS NULL
  `;
  const fbRows = await q`
    SELECT rating, comment, created_at
    FROM agent_feedback WHERE agent_id = ${agentId}
    ORDER BY created_at DESC
    LIMIT 50
  ` as unknown as { rating: number; comment: string | null; created_at: string }[];

  const completed = Number(perf?.completed_runs ?? 0);
  const failed = Number(perf?.failed_runs ?? 0);
  const terminal = completed + failed;
  const ratings = fbRows.map((r) => Number(r.rating));
  const avgLatency = perf?.avg_latency_ms == null ? null : Math.round(Number(perf.avg_latency_ms));

  return {
    totalRuns: Number(perf?.total_runs ?? 0),
    completedRuns: completed,
    failedRuns: failed,
    successRate: terminal === 0 ? null : completed / terminal,
    avgLatencyMs: avgLatency,
    hiredTenants: Number(hires?.hired_tenants ?? 0),
    ratingCount: ratings.length,
    avgRating: ratings.length === 0 ? null : ratings.reduce((a, b) => a + b, 0) / ratings.length,
    feedback: fbRows.map((r) => ({ rating: Number(r.rating), comment: r.comment, createdAt: r.created_at })),
  };
}

export function createWorkforceRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  const sql = (env: HonoEnv['Bindings']) => neon(env.NEON_DATABASE_URL);

  // ----- Authenticated: the tenant's own agents --------------------------
  // Registered BEFORE GET /agents/:id so "mine" isn't swallowed by the :id route.
  router.get('/agents/mine', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    // active_hires = tenants CURRENTLY holding the agent (owner-only "in use"
    // metric). Distinct from the cumulative hire_count. Owner-scoped, so it ships
    // only on /mine, never on the public marketplace list.
    const rows = await sql(c.env)`
      SELECT a.*, (
        SELECT COUNT(*) FROM agent_purchases p
        WHERE p.agent_id = a.id AND p.unhired_at IS NULL
      )::int AS active_hires
      FROM ide_agents a
      WHERE a.tenant_id = ${tenantId}
      ORDER BY a.created_at DESC
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
    await invalidateHireCaches(c.env as Env, tenantId, { publicListing: changed.length > 0 });
    return c.json(mapAgentRow(row));
  });

  // DELETE /agents/:id/hire — release a previously-hired marketplace agent from
  // this tenant's workforce. SOFT delete: the purchase row stays (with unhired_at
  // stamped) so any work the agent did keeps its hire provenance for contributor
  // and performance history; it just drops out of the active "purchased" list.
  // hire_count is CUMULATIVE ("times hired") — unhiring does NOT decrement it.
  // Idempotent: unhiring something not actively held is a no-op success.
  router.delete('/agents/:id/hire', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const removed = await sql(c.env)`
      UPDATE agent_purchases SET unhired_at = NOW()
      WHERE tenant_id = ${tenantId} AND agent_id = ${id} AND unhired_at IS NULL
      RETURNING agent_id
    `;
    // hire_count is cumulative, so an unhire never reorders the public listing.
    await invalidateHireCaches(c.env as Env, tenantId, { publicListing: false });
    return c.json({ unhired: removed.length > 0 });
  });

  router.post('/agents', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    const body = await c.req.json<{
      name: string;
      title?: string;
      bio?: string;
      skills?: string[];
      baseModel?: string;
      runtimeSupport?: string;
      preferredRuntime?: string | null;
      runtimeSurface?: string;
      priceCents?: number;
      pricingModel?: string;
      priceUnit?: string | null;
      published?: boolean;
      psychometric?: unknown;
    }>();

    if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);

    const runtimeSupport = (RUNTIME_SUPPORT as readonly string[]).includes(body.runtimeSupport ?? '')
      ? body.runtimeSupport! : 'cloud';
    const pricingModel = (PRICING_MODELS as readonly string[]).includes(body.pricingModel ?? '')
      ? body.pricingModel! : 'flat_fee';
    // Which execution surface the agent runs on (durable DO vs long-lived node).
    const runtimeSurface = (RUNTIME_SURFACES as readonly string[]).includes(body.runtimeSurface ?? '')
      ? body.runtimeSurface! : 'durable';
    // preferred_runtime only meaningful when both are supported
    const preferredRuntime = runtimeSupport === 'both' ? (body.preferredRuntime ?? null) : null;
    // Per-agent personality is a Pro feature — store none for free plans (rather than
    // failing the create) so the agent still saves.
    const psychometric = body.psychometric != null && (await tenantHasFeature(c.env, tenantId, userId, 'psychometricPersona'))
      ? sanitizePsychometricProfile(body.psychometric)
      : null;

    const id = crypto.randomUUID();
    const [row] = await sql(c.env)`
      INSERT INTO ide_agents
        (id, tenant_id, project_id, name, title, bio, skills, base_model,
         status, hire_count, runtime_support, preferred_runtime, runtime_surface,
         price_cents, pricing_model, price_unit, published, psychometric)
      VALUES
        (${id}, ${tenantId}, NULL, ${body.name.trim()}, ${body.title?.trim() || body.name.trim()},
         ${body.bio ?? ''}, ${JSON.stringify(body.skills ?? [])}, ${body.baseModel || 'builderforce-default'},
         'active', 0, ${runtimeSupport}, ${preferredRuntime}, ${runtimeSurface},
         ${Math.max(0, Math.round(body.priceCents ?? 0))}, ${pricingModel}, ${body.priceUnit ?? null},
         ${body.published ?? false}, ${psychometric})
      RETURNING *
    `;
    await invalidateAgentCaches(c.env as Env, tenantId);
    return c.json(mapAgentRow(row), 201);
  });

  router.patch('/agents/:id', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    const id = c.req.param('id');
    const body = await c.req.json<{
      name?: string;
      title?: string;
      bio?: string;
      skills?: string[];
      baseModel?: string;
      runtimeSupport?: string;
      preferredRuntime?: string | null;
      runtimeSurface?: string;
      priceCents?: number;
      pricingModel?: string;
      priceUnit?: string | null;
      published?: boolean;
      status?: string;
      psychometric?: unknown;
    }>();

    const [existing] = await sql(c.env)`
      SELECT * FROM ide_agents WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!existing) return c.json({ error: 'Agent not found' }, 404);

    // Per-agent personality (Pro). `undefined` = field not sent → keep existing;
    // `null` = explicit clear; an object = set (Pro-gated, sanitized).
    let psychometric = existing.psychometric as string | null;
    if (body.psychometric !== undefined) {
      psychometric = body.psychometric != null && (await tenantHasFeature(c.env, tenantId, userId, 'psychometricPersona'))
        ? sanitizePsychometricProfile(body.psychometric)
        : null;
    }

    const runtimeSupport = body.runtimeSupport != null && (RUNTIME_SUPPORT as readonly string[]).includes(body.runtimeSupport)
      ? body.runtimeSupport : existing.runtime_support;
    const pricingModel = body.pricingModel != null && (PRICING_MODELS as readonly string[]).includes(body.pricingModel)
      ? body.pricingModel : existing.pricing_model;
    const runtimeSurface = body.runtimeSurface != null && (RUNTIME_SURFACES as readonly string[]).includes(body.runtimeSurface)
      ? body.runtimeSurface : (existing.runtime_surface ?? 'durable');
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
        runtime_surface   = ${runtimeSurface},
        price_cents       = ${body.priceCents != null ? Math.max(0, Math.round(body.priceCents)) : existing.price_cents},
        pricing_model     = ${pricingModel},
        price_unit        = ${body.priceUnit !== undefined ? body.priceUnit : existing.price_unit},
        published         = ${body.published ?? existing.published},
        status            = ${body.status ?? existing.status},
        psychometric      = ${psychometric},
        updated_at        = NOW()
      WHERE id = ${id} AND tenant_id = ${tenantId}
      RETURNING *
    `;
    // Name/title/bio/skills/status/published — and the agent's eval score, if a
    // training-publish flow patches it — all surface in the cached reads.
    await invalidateAgentCaches(c.env as Env, tenantId);
    return c.json(mapAgentRow(row));
  });

  router.delete('/agents/:id', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');

    // Only a tenant's OWN agent that is unpublished AND has no purchases may be
    // deleted — never pull a published/purchased agent out from under buyers.
    const [existing] = await sql(c.env)`
      SELECT published FROM ide_agents WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!existing) return c.json({ error: 'Agent not found' }, 404);
    if (existing.published) {
      return c.json({ error: 'Unpublish this agent before deleting it.' }, 409);
    }
    // Only an ACTIVE hold blocks deletion — a soft-deleted (unhired) purchase is
    // just history and must not pin the agent in place forever. Note we do NOT
    // gate on hire_count: it is cumulative ("times hired") and never decrements,
    // so an agent every buyer has since released must still be deletable.
    const [purchase] = await sql(c.env)`
      SELECT 1 FROM agent_purchases WHERE agent_id = ${id} AND unhired_at IS NULL LIMIT 1
    `;
    if (purchase) {
      return c.json({ error: 'This agent is currently hired by another workspace and cannot be deleted.' }, 409);
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
    await invalidateAgentCaches(c.env as Env, tenantId);
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

  // ----- Owner-only: agent performance + buyer feedback (gap [1247]) -------
  // GET /agents/:id/perf — owner-only rollup (success rate / runs / latency per
  // hired tenant + buyer ratings). 404 unless the caller OWNS the agent, so the
  // cross-tenant telemetry never leaks. Read-heavy → read-through cached on
  // agent_id; invalidated when a buyer posts feedback (short TTL covers run drift).
  router.get('/agents/:id/perf', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [owned] = await sql(c.env)`
      SELECT 1 FROM ide_agents WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!owned) return c.json({ error: 'Agent not found' }, 404);
    const rollup = await getOrSetCached(
      c.env as Env,
      perfCacheKey(id),
      () => loadAgentPerfRollup(sql(c.env), id),
      { kvTtlSeconds: PERF_CACHE_TTL_SECONDS },
    );
    return c.json(rollup);
  });

  // POST /agents/:id/feedback — a BUYER (a tenant holding an active hire) rates
  // the agent. One row per hire (UPSERT), invalidates the owner's perf cache.
  router.post('/agents/:id/feedback', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const body = await c.req.json<{ rating?: number; comment?: string | null }>();
    const rating = Math.round(Number(body.rating));
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return c.json({ error: 'rating must be an integer 1..5' }, 400);
    }
    // Must hold an ACTIVE hire to leave feedback — feedback rides the purchase row.
    const [purchase] = await sql(c.env)`
      SELECT id FROM agent_purchases
      WHERE tenant_id = ${tenantId} AND agent_id = ${id} AND unhired_at IS NULL
    `;
    if (!purchase) return c.json({ error: 'Hire this agent before leaving feedback.' }, 409);

    const comment = (body.comment ?? '').toString().trim() || null;
    const [row] = await sql(c.env)`
      INSERT INTO agent_feedback (purchase_id, agent_id, tenant_id, rating, comment)
      VALUES (${purchase.id}, ${id}, ${tenantId}, ${rating}, ${comment})
      ON CONFLICT (purchase_id) DO UPDATE
        SET rating = ${rating}, comment = ${comment}, created_at = NOW()
      RETURNING id
    `;
    await invalidateCached(c.env as Env, perfCacheKey(id));
    return c.json({ id: row?.id }, 201);
  });

  // ----- Public: browse published agents ---------------------------------
  // GET /api/workforce/agents — list active published agents (with evalScore).
  // Read-heavy + world-readable → served through the read-through cache; the
  // listing is invalidated by every write below that can change a listed row.
  router.get('/agents', async (c) => {
    const rows = await getOrSetCached(
      c.env as Env,
      PUBLIC_LIST_CACHE_KEY,
      () => sql(c.env)`
        SELECT *
        FROM ide_agents
        WHERE status = 'active' AND published = true
        ORDER BY hire_count DESC, created_at DESC
        LIMIT 200
      ` as unknown as Promise<Record<string, unknown>[]>,
      { kvTtlSeconds: PUBLIC_LIST_CACHE_TTL_SECONDS },
    );
    return c.json(rows.map(mapPublicAgentRow));
  });

  // GET /api/workforce/agents/:id — public agent detail (with evalScore).
  router.get('/agents/:id', async (c) => {
    const [row] = await sql(c.env)`
      SELECT *
      FROM ide_agents
      WHERE id = ${c.req.param('id')} AND status = 'active' AND published = true
    `;
    if (!row) return c.json({ error: 'Agent not found' }, 404);
    return c.json(mapPublicAgentRow(row));
  });

  return router;
}
