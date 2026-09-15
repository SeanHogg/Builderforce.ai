import { eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { tenants } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';

/**
 * THE WORKSPACE EXECUTION SWITCH — `tenants.agent_execution_enabled`, under the
 * deployment-wide `AGENT_EXECUTION_ENABLED=false` override — read ONE way, with two
 * freshness contracts:
 *
 *   • {@link readAgentExecutionEnabled} is AUTHORITATIVE and uncached.
 *     `RuntimeService.submit` enforces the emergency stop with it: a manager who
 *     disables execution and then drains the fleet must not have another isolate start
 *     a run from a cached `true`.
 *   • {@link agentExecutionEnabledCached} is the PRE-CHECK for everything that decides
 *     whether to TRY — the auto-run evaluator and the cloud dispatcher. Without it a
 *     disabled workspace still had every lane entry signal the cron gate and every sweep
 *     dispatch a run that submit then refused: measured in production on 2026-09-14,
 *     thirteen refused role runs per tick, and a cron gate held open by work that could
 *     never start. A stale `true` here costs one refused attempt; the settings write
 *     invalidates it.
 *
 * Fails CLOSED — a missing tenant is never an execution scope — and lets database
 * errors propagate, because this is an emergency control.
 */

const cacheKey = (tenantId: number) => `agent-execution:v1:${tenantId}`;

/** The deployment-wide kill switch, which outranks every workspace's own setting. */
function deploymentDisabled(env: Env | undefined): boolean {
  return env?.AGENT_EXECUTION_ENABLED?.trim().toLowerCase() === 'false';
}

export async function readAgentExecutionEnabled(env: Env | undefined, db: Db, tenantId: number): Promise<boolean> {
  if (deploymentDisabled(env)) return false;
  const [row] = await db
    .select({ enabled: tenants.agentExecutionEnabled })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return row?.enabled === true;
}

export async function agentExecutionEnabledCached(env: Env | undefined, db: Db, tenantId: number): Promise<boolean> {
  if (deploymentDisabled(env)) return false;
  if (!env) return readAgentExecutionEnabled(env, db, tenantId);
  // Stored as a tagged object, never a bare boolean, so a cached `false` can never be
  // mistaken for a miss by any layer that tests the value for truthiness.
  const cached = await getOrSetCached(
    env,
    cacheKey(tenantId),
    async () => ({ enabled: await readAgentExecutionEnabled(env, db, tenantId) }),
    { kvTtlSeconds: 300, l1TtlMs: 30_000 },
  );
  return cached.enabled;
}

/** Drop the cached pre-check after the switch is written. */
export async function invalidateAgentExecutionGate(env: Env, tenantId: number): Promise<void> {
  await invalidateCached(env, cacheKey(tenantId));
}
