/**
 * hostOrTenantAuth — the ONE spelling of "either a person's tenant JWT or a
 * registered agent host's API key may call this".
 *
 * Several execution seams have to answer to BOTH callers: the browser worker
 * drives them with the operator's tenant JWT, and a headless executor (an
 * on-prem agent host, a container run) drives the SAME endpoint with its
 * `agent_hosts` API key. Before this existed, four route files each open-coded
 * the fallback — and they disagreed: one accepted `Bearer`+`X-AgentHost-Id`, one
 * only `?agentHostId=&key=`, one both, and the agent-runtime + git-proxy seams
 * accepted neither, which is why a non-browser executor could not close its loop.
 *
 * Behaviour:
 *   1. Ask the application layer for the host identity behind this request
 *      ({@link resolveAgentHostIdentity}), which is the SAME record the JWT
 *      exchange publishes — so a handler downstream cannot tell the two doors
 *      apart and nothing has to learn a second identity shape.
 *   2. If one resolves, publish it and continue.
 *   3. Otherwise delegate to {@link authMiddleware} verbatim, so revocation,
 *      session-version and segment resolution all still apply to a human caller.
 *
 * The identity is BUILT in `application/auth/hostIdentity.ts`, not here: a
 * middleware may decide who a request is on behalf of, but resolving it means a
 * key check and a segment lookup, and those are infrastructure this layer must
 * not reach into directly.
 */
import type { Context, MiddlewareHandler } from 'hono';
import { authMiddleware } from './authMiddleware';
import { resolveAgentHostIdentity, type AgentHostIdentity } from '../../application/auth/hostIdentity';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv } from '../../env';

/** Publish a resolved host identity onto the request. */
function publish(c: Context<HonoEnv>, db: Db, identity: AgentHostIdentity): void {
  c.set('userId', identity.userId);
  c.set('tenantId', identity.tenantId);
  c.set('role', identity.role);
  c.set('machineActor', identity.machineActor);
  c.set('segmentId', identity.segmentId);
  if (!c.get('db')) c.set('db', db);
}

/**
 * Middleware: accept a host API key OR a tenant JWT. `db` is the router's handle
 * so the key lookup reuses the same connection the routes already hold.
 *
 * `idPathParam` names the route parameter carrying the host id, for routers
 * mounted under `/api/agent-hosts/:id/*` where the key arrives as a bare
 * `Bearer` and the id is in the path. Omitted, only the header and query-string
 * forms authenticate — which is why a router that addresses its caller by path
 * and does NOT pass this would silently accept only the other two.
 */
export function hostOrTenantAuth(db: Db, idPathParam?: string): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const identity = await resolveAgentHostIdentity(db, c, idPathParam);
    if (!identity) {
      // No host key on the request — a bare `Bearer <jwt>` carries no
      // `X-AgentHost-Id`, so it lands here and takes the full human path.
      await authMiddleware(c, next);
      return;
    }
    publish(c, db, identity);
    await next();
  };
}

/**
 * The agent host behind this request, or null when a person authenticated.
 *
 * Reads the `machineActor` both doors publish rather than a second variable, so
 * a route that wants to attribute work to the executing host asks ONE question.
 */
export function requestAgentHostId(c: Context<HonoEnv>): number | null {
  const actor = c.get('machineActor');
  return actor?.kind === 'agent_host' ? actor.agentHostId : null;
}
