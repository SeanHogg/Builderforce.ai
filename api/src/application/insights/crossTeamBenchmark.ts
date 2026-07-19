/**
 * LENS — Cross-team benchmarking (EMP-5, internal cohort).
 *
 * The industry-benchmarking lens ({@link computeBenchmarking}) ranks the tenant
 * against a SEEDED external cohort. This is the complementary INTERNAL view: it
 * ranks each of the tenant's teams against the tenant's OTHER teams, so an EM can
 * see which squads lead/lag on delivery without any external reference data.
 *
 * There is no new collection: per-team values reuse {@link computeMemberMetrics}
 * (the same scorecards the workforce lens shows), aggregated to the team via the
 * team_members roster (kind:ref identity — the exact key the allocation lens uses).
 * DORA deploy-stream keys (freq / CFR / MTTR) are not team-attributable (deploys
 * carry no assignee), so the team metrics are the task-derived four: throughput,
 * cycle time, lead time (== cycle time here) and rework — each ranked to a
 * within-tenant percentile via the pure {@link percentileWithinPeers}.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { teams, teamMembers, teamProjects } from '../../infrastructure/database/schema';
import { computeMemberMetrics, type MemberScorecard } from '../metrics/workforceMetrics';

/** A team metric and whether a HIGHER raw value is the better outcome. */
export const CROSS_TEAM_METRICS = [
  { metric: 'throughput', higherIsBetter: true },
  { metric: 'avg_cycle_time_hours', higherIsBetter: false },
  { metric: 'rework_rate_pct', higherIsBetter: false },
  { metric: 'effectiveness', higherIsBetter: true },
] as const;

export type CrossTeamMetricKey = (typeof CROSS_TEAM_METRICS)[number]['metric'];

export interface TeamMetricValue {
  metric: CrossTeamMetricKey;
  value: number | null;
  /** 0..100 percentile of this team among the tenant's teams (null when < 2 teams
   *  have a value or this team has no value). */
  percentile: number | null;
  higherIsBetter: boolean;
}

export interface TeamBenchmarkRow {
  teamId: number;
  teamName: string;
  memberCount: number;
  completed: number;
  metrics: TeamMetricValue[];
  /** Mean of the team's non-null metric percentiles — a single "where this team
   *  stands overall" score for sorting/leaderboard. */
  overallPercentile: number | null;
}

export interface CrossTeamBenchmarkResult {
  windowDays: number;
  teamCount: number;
  teams: TeamBenchmarkRow[];
}

/**
 * Pure: rank `value` against its `peers` (all teams' values for one metric,
 * including this team's) into a 0..100 percentile. Direction-aware — when a lower
 * raw value is better the ranking is inverted. Uses the "share of peers this team
 * is at-least-as-good-as" definition (ties share credit). Returns null when there
 * are fewer than two comparable peers or `value` is null.
 */
export function percentileWithinPeers(
  value: number | null,
  peers: Array<number | null>,
  higherIsBetter: boolean,
): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const vals = peers.filter((p): p is number => p != null && Number.isFinite(p));
  if (vals.length < 2) return null;
  const atLeastAsGood = vals.filter((p) => (higherIsBetter ? value >= p : value <= p)).length;
  return Math.round((atLeastAsGood / vals.length) * 100);
}

/** Aggregate one team's member scorecards into its task-derived metric values. */
function aggregateTeam(cards: MemberScorecard[]): {
  completed: number; throughput: number | null; avgCycleTimeHours: number | null;
  reworkRatePct: number | null; effectiveness: number | null;
} {
  let completed = 0, redo = 0, reopen = 0, cycleWeighted = 0, cycleWeight = 0;
  const effs: number[] = [];
  for (const c of cards) {
    completed += c.completedCount;
    redo += c.redoCount;
    reopen += c.reopenCount;
    if (c.avgCycleTimeHours != null && c.completedCount > 0) {
      cycleWeighted += c.avgCycleTimeHours * c.completedCount;
      cycleWeight += c.completedCount;
    }
    if (c.effectivenessScore != null) effs.push(c.effectivenessScore);
  }
  return {
    completed,
    throughput: cards.length ? completed : null,
    avgCycleTimeHours: cycleWeight > 0 ? cycleWeighted / cycleWeight : null,
    reworkRatePct: completed > 0 ? ((redo + reopen) / completed) * 100 : null,
    effectiveness: effs.length ? effs.reduce((a, b) => a + b, 0) / effs.length : null,
  };
}

/**
 * Compute per-team delivery metrics + within-tenant percentile bands. Reuses the
 * member scorecards (one query) and maps each member to its team(s) via the roster.
 * A member on multiple teams counts toward each; a team with no active members in
 * the window still appears (all metrics null) so the roster is complete.
 */
export async function computeCrossTeamBenchmark(
  db: Db,
  tenantId: number,
  days: number,
  projectId?: number,
): Promise<CrossTeamBenchmarkResult> {
  const projectTeamIds = projectId == null ? null : (await db
    .select({ teamId: teamProjects.teamId })
    .from(teamProjects)
    .where(eq(teamProjects.projectId, projectId))).map((row) => row.teamId);
  const [teamRows, rosterRows, cards] = await Promise.all([
    projectTeamIds != null && projectTeamIds.length === 0
      ? Promise.resolve([])
      : db.select({ id: teams.id, name: teams.name }).from(teams).where(and(
        eq(teams.tenantId, tenantId),
        ...(projectTeamIds != null ? [inArray(teams.id, projectTeamIds)] : []),
      )),
    db.select({ teamId: teamMembers.teamId, memberKind: teamMembers.memberKind, memberRef: teamMembers.memberRef })
      .from(teamMembers),
    computeMemberMetrics(db, tenantId, days, projectId),
  ]);

  // Restrict the roster to this tenant's teams (team_members has no tenant column).
  const teamIds = new Set(teamRows.map((t) => t.id));
  const membersByTeam = new Map<number, Set<string>>();
  for (const r of rosterRows) {
    if (!teamIds.has(r.teamId)) continue;
    const set = membersByTeam.get(r.teamId) ?? new Set<string>();
    set.add(`${r.memberKind}:${r.memberRef}`);
    membersByTeam.set(r.teamId, set);
  }
  const cardByKey = new Map(cards.map((c) => [`${c.memberKind}:${c.memberRef}`, c]));

  // Aggregate each team, then build the peer arrays for percentile ranking.
  const agg = teamRows.map((t) => {
    const keys = membersByTeam.get(t.id) ?? new Set<string>();
    const teamCards = [...keys].map((k) => cardByKey.get(k)).filter((c): c is MemberScorecard => !!c);
    return { team: t, memberCount: keys.size, ...aggregateTeam(teamCards) };
  });

  const peerVals = (pick: (a: (typeof agg)[number]) => number | null) => agg.map(pick);
  const valueOf: Record<CrossTeamMetricKey, (a: (typeof agg)[number]) => number | null> = {
    throughput: (a) => a.throughput,
    avg_cycle_time_hours: (a) => a.avgCycleTimeHours,
    rework_rate_pct: (a) => a.reworkRatePct,
    effectiveness: (a) => a.effectiveness,
  };
  const peersByMetric = new Map<CrossTeamMetricKey, Array<number | null>>();
  for (const { metric } of CROSS_TEAM_METRICS) peersByMetric.set(metric, peerVals(valueOf[metric]));

  const rows: TeamBenchmarkRow[] = agg.map((a) => {
    const metrics: TeamMetricValue[] = CROSS_TEAM_METRICS.map(({ metric, higherIsBetter }) => {
      const value = valueOf[metric](a);
      const percentile = percentileWithinPeers(value, peersByMetric.get(metric)!, higherIsBetter);
      return { metric, value, percentile, higherIsBetter };
    });
    const pcts = metrics.map((m) => m.percentile).filter((p): p is number => p != null);
    return {
      teamId: a.team.id,
      teamName: a.team.name,
      memberCount: a.memberCount,
      completed: a.completed,
      metrics,
      overallPercentile: pcts.length ? Math.round(pcts.reduce((x, y) => x + y, 0) / pcts.length) : null,
    };
  });

  rows.sort((x, y) => (y.overallPercentile ?? -1) - (x.overallPercentile ?? -1) || x.teamName.localeCompare(y.teamName));
  return { windowDays: days, teamCount: rows.length, teams: rows };
}
