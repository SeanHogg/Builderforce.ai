import type { Project } from '@/lib/types';

/**
 * Single source of truth for a project's health + progress, derived from the
 * task-status breakdown the `/api/projects` list returns. Both the project card
 * and table (and any future surface) call this so the speedometer score and the
 * "% done" ring can never drift between views.
 *
 * Two distinct signals — kept separate on purpose:
 *  - progressPct: how FAR along (completed / total).
 *  - healthScore: how WELL it's going, independent of progress. A brand-new
 *    project with nothing overdue/blocked is healthy even at 0% done; health is
 *    eroded by overdue and blocked OPEN work, not by being early.
 */

export type HealthTier = 'healthy' | 'watch' | 'at_risk' | 'critical';

export interface ProjectHealth {
  /** False when the project has no (non-archived) tasks → render a neutral "no data" state. */
  hasData: boolean;
  /** Completed / total, 0–100. */
  progressPct: number;
  /** Composite 0–100 health (higher = healthier). */
  healthScore: number;
  tier: HealthTier;
  /** Tier colour (hex, stable across themes — same convention as chartColors). */
  color: string;
  completed: number;
  total: number;
  open: number;
  blocked: number;
  overdue: number;
}

const TIER_COLOR: Record<HealthTier, string> = {
  healthy: '#22c55e',
  watch: '#eab308',
  at_risk: '#f59e0b',
  critical: '#ef4444',
};

/** Map a 0–100 score to a tier (shared so the badge + gauge agree). */
export function healthTier(score: number): HealthTier {
  if (score >= 80) return 'healthy';
  if (score >= 60) return 'watch';
  if (score >= 40) return 'at_risk';
  return 'critical';
}

export function computeProjectHealth(project: Project): ProjectHealth {
  const total = project.taskCount ?? 0;
  const completed = Math.min(total, project.completedTaskCount ?? 0);
  const blocked = project.blockedTaskCount ?? 0;
  const overdue = project.overdueTaskCount ?? 0;
  // Prefer the server's open count; fall back to total − completed.
  const open = project.openTaskCount ?? Math.max(0, total - completed);

  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  // Health: start at 100, erode by the share of OPEN work that's overdue or
  // blocked (overdue weighted heavier than blocked). When everything is resolved
  // (open === 0) the project is fully healthy.
  let healthScore = 100;
  if (open > 0) {
    const overdueRatio = Math.min(1, overdue / open);
    const blockedRatio = Math.min(1, blocked / open);
    healthScore = Math.round(100 * Math.max(0, 1 - 0.6 * overdueRatio - 0.4 * blockedRatio));
  }

  const tier = healthTier(healthScore);
  return { hasData: total > 0, progressPct, healthScore, tier, color: TIER_COLOR[tier], completed, total, open, blocked, overdue };
}
