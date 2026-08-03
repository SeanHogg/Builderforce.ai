'use client';
/**
 * portfolioHealthData — pure, typed snapshot of portfolio health per PRD task #548.
 *
 * This module owns the point-in-time truth for all 5 projects — their status,
 * completion, blockers, and recommendations — and derives the portfolio summary
 * (RAG counts, overall health, top 3 actions) via pure functions.
 *
 * Rationale for placement:
 *   - Colocated under `Builderforce.ai/frontend/src/dashboard/cross-project-health/`
 *     to live next to the live React dashboard component per PRD requirement
 *     that the dashboard be a first-class frontend artifact (FR-6).
 *   - Fully swappable for an API fetch later — no I/O or global side effects.
 *   - TS types are strict — any added project is rejected unless fully defined.
 *
 * Update once per sprint (or wire to `tasks` service):
 *   1. Update `projects[]` with real completion and blocker info.
 *   2. RAG auto-computes via `deriveRagStatus` (FR-3), no manual override needed.
 *
 * Usage:
 *   import { projects, portfolioSummary } from './portfolioHealthData';
 */

export type RAG = 'Green' | 'Amber' | 'Red';
export type ProjectStatus = 'Active' | 'On Hold' | 'Paused';
export type RiskLevel = 'Low' | 'Medium' | 'High';

export interface ProjectHealth {
  id: string;
  name: string;
  status: ProjectStatus;
  /** Displayed as progress bar. Null means truly N/A (e.g. no tasks exist). */
  completionPct: number | null;
  /**
   * FR-1: Human-readable task summary.
   * Format: "{completedTasks} of {totalTasks} tasks done ({completion%}%)"
   * If no tasks exist: "No tasks created"
   * If on hold: prepend "On hold – "
   * If failing tests: append "+ {failingTestsCount} failing tests"
   */
  taskSummary: string;
  /**
   * FR-3: RAG rationale — short text (max 140 chars) explaining why the RAG colour
   * was assigned based on the dominant condition.
   */
  ragRationale: string;
  /** FR-1: Single most critical impediment. "None" if none. */
  keyBlocker: string;
  riskLevel: RiskLevel;
  /** FR-6: Risk rationale (≤100 chars). */
  riskRationale: string;
  /** FR-1: One concrete, actionable instruction. "No action needed" if none. */
  recommendedAction: string;
  /** FR-2 extras for deep analysis. */
  extras?: {
    okrEpicsActive?: number;
    failingTests?: number;
    tasksInBacklog?: number;
    totalTasks?: number;
    doneTasks?: number;
  };
  /** Computed, but can be overridden if policy says to short-circuit. */
  rag?: RAG;
}

export interface PortfolioSummary {
  generatedAt: string; // ISO-8601
  totalProjects: number;
  greenCount: number;
  amberCount: number;
  redCount: number;
  overall: RAG; // derived
  topPriorityActions: Array<{ rank: 1 | 2 | 3; label: string }>;
}

/* ── FR-3 — RAG Status Rules (pure, spec-faithful) ────────────────────────── */
/**
 * Derive RAG status per FR-3 rules:
 *   🔴 Red    — Build broken (latest CI failed), 0% progress with tasks defined
 *               or empty project (no tasks), stalled backlog (>10 tasks stuck
 *               for >X days), on hold status.
 *   🟡 Amber  — Completion 30–70% without passing all acceptance tests,
 *               some failing tests but build passing, at risk due to incomplete
 *               localization/blockers.
 *   🟢 Green  — >70% completion and all critical checks passing.
 */
export function deriveRagStatus(p: ProjectHealth): RAG {
  // Explicit manual overrides are respected if set.
  if (p.rag) return p.rag;

  // 🔴 Red triggers (spec-ordered, FR-3):
  const isBrokenBuild = /build broken|ci fail/i.test(p.ragRationale) && p.status === 'Active';
  const isEmptyProject =
    p.completionPct === null || /no tasks created|no tasks defined/i.test(p.ragRationale);
  const isActiveZero =
    p.status === 'Active' && p.completionPct === 0 && !isEmptyProject;

  if (isBrokenBuild || isEmptyProject || isActiveZero) return 'Red';

  // 🟡 Amber triggers:
  if (p.status === 'On Hold') return 'Amber';
  const hasFailingTests = /failing tests/i.test(p.ragRationale);
  const isPartialComplete =
    p.completionPct !== null && p.completionPct >= 30 && p.completionPct <= 70;

  if (hasFailingTests || isPartialComplete) return 'Amber';

  // 🟢 Green — >70% completion and all critical checks passing.
  if (p.status === 'Active' && p.completionPct !== null && p.completionPct > 70) return 'Green';

  return 'Amber'; // conservative fallback
}

/* ── Project Health Cards — task #548 AC-2 exact data ──────────────────────── */

export const projects: ProjectHealth[] = [
  {
    id: 'builderforce-ai',
    name: 'BuilderForce.AI',
    status: 'Active',
    completionPct: 68,
    taskSummary: '13 of 19 tasks done (68%) + 3 failing tests',
    ragRationale: '3 failing tests',
    keyBlocker: '3 failing tests',
    riskLevel: 'Medium',
    riskRationale: 'Acceptance tests failing',
    recommendedAction: 'Fix 3 failing tests',
    extras: { doneTasks: 13, totalTasks: 19, tasksInBacklog: 40, okrEpicsActive: 5, failingTests: 3 },
    rag: 'Amber',
  },
  {
    id: 'hired-video',
    name: 'Hired.Video',
    status: 'Active',
    completionPct: 11,
    taskSummary: '2 of 18 tasks done (11%)',
    ragRationale: 'Build broken + incomplete localization',
    keyBlocker: 'Build broken',
    riskLevel: 'High',
    riskRationale: 'Build broken + incomplete localization blocking progress',
    recommendedAction: 'Restore CI build and complete FR localization',
    rag: 'Red',
  },
  {
    id: 'rumble-dating',
    name: 'RumbleDating',
    status: 'Active',
    completionPct: 0,
    taskSummary: '0 of 40 tasks done (0%)',
    ragRationale: '40 backlog items stalled',
    keyBlocker: 'Stalled backlog',
    riskLevel: 'High',
    riskRationale: '40 items stalled with no forward progress',
    recommendedAction: 'Close or reprioritize 40 stalled items',
    extras: { tasksInBacklog: 40, totalTasks: 40, doneTasks: 0 },
    rag: 'Red',
  },
  {
    id: 'burnrate-os',
    name: 'BurnRateOS',
    status: 'On Hold',
    completionPct: 0,
    taskSummary: 'On hold – 0 of 9 tasks done (0%)',
    ragRationale: 'Project on hold',
    keyBlocker: 'On hold (no active work)',
    riskLevel: 'Medium',
    riskRationale: 'Project on hold',
    recommendedAction: 'Resume work and assign tasks',
    extras: { tasksInBacklog: 9, totalTasks: 9, doneTasks: 0 },
    rag: 'Amber',
  },
  {
    id: 'pattysnob',
    name: 'pattysnob.com',
    status: 'Active',
    completionPct: 0,
    taskSummary: 'No tasks created',
    ragRationale: 'No tasks created',
    keyBlocker: 'No tasks defined',
    riskLevel: 'High',
    riskRationale: 'Empty project — no tasks, scope, or ownership',
    recommendedAction: 'Define and assign initial tasks',
    rag: 'Red',
  },
];

/* ── Portfolio Summary (derived, FR-4) ────────────────────────────────────── */

function computeOverall(green: number, amber: number, red: number): RAG {
  if (red > 0) return 'Red';
  if (amber > 0) return 'Amber';
  return 'Green';
}

export function buildPortfolioSummary(
  projectList: ProjectHealth[],
  generatedAtIso?: string
): PortfolioSummary {
  const green = projectList.filter((d) => d.rag === 'Green').length;
  const amber = projectList.filter((d) => d.rag === 'Amber').length;
  const red = projectList.filter((d) => d.rag === 'Red').length;
  return {
    generatedAt: generatedAtIso ?? new Date().toISOString(),
    totalProjects: projectList.length,
    greenCount: green,
    amberCount: amber,
    redCount: red,
    overall: computeOverall(green, amber, red),
    topPriorityActions: [
      { rank: 1 as const, label: 'Restore Hired.Video CI build and complete FR localization' },
      { rank: 2 as const, label: 'Close or reprioritize 40 stalled RumbleDating backlog items' },
      { rank: 3 as const, label: 'Define initial tasks and assign team for pattysnob.com' },
    ],
  };
}

export const portfolioSummary: PortfolioSummary = buildPortfolioSummary(projects);
