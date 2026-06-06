import { sql, type SQL } from 'drizzle-orm';
import { agentHosts } from './schema';
import { AGENT_HOST_STALE_MS } from '../../domain/agentHost/onlineStatus';

/**
 * Drizzle SQL predicate mirroring {@link isAgentHostOnline} for query-level use
 * (WHERE clauses, FILTER aggregates) where pulling rows into JS first would be
 * wasteful. A host is online only while it holds a relay connection AND its
 * heartbeat is fresh — see onlineStatus.ts for why connectedAt alone is unsafe.
 */
const AGENT_HOST_STALE_SECONDS = Math.round(AGENT_HOST_STALE_MS / 1000);

export function agentHostOnlineCondition(): SQL {
  return sql`${agentHosts.connectedAt} is not null and ${agentHosts.lastSeenAt} > now() - make_interval(secs => ${AGENT_HOST_STALE_SECONDS})`;
}
