/**
 * Resolve the BACKPLANE a lane-staffed agent must run on.
 *
 * A swimlane agent assignment carries `runtime` ('local' | 'cloud' | 'remote' |
 * 'browser') and, for a pinned machine, `target`. The SwimlaneCoordinator has always
 * honoured both (`compileStage` encodes them into the dispatch row); the AUTONOMOUS
 * lane trigger — the path a board drag actually takes — never read either column, so
 * every lane agent was handed to the cloud dispatcher no matter how it was staffed.
 * An operator who deliberately pinned a lane to their own machine got a cloud run.
 *
 * This is the one place that turns (runtime, target) into the `agentHostId` the
 * dispatcher accepts, so the trigger and the coordinator cannot drift apart on what
 * "remote:42" means.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { tenants } from '../../infrastructure/database/schema';
import type { LaneAgentRuntime } from './laneAutoRun';

/** Backplanes that are NOT pushable to an agent host by the simple lane trigger. */
export const CLOUD_LANE_RUNTIMES: ReadonlySet<LaneAgentRuntime> = new Set<LaneAgentRuntime>(['cloud']);

/**
 * The agent-host id a lane assignment targets, or null when the run belongs in the
 * cloud. Never throws: an unresolvable pin degrades to the tenant default host, and a
 * tenant with no default host degrades to cloud — the behaviour before this existed.
 *
 * - `remote` → the pinned `target` host when it is a real id, else the tenant default.
 * - `local`  → the tenant's default agent host (the operator's own machine).
 * - `cloud`  → null (cloud dispatch).
 * - `browser`→ null; a browser dispatch is CLAIMED by a pull worker, never pushed, so
 *              it is routed through the coordinator rather than this path.
 * - unset    → null; the dispatcher applies its ordinary host-pin/cloud resolution.
 */
export async function resolveLaneAgentHostId(
  db: Db,
  tenantId: number,
  runtime: LaneAgentRuntime | null | undefined,
  target: string | null | undefined,
): Promise<number | null> {
  if (runtime !== 'local' && runtime !== 'remote') return null;

  if (runtime === 'remote') {
    const pinned = Number.parseInt((target ?? '').trim(), 10);
    if (Number.isFinite(pinned) && pinned > 0) return pinned;
  }

  const [row] = await db
    .select({ defaultAgentHostId: tenants.defaultAgentHostId })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const fallback = row?.defaultAgentHostId;
  return typeof fallback === 'number' && fallback > 0 ? fallback : null;
}
