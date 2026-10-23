/**
 * WHAT A HIRE ACTUALLY GIVES YOU — the entitlement and the binding behind it.
 *
 * ── THE DEFECT THIS MODULE EXISTS TO CLOSE ───────────────────────────────────
 * `POST /agents/:id/hire` wrote a row into `agent_purchases` and incremented
 * `ide_agents.hire_count`. That was the whole effect. Every surface that decides
 * whether a workspace may USE a workforce agent asked the same question —
 * "`ide_agents.tenant_id` = my tenant?" — and a hired agent belongs to the
 * SELLER'S tenant, so the answer was always no:
 *
 *   • `resolveAssignedAgent` (swimlane / ticket dispatch) refused it outright:
 *     `AssignedAgentNotFoundError('workforce', ref)`.
 *   • `loadAssignableWorkforce` (the role/ticket assignee picker) omitted it —
 *     while its own doc comment claimed marketplace hires were included, because
 *     "any active `ide_agents` row for the tenant" was believed to be where a
 *     hired agent materialises. No row is ever created there.
 *   • `TeamRoster` left it off the footer for the same reason.
 *
 * So a workspace could pay, appear to acquire an agent, watch `hire_count` go up
 * — and then find the agent nowhere it could be assigned or run. The only two
 * surfaces that DID work read `agent_purchases` directly (`/agents/purchased`
 * and `/api/runtime/hired-agents`), which is what made the gap survivable and
 * invisible.
 *
 * ── THE FIX: ONE PREDICATE, NOT FOUR ─────────────────────────────────────────
 * `usableByTenant` answers "which agents may this workspace use" —
 * the ones it OWNS plus the ones it currently HOLDS a hire on — and every
 * surface above now asks it instead of re-deriving the rule from
 * `ide_agents.tenant_id`. Four copies of an entitlement rule is four places for
 * a buyer to lose what they paid for.
 *
 * ── PROVISIONING: A HIRE HAS TO CREATE SOMETHING ─────────────────────────────
 * Reading the entitlement is not enough on its own. A workforce agent is
 * addressed for per-agent capability assignment, chat participation and role
 * assignment through its WORKSPACE IDENTITY — the `agent_assignments` row with
 * `scope = 'workspace'` (migration 1265 folded the old `project_agents` identity
 * rows in), whose integer `agentHandle` is what `artifact_assignments.scope =
 * 'agent'` points at. An owned agent gets one on demand from
 * `POST /agents/:id/bridge`, which only ever ran for agents the caller owns. A
 * hired agent had none and could not get one.
 *
 * {@link provisionHiredAgent} creates that identity in the HIRING workspace, so
 * a bought agent is configurable and assignable there the moment it is hired;
 * {@link revokeHiredAgent} removes it (and the per-agent assignments hanging off
 * it) on unhire, so releasing an agent releases the configuration with it rather
 * than leaving orphan capability rows pointing at an identity nobody holds.
 *
 * Both go through `AgentAssignmentService.ensureIdentity` / `removeIdentities` —
 * the same calls the owner-side bridge and agent DELETE make — so there is one
 * definition of "the canonical identity of a workforce agent in a workspace".
 */

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { agentPurchases, ideAgents } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { AgentAssignmentService } from '../agent/AgentAssignmentService';

/**
 * The ids of the agents this workspace currently HOLDS a hire on.
 *
 * `unhired_at IS NULL` is the whole distinction between "holding" and "held once":
 * the row is soft-deleted on unhire so the provenance of work the agent did
 * survives, and every entitlement read has to filter on it or a released agent
 * stays usable forever.
 */
export async function activeHiredAgentIds(db: Db, tenantId: number): Promise<string[]> {
  const rows = await db
    .select({ agentId: agentPurchases.agentId })
    .from(agentPurchases)
    .where(scopedToTenant(agentPurchases, tenantId, isNull(agentPurchases.unhiredAt)));
  return rows.map((r) => r.agentId);
}

/**
 * A Drizzle predicate for "an active `ide_agents` row this workspace may use".
 *
 * Takes the already-resolved hired ids so the caller runs ONE extra query rather
 * than one per surface. An empty hire list degenerates to the plain ownership
 * predicate, which is exactly right and costs no `IN ()`.
 */
export function usableByTenant(tenantId: number, hiredAgentIds: readonly string[]) {
  const owned = and(eq(ideAgents.tenantId, tenantId), eq(ideAgents.status, 'active'));
  if (hiredAgentIds.length === 0) return owned;
  return and(
    eq(ideAgents.status, 'active'),
    sql`(${ideAgents.tenantId} = ${tenantId} OR ${inArray(ideAgents.id, [...hiredAgentIds])})`,
  );
}

/**
 * Bind a just-hired agent into the hiring workspace.
 *
 * This is the step that turns "a row says I bought it" into "I can use it": the
 * canonical identity is what the assignee picker, the per-agent capability panel
 * and the chat participant list address the agent by. Without it a hire is a
 * counter.
 */
export async function provisionHiredAgent(
  db: Db,
  input: { tenantId: number; agentId: string; agentName: string; actorUserId: string | null },
): Promise<{ agentHandle: number }> {
  const agentHandle = await new AgentAssignmentService(db).ensureIdentity(input.tenantId, {
    agentRef: input.agentId,
    name: input.agentName,
    addedBy: input.actorUserId,
  });
  return { agentHandle };
}

/**
 * Release a hired agent's binding from the workspace.
 *
 * The hire row itself is soft-deleted by the caller (its `unhired_at` stamp is
 * the provenance record); what goes here is the LIVE wiring — the identity the
 * agent was assignable through and the capabilities configured against it. A
 * released agent that stayed in the assignee picker would be assignable work
 * nothing could run.
 */
export async function revokeHiredAgent(
  db: Db,
  input: { tenantId: number; agentId: string },
): Promise<{ removed: number }> {
  const removed = await new AgentAssignmentService(db).removeIdentities(input.tenantId, { agentRef: input.agentId });
  return { removed };
}
