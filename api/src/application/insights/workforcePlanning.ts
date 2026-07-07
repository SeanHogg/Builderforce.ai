/**
 * Blended human + agent workforce-planning view — hire-vs-agent ALLOCATION over
 * {@link memberProfiles}.
 *
 * Answers the capacity-planning question a manager actually asks: for every
 * member of the workforce (human OR agent), how much declared capacity do they
 * carry, how much is currently in flight (observed WIP), what does that cost, and
 * where is the gap — split human vs agent so the "hire a person vs. spin up an
 * agent" trade-off is legible. Reuses the SAME polymorphic identity + WIP
 * derivation as the scorecards ({@link identityOf}) so a member is counted once
 * and identically across the workforce surfaces (DRY).
 *
 * Capacity comes from the profile (weekly hours / daily points / max WIP / cost
 * rate). Observed WIP is open (not-done, not-archived) assigned tasks. Pure
 * arithmetic on top of two bounded queries; cached at the route.
 */

import { and, eq, ne, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  agentHosts, memberProfiles, projects, tasks, users,
} from '../../infrastructure/database/schema';
import { notSystemTask } from '../task/taskScope';
import { identityOf, type MemberKind } from '../metrics/workforceMetrics';
import { TaskStatus } from '../../domain/shared/types';

/** Which population a member belongs to for the human-vs-agent split. */
export type WorkforcePopulation = 'human' | 'agent';

/** One planning row per workforce member. */
export interface WorkforcePlanMember {
  memberKind: MemberKind;
  memberRef: string;
  memberName: string;
  population: WorkforcePopulation;
  discipline: string | null;
  /** Declared capacity from the profile (nulls = not modelled). */
  weeklyCapacityHours: number | null;
  dailyCapacityPoints: number | null;
  maxConcurrentWip: number | null;
  /** Blended hourly cost (USD) from cost_rate_usd_cents; null = not modelled. */
  costRateUsdHours: number | null;
  /** Observed open (in-flight) assigned tasks. */
  openWip: number;
  /** maxConcurrentWip − openWip (null when no WIP ceiling is set). */
  spareWip: number | null;
  /** True when openWip exceeds the declared WIP ceiling. */
  overAllocated: boolean;
  /** Estimated weekly cost = weeklyCapacityHours × hourly rate (null if either missing). */
  weeklyCostUsd: number | null;
}

export interface WorkforcePopulationRollup {
  population: WorkforcePopulation;
  memberCount: number;
  totalWeeklyCapacityHours: number;
  totalMaxWip: number;
  totalOpenWip: number;
  /** totalMaxWip − totalOpenWip, floored at 0. */
  capacityGapWip: number;
  totalWeeklyCostUsd: number;
}

export interface WorkforcePlan {
  generatedAt: string;
  members: WorkforcePlanMember[];
  byPopulation: WorkforcePopulationRollup[];
  totals: {
    memberCount: number;
    totalWeeklyCapacityHours: number;
    totalMaxWip: number;
    totalOpenWip: number;
    /** Overall unused WIP headroom (allocatable capacity). */
    capacityGapWip: number;
    totalWeeklyCostUsd: number;
    /** Blended weekly cost split — the hire-vs-agent cost comparison. */
    humanWeeklyCostUsd: number;
    agentWeeklyCostUsd: number;
    /** Share of open WIP carried by agents (0..1) — automation leverage. */
    agentWipShare: number;
  };
}

const populationOf = (kind: MemberKind): WorkforcePopulation => (kind === 'human' ? 'human' : 'agent');

/**
 * Compute the blended workforce plan for a tenant. Two bounded queries: every
 * member profile, and the open (in-flight) assigned tasks (tenant-scoped by
 * joining projects, the same pattern as the scorecards).
 */
export async function computeWorkforcePlan(db: Db, tenantId: number): Promise<WorkforcePlan> {
  const profileRows = await db
    .select({
      memberKind: memberProfiles.memberKind,
      memberRef: memberProfiles.memberRef,
      discipline: memberProfiles.discipline,
      weeklyCapacityHours: memberProfiles.weeklyCapacityHours,
      dailyCapacityPoints: memberProfiles.dailyCapacityPoints,
      maxConcurrentWip: memberProfiles.maxConcurrentWip,
      costRateUsdCents: memberProfiles.costRateUsdCents,
    })
    .from(memberProfiles)
    .where(eq(memberProfiles.tenantId, tenantId));

  // Open (in-flight) assigned tasks → observed WIP per member. Not-done, not-archived.
  const openTasks = await db
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
    ));

  // WIP by polymorphic identity (same resolver the scorecards use).
  const wipByMember = new Map<string, { name: string; wip: number }>();
  for (const r of openTasks) {
    const id = identityOf(r);
    if (!id) continue;
    const key = `${id.kind}:${id.ref}`;
    const prev = wipByMember.get(key) ?? { name: id.name, wip: 0 };
    prev.wip += 1;
    wipByMember.set(key, prev);
  }

  const members: WorkforcePlanMember[] = profileRows.map((p) => {
    const key = `${p.memberKind}:${p.memberRef}`;
    const wip = wipByMember.get(key)?.wip ?? 0;
    const name = wipByMember.get(key)?.name ?? p.memberRef;
    const costRateUsdHours = p.costRateUsdCents != null ? p.costRateUsdCents / 100 : null;
    const spareWip = p.maxConcurrentWip != null ? p.maxConcurrentWip - wip : null;
    const weeklyCostUsd = p.weeklyCapacityHours != null && costRateUsdHours != null
      ? Math.round(p.weeklyCapacityHours * costRateUsdHours)
      : null;
    return {
      memberKind: p.memberKind as MemberKind,
      memberRef: p.memberRef,
      memberName: name,
      population: populationOf(p.memberKind as MemberKind),
      discipline: p.discipline ?? null,
      weeklyCapacityHours: p.weeklyCapacityHours,
      dailyCapacityPoints: p.dailyCapacityPoints,
      maxConcurrentWip: p.maxConcurrentWip,
      costRateUsdHours,
      openWip: wip,
      spareWip,
      overAllocated: p.maxConcurrentWip != null && wip > p.maxConcurrentWip,
      weeklyCostUsd,
    };
  });

  // Members with WIP but no profile still matter to the plan (unmodelled capacity).
  const profiledKeys = new Set(profileRows.map((p) => `${p.memberKind}:${p.memberRef}`));
  for (const [key, v] of wipByMember) {
    if (profiledKeys.has(key)) continue;
    const [kind, ref] = key.split(':') as [MemberKind, string];
    members.push({
      memberKind: kind,
      memberRef: ref,
      memberName: v.name,
      population: populationOf(kind),
      discipline: null,
      weeklyCapacityHours: null,
      dailyCapacityPoints: null,
      maxConcurrentWip: null,
      costRateUsdHours: null,
      openWip: v.wip,
      spareWip: null,
      overAllocated: false,
      weeklyCostUsd: null,
    });
  }

  // Sort busiest-first, stable by name.
  members.sort((a, b) => b.openWip - a.openWip || a.memberName.localeCompare(b.memberName));

  // ── population rollups ──
  const byPop = new Map<WorkforcePopulation, WorkforcePopulationRollup>();
  for (const pop of ['human', 'agent'] as const) {
    byPop.set(pop, {
      population: pop, memberCount: 0, totalWeeklyCapacityHours: 0,
      totalMaxWip: 0, totalOpenWip: 0, capacityGapWip: 0, totalWeeklyCostUsd: 0,
    });
  }
  for (const m of members) {
    const r = byPop.get(m.population)!;
    r.memberCount += 1;
    r.totalWeeklyCapacityHours += m.weeklyCapacityHours ?? 0;
    r.totalMaxWip += m.maxConcurrentWip ?? 0;
    r.totalOpenWip += m.openWip;
    r.totalWeeklyCostUsd += m.weeklyCostUsd ?? 0;
  }
  for (const r of byPop.values()) r.capacityGapWip = Math.max(0, r.totalMaxWip - r.totalOpenWip);
  const byPopulation = [...byPop.values()];

  const human = byPop.get('human')!;
  const agent = byPop.get('agent')!;
  const totalMaxWip = human.totalMaxWip + agent.totalMaxWip;
  const totalOpenWip = human.totalOpenWip + agent.totalOpenWip;
  const totalWeeklyCostUsd = human.totalWeeklyCostUsd + agent.totalWeeklyCostUsd;

  return {
    generatedAt: new Date().toISOString(),
    members,
    byPopulation,
    totals: {
      memberCount: members.length,
      totalWeeklyCapacityHours: human.totalWeeklyCapacityHours + agent.totalWeeklyCapacityHours,
      totalMaxWip,
      totalOpenWip,
      capacityGapWip: Math.max(0, totalMaxWip - totalOpenWip),
      totalWeeklyCostUsd,
      humanWeeklyCostUsd: human.totalWeeklyCostUsd,
      agentWeeklyCostUsd: agent.totalWeeklyCostUsd,
      agentWipShare: totalOpenWip > 0 ? agent.totalOpenWip / totalOpenWip : 0,
    },
  };
}
