/**
 * assignableWorkforce — the ONE server-side union of everyone a role/ticket can be
 * assigned to: cloud agents, human workspace members, and active freelance hires.
 *
 * The assignment picker historically fanned out FOUR client calls (listMyAgents +
 * listPurchasedAgents + listTenantMembers + listEngagements) on every open. This
 * collapses that into a single cached read so a hot picker costs one round-trip, and
 * — importantly — includes marketplace-HIRED agents (any active `ide_agents` row for
 * the tenant, which is where a hired marketplace agent materialises) so the picker no
 * longer omits them.
 *
 * Served read-through cached (short TTL — the roster changes rarely), and explicitly
 * invalidated on agent create/update/delete via {@link assignableWorkforceCacheKey}
 * so a just-built agent is immediately pickable rather than hidden behind the TTL.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { ideAgents, tenantMembers, users, freelancerEngagements } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

export interface AssigneeCandidate { ref: string; name: string }
export interface AssignableWorkforce {
  agents: AssigneeCandidate[];
  humans: AssigneeCandidate[];
  hires: AssigneeCandidate[];
}

/** Cache key for one tenant's assignable workforce. Any write that changes who is
 *  assignable (agent create/update/delete, hire, membership) must invalidate this. */
export const assignableWorkforceCacheKey = (tenantId: number): string => `kanban:assignable:t:${tenantId}`;

/** Engagement statuses that still count as an assignable hire (not declined/ended). */
const LIVE_ENGAGEMENT = ['invited', 'interviewing', 'active'];

const displayName = (u: { displayName: string | null; username: string | null; email: string | null }, fallback: string): string =>
  u.displayName?.trim() || u.username?.trim() || u.email?.trim() || fallback;

/** Build the tenant's assignable workforce (agents / humans / hires), deduped. */
export async function loadAssignableWorkforce(db: Db, tenantId: number): Promise<AssignableWorkforce> {
  const [agentRows, humanRows, hireRows] = await Promise.all([
    db
      .select({ id: ideAgents.id, name: ideAgents.name })
      .from(ideAgents)
      .where(and(eq(ideAgents.tenantId, tenantId), eq(ideAgents.status, 'active'))),
    db
      .select({ id: users.id, displayName: users.displayName, username: users.username, email: users.email })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.isActive, true))),
    db
      .select({
        userId: freelancerEngagements.freelancerUserId,
        status: freelancerEngagements.status,
        displayName: users.displayName, username: users.username, email: users.email,
      })
      .from(freelancerEngagements)
      .innerJoin(users, eq(users.id, freelancerEngagements.freelancerUserId))
      .where(and(eq(freelancerEngagements.tenantId, tenantId), inArray(freelancerEngagements.status, LIVE_ENGAGEMENT))),
  ]);

  const agents = dedupe(agentRows.map((a) => ({ ref: a.id, name: a.name?.trim() || a.id })));
  const humans = dedupe(humanRows.map((h) => ({ ref: h.id, name: displayName(h, h.id) })));
  const hires = dedupe(hireRows.map((h) => ({ ref: h.userId, name: displayName(h, h.userId) })));
  return { agents, humans, hires };
}

function dedupe(list: AssigneeCandidate[]): AssigneeCandidate[] {
  const byRef = new Map<string, AssigneeCandidate>();
  for (const c of list) if (!byRef.has(c.ref)) byRef.set(c.ref, c);
  return [...byRef.values()].sort((a, b) => a.name.localeCompare(b.name));
}
