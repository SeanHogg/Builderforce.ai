/**
 * The identity an authenticated agent host presents — resolved once, in the
 * application layer, so no route or middleware has to assemble it.
 *
 * Two doors mint the SAME identity for a registered host: `POST
 * /api/auth/agentHost-token`, which exchanges its API key for a tenant JWT, and
 * the direct-key middleware {@link ../../presentation/middleware/hostOrTenantAuth}.
 * Before this module the second door built the identity inline, which meant a
 * presentation-layer file reaching into `infrastructure/auth` for both the key
 * check and the segment lookup — the layering the guard exists to stop, and the
 * shape that let the two doors drift (one published a `machineActor`, the other
 * did not, so writes made through the key door were credited to a person).
 *
 * Returning a plain record rather than mutating a request context is what keeps
 * this callable from anywhere: the middleware publishes it onto Hono, and a
 * future caller (a queue consumer, a test) can hold it as a value.
 */

import type { Context } from 'hono';
import { TenantRole } from '../../domain/shared/types';
import { resolveHostAuth } from '../../infrastructure/auth/agentHostAuth';
import { resolveSegment } from '../../infrastructure/auth/segmentResolver';
import type { Db } from '../../infrastructure/database/connection';
import type { MachineSubject } from '../../infrastructure/auth/machineSubject';

/** Exactly the request identity the JWT-exchange door publishes, as a value. */
export interface AgentHostIdentity {
  userId: string;
  tenantId: number;
  role: TenantRole;
  machineActor: MachineSubject;
  segmentId: string;
}

/**
 * Resolve the agent host behind a request, or null when no host key is present.
 *
 * `idPathParam` names the route parameter carrying the host id, for the
 * `/api/agent-hosts/:id/*` convention where the key is a bare `Bearer` with the
 * id in the path. Omitted, only the header and query-string forms are accepted.
 *
 * A null result is NOT an authentication failure — it means the caller offered
 * no host credential at all, and the caller (the middleware) falls through to
 * the human path. A host key that is present but wrong also returns null, and
 * lands on the same fallthrough, where `authMiddleware` rejects it: one 401,
 * from the component that owns 401s.
 */
export async function resolveAgentHostIdentity(
  db: Db,
  c: Context,
  idPathParam?: string,
): Promise<AgentHostIdentity | null> {
  const host = await resolveHostAuth(db, c, idPathParam);
  if (!host) return null;
  return {
    userId: `agentHost:${host.id}`,
    tenantId: host.tenantId,
    role: TenantRole.DEVELOPER,
    machineActor: { kind: 'agent_host', agentHostId: host.id, suffix: String(host.id) },
    segmentId: await resolveSegment(db, host.tenantId),
  };
}
