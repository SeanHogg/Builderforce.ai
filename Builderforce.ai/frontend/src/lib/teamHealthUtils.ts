/**
 * teamHealthUtils.ts — pure helpers for score computation, CSV export, overload calc.
 */

import type {
  ContributorLoad,
  Blocker,
  AgingWip,
  AgentHealth,
  HealthScoreConfig,
  HealthScoreBreakdown,
  OverloadResult,
} from './teamHealthTypes';

/** Compute the weighted Team Health Score (0–100). */
export function computeHealthScore(
  contributors: ContributorLoad[],
  blockers: Blocker[],
  agingWip: AgingWip[],
  agents: AgentHealth[],
  config: HealthScoreConfig,
): HealthScoreBreakdown {
  const w = config.weights;

  // Blocker sub-score: 100 if zero; penalise per blocker (capped at 0)
  const blockerScore = blockers.length === 0 ? 100 : Math.max(0, 100 - blockers.length * 8);

  // Over-capacity sub-score: % of contributors NOT over threshold
  const overThreshold = config.thresholds.overloadWarningPct ?? 120;
  const overCount = contributors.filter((c) => {
    if (!c.capacity || c.capacity <= 0) return false;
    return (c.activeTaskCount / c.capacity) * 100 > overThreshold;
  }).length;
  const overCapScore = contributors.length === 0 ? 100 : Math.max(0, 100 - (overCount / contributors.length) * 100);

  // Aging WIP sub-score
  const agingScore = agingWip.length === 0 ? 100 : Math.max(0, 100 - agingWip.length * 5);

  // Agent error sub-score
  const errorRate = agents.length === 0 ? 0 : agents.filter((a) => a.agentStatus === 'error').length / agents.length;
  const agentScore = Math.max(0, 100 - errorRate * 100);

  const overall = Math.round(
    blockerScore * w.blockerCount +
    overCapScore * w.overCapacityPct +
    agingScore * w.agingWipCount +
    agentScore * w.agentErrorRate,
  );

  return {
    overall,
    blockerScore: Math.round(blockerScore),
    overCapScore: Math.round(overCapScore),
    agingScore: Math.round(agingScore),
    agentScore: Math.round(agentScore),
    breakdown: [
      { label: 'Blockers', score: Math.round(blockerScore) },
      { label: 'Capacity', score: Math.round(overCapScore) },
      { label: 'Aging WIP', score: Math.round(agingScore) },
      { label: 'Agents', score: Math.round(agentScore) },
    ],
  };
}

/** Compute overload level and percentage for a single contributor. */
export function computeOverload(
  tasksAssigned: number,
  capacity: number,
  config: HealthScoreConfig,
): OverloadResult {
  if (!capacity || capacity <= 0) {
    return { level: 'ok', pct: 0 };
  }
  const pct = Math.round((tasksAssigned / capacity) * 100);
  const criticalThreshold = config.thresholds.overloadCriticalPct ?? 150;
  const warningThreshold = config.thresholds.overloadWarningPct ?? 120;

  if (pct >= criticalThreshold) return { level: 'critical', pct };
  if (pct >= warningThreshold) return { level: 'warning', pct };
  return { level: 'ok', pct };
}

/** Export an aging-WIP list to CSV string (FR-3.5). */
export function agingWipToCsv(items: AgingWip[]): string {
  const header = 'Task ID,Title,Assignee,Status,Days Since Activity';
  const rows = items.map(
    (a) =>
      `"${a.task.id}","${a.task.title.replace(/"/g, '""')}","${a.task.assigneeName ?? ''}",${a.task.status},${Math.round(a.staleDays)}`,
  );
  return [header, ...rows].join('\n');
}
