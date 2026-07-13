/**
 * EMP-12 — Over-allocation detection.
 *
 * Compares each member's WIP ceiling (member_profiles.max_concurrent_wip) to their
 * OBSERVED work-in-progress: the count of open (non-done), non-archived tasks
 * currently assigned to them tenant-wide. A member carrying more open tasks than
 * their ceiling is flagged `overAllocated` (the board is asking them to hold more
 * than they can) — the signal a manager needs to rebalance before thrash/burnout.
 *
 * The observed-WIP definition MATCHES the assignee recommender's (non-done open
 * tasks) so "over-allocated here" and "no spare capacity there" agree. The member
 * set is derived from members who actually HOLD open work (a member with zero WIP
 * cannot be over-allocated), so names come for free off the task join.
 *
 * {@link scoreAllocation} is pure (no DB) for unit testing.
 */
import { and, desc, eq, ne } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  agentHosts, memberProfiles, projects, tasks, users,
} from '../../infrastructure/database/schema';
import { TaskStatus } from '../../domain/shared/types';
import { notSystemTask } from '../task/taskScope';
import { identityOf, type MemberIdentityFields, type MemberKind } from './workforceMetrics';

/** Default WIP ceiling when a member has no profile / no max set (mirrors the
 *  assignee recommender's DEFAULT_MAX_WIP so the two stay aligned). */
export const DEFAULT_MAX_WIP = 5;
/** Bound the open-task scan; open tasks per tenant is small in practice. */
const MAX_OPEN_TASKS = 10_000;

export interface AllocationHealthRow {
  memberKind: MemberKind;
  memberRef: string;
  name: string;
  /** WIP ceiling from the profile, or DEFAULT_MAX_WIP when unset. */
  maxWip: number;
  /** True when maxWip came from the profile (not the default) — lets the UI nudge
   *  the manager to set a ceiling on members still on the default. */
  hasExplicitMax: boolean;
  /** Open (non-done) tasks currently assigned to this member. */
  observedWip: number;
  overAllocated: boolean;
  /** observedWip / maxWip * 100, rounded. */
  utilizationPct: number;
}

interface OpenTaskRow extends MemberIdentityFields {}
interface ProfileMax { maxWip: number | null }

/**
 * Pure: fold open-task assignee rows + the per-member WIP ceiling into one health
 * row per member holding work. Over-allocated first, then by utilization desc.
 */
export function scoreAllocation(
  openRows: OpenTaskRow[],
  maxByMember: Map<string, ProfileMax>,
): AllocationHealthRow[] {
  const byMember = new Map<string, { kind: MemberKind; ref: string; name: string; wip: number }>();
  for (const r of openRows) {
    const id = identityOf(r);
    if (!id) continue;
    const key = `${id.kind}:${id.ref}`;
    const b = byMember.get(key) ?? { kind: id.kind, ref: id.ref, name: id.name, wip: 0 };
    b.wip += 1;
    byMember.set(key, b);
  }

  const out: AllocationHealthRow[] = [];
  for (const [key, b] of byMember) {
    const profileMax = maxByMember.get(key)?.maxWip ?? null;
    const hasExplicitMax = profileMax != null && profileMax > 0;
    const maxWip = hasExplicitMax ? profileMax! : DEFAULT_MAX_WIP;
    const utilizationPct = Math.round((b.wip / maxWip) * 100);
    out.push({
      memberKind: b.kind,
      memberRef: b.ref,
      name: b.name,
      maxWip,
      hasExplicitMax,
      observedWip: b.wip,
      overAllocated: b.wip > maxWip,
      utilizationPct,
    });
  }

  return out.sort(
    (a, b) =>
      Number(b.overAllocated) - Number(a.overAllocated) ||
      b.utilizationPct - a.utilizationPct ||
      a.name.localeCompare(b.name),
  );
}

export interface AllocationHealthResult {
  members: AllocationHealthRow[];
  overAllocatedCount: number;
  totalMembers: number;
}

/** Fetch open assigned tasks (tenant-scoped via projects) + member WIP ceilings,
 *  then score. Tasks carry no tenant_id, so scope by joining projects. */
export async function computeAllocationHealth(db: Db, tenantId: number): Promise<AllocationHealthResult> {
  const openRows = (await db
    .select({
      assignedUserId: tasks.assignedUserId,
      assignedUserName: users.displayName,
      assignedAgentHostId: tasks.assignedAgentHostId,
      assignedHostName: agentHosts.name,
      assignedAgentRef: tasks.assignedAgentRef,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(users, eq(users.id, tasks.assignedUserId))
    .leftJoin(agentHosts, eq(agentHosts.id, tasks.assignedAgentHostId))
    .where(and(
      eq(projects.tenantId, tenantId),
      eq(tasks.archived, false),
      ne(tasks.status, TaskStatus.DONE),
      notSystemTask,
    ))
    .orderBy(desc(tasks.updatedAt))
    .limit(MAX_OPEN_TASKS)) as OpenTaskRow[];

  const profileRows = await db
    .select({ memberKind: memberProfiles.memberKind, memberRef: memberProfiles.memberRef, maxWip: memberProfiles.maxConcurrentWip })
    .from(memberProfiles)
    .where(eq(memberProfiles.tenantId, tenantId));
  const maxByMember = new Map<string, ProfileMax>();
  for (const p of profileRows) maxByMember.set(`${p.memberKind}:${p.memberRef}`, { maxWip: p.maxWip });

  const members = scoreAllocation(openRows, maxByMember);
  return {
    members,
    overAllocatedCount: members.filter((m) => m.overAllocated).length,
    totalMembers: members.length,
  };
}
