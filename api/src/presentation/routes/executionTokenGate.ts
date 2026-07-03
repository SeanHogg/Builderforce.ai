import type { Context } from 'hono';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { checkTenantTokenGate } from '../../application/llm/tenantTokenAvailability';

/**
 * THE interactive-dispatch token gate. Every manual run surface (submit execution,
 * Run-now, board Run) calls this one adapter instead of re-deriving
 * (tenantId, actingUserId) + the 429 block itself — so the tenant-budget check, the
 * superadmin bypass (keyed on the acting user), and the 429 response shape are each
 * defined exactly once. Adding a new dispatch route means one call here; there is no
 * per-route knowledge of "which user, which tenant, what status" to get wrong.
 *
 * Returns the 429 Response to return straight from the handler, or null to proceed.
 *
 * Generic over the route's env so it accepts both the base `Hono<HonoEnv>` routers and
 * wider ones (e.g. runtime's `RuntimeHonoEnv`, which only adds Bindings).
 */
export async function executionTokenGate<E extends HonoEnv>(
  c: Context<E>,
  db: Db,
): Promise<Response | null> {
  const gate = await checkTenantTokenGate(db, c.get('tenantId'), { actingUserId: c.get('userId') });
  return gate ? c.json(gate, 429) : null;
}
