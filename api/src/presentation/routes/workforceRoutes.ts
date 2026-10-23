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
import { type Db } from '../../infrastructure/database/connection';
import { requestDb } from '../../application/shared/dbHandle';
import {
  agentFeedback,
  agentPurchases,
  artifactAssignments,
  executions,
  ideAgents,
} from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { authMiddleware, requestActor } from '../middleware/authMiddleware';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import {
  PUBLIC_LIST_CACHE_KEY,
  agentRowColumns,
  getPublicAgent,
  hiredAgentsCacheKey,
  listWorkforceAgents,
  mapAgentRow,
  mapPublicAgentRow,
} from '../../application/workforce/agentDirectory';
import { tenantHasFeature } from '../middleware/featureGate';
import { sanitizePsychometricProfile } from '../../application/persona/psychometricCatalog';
import { assigneeProfilesCacheKey } from '../../application/kanban/assigneeProfiles';
import { invalidateTeamCaches } from '../../application/kernel/TeamRoster';
import { CLOUD_SURFACES } from '../../application/runtime/cloudDispatch';
import {
  completeAgentCheckout,
  holdsAgentPurchase,
  startAgentCheckout,
} from '../../application/marketplace/agentCommerce';
import { demoTenantAgent, publicAgentScope } from '../../application/marketplace/publicAgentScope';
import { BUILTIN_AGENT_CATALOGUE } from '../../application/agent/provisionBuiltinAgents';
import { provisionHiredAgent, revokeHiredAgent } from '../../application/workforce/hiredAgents';
import { AgentAssignmentService } from '../../application/agent/AgentAssignmentService';
import type { Env, HonoEnv } from '../../env';
import { parseBody, z, zNonEmptyString } from './requestBody';

/** The fields a cloud agent's owner may write; create requires `name`, patch may also set `status`. */
const AgentWriteBody = z.object({
  name: z.string().optional(),
  title: z.string().optional(),
  bio: z.string().optional(),
  skills: z.array(z.string()).optional(),
  baseModel: z.string().optional(),
  runtimeSupport: z.string().optional(),
  preferredRuntime: z.string().nullable().optional(),
  runtimeSurface: z.string().optional(),
  priceCents: z.number().optional(),
  pricingModel: z.string().optional(),
  priceUnit: z.string().nullable().optional(),
  published: z.boolean().optional(),
  psychometric: z.unknown().optional(),
});
const AgentCreateBody = AgentWriteBody.extend({ name: zNonEmptyString });
const AgentPatchBody = AgentWriteBody.extend({ status: z.string().optional() });

const CheckoutStartBody = z.object({
  returnUrl: z.string().optional(),
  buyerEmail: z.string().optional(),
});
const CheckoutCompleteBody = z.object({ checkoutSessionId: zNonEmptyString });
const FeedbackBody = z.object({
  rating: z.number(),
  comment: z.string().nullable().optional(),
});

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
    // ONE key behind both the purchased list and the runtime registry.
    invalidateCached(env, hiredAgentsCacheKey(tenantId)),
    invalidateTeamCaches(env, tenantId),
    invalidateCached(env, assigneeProfilesCacheKey(tenantId)),
    opts.publicListing ? invalidateCached(env, PUBLIC_LIST_CACHE_KEY) : Promise.resolve(),
  ]);
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
  // Query-builder read with conditional CASE aggregates. The active-hirer tenant
  // subquery is itself typed Drizzle, so this rollup no longer needs db.execute or
  // a hand-written correlated FILTER statement.
  const activeHirerTenants = db.select({ tenantId: agentPurchases.tenantId })
    .from(agentPurchases)
    .where(and(eq(agentPurchases.agentId, agentId), isNull(agentPurchases.unhiredAt)));
  const [perf] = await db.select({
    total_runs: sql<number>`COUNT(*)::int`,
    completed_runs: sql<number>`COALESCE(SUM(CASE WHEN ${executions.status} = 'completed' THEN 1 ELSE 0 END), 0)::int`,
    failed_runs: sql<number>`COALESCE(SUM(CASE WHEN ${executions.status} IN ('failed', 'cancelled') THEN 1 ELSE 0 END), 0)::int`,
    avg_latency_ms: sql<number | null>`AVG(CASE
      WHEN ${executions.status} = 'completed' AND ${executions.startedAt} IS NOT NULL AND ${executions.completedAt} IS NOT NULL
      THEN EXTRACT(EPOCH FROM (${executions.completedAt} - ${executions.startedAt})) * 1000
      ELSE NULL
    END)`,
  }).from(executions).where(and(
    eq(executions.cloudAgentRef, agentId),
    inArray(executions.tenantId, activeHirerTenants),
  ));
  // Deliberately cross-tenant, and declared as such: "how many tenants hired this
  // agent" is a count OF tenants — scoping it to the caller's own would make every
  // marketplace listing read `1` or `0`. The agent id is the access predicate.
  const [hires] = await db
    .select({ hired_tenants: sql<number>`COUNT(*)::int` })
    .from(agentPurchases)
    .where(acrossTenants(
      agentPurchases,
      'platform_aggregate',
      eq(agentPurchases.agentId, agentId),
      isNull(agentPurchases.unhiredAt),
    ));
  const fbRows = await db
    .select({
      rating: agentFeedback.rating,
      comment: agentFeedback.comment,
      created_at: agentFeedback.createdAt,
    })
    .from(agentFeedback)
    // Same reason as the hire count: a public agent's rating is the rating every
    // hirer gave it, not the rating this one tenant gave it.
    .where(acrossTenants(agentFeedback, 'platform_aggregate', eq(agentFeedback.agentId, agentId)))
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
    const rows = await listWorkforceAgents(c.env as Env, requestDb(c), { scope: 'owned', tenantId: c.get('tenantId') as number });
    return c.json(rows.map(mapAgentRow));
  });

  // GET /agents/purchased — agents this tenant acquired from the marketplace
  // (distinct from /agents/mine, which is the tenant's OWN created agents).
  // Read-through cached; invalidated on hire.
  router.get('/agents/purchased', authMiddleware, async (c) => {
    const rows = await listWorkforceAgents(c.env as Env, requestDb(c), { scope: 'hired', tenantId: c.get('tenantId') as number });
    return c.json(rows.map(mapAgentRow));
  });

  // POST /agents/:id/hire — acquire a published marketplace agent into this
  // tenant's workforce. Records the hire (idempotent), bumps the agent's
  // aggregate hire counter, and PROVISIONS the agent into the hiring workspace
  // so it is actually usable there. Authenticated so the buyer (tenant) is known.
  //
  // A PRICED agent 402s unless this workspace holds a completed purchase. The
  // price column has been on `ide_agents` since the marketplace shipped and was
  // never read: an owner could list an agent at $99 and every hire was free.
  // Free agents (price_cents = 0) are unaffected and hire exactly as before.
  router.post('/agents/:id/hire', authMiddleware, async (c) => {
    const db = requestDb(c);
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [agent] = await db
      .select({
        id: ideAgents.id,
        name: ideAgents.name,
        published: ideAgents.published,
        status: ideAgents.status,
        tenant_id: ideAgents.tenantId,
        price_cents: ideAgents.priceCents,
        // Selected rather than filtered on, because the two rejections BELOW
        // this read have to keep their own answers: an owner must still be told
        // "you already own this", not that their agent vanished.
        is_demo_fixture: demoTenantAgent,
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
    // A demo-tenant agent is a seeded fixture, never merchandise. It is already
    // invisible in every public read (`publicAgentScope`); this closes the one
    // door a stale id or a hand-written request could still walk through.
    if (agent.is_demo_fixture) return c.json({ error: 'Agent is not published to the marketplace' }, 409);

    // THE PAY GATE. Checked before anything is written, so a refused hire leaves
    // no row, no counter movement and no binding behind it. The entitlement is a
    // PURCHASE, not a hire: unhiring does not un-buy, so re-hiring never charges
    // a second time.
    const priceCents = Number(agent.price_cents ?? 0);
    if (priceCents > 0 && !(await holdsAgentPurchase(db, tenantId, id))) {
      return c.json({ error: 'Purchase required', checkoutRequired: true, priceCents }, 402);
    }

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
          .where(and(eq(ideAgents.id, id), eq(ideAgents.tenantId, Number(agent.tenant_id))))
          .returning(agentRowColumns)
      : await db.select(agentRowColumns).from(ideAgents).where(and(
          eq(ideAgents.id, id),
          eq(ideAgents.tenantId, Number(agent.tenant_id)),
        ));
    // PROVISION — the step that makes a hire more than a counter. Creates the
    // agent's workspace identity (`agent_assignments`, scope 'workspace') in the HIRING workspace, which is what
    // the assignee picker, the per-agent capability panel and swimlane dispatch
    // address the agent by. Run on every hire, not only a fresh one, so a hire
    // that predates this route (or one whose identity was cleaned up) is repaired
    // the next time the buyer presses Hire.
    const { agentHandle } = await provisionHiredAgent(db, {
      tenantId,
      agentId: id,
      agentName: String(agent.name ?? id),
      // A machine/agent principal's subject is not a users.id — record no adder.
      actorUserId: requestActor(c).actorUserId ?? null,
    });
    await invalidateHireCaches(c.env as Env, tenantId, { publicListing: changed.length > 0 });
    // `project_agent_id` is the pre-1265 name of the same handle — shipped clients (the
    // VSIX webview) still read it.
    return c.json({ ...mapAgentRow(row), agent_handle: agentHandle, project_agent_id: agentHandle });
  });

  // POST /agents/:id/checkout — start a hosted payment for a PRICED agent.
  // Mirrors the knowledge-listing checkout: `{ free: true }` when there is
  // nothing to pay, `{ purchased: true }` when this workspace already bought it,
  // otherwise a processor URL. Records nothing — see agentCommerce.ts.
  router.post('/agents/:id/checkout', authMiddleware, async (c) => {
    const db = requestDb(c);
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    // The same predicate the public listing is built on — you may only pay for
    // an agent a stranger could have found (see `publicAgentScope`), which is
    // what keeps a demo fixture from reaching a processor.
    const [agent] = await db
      .select({ price_cents: ideAgents.priceCents })
      .from(ideAgents)
      .where(publicAgentScope(eq(ideAgents.id, id)));
    if (!agent) return c.json({ error: 'Agent not found' }, 404);
    if (Number(agent.price_cents ?? 0) <= 0) return c.json({ free: true });
    if (await holdsAgentPurchase(db, tenantId, id)) return c.json({ purchased: true });

    const body = await parseBody(c, CheckoutStartBody);
    // The buyer comes back to the page they left, so the return url is theirs to
    // name — but only its origin and path are used, and the processor substitutes
    // the session id, so it cannot be turned into an open redirect carrying data.
    const returnUrl = body.returnUrl ?? `${new URL(c.req.url).origin}/workforce`;
    // A `ListingError` carries its own status; `statusOf` renders it (no local map).
    const { checkoutUrl } = await startAgentCheckout(db, c.env as Env, {
      tenantId,
      buyerUserId: c.get('userId') as string,
      // Only prefills the processor's own email field; it collects one either way.
      buyerEmail: body.buyerEmail ?? null,
      agentId: id,
      returnUrl,
    });
    return c.json({ checkoutUrl });
  });

  // POST /agents/:id/checkout/complete — the processor's redirect lands here.
  // The session is re-read FROM the processor before the purchase is recorded;
  // the id in the body is untrusted until agentCommerce has verified it.
  router.post('/agents/:id/checkout/complete', authMiddleware, async (c) => {
    const db = requestDb(c);
    const tenantId = c.get('tenantId') as number;
    const body = await parseBody(c, CheckoutCompleteBody);
    const purchase = await completeAgentCheckout(db, c.env as Env, {
      tenantId,
      buyerUserId: c.get('userId') as string,
      checkoutSessionId: body.checkoutSessionId,
    });
    return c.json({ purchased: true, purchase });
  });

  // DELETE /agents/:id/hire — release a previously-hired marketplace agent from
  // this tenant's workforce. SOFT delete: the purchase row stays (with unhired_at
  // stamped) so any work the agent did keeps its hire provenance for contributor
  // and performance history; it just drops out of the active "purchased" list.
  // hire_count is CUMULATIVE ("times hired") — unhiring does NOT decrement it.
  // Idempotent: unhiring something not actively held is a no-op success.
  router.delete('/agents/:id/hire', authMiddleware, async (c) => {
    const db = requestDb(c);
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
    // REVOKE the binding hire created. The purchase row is only soft-deleted (it
    // is the provenance of work the agent did), but the LIVE wiring goes: the
    // canonical identity the agent was assignable through, and the per-agent
    // capabilities configured against it. Leaving them would keep a released
    // agent in the assignee picker as work nothing could run.
    if (removed.length > 0) await revokeHiredAgent(db, { tenantId, agentId: id });
    // hire_count is cumulative, so an unhire never reorders the public listing.
    await invalidateHireCaches(c.env as Env, tenantId, { publicListing: false });
    return c.json({ unhired: removed.length > 0 });
  });

  router.post('/agents', authMiddleware, async (c) => {
    const db = requestDb(c);
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    const body = await parseBody(c, AgentCreateBody);

    const runtimeSupport = (RUNTIME_SUPPORT as readonly string[]).includes(body.runtimeSupport ?? '')
      ? body.runtimeSupport! : 'cloud';
    const pricingModel = (PRICING_MODELS as readonly string[]).includes(body.pricingModel ?? '')
      ? body.pricingModel! : 'flat_fee';
    // Which execution surface the agent runs on (durable DO vs long-lived node).
    // UNSET when the caller did not choose, never a hard-coded 'durable': the default
    // surface is a plan decision resolved at dispatch time (`resolveCloudSurface`), so an
    // agent created on Free moves to the container the moment the workspace upgrades,
    // without anyone editing it. Writing a concrete value here froze that choice forever.
    const runtimeSurface = (RUNTIME_SURFACES as readonly string[]).includes(body.runtimeSurface ?? '')
      ? body.runtimeSurface! : null;
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
        name: body.name,
        title: body.title?.trim() || body.name,
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
    if (!row) throw new Error('ide_agents insert returned no row');
    await invalidateAgentCaches(c.env as Env, tenantId);
    return c.json(mapAgentRow(row), 201);
  });

  router.patch('/agents/:id', authMiddleware, async (c) => {
    const db = requestDb(c);
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    const id = c.req.param('id');
    const body = await parseBody(c, AgentPatchBody);

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
      ? body.runtimeSurface : (existing.runtime_surface ?? null);
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
    const db = requestDb(c);
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
      .where(scopedToTenant(agentPurchases, tenantId, eq(agentPurchases.agentId, id), isNull(agentPurchases.unhiredAt)))
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

    // Same teardown an unhire performs, from the one definition of it.
    await new AgentAssignmentService(db, c.env as Env).removeIdentities(tenantId, { agentRef: id });
    await invalidateAgentCaches(c.env as Env, tenantId);
    return c.json({ deleted: true });
  });

  // ----- Canonical agent identity (for per-agent capability assignment) ----
  // Ensures the agent's workspace identity (`agent_assignments`, scope 'workspace')
  // and returns its integer handle. Per-agent skills/personas are assigned against
  // it via artifact_assignments scope='agent' + scope_id = agentHandle, so they
  // follow the agent everywhere (IDE / Workflow / on-prem / cloud) rather than
  // being tied to any one project.
  router.post('/agents/:id/bridge', authMiddleware, async (c) => {
    const db = requestDb(c);
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');

    // OWNED agents only. A HIRED agent gets the same identity, but from the hire
    // route (which is the moment it is acquired) — see provisionHiredAgent.
    const [agent] = await db
      .select({ id: ideAgents.id, name: ideAgents.name })
      .from(ideAgents)
      .where(and(eq(ideAgents.id, id), eq(ideAgents.tenantId, tenantId)));
    if (!agent) return c.json({ error: 'Agent not found' }, 404);

    // `AgentAssignmentService.ensureIdentity` is shared with the hire path, so both
    // create the SAME canonical row rather than two subtly different ones.
    const agentHandle = await new AgentAssignmentService(db, c.env as Env).ensureIdentity(tenantId, {
      agentRef: id, name: agent.name, addedBy: requestActor(c).actorUserId ?? null,
    });
    // `projectAgentId` is the pre-1265 key for the same handle — the shipped VSIX webview
    // reads it, so it stays alongside the new name.
    return c.json({ agentHandle, projectAgentId: agentHandle });
  });

  // ----- Owner-only: agent performance + buyer feedback (gap [1247]) -------
  // GET /agents/:id/perf — owner-only rollup (success rate / runs / latency per
  // hired tenant + buyer ratings). 404 unless the caller OWNS the agent, so the
  // cross-tenant telemetry never leaks. Read-heavy → read-through cached on
  // agent_id; invalidated when a buyer posts feedback (short TTL covers run drift).
  router.get('/agents/:id/perf', authMiddleware, async (c) => {
    const db = requestDb(c);
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
    const db = requestDb(c);
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const body = await parseBody(c, FeedbackBody);
    const rating = Math.round(body.rating);
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

    const comment = (body.comment ?? '').trim() || null;
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
    const rows = await listWorkforceAgents(c.env as Env, requestDb(c), { scope: 'public' });
    return c.json(rows.map(mapPublicAgentRow));
  });

  // GET /api/workforce/builtin-agents — the built-in roster every workspace
  // receives. Static module data with no DB read, so there is nothing for the
  // read-through cache to hold; a public Cache-Control lets the edge and the
  // browser keep it instead.
  router.get('/builtin-agents', (c) => {
    c.header('Cache-Control', 'public, max-age=3600');
    return c.json(BUILTIN_AGENT_CATALOGUE);
  });

  // GET /api/workforce/agents/:id — public agent detail (with evalScore).
  router.get('/agents/:id', async (c) => {
    const row = await getPublicAgent(requestDb(c), c.req.param('id'));
    if (!row) return c.json({ error: 'Agent not found' }, 404);
    return c.json(mapPublicAgentRow(row));
  });

  return router;
}
