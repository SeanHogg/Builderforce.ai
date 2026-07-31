/**
 * EMP-19 — Labor-cost attribution.
 *
 * Attributes real labour spend to work by pricing each task's effort at the owning
 * member's blended rate (member_profiles.cost_rate_usd_cents). Effort follows the
 * SAME rule the planning spine uses (DRY): REAL logged time (time_entries, 0245)
 * wins; absent that, a cycle-time estimate (created → done, capped at one work-day)
 * is the fallback until time is logged. Cost is then rolled up three ways —
 * per member, per project, per initiative — so a manager can see where the money
 * went and who carried it.
 *
 * {@link taskLaborUsd} mirrors planningSpine's per-task human-cost math and is pure
 * for unit testing.
 */
import { and, eq, gte } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  agentHosts, initiatives, memberProfiles, projects, tasks, users,
} from '../../infrastructure/database/schema';
import { notSystemTask } from '../task/taskScope';
import { loggedMinutesByTask, isoDay } from '../timeTracking/timeTracking';
import { identityOf, type MemberIdentityFields, type MemberKind } from './workforceMetrics';

const HOUR_MS = 3_600_000;
/** Cap a single task's cycle-time estimate at one work-day (matches planningSpine). */
export const HUMAN_HOURS_CAP = 8;

/**
 * Pure: effort hours for one task. REAL logged time wins; else the capped
 * cycle-time estimate once the task is done; else 0. The single effort definition
 * shared by cost attribution (EMP-19) and initiative allocation (EMP-13).
 */
export function taskEffortHours(loggedMinutes: number, createdAt: Date, completedAt: Date | null): number {
  if (loggedMinutes > 0) return loggedMinutes / 60;
  if (completedAt) {
    const cycleHours = (completedAt.getTime() - createdAt.getTime()) / HOUR_MS;
    return Math.max(0, Math.min(cycleHours, HUMAN_HOURS_CAP));
  }
  return 0;
}

/**
 * Pure: dollars of labour for one task. `ratePerHour` null ⇒ 0 (member has no
 * modelled rate) while effort is still reported.
 */
export function taskLaborUsd(
  ratePerHour: number | null,
  loggedMinutes: number,
  createdAt: Date,
  completedAt: Date | null,
): { usd: number; effortHours: number } {
  const effortHours = taskEffortHours(loggedMinutes, createdAt, completedAt);
  return { usd: ratePerHour == null ? 0 : ratePerHour * effortHours, effortHours };
}

export interface LaborByMember {
  memberKind: MemberKind;
  memberRef: string;
  name: string;
  costUsd: number;
  effortHours: number;
  taskCount: number;
}
export interface LaborBucket { id: string; name: string; costUsd: number }

export interface LaborCostResult {
  windowDays: number;
  totalUsd: number;
  byMember: LaborByMember[];
  byProject: LaborBucket[];
  byInitiative: LaborBucket[];
}

interface TaskRow extends MemberIdentityFields {
  taskId: number;
  projectId: number;
  projectName: string | null;
  initiativeId: string | null;
  initiativeName: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface LaborCostOptions { projectId?: number }

export async function computeLaborCost(
  db: Db,
  tenantId: number,
  days: number,
  opts: LaborCostOptions = {},
): Promise<LaborCostResult> {
  const now = Date.now();
  const since = new Date(now - days * 24 * HOUR_MS);

  const conds = [
    eq(projects.tenantId, tenantId),
    eq(tasks.archived, false),
    gte(tasks.updatedAt, since),
    notSystemTask,
  ];
  if (opts.projectId != null) conds.push(eq(tasks.projectId, opts.projectId));

  const rows = (await db
    .select({
      taskId: tasks.id,
      projectId: tasks.projectId,
      projectName: projects.name,
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
    .where(and(...conds))
    .limit(5_000)) as TaskRow[];

  // Rate per hour by member (cents → dollars).
  const rateByMember = new Map<string, number>();
  const rateRows = await db
    .select({ memberKind: memberProfiles.memberKind, memberRef: memberProfiles.memberRef, cents: memberProfiles.costRateUsdCents })
    .from(memberProfiles)
    .where(eq(memberProfiles.tenantId, tenantId));
  for (const r of rateRows) if (r.cents != null) rateByMember.set(`${r.memberKind}:${r.memberRef}`, r.cents / 100);

  // Real logged minutes for the window (bounds effort to the reporting window).
  const loggedMin = await loggedMinutesByTask(db, tenantId, rows.map((r) => r.taskId), {
    from: isoDay(since), to: isoDay(new Date(now)),
  });

  const byMember = new Map<string, LaborByMember>();
  const byProject = new Map<string, LaborBucket>();
  const byInitiative = new Map<string, LaborBucket>();
  let totalUsd = 0;

  for (const r of rows) {
    const id = identityOf(r);
    if (!id) continue;
    const mkey = `${id.kind}:${id.ref}`;
    const rate = rateByMember.get(mkey) ?? null;
    const { usd, effortHours } = taskLaborUsd(rate, loggedMin.get(r.taskId) ?? 0, r.createdAt, r.completedAt);
    if (usd === 0 && effortHours === 0) continue;
    totalUsd += usd;

    const m = byMember.get(mkey) ?? { memberKind: id.kind, memberRef: id.ref, name: id.name, costUsd: 0, effortHours: 0, taskCount: 0 };
    m.costUsd += usd; m.effortHours += effortHours; m.taskCount += 1; byMember.set(mkey, m);

    const pkey = String(r.projectId);
    const p = byProject.get(pkey) ?? { id: pkey, name: r.projectName ?? `Project #${r.projectId}`, costUsd: 0 };
    p.costUsd += usd; byProject.set(pkey, p);

    const ikey = r.initiativeId ?? 'unassigned';
    const i = byInitiative.get(ikey) ?? { id: ikey, name: r.initiativeName ?? 'Unassigned', costUsd: 0 };
    i.costUsd += usd; byInitiative.set(ikey, i);
  }

  const byCost = (a: { costUsd: number }, b: { costUsd: number }) => b.costUsd - a.costUsd;
  return {
    windowDays: days,
    totalUsd,
    byMember: [...byMember.values()].sort(byCost),
    byProject: [...byProject.values()].sort(byCost),
    byInitiative: [...byInitiative.values()].sort(byCost),
  };
}
