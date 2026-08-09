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
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import {
  agentFeedback,
  agentPurchases,
  artifactAssignments,
  ideAgents,
  projectAgents,
} from '../../infrastructure/database/schema';
import { authMiddleware } from '../middleware/authMiddleware';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { runtimeHiredAgentsCacheKey } from './runtimeRoutes';
import { tenantHasFeature } from '../middleware/featureGate';
import { sanitizePsychometricProfile } from '../../application/persona/psychometricCatalog';
import { assigneeProfilesCacheKey } from '../../application/kanban/assigneeProfiles';
import { invalidateTeamCaches } from '../../application/kernel/TeamRoster';
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
 *  this tenant's assignee-hovercard profiles, and — through `invalidateTeamCaches`
 *  — both projections of "who is on this team" (the footer roster and the
 *  assignable-workforce union the role/ticket pickers read), so a just-created
 *  agent is on the roster and pickable immediately. */
async function invalidateAgentCaches(env: Env, tenantId: number): Promise<void> {
  await Promise.all([
    invalidateCached(env, PUBLIC_LIST_CACHE_KEY),
    invalidateCached(env, assigneeProfilesCacheKey(tenantId)),
    invalidateTeamCaches(env, tenantId),
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
    invalidateTeamCaches(env, tenantId),
    invalidateCached(env, assigneeProfilesCacheKey(tenantId)),
    opts.publicListing ? invalidateCached(env, PUBLIC_LIST_CACHE_KEY) : Promise.resolve(),
  ]);
}

/**
 * The `SELECT ide_agents.*` projection, key-for-key.
 *
 * Every workforce/marketplace response in this file ships the agent row with its
 * RAW snake_case column names (the frontend `PublishedAgent` contract reads
 * `base_model` / `hire_count` / `runtime_support` / `created_at` / …). Drizzle
 * returns camelCase, so each column is aliased back to its physical name here and
 * this ONE object is reused by every read/insert/update — key drift in a single
 * hand-written selection would silently blank a field on the Workforce card.
 *
 * It covers EVERY declared `ide_agents` column, including the training/inference
 * ones (`job_id`, `lora_rank`, `r2_artifact_key`, `resume_md`, `package_version`,
 * `mamba_state`, `inference_mode`, `request_count`, `last_used_at`) that no
 * workforce handler reads but that `SELECT *` shipped — `PublishedAgent` declares
 * several of them, so narrowing the projection would change the response.
 */
const agentRowColumns = {
  id:                ideAgents.id,
  project_id:        ideAgents.projectId,
  job_id:            ideAgents.jobId,
  name:              ideAgents.name,
  title:             ideAgents.title,
  bio:               ideAgents.bio,
  skills:            ideAgents.skills,
  base_model:        ideAgents.baseModel,
  lora_rank:         ideAgents.loraRank,
  r2_artifact_key:   ideAgents.r2ArtifactKey,
  resume_md:         ideAgents.resumeMd,
  status:            ideAgents.status,
  hire_count:        ideAgents.hireCount,
  eval_score:        ideAgents.evalScore,
  created_at:        ideAgents.createdAt,
  updated_at:        ideAgents.updatedAt,
  package_version:   ideAgents.packageVersion,
  mamba_state:       ideAgents.mambaState,
  inference_mode:    ideAgents.inferenceMode,
  request_count:     ideAgents.requestCount,
  last_used_at:      ideAgents.lastUsedAt,
  tenant_id:         ideAgents.tenantId,
  price_cents:       ideAgents.priceCents,
  pricing_model:     ideAgents.pricingModel,
  price_unit:        ideAgents.priceUnit,
  runtime_support:   ideAgents.runtimeSupport,
  preferred_runtime: ideAgents.preferredRuntime,
  published:         ideAgents.published,
  runtime_surface:   ideAgents.runtimeSurface,
  psychometric:      ideAgents.psychometric,
  builtin_kind:      ideAgents.builtinKind,
  role_keys:         ideAgents.roleKeys,
};

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

export async function loadAgentPerfRollup(
  db: Db,
  agentId: string,
): Promise<AgentPerfRollup> {
  // Perf telemetry, scoped to runs that ran AS this agent for a currently-active
  // hirer. Latency is server-side seconds*1000 so it survives JSON without TZ drift.
  //
  // `db.execute` (still Drizzle) rather than the query builder: this is four
  // aggregates with per-aggregate FILTER clauses over a correlated EXISTS — the
  // builder has no FILTER construct, so expressing it would mean one sql`` fragment
  // per selected column plus a hand-written subquery, i.e. the same SQL with more
  // ceremony and more places to drift.
  const perfResult = await db.execute(sql`
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
  `);
  const [perf] = perfResult.rows as Array<{
    total_runs: number | string | null;
    completed_runs: number | string | null;
    failed_runs: number | string | null;
    avg_latency_ms: number | string | null;
  }>;
  const [hires] = await db
    .select({ hired_tenants: sql<number>`COUNT(*)::int` })
    .from(agentPurchases)
    .where(and(eq(agentPurchases.agentId, agentId), isNull(agentPurchases.unhiredAt)));
  const fbRows = await db
    .select({
      rating: agentFeedback.rating,
      comment: agentFeedback.comment,
      created_at: agentFeedback.createdAt,
    })
    .from(agentFeedback)
    .where(eq(agentFeedback.agentId, agentId))
    .orderBy(desc(agentFeedback.createdAt))
    .limit(50);

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
    // `createdAt` is declared `string`; Drizzle hands back a Date for a timestamp
    // column, so normalize here. c.json() serialized the Date to the same ISO
    // string before, and this also makes the cache-hit (KV, already a string) and
    // cache-miss shapes identical instead of Date-vs-string.
    feedback: fbRows.map((r) => ({
      rating: Number(r.rating),
      comment: r.comment,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    })),
  };
}

export function createWorkforceRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // ----- Authenticated: the tenant's own agents --------------------------
  // Registered BEFORE GET /agents/:id so "mine" isn't swallowed by the :id route.
  router.get('/agents/mine', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    // active_hires = tenants CURRENTLY holding the agent (owner-only "in use"
    // metric). Distinct from the cumulative hire_count. Owner-scoped, so it ships
    // only on /mine, never on the public marketplace list.
    const rows = await db
      .select({
        ...agentRowColumns,
        // `ide_agents.id` is spelled out rather than interpolated: in a
        // single-table select Drizzle renders `${ideAgents.id}` UNQUALIFIED, and
        // inside this subquery a bare "id" binds to `agent_purchases.id` (the
        // inner scope wins), which would silently make every count 0.
        active_hires: sql<number>`(
          SELECT COUNT(*) FROM agent_purchases
          WHERE agent_purchases.agent_id = ide_agents.id AND agent_purchases.unhired_at IS NULL
        )::int`,
      })
      .from(ideAgents)
      .where(eq(ideAgents.tenantId, tenantId))
      .orderBy(desc(ideAgents.createdAt))
      .limit(200);
    return c.json(rows.map(mapAgentRow));
  });

  // GET /agents/purchased — agents this tenant acquired from the marketplace
  // (distinct from /agents/mine, which is the tenant's OWN created agents).
  // Read-through cached; invalidated on hire.
  router.get('/agents/purchased', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const rows = await getOrSetCached(c.env as Env, purchasedCacheKey(tenantId), () =>
      db
        .select(agentRowColumns)
        .from(ideAgents)
        .innerJoin(agentPurchases, eq(agentPurchases.agentId, ideAgents.id))
        .where(and(
          eq(agentPurchases.tenantId, tenantId),
          isNull(agentPurchases.unhiredAt),
          eq(ideAgents.status, 'active'),
        ))
        .orderBy(desc(agentPurchases.createdAt))
        .limit(200),
    );
    return c.json(rows.map(mapAgentRow));
  });

  // POST /agents/:id/hire — acquire a published marketplace agent into this
  // tenant's workforce. Records the purchase (idempotent) and bumps the agent's
  // aggregate hire counter. Authenticated so the buyer (tenant) is known.
  router.post('/agents/:id/hire', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [agent] = await db
      .select({
        id: ideAgents.id,
        published: ideAgents.published,
        status: ideAgents.status,
        tenant_id: ideAgents.tenantId,
      })
      .from(ideAgents)
      .where(and(eq(ideAgents.id, id), eq(ideAgents.status, 'active')));
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
    const changed = await db
      .insert(agentPurchases)
      .values({ tenantId, agentId: id })
      .onConflictDoUpdate({
        target: [agentPurchases.tenantId, agentPurchases.agentId],
        set: { unhiredAt: null },
        setWhere: isNotNull(agentPurchases.unhiredAt),
      })
      .returning({ id: agentPurchases.id });
    const [row] = changed.length > 0
      ? await db
          .update(ideAgents)
          .set({ hireCount: sql`${ideAgents.hireCount} + 1`, updatedAt: sql`NOW()` })
          .where(eq(ideAgents.id, id))
          .returning(agentRowColumns)
      : await db.select(agentRowColumns).from(ideAgents).where(eq(ideAgents.id, id));
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
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const removed = await db
      .update(agentPurchases)
      .set({ unhiredAt: sql`NOW()` })
      .where(and(
        eq(agentPurchases.tenantId, tenantId),
        eq(agentPurchases.agentId, id),
        isNull(agentPurchases.unhiredAt),
      ))
      .returning({ agent_id: agentPurchases.agentId });
    // hire_count is cumulative, so an unhire never reorders the public listing.
    await invalidateHireCaches(c.env as Env, tenantId, { publicListing: false });
    return c.json({ unhired: removed.length > 0 });
  });

  router.post('/agents', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
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
    const [row] = await db
      .insert(ideAgents)
      .values({
        id,
        tenantId,
        projectId: null,
        name: body.name.trim(),
        title: body.title?.trim() || body.name.trim(),
        bio: body.bio ?? '',
        skills: JSON.stringify(body.skills ?? []),
        baseModel: body.baseModel || 'builderforce-default',
        status: 'active',
        hireCount: 0,
        runtimeSupport,
        preferredRuntime,
        runtimeSurface,
        priceCents: Math.max(0, Math.round(body.priceCents ?? 0)),
        pricingModel,
        priceUnit: body.priceUnit ?? null,
        published: body.published ?? false,
        psychometric,
      })
      .returning(agentRowColumns);
    await invalidateAgentCaches(c.env as Env, tenantId);
    return c.json(mapAgentRow(row), 201);
  });

  router.patch('/agents/:id', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
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

    const [existing] = await db
      .select(agentRowColumns)
      .from(ideAgents)
      .where(and(eq(ideAgents.id, id), eq(ideAgents.tenantId, tenantId)));
    if (!existing) return c.json({ error: 'Agent not found' }, 404);

    // Per-agent personality (Pro). `undefined` = field not sent → keep existing;
    // `null` = explicit clear; an object = set (Pro-gated, sanitized).
    let psychometric: string | null = existing.psychometric;
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

    const [row] = await db
      .update(ideAgents)
      .set({
        name:             body.name?.trim() ?? existing.name,
        title:            body.title?.trim() ?? existing.title,
        bio:              body.bio ?? existing.bio,
        skills:           body.skills != null ? JSON.stringify(body.skills) : existing.skills,
        baseModel:        body.baseModel ?? existing.base_model,
        runtimeSupport,
        preferredRuntime,
        runtimeSurface,
        priceCents:       body.priceCents != null ? Math.max(0, Math.round(body.priceCents)) : existing.price_cents,
        pricingModel,
        priceUnit:        body.priceUnit !== undefined ? body.priceUnit : existing.price_unit,
        published:        body.published ?? existing.published,
        status:           body.status ?? existing.status,
        psychometric,
        updatedAt:        sql`NOW()`,
      })
      .where(and(eq(ideAgents.id, id), eq(ideAgents.tenantId, tenantId)))
      .returning(agentRowColumns);
    // Name/title/bio/skills/status/published — and the agent's eval score, if a
    // training-publish flow patches it — all surface in the cached reads.
    await invalidateAgentCaches(c.env as Env, tenantId);
    return c.json(mapAgentRow(row));
  });

  router.delete('/agents/:id', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');

    // Only a tenant's OWN agent that is unpublished AND has no purchases may be
    // deleted — never pull a published/purchased agent out from under buyers.
    const [existing] = await db
      .select({ published: ideAgents.published })
      .from(ideAgents)
      .where(and(eq(ideAgents.id, id), eq(ideAgents.tenantId, tenantId)));
    if (!existing) return c.json({ error: 'Agent not found' }, 404);
    if (existing.published) {
      return c.json({ error: 'Unpublish this agent before deleting it.' }, 409);
    }
    // Only an ACTIVE hold blocks deletion — a soft-deleted (unhired) purchase is
    // just history and must not pin the agent in place forever. Note we do NOT
    // gate on hire_count: it is cumulative ("times hired") and never decrements,
    // so an agent every buyer has since released must still be deletable.
    const [purchase] = await db
      .select({ one: sql<number>`1` })
      .from(agentPurchases)
      .where(and(eq(agentPurchases.agentId, id), isNull(agentPurchases.unhiredAt)))
      .limit(1);
    if (purchase) {
      return c.json({ error: 'This agent is currently hired by another workspace and cannot be deleted.' }, 409);
    }

    // Drop the agent and its canonical identity bridge + per-agent assignments.
    const rows = await db
      .delete(ideAgents)
      .where(and(eq(ideAgents.id, id), eq(ideAgents.tenantId, tenantId)))
      .returning({ id: ideAgents.id });
    if (rows.length === 0) return c.json({ error: 'Agent not found' }, 404);

    const bridges = await db.select({ id: projectAgents.id }).from(projectAgents)
      .where(and(
        eq(projectAgents.tenantId, tenantId),
        eq(projectAgents.agentKind, 'workforce'),
        eq(projectAgents.agentRef, id),
        isNull(projectAgents.projectId),
      ));
    const bridgeIds = bridges.map((bridge) => bridge.id);
    if (bridgeIds.length > 0) {
      await db
        .delete(artifactAssignments)
        .where(and(
          eq(artifactAssignments.tenantId, tenantId),
          eq(artifactAssignments.scope, 'agent'),
          inArray(artifactAssignments.scopeId, bridgeIds),
        ));
      await db.delete(projectAgents).where(inArray(projectAgents.id, bridgeIds));
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
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const id = c.req.param('id');

    const [agent] = await db
      .select({ id: ideAgents.id, name: ideAgents.name })
      .from(ideAgents)
      .where(and(eq(ideAgents.id, id), eq(ideAgents.tenantId, tenantId)));
    if (!agent) return c.json({ error: 'Agent not found' }, 404);

    /** The canonical (project-less) identity row for this workforce agent. */
    const identityWhere = and(
      eq(projectAgents.tenantId, tenantId),
      eq(projectAgents.agentKind, 'workforce'),
      eq(projectAgents.agentRef, id),
      isNull(projectAgents.projectId),
    );

    const [existing] = await db.select({ id: projectAgents.id }).from(projectAgents).where(identityWhere);
    if (existing) return c.json({ projectAgentId: existing.id });

    const [created] = await db
      .insert(projectAgents)
      .values({ tenantId, projectId: null, agentKind: 'workforce', agentRef: id, name: agent.name, addedBy: userId })
      // `where` here is the CONFLICT TARGET predicate (drizzle's name for the
      // partial-index qualifier), matching the partial unique index the raw
      // statement targeted: ON CONFLICT (...) WHERE project_id IS NULL DO NOTHING.
      .onConflictDoNothing({
        target: [projectAgents.tenantId, projectAgents.agentKind, projectAgents.agentRef],
        where: isNull(projectAgents.projectId),
      })
      .returning({ id: projectAgents.id });
    if (created) return c.json({ projectAgentId: created.id }, 201);

    // Lost an insert race — read the row the other request created.
    const [row] = await db.select({ id: projectAgents.id }).from(projectAgents).where(identityWhere);
    if (!row) return c.json({ error: 'Failed to create agent identity' }, 500);
    return c.json({ projectAgentId: row.id });
  });

  // ----- Owner-only: agent performance + buyer feedback (gap [1247]) -------
  // GET /agents/:id/perf — owner-only rollup (success rate / runs / latency per
  // hired tenant + buyer ratings). 404 unless the caller OWNS the agent, so the
  // cross-tenant telemetry never leaks. Read-heavy → read-through cached on
  // agent_id; invalidated when a buyer posts feedback (short TTL covers run drift).
  router.get('/agents/:id/perf', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [owned] = await db
      .select({ one: sql<number>`1` })
      .from(ideAgents)
      .where(and(eq(ideAgents.id, id), eq(ideAgents.tenantId, tenantId)));
    if (!owned) return c.json({ error: 'Agent not found' }, 404);
    const rollup = await getOrSetCached(
      c.env as Env,
      perfCacheKey(id),
      () => loadAgentPerfRollup(db, id),
      { kvTtlSeconds: PERF_CACHE_TTL_SECONDS },
    );
    return c.json(rollup);
  });

  // POST /agents/:id/feedback — a BUYER (a tenant holding an active hire) rates
  // the agent. One row per hire (UPSERT), invalidates the owner's perf cache.
  router.post('/agents/:id/feedback', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const body = await c.req.json<{ rating?: number; comment?: string | null }>();
    const rating = Math.round(Number(body.rating));
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return c.json({ error: 'rating must be an integer 1..5' }, 400);
    }
    // Must hold an ACTIVE hire to leave feedback — feedback rides the purchase row.
    const [purchase] = await db
      .select({ id: agentPurchases.id })
      .from(agentPurchases)
      .where(and(
        eq(agentPurchases.tenantId, tenantId),
        eq(agentPurchases.agentId, id),
        isNull(agentPurchases.unhiredAt),
      ));
    if (!purchase) return c.json({ error: 'Hire this agent before leaving feedback.' }, 409);

    const comment = (body.comment ?? '').toString().trim() || null;
    const [row] = await db
      .insert(agentFeedback)
      .values({ purchaseId: purchase.id, agentId: id, tenantId, rating, comment })
      .onConflictDoUpdate({
        target: agentFeedback.purchaseId,
        set: { rating, comment, createdAt: sql`NOW()` },
      })
      .returning({ id: agentFeedback.id, created: sql<boolean>`(xmax = 0)` });
    await invalidateCached(c.env as Env, perfCacheKey(id));
    return c.json({ id: row?.id }, row?.created ? 201 : 200);
  });

  // ----- Public: browse published agents ---------------------------------
  // GET /api/workforce/agents — list active published agents (with evalScore).
  // Read-heavy + world-readable → served through the read-through cache; the
  // listing is invalidated by every write below that can change a listed row.
  router.get('/agents', async (c) => {
    const db = buildDatabase(c.env);
    const rows = await getOrSetCached(
      c.env as Env,
      PUBLIC_LIST_CACHE_KEY,
      () => db
        .select(agentRowColumns)
        .from(ideAgents)
        .where(and(eq(ideAgents.status, 'active'), eq(ideAgents.published, true)))
        .orderBy(desc(ideAgents.hireCount), desc(ideAgents.createdAt))
        .limit(200),
      { kvTtlSeconds: PUBLIC_LIST_CACHE_TTL_SECONDS },
    );
    return c.json(rows.map(mapPublicAgentRow));
  });

  // GET /api/workforce/agents/:id — public agent detail (with evalScore).
  router.get('/agents/:id', async (c) => {
    const db = buildDatabase(c.env);
    const [row] = await db
      .select(agentRowColumns)
      .from(ideAgents)
      .where(and(
        eq(ideAgents.id, c.req.param('id')),
        eq(ideAgents.status, 'active'),
        eq(ideAgents.published, true),
      ));
    if (!row) return c.json({ error: 'Agent not found' }, 404);
    return c.json(mapPublicAgentRow(row));
  });

  return router;
}
