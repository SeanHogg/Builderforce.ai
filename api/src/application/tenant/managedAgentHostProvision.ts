/**
 * Orchestration for auto-provisioning a billed Managed AgentHost.
 *
 * pending → provisioning → register `agent_hosts` → container start → active
 * (with a real `agentHostId`). Start failure marks the request failed and
 * deletes the host row so we never advertise an active host we did not boot.
 * Cancel / add-on lapse stops the container and retires the host.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { agentHosts, managedAgentHostRequests, tenants } from '../../infrastructure/database/schema';
import { generateApiKey, hashSecret } from '../../infrastructure/auth/HashService';
import { invalidateAgentHostKeyCache } from '../../infrastructure/auth/keyResolutionCache';
import type { Env } from '../../env';
import {
  provisionManagedAgentHostRequest,
  type ManagedAgentHostRequestStatus,
} from './managedAgentHostSubscription';
import type { ManagedAgentHostRuntime } from './managedAgentHostRuntime';
import { bumpTenantAgentHostCount } from './tenantResourceCounts';

export interface ManagedAgentHostRuntimeDeps {
  runtime: ManagedAgentHostRuntime;
  env?: Env;
}

const OCCUPYING_LIVE: ManagedAgentHostRequestStatus[] = ['provisioning', 'active'];

async function retireManagedAgentHost(
  db: Db,
  tenantId: number,
  agentHostId: number,
  env?: Env,
): Promise<void> {
  const [host] = await db
    .delete(agentHosts)
    .where(and(eq(agentHosts.id, agentHostId), eq(agentHosts.tenantId, tenantId)))
    .returning({ apiKeyHash: agentHosts.apiKeyHash });
  if (host && env) await invalidateAgentHostKeyCache(env, host.apiKeyHash);
  // The plan-limit guard caches the tenant's host count; a removed row must re-count.
  if (host) await bumpTenantAgentHostCount(env, tenantId);
  await db
    .update(tenants)
    .set({ defaultAgentHostId: null, updatedAt: new Date() })
    .where(and(eq(tenants.id, tenantId), eq(tenants.defaultAgentHostId, agentHostId)));
}

export async function provisionManagedAgentHost(
  db: Db,
  deps: ManagedAgentHostRuntimeDeps,
  input: { requestId: number; registeredBy: string },
): Promise<
  | { request: typeof managedAgentHostRequests.$inferSelect }
  | { error: { status: number; error: string } }
> {
  const moved = await provisionManagedAgentHostRequest(db, {
    requestId: input.requestId,
    status: 'provisioning',
  });
  if ('error' in moved) return moved;
  const row = moved.request;

  const rawKey = generateApiKey('bfa');
  const keyHash = await hashSecret(rawKey);
  const slug = `managed-${row.id}`;
  const [host] = await db
    .insert(agentHosts)
    .values({
      tenantId: row.tenantId,
      name: row.agentHostName,
      slug,
      apiKeyHash: keyHash,
      registeredBy: input.registeredBy,
      networkMetadata: JSON.stringify({
        managed: true,
        region: row.region,
        requestId: row.id,
      }),
    })
    .returning({ id: agentHosts.id, tenantId: agentHosts.tenantId });
  if (host) await bumpTenantAgentHostCount(deps.env, row.tenantId);

  if (!host) {
    await provisionManagedAgentHostRequest(db, { requestId: input.requestId, status: 'failed' });
    return { error: { status: 500, error: 'Failed to register AgentHost' } };
  }

  const started = await deps.runtime.start({
    requestId: row.id,
    tenantId: row.tenantId,
    region: row.region,
  });
  if (!started.ok) {
    await retireManagedAgentHost(db, row.tenantId, host.id, deps.env);
    await provisionManagedAgentHostRequest(db, { requestId: input.requestId, status: 'failed' });
    return { error: { status: 503, error: started.reason } };
  }

  await db
    .update(tenants)
    .set({ defaultAgentHostId: host.id, updatedAt: new Date() })
    .where(and(eq(tenants.id, row.tenantId), isNull(tenants.defaultAgentHostId)));

  return provisionManagedAgentHostRequest(db, {
    requestId: input.requestId,
    status: 'active',
    agentHostId: host.id,
  });
}

export async function deprovisionManagedAgentHost(
  db: Db,
  deps: ManagedAgentHostRuntimeDeps,
  input: { requestId: number; tenantId: number },
): Promise<
  | { request: typeof managedAgentHostRequests.$inferSelect }
  | { error: { status: number; error: string } }
> {
  const [row] = await db
    .select()
    .from(managedAgentHostRequests)
    .where(and(
      eq(managedAgentHostRequests.id, input.requestId),
      eq(managedAgentHostRequests.tenantId, input.tenantId),
    ))
    .limit(1);
  if (!row) return { error: { status: 404, error: 'Not found' } };
  if (row.status === 'cancelled') return { request: row };
  if (row.status === 'failed') {
    return { error: { status: 409, error: "Cannot cancel a request with status 'failed'" } };
  }
  if (row.status === 'pending') {
    const [updated] = await db
      .update(managedAgentHostRequests)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(
        eq(managedAgentHostRequests.id, input.requestId),
        eq(managedAgentHostRequests.tenantId, input.tenantId),
        eq(managedAgentHostRequests.status, 'pending'),
      ))
      .returning();
    return { request: updated ?? { ...row, status: 'cancelled' } };
  }

  await deps.runtime.stop({ requestId: row.id });
  if (row.agentHostId) {
    await retireManagedAgentHost(db, input.tenantId, row.agentHostId, deps.env);
  }
  const [updated] = await db
    .update(managedAgentHostRequests)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(
      eq(managedAgentHostRequests.id, input.requestId),
      eq(managedAgentHostRequests.tenantId, input.tenantId),
      inArray(managedAgentHostRequests.status, OCCUPYING_LIVE),
    ))
    .returning();
  return { request: updated ?? { ...row, status: 'cancelled' } };
}

export async function deprovisionOccupyingManagedAgentHosts(
  db: Db,
  tenantId: number,
  deps: ManagedAgentHostRuntimeDeps,
): Promise<void> {
  const occupying = await db
    .select({
      id: managedAgentHostRequests.id,
      agentHostId: managedAgentHostRequests.agentHostId,
    })
    .from(managedAgentHostRequests)
    .where(and(
      eq(managedAgentHostRequests.tenantId, tenantId),
      inArray(managedAgentHostRequests.status, OCCUPYING_LIVE),
    ));
  if (occupying.length === 0) return;
  for (const row of occupying) {
    await deps.runtime.stop({ requestId: row.id });
    if (row.agentHostId) {
      await retireManagedAgentHost(db, tenantId, row.agentHostId, deps.env);
    }
  }
  await db
    .update(managedAgentHostRequests)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(
      eq(managedAgentHostRequests.tenantId, tenantId),
      inArray(managedAgentHostRequests.status, OCCUPYING_LIVE),
    ));
}
