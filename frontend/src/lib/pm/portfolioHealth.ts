import type { Project } from '@/lib/types';
import { computeProjectHealth, type ProjectHealth } from '@/lib/projectHealth';

/**
 * Cross-project health — the portfolio-wide RAG read behind the Projects →
 * Portfolio → Health tab.
 *
 * One question per project, answered the same way for all of them: is this thing
 * moving, what is the single biggest thing stopping it, and what is the one next
 * action. That is FR-1..FR-4 of the original Cross-Project Health Dashboard spec
 * (`docs/design/cross-project-health-dashboard.md`), except that nothing here is a
 * point-in-time snapshot somebody edits each sprint: every field is derived from the
 * live `/api/projects` list, which already attaches per-project task counts and the
 * compact `deliverySignals` bundle.
 *
 * DRY: the health score and progress come from {@link computeProjectHealth} — the SAME
 * function the project card, the list row and the details panel call — so a project
 * cannot read "Red" here and "Healthy" on its own card. This module adds only the
 * portfolio-level layer on top: RAG banding, the blocker/action pair, and the summary.
 *
 * Pure + hook-free (the same reason `deliveryVerdict.ts` is): it is unit-testable
 * without a DOM, and it emits i18n KEYS plus interpolation values rather than English
 * strings, so the card owns the words and all five catalogs stay the single source.
 */

export type Rag = 'green' | 'amber' | 'red';
export type RiskLevel = 'low' | 'medium' | 'high';

/**
 * The impediment vocabulary — ordered by precedence in {@link deriveBlocker}. Each key
 * names BOTH the blocker sentence (`pmo.health.blocker.<key>`) and the recommended
 * next action (`pmo.health.action.<key>`), so a blocker and its remedy can never be
 * paired up wrongly: there is one key, not two lists to keep aligned.
 */
export const HEALTH_SIGNALS = [
  'noTasks',
  'onHold',
  'blocked',
  'overdue',
  'notStarted',
  'deliveryStalled',
  'deliveryAtRisk',
  'noSignal',
  'onTrack',
] as const;

export type HealthSignalKey = (typeof HEALTH_SIGNALS)[number];

/** An i18n key plus its interpolation values (same shape as `VerdictReason`). */
export interface HealthSignal {
  key: HealthSignalKey;
  values: Record<string, string | number>;
}

export interface PortfolioHealthItem {
  id: number;
  name: string;
  /** Raw enum value — the card localizes it via `useProjectStatusLabel`. */
  status: string;
  /** Kept so the card can hand it to the shared <ProjectHealthBadge/> unmodified. */
  project: Project;
  health: ProjectHealth;
  rag: Rag;
  risk: RiskLevel;
  blocker: HealthSignal;
  /** Always the same key as `blocker` — the remedy for that impediment. */
  action: HealthSignal;
  /** Higher = worse. Orders the grid and picks the top priority actions. */
  severity: number;
}

export interface PortfolioTopAction {
  rank: number;
  item: PortfolioHealthItem;
}

export interface PortfolioHealthSummary {
  total: number;
  green: number;
  amber: number;
  red: number;
  /** The worst RAG present — a portfolio is only as green as its reddest project. */
  overall: Rag;
  /** Up to three non-green projects, worst first (FR-4). */
  topActions: PortfolioTopAction[];
}

export interface PortfolioHealth {
  items: PortfolioHealthItem[];
  summary: PortfolioHealthSummary;
}

/**
 * The projects a health read is ABOUT: live work only. A completed or archived project
 * has no health to report — it would sit permanently green (or permanently red for
 * never having deployed) and dilute the counts leadership scans.
 */
export function livePortfolioProjects(projects: Project[]): Project[] {
  return projects.filter((p) => {
    const status = p.status ?? 'active';
    return status !== 'archived' && status !== 'completed';
  });
}

/**
 * The single most critical impediment, by precedence (FR-1 asks for ONE, not a list).
 * Deliberate ordering: a deliberate hold outranks everything (it is not a problem), an
 * unmeasurable project outranks a measurable one, explicit task-level blockage outranks
 * an inferred delivery verdict, and "delivering fine" is the fall-through.
 */
export function deriveBlocker(project: Project, health: ProjectHealth): HealthSignal {
  if ((project.status ?? 'active') === 'on_hold') return { key: 'onHold', values: {} };
  if (!health.hasData) return { key: 'noTasks', values: {} };
  if (health.blocked > 0) return { key: 'blocked', values: { count: health.blocked } };
  if (health.overdue > 0) return { key: 'overdue', values: { count: health.overdue } };
  if (health.completed === 0 && health.open > 0) return { key: 'notStarted', values: { count: health.open } };
  if (health.verdict === 'no') return { key: 'deliveryStalled', values: { score: health.healthScore ?? 0 } };
  if (health.verdict === 'at_risk') return { key: 'deliveryAtRisk', values: { score: health.healthScore ?? 0 } };
  if (health.verdict === 'no_data') return { key: 'noSignal', values: {} };
  return { key: 'onTrack', values: {} };
}

/**
 * RAG banding (FR-3), read off the blocker and the shared delivery tier:
 *   🔴 nothing to measure, nothing started, or delivery has stopped.
 *   🟡 a named impediment, an at-risk verdict, or not yet past half-way.
 *   🟢 past half-way, no impediment, and delivering.
 */
export function deriveRag(blocker: HealthSignalKey, health: ProjectHealth): Rag {
  if (blocker === 'noTasks' || blocker === 'notStarted' || blocker === 'deliveryStalled') return 'red';
  if (health.tier === 'critical') return 'red';
  if (blocker === 'onHold' || blocker === 'blocked' || blocker === 'overdue' || blocker === 'deliveryAtRisk') return 'amber';
  if (health.tier === 'at_risk') return 'amber';
  if (health.progressPct <= 50) return 'amber';
  return 'green';
}

const RISK_BY_RAG: Record<Rag, RiskLevel> = { red: 'high', amber: 'medium', green: 'low' };
const RAG_WEIGHT: Record<Rag, number> = { red: 2, amber: 1, green: 0 };

/**
 * Orders the grid and the top-3. RAG dominates; within a band the lower delivery-health
 * score comes first, and a project with no score at all sorts as mid-band (50) rather
 * than as either extreme — "we cannot see it" is not evidence of health in either
 * direction. Progress breaks the remaining ties so the least-advanced project leads.
 */
function severityOf(rag: Rag, health: ProjectHealth): number {
  const score = health.healthScore ?? 50;
  return RAG_WEIGHT[rag] * 10_000 + (100 - score) * 100 + (100 - health.progressPct);
}

/** Derive one project's portfolio-health row. */
export function buildPortfolioHealthItem(project: Project): PortfolioHealthItem {
  const health = computeProjectHealth(project);
  const blocker = deriveBlocker(project, health);
  const rag = deriveRag(blocker.key, health);
  return {
    id: project.id,
    name: project.name,
    status: project.status ?? 'active',
    project,
    health,
    rag,
    risk: RISK_BY_RAG[rag],
    blocker,
    // One key, two sentences: the impediment and its remedy always agree.
    action: blocker,
    severity: severityOf(rag, health),
  };
}

/**
 * The whole portfolio read: one row per live project (worst first) plus the summary
 * leadership scans before the fold.
 */
export function buildPortfolioHealth(projects: Project[]): PortfolioHealth {
  const items = livePortfolioProjects(projects)
    .map(buildPortfolioHealthItem)
    .sort((a, b) => b.severity - a.severity || a.name.localeCompare(b.name));

  const green = items.filter((i) => i.rag === 'green').length;
  const amber = items.filter((i) => i.rag === 'amber').length;
  const red = items.filter((i) => i.rag === 'red').length;

  return {
    items,
    summary: {
      total: items.length,
      green,
      amber,
      red,
      overall: red > 0 ? 'red' : amber > 0 ? 'amber' : 'green',
      // Already severity-sorted, so the first three non-green rows ARE the top three.
      topActions: items
        .filter((i) => i.rag !== 'green')
        .slice(0, 3)
        .map((item, idx) => ({ rank: idx + 1, item })),
    },
  };
}

/** Token colour per band — shared by the badge, the counts and the overall banner. */
export const RAG_COLOR: Record<Rag, string> = {
  green: 'var(--success)',
  amber: 'var(--warning)',
  red: 'var(--error)',
};
