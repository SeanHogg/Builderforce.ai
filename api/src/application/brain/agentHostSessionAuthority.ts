/**
 * Whether the caller owns an agent-host coding session (PRD 42 principle 6).
 *
 * `chat_sessions` carries no user column: a session belongs to the agent host it ran on,
 * and a host is owned by the member who registered it (`agent_hosts.registered_by`). A
 * client-supplied session summary is accepted only from that owner; anyone else's result
 * is ignored and the server path runs.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { agentHosts, chatSessions } from '../../infrastructure/database/schema';

export async function agentHostSessionOwnedBy(
  db: Db,
  tenantId: number,
  sessionId: number,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  const [row] = await db
    .select({ registeredBy: agentHosts.registeredBy })
    .from(chatSessions)
    .innerJoin(agentHosts, eq(agentHosts.id, chatSessions.agentHostId))
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.tenantId, tenantId), eq(agentHosts.tenantId, tenantId)))
    .limit(1);
  return row?.registeredBy === userId;
}
