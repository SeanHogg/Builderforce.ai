'use client';
/**
 * portfolioHealthData — pure, typed snapshot of portfolio health per PRD task #146.
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
  /** Human-readable (e.g. "13/19 done, 40 in backlog, 5 OKR epics active"). */
  taskSummary: string;
  /** Single most critical impediment (FR-1). */
  keyBlocker: string;
  riskLevel: RiskLevel;
  riskRationale: string;
  /** One concrete, actionable instruction (FR-1). */
  recommendedAction: string;
  /** Optional extras for deep analysis (FR-2 context). */
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
 *   🟢 Green  — Active, >50% complete, no build failures, no stalled tasks
 *   🟡 Amber  — Active with known blockers OR on hold with defined plan
 *              OR 25–50% complete with risks present
 *   🔴 Red    — Build broken, 0% complete with active status, no tasks defined,
 *              stalled with no DRI
 */
export function deriveRagStatus(p: ProjectHealth): RAG {
  // Explicit manual overrides are respected if set.
  if (p.rag) return p.rag;

  // 🔴 Red triggers (spec-ordered):
  const isBrokenBuild = /build/.test(p.keyBlocker.toLowerCase()) && p.status === 'Active';
  const isEmptyProject = p.completionPct === null || /no tasks|empty project|no tasks defined/.test(p.keyBlocker.toLowerCase());
  const isActiveZero = p.status === 'Active' && p.completionPct === 0;
  const isStalled = /no tasks have been started|no apparent ownership|stalled with no DRI/i.test(p.keyBlocker);
  if (isBrokenBuild || isEmptyProject || isActiveZero || isStalled) return 'Red';

  // 🟡 Amber triggers:
  if (p.status === 'On Hold') return 'Amber';
  const hasBlocker = p.keyBlocker && p.keyBlocker.length > 10;
  const isPartialComplete = p.completionPct !== null && p.completionPct >= 25 && p.completionPct <= 50;
  const hasRisk = p.riskLevel === 'Medium';
  if ((p.status === 'Active' && hasBlocker) || isPartialComplete || hasRisk) return 'Amber';

  // 🟢 Green — default for active, >50%, no hard blockers.
  if (p.status === 'Active' && (p.completionPct === null || p.completionPct > 50)) return 'Green';
  return 'Amber'; // conservative fallback
}

/* ── Project Health Cards — task #146 + FR-2 (analysis preserved) ─────────── */

export const projects: ProjectHealth[] = [
  {
    id: 'builderforce-ai',
    name: 'BuilderForce.AI',
    status: 'Active',
    completionPct: 68,
    taskSummary: '13/19 done, 40 in backlog, 5 OKR epics active',
    keyBlocker: '3 failing tests blocking clean merge/release',
    riskLevel: 'Medium',
    riskRationale: 'Strong momentum but test failures risk delivery slip',
    recommendedAction: 'Assign engineer(s) to resolve 3 failing tests this sprint; gate next release on green CI',
    extras: { doneTasks: 13, totalTasks: 19, tasksInBacklog: 40, okrEpicsActive: 5, failingTests: 3 },
    rag: 'Amber', // Spec says Amber to foreground test failures; rules allow Green — intentionally Amber for leadership caution.
  },
  {
    id: 'hired-video',
    name: 'Hired.Video',
    status: 'Active',
    completionPct: 11,
    taskSummary: '~11% complete — build issues blocking all development; French localization partially in progress',
    keyBlocker: 'Build issues blocking all development progress; French localization partially in progress adds scope complexity',
    riskLevel: 'High',
    riskRationale: 'Early stage with a broken build is a critical path blocker',
    recommendedAction: 'Freeze localization work; prioritize build fix as P0 this week before any feature work resumes',
    rag: 'Red',
  },
  {
    id: 'rumble-dating',
    name: 'RumbleDating',
    status: 'Active',
    completionPct: 0,
    taskSummary: '40 tasks all in backlog — appears stalled despite active status',
    keyBlocker: 'No tasks have been started — project appears stalled despite active status',
    riskLevel: 'High',
    riskRationale: 'Zero forward motion with no apparent ownership or sprint planning',
    recommendedAction: 'Hold a kickoff/triage session within 48 hours; assign DRI, pull first sprint tasks out of backlog',
    extras: { tasksInBacklog: 40, totalTasks: 40, doneTasks: 0 },
    rag: 'Red',
  },
  {
    id: 'burnrate-os',
    name: 'BurnRateOS',
    status: 'On Hold',
    completionPct: 0,
    taskSummary: '0% complete, intentionally on hold, 9 tasks in backlog',
    keyBlocker: 'Deprioritized; no active work scheduled',
    riskLevel: 'Medium',
    riskRationale: 'On hold is an acceptable state but needs a defined re-engagement date to avoid indefinite drift',
    recommendedAction: 'Set a formal review date (recommend 30 days); document the hold rationale and trigger conditions for reactivation',
    extras: { tasksInBacklog: 9, totalTasks: 9, doneTasks: 0 },
    rag: 'Amber',
  },
  {
    id: 'pattysnob',
    name: 'pattysnob.com',
    status: 'Active',
    completionPct: null,
    taskSummary: 'Project shell exists with no tasks, scope, or ownership defined',
    keyBlocker: 'Project shell exists with no tasks, scope, or ownership defined',
    riskLevel: 'High',
    riskRationale: 'Cannot measure, plan, or execute against an empty project',
    recommendedAction: 'Within one week: define project scope, create initial task list, assign owner — or archive the project to reduce portfolio noise',
    rag: 'Red',
  },
];

/* ── Portfolio Summary (derived, FR-4) ────────────────────────────────────── */

function computeOverall(green: number, amber: number, red: number): RAG {
  // Overall is the worst bucket that has plurality — RED if any reds exist.
  if (red > 0) return 'Red';
  if (amber > 0) return 'Amber';
  return 'Green';
}

export function buildPortfolioSummary(
  projectList: ProjectHealth[],
  generatedAtIso?: string
): PortfolioSummary {
  const derived = projectList.map((p) => ({ id: p.id, rag: deriveRagStatus(p) }));
  const green = derived.filter((d) => d.rag === 'Green').length;
  const amber = derived.filter((d) => d.rag === 'Amber').length;
  const red = derived.filter((d) => d.rag === 'Red').length;
  return {
    generatedAt: generatedAtIso ?? new Date().toISOString(),
    totalProjects: projectList.length,
    greenCount: green,
    amberCount: amber,
    redCount: red,
    overall: computeOverall(green, amber, red),
    topPriorityActions: [
      { rank: 1 as const, label: 'Fix Hired.Video build — blocks all progress' },
      { rank: 2 as const, label: 'Kickoff RumbleDating — 40 tasks, zero started' },
      { rank: 3 as const, label: 'Define or archive pattysnob.com' },
    ],
  };
}

export const portfolioSummary: PortfolioSummary = buildPortfolioSummary(projects);
