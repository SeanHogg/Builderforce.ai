/**
 * THE PUBLIC MARKETPLACE AGENT PREDICATE — one definition, every reader.
 *
 * "Which `ide_agents` rows may a stranger see?" was answered independently in
 * eight places — the workforce listing and detail routes, the `/api/ide/agents`
 * registry and its package/state/chat reads, the purchase loader, the checkout
 * handler and the two `agents_published.*` MCP tools — and the answers had
 * already drifted: only the workforce pair excluded demo tenants, so the same
 * fixture agent was hidden from the marketplace page and downloadable from the
 * package endpoint, listable by any agent holding the MCP catalogue, and
 * purchasable through checkout.
 *
 * The predicate lives here now. A read that widens or narrows what "public"
 * means changes this file, and every surface moves with it.
 */
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { ideAgents } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';

/**
 * "…and its tenant is not a demo tenant."
 *
 * A correlated EXISTS rather than a join: the public listing is cached and
 * ordered by hire count, and a join would change the row shape every caller
 * depends on. The demo flag lives on `tenants.is_demo`, which is where
 * `demoSeedService` sets it.
 *
 * WHY IT IS PART OF "PUBLIC" AT ALL: the Talent persona demo tenant publishes
 * `coder`/`copywriter` agents, and they are FIXTURES — seeded to make a sales
 * demo look inhabited, not offered for hire. Left in, the public registry
 * advertised them alongside real ones, so a visitor's first impression of the
 * marketplace was two agents nobody wrote. The admin "paid pro" rollups already
 * discount `is_demo`; this is the same rule applied where the public can see it.
 */
export const notDemoTenant: SQL = sql`NOT EXISTS (
  SELECT 1 FROM tenants t WHERE t.id = ${ideAgents.tenantId} AND t.is_demo = true
)`;

/**
 * Does this agent belong to a demo tenant? The positive form, for the handful of
 * call sites that already hold the row and need to REJECT it with their own
 * message rather than filter it out of a set (the hire handler, which must keep
 * saying "you already own this" to an owner before it says anything else).
 */
export const demoTenantAgent: SQL = sql`EXISTS (
  SELECT 1 FROM tenants t WHERE t.id = ${ideAgents.tenantId} AND t.is_demo = true
)`;

/**
 * The plain predicate — active, published, not a demo fixture — for callers that
 * compose their own `and(...)` and declare their own cross-tenant reason.
 */
export function publiclyListedAgent(...conditions: Array<SQL | undefined>): SQL {
  return and(
    eq(ideAgents.status, 'active'),
    eq(ideAgents.published, true),
    notDemoTenant,
    ...conditions,
  ) as SQL;
}

/**
 * The same predicate, declared as the cross-tenant read it is.
 *
 * A published agent is browsed and bought FROM another workspace, so filtering
 * by the caller's tenant would make every agent on the market invisible to
 * everyone who might pay for it. `published` + `status` + "not a demo fixture"
 * ARE the access control, and `acrossTenants` is where that is stated in a form
 * the tenant-scope guard reads.
 */
export function publicAgentScope(...conditions: Array<SQL | undefined>): SQL {
  return acrossTenants(ideAgents, 'public_catalogue', publiclyListedAgent(...conditions));
}
