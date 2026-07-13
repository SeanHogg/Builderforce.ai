import { and, eq } from 'drizzle-orm';
import { agentHostOnlineCondition } from '../../infrastructure/database/agentHostOnline';
import type { Db } from '../../infrastructure/database/connection';
import { agentHosts } from '../../infrastructure/database/schema';
import { resolveCloudSurface } from './cloudDispatch';

/**
 * Determine all dispatchable targets for a task execution.
 *
 * - If the task is manually assigned to a self‑hosted agentHost and that host
 *   is online, route as 'task.assign'.
 * - If no host is assigned or no online host exists, route as 'task.broadcast'.
 *
 * The function is independent of the runner surface; it reports an authoritative
 * flag indicating where fallback (durable-only) should be invoked when needed.
 */
export async function getDispatchTargets(
  db: Db,
  tenantId: number,
  assignedAgentHostId: number | null,
): Promise<{
  targets: { id: number; ref: string | null; dispatchType: 'task.assign' | 'task.broadcast'; requiresHost: boolean };
  fallbackToDurableOnly: boolean;
}> {
  const isAssigned = assignedAgentHostId != null;
  if (!isAssigned) {
    return {
      targets: [{ id: 0, ref: null, dispatchType: 'task.broadcast', requiresHost: false }],
      fallbackToDurableOnly: true,
    };
  }

  const oneAgentHost = await db
    .select({ id: agentHosts.id, connectedAt: agentHosts.connectedAt, lastSeenAt: agentHosts.lastSeenAt })
    .from(agentHosts)
    .where(and(eq(agentHosts.tenantId, tenantId), eq(agentHosts.id, assignedAgentHostId)))
    .limit(1);
  const online = oneAgentHost.length === 1 && agentHosts.connectedAt.isNotNull()(oneAgentHost[0]) && agentHost.lastSeenAt.isNotNull()(oneAgentHost[0]);

  if (online) {
    return {
      targets: [{ id: assignedAgentHostId, ref: String(assignedAgentHostId), dispatchType: 'task.assign', requiresHost: true }],
      fallbackToDurableOnly: false,
    };
  }

  return {
    targets: [{ id: 0, ref: null, dispatchType: 'task.broadcast', requiresHost: false }],
    fallbackToDurableOnly: true,
  };
}