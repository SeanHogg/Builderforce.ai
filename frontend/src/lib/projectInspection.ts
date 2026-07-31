import type { Project } from '@/lib/types';
import { computeProjectHealth, healthTier, type HealthTier } from '@/lib/projectHealth';

/**
 * The project "full inspection" — a multi-dimension Product-Management rating that
 * turns the two existing speedometers (Health + % done) into ONE of several
 * graded dimensions, plus an overall letter grade and a prescriptive "what to
 * target" list. Think of it as a car-inspection sticker for a project: every
 * sub-system gets a score, and the report tells you exactly what to fix.
 *
 * This is the single source of truth (same role as {@link computeProjectHealth})
 * so the compact card strip, the dashboard and the slide-out report can never
 * drift. It is PURE and derived entirely from the fields the `/api/projects` list
 * already returns — no per-card fetch, no N+1.
 *
 * The rating is deliberately weighted toward the platform North Star — *"define a
 * need, the agentic system solves it"*: a project an agent can actually execute is
 * one whose NEED is defined (vision, goals/OKRs, deadline) and whose work is
 * planned. So `direction` carries the most weight and surfaces first.
 */

export type InspectionKey = 'direction' | 'planning' | 'health' | 'progress' | 'execution';

export interface InspectionDimension {
  key: InspectionKey;
  /** 0–100, or null when the project has no task data to judge it on (health/progress). */
  score: number | null;
  /** Tier for the score (null score → null tier → "no data"). */
  tier: HealthTier | null;
  /** Tier colour (hex, stable across themes — same convention as projectHealth). */
  color: string;
  /** Relative weight in the overall rating (renormalized over scored dimensions). */
  weight: number;
}

export interface InspectionRecommendation {
  /** Stable key → resolves to projectInspection.rec.<key>.{title,detail} in i18n. */
  key: string;
  dimension: InspectionKey;
  /** Lower = more urgent / higher up the "what to target" list. */
  priority: number;
  /** ICU params for the i18n strings (e.g. counts). */
  params?: Record<string, number | string>;
}

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface ProjectInspection {
  /** 0–100 overall PM rating (weighted mean over the scored dimensions). */
  overall: number;
  grade: Grade;
  tier: HealthTier;
  color: string;
  dimensions: InspectionDimension[];
  /** Prescriptive next steps, already sorted by urgency (most urgent first). */
  recommendations: InspectionRecommendation[];
}

const TIER_COLOR: Record<HealthTier, string> = {
  healthy: '#22c55e',
  watch: '#eab308',
  at_risk: '#f59e0b',
  critical: '#ef4444',
};

function tierColor(tier: HealthTier | null): string {
  return tier ? TIER_COLOR[tier] : 'var(--border-subtle)';
}

/** Map a 0–100 overall to a letter grade (aligned with the health tier cutoffs). */
function gradeFor(score: number): Grade {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

/** A project's description counts as a real "vision" once it's more than a stub. */
const VISION_MIN_CHARS = 30;

/** The core "is this project set up" signals — the SINGLE source used by both the
 *  full inspection AND the card's configuration-completeness donut, so the two can
 *  never disagree on what counts as configured. */
export type ProjectConfigItem = 'vision' | 'goals' | 'deadline' | 'owner' | 'tasks' | 'architecture';

/** Display order of the configuration checklist (also the donut/legend order). */
export const PROJECT_CONFIG_ITEMS: ProjectConfigItem[] = ['vision', 'goals', 'deadline', 'owner', 'tasks', 'architecture'];

/** Which configuration signals a project currently satisfies. Pure, derived from
 *  the `/api/projects` list fields only (no per-card fetch). */
export function projectConfigSignals(project: Project): Record<ProjectConfigItem, boolean> {
  return {
    vision: (project.description ?? '').trim().length >= VISION_MIN_CHARS,
    goals: (project.linkedGoalCount ?? 0) > 0 || project.initiativeId != null,
    deadline: project.projectDueDate != null && project.projectDueDate !== '',
    owner: project.assignedAgentHost != null,
    tasks: (project.taskCount ?? 0) > 0,
    architecture: project.hasArchitecturePrd === true,
  };
}

export interface ProjectConfig {
  /** Satisfied config items. */
  done: ProjectConfigItem[];
  /** Config items still to set up. */
  missing: ProjectConfigItem[];
  total: number;
  /** 0–100 configuration completeness. */
  pct: number;
}

/** Configuration-completeness of a project — how much of its setup is done.
 *  Distinct from task progress (that's {@link computeProjectHealth}). */
export function computeProjectConfig(project: Project): ProjectConfig {
  const sig = projectConfigSignals(project);
  const done = PROJECT_CONFIG_ITEMS.filter((k) => sig[k]);
  const missing = PROJECT_CONFIG_ITEMS.filter((k) => !sig[k]);
  return { done, missing, total: PROJECT_CONFIG_ITEMS.length, pct: Math.round((done.length / PROJECT_CONFIG_ITEMS.length) * 100) };
}

export function computeProjectInspection(project: Project): ProjectInspection {
  const health = computeProjectHealth(project);

  const sig = projectConfigSignals(project);
  const hasVision = sig.vision;
  const hasGoals = sig.goals;
  const hasDeadline = sig.deadline;
  const hasArchitecture = sig.architecture;

  const taskCount = project.taskCount ?? 0;
  const hasTasks = taskCount > 0;
  const isScheduled = !!project.startDate && !!project.dueDate;
  const isDecomposed = taskCount >= 5;

  const hasOwner = project.assignedAgentHost != null;
  const hasWorkflows = (project.workflowCount ?? 0) > 0;
  const hasMomentum = health.completed > 0;

  // --- Direction: how clearly the NEED is defined (the North Star). ----------
  const directionScore = Math.round(
    (hasVision ? 35 : 0) + (hasGoals ? 35 : 0) + (hasDeadline ? 15 : 0) + (hasArchitecture ? 15 : 0),
  );

  // --- Planning: is the work broken down and scheduled? ----------------------
  const planningScore = Math.round(
    (hasTasks ? 45 : 0) + (isScheduled ? 30 : 0) + (isDecomposed ? 25 : taskCount > 0 ? 12 : 0),
  );

  // --- Execution: is something actively driving the work? --------------------
  const executionScore = Math.round(
    (hasOwner ? 40 : 0) + (hasWorkflows ? 30 : 0) + (hasMomentum ? 30 : 0),
  );

  // Health is the shared delivery verdict (null until there's delivery data);
  // progress is only meaningful once the project has tasks.
  const healthScore = health.healthScore;
  const progressScore = health.hasData ? health.progressPct : null;

  const mk = (key: InspectionKey, score: number | null, weight: number): InspectionDimension => {
    const tier = score == null ? null : healthTier(score);
    return { key, score, tier, color: tierColor(tier), weight };
  };

  const dimensions: InspectionDimension[] = [
    mk('direction', directionScore, 0.28),
    mk('planning', planningScore, 0.22),
    mk('health', healthScore, 0.2),
    mk('progress', progressScore, 0.15),
    mk('execution', executionScore, 0.15),
  ];

  // Overall = weighted mean over the dimensions that actually have a score, with
  // the weights renormalized so a task-less project is judged on what it CAN be
  // judged on (direction/planning/execution) rather than penalised for null data.
  const scored = dimensions.filter((d) => d.score != null);
  const weightSum = scored.reduce((acc, d) => acc + d.weight, 0) || 1;
  const overall = Math.round(scored.reduce((acc, d) => acc + (d.score as number) * d.weight, 0) / weightSum);
  const tier = healthTier(overall);

  // --- Prescriptive "what to target" — only the UNMET signals. ---------------
  const recommendations: InspectionRecommendation[] = [];
  const add = (key: string, dimension: InspectionKey, priority: number, params?: Record<string, number | string>) =>
    recommendations.push({ key, dimension, priority, params });

  if (!hasVision) add('vision', 'direction', 1);
  if (!hasGoals) add('goals', 'direction', 2);
  if (!hasTasks) add('tasks', 'planning', 3);
  if (hasTasks && !isDecomposed) add('decompose', 'planning', 7, { count: taskCount });
  if (!hasDeadline) add('deadline', 'direction', 6);
  if (hasTasks && !isScheduled) add('schedule', 'planning', 8);
  if (health.overdue > 0) add('overdue', 'health', 4, { count: health.overdue });
  if (health.blocked > 0) add('blocked', 'health', 5, { count: health.blocked });
  if (hasTasks && !hasMomentum) add('stalled', 'progress', 9);
  if (!hasOwner) add('owner', 'execution', 10);
  if (!hasWorkflows) add('workflows', 'execution', 12);
  if (!hasArchitecture) add('architecture', 'direction', 11);

  recommendations.sort((a, b) => a.priority - b.priority);

  return { overall, grade: gradeFor(overall), tier, color: tierColor(tier), dimensions, recommendations };
}
