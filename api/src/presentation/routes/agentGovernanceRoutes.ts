/**
 * Agent-host governance routes — GET /api/agent/governance/policy-gates.
 *
 * A self-hosted runtime serves two kinds of run. A ticket run is dispatched with its
 * gates inside the relay payload (`RuntimeService.withPolicyGates`). A channel
 * message or a cron job has no dispatch, so no payload, so until this door existed no
 * governance gate ever reached it: a tenant `block` gate stopped a tool on a ticket and
 * not on a chat reply. This is the host-key read those runs fetch from.
 *
 * Scope is the TENANT, nothing finer: a channel/cron run has neither a project nor a
 * ticket, so only the tenant's wildcard packs apply — a project- or agent-pinned pack
 * never leaks onto it (`loadPolicyGates` with a tenant-only scope selects exactly that).
 *
 * The route authenticates and answers; the cached resolver is the application
 * service's (`resolvePolicyGates`: L1 + KV read-through keyed on a per-tenant version
 * that every pack/gate write bumps). It is therefore cached, and fresh on a policy edit
 * without any invalidation here. The tenant comes from the host's key and nowhere else:
 * a `tenantId`/`project`/`agent` in the query is ignored, never trusted.
 */
import { Hono } from 'hono';
import { agentHostDoor, type FrontDoor } from '../middleware/frontDoor';
import { resolvePolicyGates } from '../../application/governance/policyPackService';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv } from '../../env';

export function createAgentGovernanceRoutes(db: Db, door: FrontDoor = agentHostDoor(db)): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', door.auth);

  router.get('/policy-gates', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const gates = await resolvePolicyGates(c.env, db, { tenantId });
    return c.json({ gates });
  });

  return router;
}
