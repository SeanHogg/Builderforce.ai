/**
 * Derived sprint velocity (EMP-4) — committed vs completed STORY POINTS per sprint,
 * computed from real task estimates (`tasks.story_points`, 0246) instead of the
 * hand-entered team_velocity tracker. Feeds sprint planning: the rolling average of
 * recent completed sprints is the team's forecast capacity for the next sprint.
 *
 * The math is a pure function ({@link summarizeVelocity}) over fetched rows so it is
 * unit-testable without a DB; the route caches it.
 */

import { and, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { projects, sprints, tasks } from '../../infrastructure/database/schema';

const MAX_SPRINTS = 200;

export interface VelocityTaskRow {
  sprintId: string | null;
  storyPoints: number | null;
  completedAt: Date | null;
}

export interface SprintMeta {
  id: string;
  name: string;
  status: string;
  endDate: Date | null;
}

export interface SprintVelocity {
  sprintId: string;
  name: string;
  status: string;
  endDate: string | null;
  committedPoints: number;   // Σ story_points of all tasks in the sprint
  completedPoints: number;   // Σ story_points of completed tasks
  taskCount: number;
  completedCount: number;
  /** completed / committed × 100 (say rate) — null when nothing committed. */
  completionRatePct: number | null;
}

export interface VelocityInsights {
  sprints: SprintVelocity[];
  /** Mean completed points across recent COMPLETED sprints — the planning forecast. */
  averageVelocity: number | null;
  /** Sprints included in the average. */
  velocitySampleSize: number;
  /** Total estimated vs unestimated tasks across the included sprints (data hygiene). */
  estimatedTasks: number;
  unestimatedTasks: number;
}

/** Pure: sprint metadata + the sprint's tasks → per-sprint velocity + the rolling
 *  average over the last `avgWindow` completed sprints. */
export function summarizeVelocity(
  metas: SprintMeta[],
  tasksBySprint: Map<string, VelocityTaskRow[]>,
  avgWindow = 5,
): VelocityInsights {
  let estimated = 0, unestimated = 0;

  const rows: SprintVelocity[] = metas.map((m) => {
    const list = tasksBySprint.get(m.id) ?? [];
    let committed = 0, completed = 0, completedCount = 0;
    for (const tk of list) {
      const pts = tk.storyPoints ?? 0;
      if (tk.storyPoints == null) unestimated++; else estimated++;
      committed += pts;
      if (tk.completedAt != null) { completed += pts; completedCount++; }
    }
    return {
      sprintId: m.id, name: m.name, status: m.status,
      endDate: m.endDate ? m.endDate.toISOString().slice(0, 10) : null,
      committedPoints: committed, completedPoints: completed,
      taskCount: list.length, completedCount,
      completionRatePct: committed > 0 ? (completed / committed) * 100 : null,
    };
  });

  // Forecast = mean completed points over the most recent COMPLETED sprints (by
  // end date desc; sprints with no completed points are still informative → kept).
  const completedSprints = rows
    .filter((s) => s.status === 'completed')
    .sort((a, b) => (b.endDate ?? '').localeCompare(a.endDate ?? ''))
    .slice(0, avgWindow);
  const averageVelocity = completedSprints.length
    ? completedSprints.reduce((a, s) => a + s.completedPoints, 0) / completedSprints.length
    : null;

  // Newest sprints first for display.
  rows.sort((a, b) => (b.endDate ?? '').localeCompare(a.endDate ?? '') || a.name.localeCompare(b.name));

  return {
    sprints: rows,
    averageVelocity,
    velocitySampleSize: completedSprints.length,
    estimatedTasks: estimated,
    unestimatedTasks: unestimated,
  };
}

export async function computeVelocityInsights(db: Db, tenantId: number): Promise<VelocityInsights> {
  const metas = (await db
    .select({ id: sprints.id, name: sprints.name, status: sprints.status, endDate: sprints.endDate })
    .from(sprints)
    .where(eq(sprints.tenantId, tenantId))
    .limit(MAX_SPRINTS)) as SprintMeta[];

  const tasksBySprint = new Map<string, VelocityTaskRow[]>();
  if (metas.length) {
    const taskRows = (await db
      .select({ sprintId: tasks.sprintId, storyPoints: tasks.storyPoints, completedAt: tasks.completedAt })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(projects.tenantId, tenantId), eq(tasks.archived, false), isNotNull(tasks.sprintId)))) as VelocityTaskRow[];
    for (const r of taskRows) {
      if (!r.sprintId) continue;
      const list = tasksBySprint.get(r.sprintId) ?? [];
      list.push(r);
      tasksBySprint.set(r.sprintId, list);
    }
  }

  return summarizeVelocity(metas, tasksBySprint);
}
