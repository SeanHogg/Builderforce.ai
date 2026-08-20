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
 * {@link dispatchableAgentIds} answers "which agents may this workspace use" —
 * the ones it OWNS plus the ones it currently HOLDS a hire on — and every
 * surface above now asks it instead of re-deriving the rule from
 * `ide_agents.tenant_id`. Four copies of an entitlement rule is four places for
 * a buyer to lose what they paid for.
 *
 * ── PROVISIONING: A HIRE HAS TO CREATE SOMETHING ─────────────────────────────
 * Reading the entitlement is not enough on its own. A workforce agent is
 * addressed for per-agent capability assignment, chat participation and role
 * assignment through its CANONICAL IDENTITY ROW in `project_agents`
 * (tenant-scoped, `project_id IS NULL`, `agent_kind = 'workforce'`) — the id
 * `artifact_assignments.scope = 'agent'` points at. An owned agent gets one on
 * demand from `POST /agents/:id/bridge`, which only ever ran for agents the
 * caller owns. A hired agent had none and could not get one.
 *
 * {@link provisionHiredAgent} creates that identity in the HIRING workspace, so
 * a bought agent is configurable and assignable there the moment it is hired;
 * {@link revokeHiredAgent} removes it (and the per-agent assignments hanging off
 * it) on unhire, so releasing an agent releases the configuration with it rather
 * than leaving orphan capability rows pointing at an identity nobody holds.
 *
 * The identity helpers are shared with the owner-side bridge route, which used to
 * spell the same upsert out inline — one definition of "the canonical identity of
 * a workforce agent in a workspace", used by both paths.
 */

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  agentPurchases,
  artifactAssignments,
  ideAgents,
  projectAgents,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';

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

/** Does this workspace currently hold a hire on this agent? */
export async function holdsActiveHire(db: Db, tenantId: number, agentId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: agentPurchases.id })
    .from(agentPurchases)
    .where(scopedToTenant(agentPurchases, tenantId,
      eq(agentPurchases.agentId, agentId),
      isNull(agentPurchases.unhiredAt)))
    .limit(1);
  return Boolean(row);
}

/**
 * EVERY agent this workspace may dispatch: the ones it owns and the ones it
 * hired. The single predicate the picker, the roster and the dispatch resolver
 * share.
 *
 * Returns ids rather than rows because each caller projects different columns —
 * the roster wants a title and `last_used_at`, the resolver wants runtime and
 * model. Returning rows would have forced one widest-common projection on all of
 * them, which is how a "shared" read acquires columns only one caller uses.
 */
export async function dispatchableAgentIds(db: Db, tenantId: number): Promise<string[]> {
  const [owned, hired] = await Promise.all([
    db.select({ id: ideAgents.id })
      .from(ideAgents)
      .where(scopedToTenant(ideAgents, tenantId, eq(ideAgents.status, 'active'))),
    activeHiredAgentIds(db, tenantId),
  ]);
  return [...new Set([...owned.map((a) => a.id), ...hired])];
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
 * The canonical, project-less `project_agents` identity for a workforce agent in
 * a workspace — created if it is not there yet.
 *
 * Idempotent by the partial unique index the insert targets
 * (`(tenant_id, agent_kind, agent_ref) WHERE project_id IS NULL`); the re-read
 * after `onConflictDoNothing` is what makes a lost insert race still return the
 * identity rather than nothing.
 */
export async function ensureAgentIdentity(
  db: Db,
  input: { tenantId: number; agentId: string; name: string; addedBy: string | null },
): Promise<number | null> {
  const identityWhere = scopedToTenant(projectAgents, input.tenantId,
    eq(projectAgents.agentKind, 'workforce'),
    eq(projectAgents.agentRef, input.agentId),
    isNull(projectAgents.projectId));

  const [existing] = await db.select({ id: projectAgents.id }).from(projectAgents).where(identityWhere);
  if (existing) return existing.id;

  const [created] = await db
    .insert(projectAgents)
    .values({
      tenantId: input.tenantId,
      projectId: null,
      agentKind: 'workforce',
      agentRef: input.agentId,
      name: input.name,
      addedBy: input.addedBy,
    })
    // `where` here is the CONFLICT TARGET predicate (drizzle's name for the
    // partial-index qualifier), matching the partial unique index the raw
    // statement targeted: ON CONFLICT (...) WHERE project_id IS NULL DO NOTHING.
    .onConflictDoNothing({
      target: [projectAgents.tenantId, projectAgents.agentKind, projectAgents.agentRef],
      where: isNull(projectAgents.projectId),
    })
    .returning({ id: projectAgents.id });
  if (created) return created.id;

  // Lost an insert race — read the row the other request created.
  const [row] = await db.select({ id: projectAgents.id }).from(projectAgents).where(identityWhere);
  return row?.id ?? null;
}

/**
 * Drop a workspace's identity rows for an agent, and the per-agent capability
 * assignments that hang off them.
 *
 * Shared with agent DELETE, which had this sequence inline: the assignments MUST
 * go first, because `artifact_assignments.scope_id` holds a `project_agents.id`
 * with no foreign key behind it (it is polymorphic across scopes), so deleting
 * the identity first would leave rows pointing at an id that will eventually be
 * reissued to a different agent.
 *
 * Returns how many identity rows were removed.
 */
export async function removeAgentIdentities(
  db: Db,
  input: { tenantId: number; agentId: string },
): Promise<number> {
  const bridges = await db
    .select({ id: projectAgents.id })
    .from(projectAgents)
    .where(scopedToTenant(projectAgents, input.tenantId,
      eq(projectAgents.agentKind, 'workforce'),
      eq(projectAgents.agentRef, input.agentId),
      isNull(projectAgents.projectId)));
  const bridgeIds = bridges.map((b) => b.id);
  if (bridgeIds.length === 0) return 0;

  await db
    .delete(artifactAssignments)
    .where(scopedToTenant(artifactAssignments, input.tenantId,
      eq(artifactAssignments.scope, 'agent'),
      inArray(artifactAssignments.scopeId, bridgeIds)));
  await db
    .delete(projectAgents)
    .where(scopedToTenant(projectAgents, input.tenantId, inArray(projectAgents.id, bridgeIds)));
  return bridgeIds.length;
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
): Promise<{ projectAgentId: number | null }> {
  const projectAgentId = await ensureAgentIdentity(db, {
    tenantId: input.tenantId,
    agentId: input.agentId,
    name: input.agentName,
    addedBy: input.actorUserId,
  });
  return { projectAgentId };
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
  const removed = await removeAgentIdentities(db, input);
  return { removed };
}
