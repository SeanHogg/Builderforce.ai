/**
 * assigneeProfiles — the ONE cached map of assignee-ref → personality, so a board
 * card / task drawer / standup row can show WHO an assignee is at a glance without
 * an N+1 fetch per hover. Personality lives in two places (a person's
 * `users.psychometric` and a cloud agent's `ide_agents.psychometric`); this unions
 * both, keyed by the SAME encoded select-value the assignee picker uses
 * (`u:<userId>` humans / `c:<agentRef>` cloud agents), so the client looks the
 * profile up directly by the value it already holds for the task.
 *
 * Only assignees that actually carry a personality are included — the payload stays
 * small and the hovercard self-hides for everyone else. Served read-through cached
 * (see {@link assigneeProfilesCacheKey}) and invalidated whenever a personality is
 * written (auth PATCH /me, agent create/update), so it stays fresh without a poll.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import { ideAgents, tenantMembers, users } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

export interface AssigneeProfile {
  name: string;
  /** Same PsychometricProfile shape personas/agents store; already parsed to an object. */
  psychometric: unknown;
}

/** Tenant-scoped cache key for the assignee-personality map. */
export const assigneeProfilesCacheKey = (tenantId: number): string => `kanban:assignee-profiles:t:${tenantId}`;

function parse(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw) as unknown; } catch { return null; }
}

const humanName = (u: { displayName: string | null; username: string | null; email: string | null }, fallback: string): string =>
  u.displayName?.trim() || u.username?.trim() || u.email?.trim() || fallback;

/**
 * Build assignee-ref → { name, psychometric } for every tenant assignee that carries
 * a personality. Keyed by the encoded select-value (`u:` humans, `c:` cloud agents);
 * self-hosted hosts (`h:`) are machines and carry no personality, so they're absent.
 */
export async function loadAssigneeProfiles(db: Db, tenantId: number): Promise<Record<string, AssigneeProfile>> {
  const [agentRows, humanRows] = await Promise.all([
    db
      .select({ id: ideAgents.id, name: ideAgents.name, psychometric: ideAgents.psychometric })
      .from(ideAgents)
      .where(and(eq(ideAgents.tenantId, tenantId), eq(ideAgents.status, 'active'), isNotNull(ideAgents.psychometric))),
    db
      .select({
        id: users.id, displayName: users.displayName, username: users.username, email: users.email,
        psychometric: users.psychometric,
      })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.isActive, true), isNotNull(users.psychometric))),
  ]);

  const out: Record<string, AssigneeProfile> = {};
  for (const a of agentRows) {
    const psychometric = parse(a.psychometric);
    if (psychometric) out[`c:${a.id}`] = { name: a.name?.trim() || a.id, psychometric };
  }
  for (const h of humanRows) {
    const psychometric = parse(h.psychometric);
    if (psychometric) out[`u:${h.id}`] = { name: humanName(h, h.id), psychometric };
  }
  return out;
}
