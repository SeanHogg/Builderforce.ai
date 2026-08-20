/**
 * THE TICKET'S COORDINATOR — one accountable voice for everything that leaves the ticket.
 *
 * PRD-coordinated-role-participation §5.5: the ticket's Assignee IS its Coordinator, and
 * the Coordinator "owns the ticket's outward communication … stakeholder updates /
 * notifications, `ask_human` escalations, human approvals at human-gated lanes, external
 * board sync comments … so there is one accountable voice per ticket."
 *
 * The sequencing half of that shipped (the Coordinator resolves roles, records hand-offs,
 * owns stage advancement and is the assignee). The ATTRIBUTION half did not: outbound
 * requests were stamped with whichever agent happened to be running at the time. A
 * stakeholder answering a paused run therefore saw a different requester every time the
 * same ticket asked them something — which is precisely the "who is actually accountable
 * for this ticket?" confusion the single-owner rule exists to remove.
 *
 * Provenance is never lost. The acting agent stays on its own columns (`cloud_agent_ref`,
 * `executions.cloud_agent_ref`) and is named inside the composed label, so "the
 * Coordinator asked, on behalf of the developer" is readable from the row alone.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { ideAgents, tasks, users } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';

/** The ticket's accountable owner, resolved to something displayable. */
export interface TicketCoordinator {
  kind: 'human' | 'agent' | 'host';
  /** `u:<userId>` | the agent ref | `h:<hostId>` — stable across renames. */
  ref: string;
  /** Display name, falling back to the ref when the row is gone. */
  label: string;
}

/**
 * Resolve a ticket's Coordinator from its assignee columns. Null when the ticket is
 * unowned — callers then keep their own label, because inventing a coordinator would be
 * worse than admitting there is none.
 *
 * Precedence matches `resolveManagerAssignee`'s encoding: a human assignee wins (a person
 * is the strongest form of accountability), then a cloud agent, then a host agent.
 */
export async function resolveTicketCoordinator(
  db: Db,
  tenantId: number,
  taskId: number,
): Promise<TicketCoordinator | null> {
  const [row] = await db
    .select({
      assignedUserId: tasks.assignedUserId,
      assignedAgentRef: tasks.assignedAgentRef,
      assignedAgentHostId: tasks.assignedAgentHostId,
    })
    .from(tasks)
    .where(scopedToTenant(tasks, tenantId, eq(tasks.id, taskId)))
    .limit(1);
  if (!row) return null;

  if (row.assignedUserId != null) {
    const [u] = await db
      // `users` has no `name` column — a person's label is `display_name`, falling back
      // to the handle and then the address, which is the order every other reader uses.
      .select({ displayName: users.displayName, username: users.username, email: users.email })
      .from(users)
      .where(eq(users.id, row.assignedUserId))
      .limit(1);
    return {
      kind: 'human',
      ref: `u:${row.assignedUserId}`,
      label: u?.displayName?.trim() || u?.username?.trim() || u?.email || `User ${row.assignedUserId}`,
    };
  }

  if (row.assignedAgentRef) {
    const [a] = await db
      .select({ name: ideAgents.name })
      .from(ideAgents)
      .where(scopedToTenant(ideAgents, tenantId, eq(ideAgents.id, row.assignedAgentRef)))
      .limit(1);
    return { kind: 'agent', ref: row.assignedAgentRef, label: a?.name?.trim() || row.assignedAgentRef };
  }

  if (row.assignedAgentHostId != null) {
    return { kind: 'host', ref: `h:${row.assignedAgentHostId}`, label: `Host agent ${row.assignedAgentHostId}` };
  }

  return null;
}

/**
 * The label an OUTBOUND request should carry. PURE.
 *
 * The Coordinator is the voice; the acting agent is the provenance. Composing both into
 * one string is deliberate — an approval queue shows `requested_by` and nothing else, so
 * dropping either half means the reader loses "who do I hold responsible" or "what was
 * actually running". When the two are the same identity (the Coordinator ran it itself,
 * on an unmanaged board), it collapses to a single name rather than repeating it.
 */
export function coordinatorVoice(
  coordinator: TicketCoordinator | null,
  actingLabel: string,
): string {
  if (!coordinator) return actingLabel;
  const acting = actingLabel.trim();
  if (!acting || acting === coordinator.label) return coordinator.label;
  return `${coordinator.label} (on behalf of ${acting})`;
}
