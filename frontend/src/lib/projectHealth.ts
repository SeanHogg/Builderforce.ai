import type { Project } from '@/lib/types';
import { computeDeliveryVerdict, type Verdict } from '@/lib/deliveryVerdict';

/**
 * Single source of truth for a project's health + progress. Both the project card
 * and table (and any future surface) call this so the speedometer score and the
 * "% done" ring can never drift between views.
 *
 * Two distinct signals — kept separate on purpose:
 *  - progressPct: how FAR along (completed / total), derived from the task-status
 *    breakdown the `/api/projects` list returns.
 *  - healthScore: how WELL it's DELIVERING. This is the SAME delivery-health
 *    verdict the /insights/delivery banner shows — DORA cadence + end-to-end cycle
 *    time + flow (rework / stuck WIP) fused via {@link computeDeliveryVerdict} —
 *    computed from the compact per-project `deliverySignals` the list attaches. A
 *    project therefore reads ONE health number on its card and on the delivery
 *    tab. Null when there's no delivery data yet (no deploys / throughput).
 */

export type HealthTier = 'healthy' | 'watch' | 'yellow' | 'at_risk' | 'critical';

export interface ProjectHealth {
  /** False when the project has no (non-archived) tasks → render a neutral "no data" state. */
  hasData: boolean;
  /** Completed / total, 0–100. */
  progressPct: number;
  /** Composite 0–100 delivery-health (higher = healthier), or null when there's
   *  no delivery signal yet (no deploys/throughput in the window). */
  healthScore: number | null;
  /** The verdict behind the score (yes/at_risk/no/no_data). */
  verdict: Verdict;
  /** Tier for the score, or null when healthScore is null. */
  tier: HealthTier | null;
  /** Previous tier and score when computing health for the next update; used to
   *  detect Yellow transitions for notifications and audit logging. */
  previousTier: HealthTier | null;
  previousScore: number | null;
  /** Tier colour (hex, stable across themes — same convention as chartColors);
   *  neutral border colour when there's no health score. */
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
  yellow: '#F5A623',
  at_risk: '#f59e0b',
  critical: '#ef4444',
};

const NO_SCORE_COLOR = 'var(--border-subtle)';

/** Whether a score transition crosses the Yellow boundary (50–74).
 *  Returns true if score goes from NOT yellow (score < 50 or score > 74) TO yellow (score >= 50 and score <= 74),
 *  or FROM yellow TO not yellow. Detects entry or exit events. */
export function isYellowTransition(oldScore: number | null, newScore: number | null): boolean {
  const nowYellow = newScore != null && newScore >= 50 && newScore <= 74;
  const prevYellow = oldScore != null && oldScore >= 50 && oldScore <= 74;
  return nowYellow !== prevYellow;
}

/** Map a 0–100 score to a tier (shared so the badge + gauge agree).
 *
 *  Yellow tier (50–74): for the Yellow risk indicator feature (Yellow: 50–74).
 *  Watch (60+): kept for compatibility; label controlled by i18n.
 *  At-risk (40–49): kept for compatibility; label controlled by i18n (may be aliased to Yellow in future).
 */
export function healthTier(score: number): HealthTier {
  if (score >= 80) return 'healthy';
  if (score >= 60) return 'watch';
  if (score >= 50) return 'yellow';
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

  // Health = the shared delivery verdict (identical to the /insights/delivery
  // gauge). No signals yet → no_data → a neutral health readout.
  const s = project.deliverySignals;
  const { verdict, score } = s
    ? computeDeliveryVerdict(s.dora, s.lifecycle, s.bottlenecks)
    : { verdict: 'no_data' as Verdict, score: null };
  const tier = score != null ? healthTier(score) : null;
  const color = tier ? TIER_COLOR[tier] : NO_SCORE_COLOR;

  return { hasData: total > 0, progressPct, healthScore: score, verdict, tier, color, completed, total, open, blocked, overdue };
}
