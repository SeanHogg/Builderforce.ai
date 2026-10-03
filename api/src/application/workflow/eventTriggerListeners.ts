import { and, eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { workflowTriggers } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { EVENT_TRIGGER_TYPES, type EventTriggerType } from '../../domain/workflowTriggers';

/**
 * THE LISTENER GATE — "does this tenant have any enabled trigger of this type?",
 * answered from the read-through cache.
 *
 * Its own module, apart from `eventTriggers.ts`, because the hottest emitters only
 * need the QUESTION: the published-site Worker asks it on every page view and must
 * not carry the workflow runner that answering "yes" would start. Firing stays in
 * `fireEventTriggers`, which consults this same gate first.
 */

/** Cache key for "does this tenant have any enabled trigger of this type?". */
function listenerKey(tenantId: number, eventType: string): string {
  return `wf:evt-listeners:${tenantId}:${eventType}`;
}

/**
 * Whether any enabled trigger row of `eventType` exists for the tenant. Cached, so
 * a high-frequency emitter (page view, email open) pays nothing when nobody listens.
 * Without `env` there is no cache to consult and the answer is an honest `true` —
 * the caller then does the real lookup, which is the pre-cache behaviour.
 */
export async function hasEventTriggerListeners(
  env: Env | undefined,
  db: Db,
  tenantId: number,
  eventType: EventTriggerType,
): Promise<boolean> {
  if (!env) return true;
  return getOrSetCached(env, listenerKey(tenantId, eventType), async () => {
    const [row] = await db
      .select({ id: workflowTriggers.id })
      .from(workflowTriggers)
      .where(and(
        eq(workflowTriggers.tenantId, tenantId),
        eq(workflowTriggers.triggerType, eventType),
        eq(workflowTriggers.enabled, true),
      ))
      .limit(1);
    return !!row;
  }, { kvTtlSeconds: 300, l1TtlMs: 30_000 });
}

/** Drop the cached listener answers for a tenant — called whenever the registry
 *  changes, so publishing a trigger takes effect on the next event, not after a TTL. */
export async function bumpEventTriggerListeners(env: Env | undefined, tenantId: number): Promise<void> {
  if (!env) return;
  await Promise.all(EVENT_TRIGGER_TYPES.map((type) =>
    invalidateCached(env, listenerKey(tenantId, type)).catch(() => undefined)));
}
