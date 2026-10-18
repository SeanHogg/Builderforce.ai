/**
 * THE workforce agent directory — one reader for every "list the agents" surface.
 *
 * `ide_agents` was listed by four routes that each carried their own select:
 * the public marketplace (`/api/workforce/agents`), the owner's own agents
 * (`/agents/mine`), the buyer's hired agents (`/agents/purchased`) and the
 * runtime's callable-role registry (`/api/runtime/hired-agents`). The last two
 * were the SAME query — active hires joined to the agent row — under two cache
 * keys, so a personality edit refreshed one and left the other stale. Every list
 * is now one call with a scope filter, one projection and one cache per scope.
 *
 * The developer API's `/api/v1/agents` reads the `public` scope too: it used to
 * list the legacy `agents` registry across EVERY tenant, which is not what
 * "published agents" means and exposed each workspace's agent names to any key.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { agentPurchases, ideAgents } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { parseJsonArray, parseJsonOr } from '../../domain/shared/json';
import type { Env } from '../../env';
import { publicAgentScope } from '../marketplace/publicAgentScope';

/** Cache key for the PUBLIC marketplace listing — the same world-readable registry
 *  for everyone. Invalidated by any write that changes a row that could appear in it. */
export const PUBLIC_LIST_CACHE_KEY = 'wf:public:agents';
const PUBLIC_LIST_CACHE_TTL_SECONDS = 120;

/** Cache key for a tenant's HIRED agents. Read by both the buyer's purchased list
 *  and the runtime registry; invalidated on hire, unhire and personality edits. */
export const hiredAgentsCacheKey = (tenantId: number): string => `wf:purchased:${tenantId}`;

/**
 * The `SELECT ide_agents.*` projection, key-for-key.
 *
 * Every workforce/marketplace response ships the agent row with its RAW snake_case
 * column names (the frontend `PublishedAgent` contract reads `base_model` /
 * `hire_count` / `runtime_support` / `created_at` / …). Drizzle returns camelCase,
 * so each column is aliased back to its physical name here and this ONE object is
 * reused by every read/insert/update — key drift in a hand-written selection would
 * silently blank a field on the Workforce card.
 *
 * It covers EVERY declared `ide_agents` column, including the training/inference
 * ones no workforce handler reads but that `SELECT *` shipped — `PublishedAgent`
 * declares several of them, so narrowing the projection would change the response.
 */
export const agentRowColumns = {
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
 * `ide_agents.skills` and `.psychometric` are text columns holding JSON. The
 * `PublishedAgent` contract (and the /workforce edit form) expects a real
 * `string[]` and an object, so every owner-facing row is normalized on the way out.
 */
export function mapAgentRow<T extends Record<string, unknown>>(row: T | null | undefined): T | null | undefined {
  if (row == null) return row;
  const psy = row.psychometric;
  const psychometric = typeof psy === 'string'
    ? parseJsonOr<unknown>(psy, null)
    : (psy ?? null);
  return { ...row, skills: parseJsonArray(row.skills), psychometric };
}

/**
 * The PUBLIC projection of a marketplace agent. Marketing promises agents listed
 * "with evaluation scores", so a single non-sensitive `evalScore` ships here. The
 * owner-only perf rollup NEVER appears on a public route.
 */
export function mapPublicAgentRow(row: Record<string, unknown>): Record<string, unknown> {
  const raw = row.eval_score;
  const score = typeof raw === 'number' ? raw : raw == null ? null : Number(raw);
  // EXPLICIT allowlist — never spread the raw row onto a world-readable route.
  // Excludes tenant_id, project_id, role_keys (internal config/dispatch) and
  // psychometric (unpublished persona internals).
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

/**
 * Which agents to list:
 *   public — active, published, non-demo marketplace agents (world-readable)
 *   owned  — every agent the tenant created, any publish state, with `active_hires`
 *   hired  — agents the tenant currently holds an active hire on
 */
export type AgentDirectoryScope =
  | { scope: 'public' }
  | { scope: 'owned'; tenantId: number }
  | { scope: 'hired'; tenantId: number };

export type AgentRow = Record<string, unknown>;

/** List agents for a scope, newest/most-hired first, capped at 200. Raw rows —
 *  each surface applies its own projection (public / owner / runtime role). */
export async function listWorkforceAgents(env: Env, db: Db, filter: AgentDirectoryScope): Promise<AgentRow[]> {
  switch (filter.scope) {
    case 'public':
      // `publicAgentScope` IS the access control — the one definition of "public",
      // shared with the detail read, the IDE registry, checkout and the MCP tools.
      return getOrSetCached(
        env,
        PUBLIC_LIST_CACHE_KEY,
        () => db
          .select(agentRowColumns)
          .from(ideAgents)
          .where(publicAgentScope())
          .orderBy(desc(ideAgents.hireCount), desc(ideAgents.createdAt))
          .limit(200),
        { kvTtlSeconds: PUBLIC_LIST_CACHE_TTL_SECONDS },
      );
    case 'owned':
      // Owner-only, uncached: the editor must see its own write immediately.
      return db
        .select({
          ...agentRowColumns,
          // active_hires = tenants CURRENTLY holding the agent. `ide_agents.id` is
          // spelled out rather than interpolated: Drizzle renders `${ideAgents.id}`
          // unqualified in a single-table select, and inside this subquery a bare
          // "id" binds to `agent_purchases.id`, silently making every count 0.
          active_hires: sql<number>`(
            SELECT COUNT(*) FROM agent_purchases
            WHERE agent_purchases.agent_id = ide_agents.id AND agent_purchases.unhired_at IS NULL
          )::int`,
        })
        .from(ideAgents)
        .where(eq(ideAgents.tenantId, filter.tenantId))
        .orderBy(desc(ideAgents.createdAt))
        .limit(200);
    case 'hired': {
      const { tenantId } = filter;
      return getOrSetCached(env, hiredAgentsCacheKey(tenantId), () => db
        .select(agentRowColumns)
        .from(ideAgents)
        .innerJoin(agentPurchases, eq(agentPurchases.agentId, ideAgents.id))
        .where(and(
          eq(agentPurchases.tenantId, tenantId),
          isNull(agentPurchases.unhiredAt),
          eq(ideAgents.status, 'active'),
        ))
        .orderBy(desc(agentPurchases.createdAt))
        .limit(200));
    }
  }
}

/** One public marketplace agent, or null when it is not publicly listed. */
export async function getPublicAgent(db: Db, id: string): Promise<AgentRow | null> {
  const [row] = await db
    .select(agentRowColumns)
    .from(ideAgents)
    .where(publicAgentScope(eq(ideAgents.id, id)));
  return row ?? null;
}
