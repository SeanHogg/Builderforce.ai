/**
 * Project-status report generator — the per-project delivery digest behind the
 * schedulable `project_status` report type (the one report_type that had no
 * generator, so buildScheduledReport returned null for it).
 *
 * One row per active project in the segment with its delivery signals (DORA +
 * lifecycle + rework/aging) and a coarse status verdict, plus a segment summary.
 * REUSES {@link computeProjectDeliverySignals} — the same per-project bundle the
 * project cards + /insights/delivery already run through the shared verdict — so
 * the scheduled digest never drifts from what the UI shows (single source).
 *
 * Pure classification ({@link classifyProjectStatus}) is separated for unit
 * testing; the fetch + assembly is the async generator.
 */

import { and, eq, ne } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { projects } from '../../infrastructure/database/schema';
import { computeProjectDeliverySignals, type ProjectDeliverySignals } from '../insights/projectDeliverySignals';

/** Coarse delivery verdict for a project row. */
export type ProjectStatusVerdict = 'on_track' | 'at_risk' | 'blocked' | 'no_data';

export interface ProjectStatusRow {
  projectId: number;
  name: string;
  status: string;
  verdict: ProjectStatusVerdict;
  completedWindow: number;      // completed tasks contributing lead time
  deployments: number;
  changeFailureRatePct: number | null;
  leadTimeHours: number | null;
  reworkRatePct: number;
  stuckCount: number;
}

/**
 * Pure verdict: blocked if work is piling up (stuck WIP) with no throughput;
 * at-risk on high rework or change-failure; on-track otherwise. `no_data` when a
 * project had no attributable tasks/deploys in the window.
 */
export function classifyProjectStatus(sig: ProjectDeliverySignals | undefined, completedWindow: number): ProjectStatusVerdict {
  if (!sig) return 'no_data';
  const { stuckCount } = sig.bottlenecks.agingWip;
  const reworkPct = sig.bottlenecks.rework.reworkRate * 100;
  const cfr = sig.dora.changeFailureRatePct ?? 0;
  if (stuckCount >= 3 && completedWindow === 0) return 'blocked';
  if (reworkPct >= 40 || cfr >= 30 || stuckCount >= 5) return 'at_risk';
  return 'on_track';
}

const REPORT_WINDOW_DAYS = 30;

export interface ProjectStatusReport {
  reportType: 'project_status';
  windowDays: number;
  generatedAt: string;
  summary: {
    projects: number;
    onTrack: number;
    atRisk: number;
    blocked: number;
    totalDeployments: number;
    completedWindow: number;
  };
  projects: ProjectStatusRow[];
}

/**
 * Build the project-status digest for one segment. Excludes archived projects and
 * the hidden IDE-storage rows (same filters the PMO project list uses).
 */
export async function generateProjectStatusReport(db: Db, tenantId: number, segmentId: string): Promise<ProjectStatusReport> {
  const projRows = await db
    .select({ id: projects.id, name: projects.name, status: projects.status })
    .from(projects)
    .where(and(
      eq(projects.tenantId, tenantId),
      ...(segmentId ? [eq(projects.segmentId, segmentId)] : []),
      eq(projects.isIdeStorage, false),
      ne(projects.status, 'archived'),
    ));

  const signals = await computeProjectDeliverySignals(db, tenantId, REPORT_WINDOW_DAYS);

  const rows: ProjectStatusRow[] = projRows.map((p) => {
    const sig = signals.get(p.id);
    // Lead-time sample count isn't returned by the bundle; use deployments +
    // a lead-time presence check as the "had throughput" proxy for the verdict.
    const completedWindow = sig && sig.dora.leadTimeHours != null ? 1 : 0;
    const verdict = classifyProjectStatus(sig, completedWindow);
    return {
      projectId: p.id,
      name: p.name,
      status: p.status,
      verdict,
      completedWindow,
      deployments: sig?.dora.totalDeployments ?? 0,
      changeFailureRatePct: sig?.dora.changeFailureRatePct ?? null,
      leadTimeHours: sig?.dora.leadTimeHours ?? null,
      reworkRatePct: sig ? Math.round(sig.bottlenecks.rework.reworkRate * 1000) / 10 : 0,
      stuckCount: sig?.bottlenecks.agingWip.stuckCount ?? 0,
    };
  });

  // Busiest / most-at-risk first: blocked, then at_risk, then by deployments.
  const rank: Record<ProjectStatusVerdict, number> = { blocked: 0, at_risk: 1, on_track: 2, no_data: 3 };
  rows.sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.deployments - a.deployments || a.name.localeCompare(b.name));

  return {
    reportType: 'project_status',
    windowDays: REPORT_WINDOW_DAYS,
    generatedAt: new Date().toISOString(),
    summary: {
      projects: rows.length,
      onTrack: rows.filter((r) => r.verdict === 'on_track').length,
      atRisk: rows.filter((r) => r.verdict === 'at_risk').length,
      blocked: rows.filter((r) => r.verdict === 'blocked').length,
      totalDeployments: rows.reduce((a, r) => a + r.deployments, 0),
      completedWindow: rows.reduce((a, r) => a + r.completedWindow, 0),
    },
    projects: rows,
  };
}
