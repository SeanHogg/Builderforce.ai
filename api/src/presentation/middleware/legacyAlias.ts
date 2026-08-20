/**
 * legacyAlias — mark a route mount that only exists for already-deployed callers.
 *
 * The agent-host router is mounted three times: its real path plus two aliases
 * kept alive because agents shipped before the rebrand still call them. Three
 * copies of a mount with three prose comments is not a migration plan — nothing
 * says WHICH alias is still in use, so nothing can ever be removed safely.
 *
 * A response from an alias carries the standard deprecation signals instead:
 *
 *   Deprecation: true                         (RFC 8594)
 *   Link: <canonical>; rel="successor-version"
 *
 * so an operator can see, from the caller's own logs, which fleet has not moved.
 */
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';

/** The canonical agent-host mount. */
export const AGENT_HOST_BASE_PATH = '/api/agent-hosts';

/**
 * Deprecated mounts of the agent-host router, kept until the deployed fleet has
 * moved. `/api/claws` predates the BuilderForce Agents rebrand; `/api/agentNodes`
 * is what the agent-runtime's relay client targets for
 * `:id/{upstream,heartbeat,assignment-context}` — dropping it would 404 the
 * periodic heartbeat, and `lastSeenAt` going stale reads as "offline after 15
 * min" to the online-status rule (domain/agentHost/onlineStatus.ts).
 */
export const LEGACY_AGENT_HOST_PATHS = ['/api/claws', '/api/agentNodes'] as const;

/** Stamp the deprecation headers naming `canonical` as the successor path. */
export function legacyAliasNotice(canonical: string): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    await next();
    c.header('Deprecation', 'true');
    c.header('Link', `<${canonical}>; rel="successor-version"`);
  };
}
