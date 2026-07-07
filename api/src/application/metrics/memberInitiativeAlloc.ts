/**
 * EMP-13 — Per-member strategic-initiative allocation.
 *
 * Shows how each member's effort splits across strategic initiatives (the PMO
 * lineage on tasks.initiative_id → initiatives, 0225). Effort per task uses the
 * shared {@link taskEffortHours} rule (logged time, else capped cycle-time) so this
 * agrees with the labour-cost lens. The result is a stacked allocation per member:
 * their total effort hours plus the per-initiative slices (share of their time), so
 * a manager can see whether a person is spread across ten initiatives or focused on
 * one. {@link rollupAllocation} is pure for unit testing.
 */
import { and, eq, gte } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  agentHosts, initiatives, projects, tasks, users,
} from '../../infrastructure/database/schema';
import { notSystemTask } from '../task/taskScope';
import { loggedMinutesByTask, isoDay } from '../timeTracking/timeTracking';
import { taskEffortHours } from './laborCost';
import { identityOf, type MemberIdentityFields, type MemberKind } from './workforceMetrics';

const HOUR_MS = 3_600_000;

export interface InitiativeSlice {
  initiativeId: string;   // 'unassigned' for tasks with no initiative
  initiativeName: string;
  hours: number;
  /** Share of this member's total effort, 0..100. */
  pct: number;
}

export interface MemberAllocationRow {
  memberKind: MemberKind;
  memberRef: string;
  name: string;
  totalHours: number;
  /** How many distinct initiatives the member touched (focus vs. spread). */
  initiativeCount: number;
  slices: InitiativeSlice[];
}

interface AllocTaskRow extends MemberIdentityFields {
  taskId: number;
  initiativeId: string | null;
  initiativeName: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

/** Pure: fold per-task effort into per-member initiative slices. */
export function rollupAllocation(rows: AllocTaskRow[], loggedMin: Map<number, number>): MemberAllocationRow[] {
  const byMember = new Map<string, {
    kind: MemberKind; ref: string; name: string;
    total: number; byInit: Map<string, InitiativeSlice>;
  }>();

  for (const r of rows) {
    const id = identityOf(r);
    if (!id) continue;
    const hours = taskEffortHours(loggedMin.get(r.taskId) ?? 0, r.createdAt, r.completedAt);
    if (hours <= 0) continue;
    const mkey = `${id.kind}:${id.ref}`;
    const m = byMember.get(mkey) ?? { kind: id.kind, ref: id.ref, name: id.name, total: 0, byInit: new Map() };
    m.total += hours;
    const ikey = r.initiativeId ?? 'unassigned';
    const slice = m.byInit.get(ikey) ?? { initiativeId: ikey, initiativeName: r.initiativeName ?? 'Unassigned', hours: 0, pct: 0 };
    slice.hours += hours;
    m.byInit.set(ikey, slice);
    byMember.set(mkey, m);
  }

  const out: MemberAllocationRow[] = [];
  for (const m of byMember.values()) {
    const slices = [...m.byInit.values()]
      .map((s) => ({ ...s, pct: m.total > 0 ? Math.round((s.hours / m.total) * 100) : 0 }))
      .sort((a, b) => b.hours - a.hours);
    out.push({
      memberKind: m.kind,
      memberRef: m.ref,
      name: m.name,
      totalHours: m.total,
      initiativeCount: slices.filter((s) => s.initiativeId !== 'unassigned').length,
      slices,
    });
  }
  return out.sort((a, b) => b.totalHours - a.totalHours || a.name.localeCompare(b.name));
}

export interface MemberInitiativeAllocResult {
  windowDays: number;
  members: MemberAllocationRow[];
  /** Distinct initiative labels present (for a stable stacked-bar colour legend). */
  initiatives: Array<{ id: string; name: string }>;
}

export async function computeMemberInitiativeAllocation(db: Db, tenantId: number, days: number): Promise<MemberInitiativeAllocResult> {
  const now = Date.now();
  const since = new Date(now - days * 24 * HOUR_MS);

  const rows = (await db
    .select({
      taskId: tasks.id,
      initiativeId: tasks.initiativeId,
      initiativeName: initiatives.name,
      createdAt: tasks.createdAt,
      completedAt: tasks.completedAt,
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
    .leftJoin(initiatives, eq(initiatives.id, tasks.initiativeId))
    .where(and(
      eq(projects.tenantId, tenantId),
      eq(tasks.archived, false),
      gte(tasks.updatedAt, since),
      notSystemTask,
    ))
    .limit(5_000)) as AllocTaskRow[];

  const loggedMin = await loggedMinutesByTask(db, tenantId, rows.map((r) => r.taskId), {
    from: isoDay(since), to: isoDay(new Date(now)),
  });

  const members = rollupAllocation(rows, loggedMin);

  const initLabels = new Map<string, string>();
  for (const m of members) for (const s of m.slices) initLabels.set(s.initiativeId, s.initiativeName);
  return {
    windowDays: days,
    members,
    initiatives: [...initLabels.entries()].map(([id, name]) => ({ id, name })),
  };
}
