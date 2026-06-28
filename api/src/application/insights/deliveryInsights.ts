/**
 * Delivery lens — deliverable progress, forecasting, and scope creep (EMP-6/7/8).
 *
 * A "deliverable" is any task scope: an initiative, a project, a release, or a
 * sprint. From the tasks' lifecycle timestamps (createdAt / completedAt) — already
 * collected — we reconstruct, with zero new write path:
 *
 *   - a BURNUP / BURNDOWN time series (cumulative scope vs cumulative completed
 *     per day) so progress is visible over time (EMP-6);
 *   - a completion-date FORECAST from recent throughput, with an optimistic/
 *     pessimistic band, and on-track vs a target date (EMP-7);
 *   - SCOPE CREEP: work added after the deliverable's baseline (start) date, as a
 *     count and a % of the original scope (EMP-8).
 *
 * The math is a pure function ({@link summarizeDelivery}) over fetched rows so it
 * is unit-testable without a DB; the route caches it.
 */

import { and, eq, or } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  initiatives,
  productReleases,
  projects,
  sprints,
  tasks,
} from '../../infrastructure/database/schema';

const DAY_MS = 86_400_000;
const MAX_TASKS = 5_000;
/** Cap on series points — beyond this the range is bucketed to weekly. */
const MAX_POINTS = 60;

export type DeliverableScope = 'initiative' | 'project' | 'release' | 'sprint';

export interface DeliveryTaskRow {
  createdAt: Date;
  completedAt: Date | null;
}

export interface BurnPoint {
  date: string;       // 'YYYY-MM-DD'
  scope: number;      // cumulative tasks in scope by this date (burnup top line)
  completed: number;  // cumulative completed by this date (burnup fill)
  remaining: number;  // scope − completed (burndown line)
}

export type DeliveryStatus = 'on_track' | 'at_risk' | 'late' | 'no_signal' | 'done';

export interface DeliveryInsights {
  scope: DeliverableScope;
  scopeId: string;
  name: string;
  totalTasks: number;
  completedTasks: number;
  openTasks: number;
  completionPct: number;
  /** Completed per 7 days over the recent window — the forecast input. */
  throughputPerWeek: number;
  /** Projected completion date (ISO) from throughput, or null if no signal. */
  forecastDate: string | null;
  forecastDateOptimistic: string | null;
  forecastDatePessimistic: string | null;
  targetDate: string | null;
  status: DeliveryStatus;
  /** Scope creep (EMP-8). */
  baselineDate: string | null;
  baselineScope: number;   // tasks created on/before the baseline
  addedScope: number;      // tasks created after the baseline
  addedScopePct: number;   // added / baseline × 100
  series: BurnPoint[];
}

function iso(d: Date): string { return d.toISOString().slice(0, 10); }
function clampPct(n: number): number { return Math.max(0, Math.min(100, n)); }

export interface SummarizeOpts {
  scope: DeliverableScope;
  scopeId: string;
  name: string;
  now: number;
  /** Deliverable baseline (start) for scope-creep + the series left edge. */
  baselineDate: Date | null;
  /** Deliverable target/release date for the on-track verdict. */
  targetDate: Date | null;
  /** Throughput window in days (recent completions used to forecast). */
  throughputWindowDays?: number;
}

/** Pure: tasks + deliverable metadata → the full delivery rollup. */
export function summarizeDelivery(rows: DeliveryTaskRow[], opts: SummarizeOpts): DeliveryInsights {
  const { scope, scopeId, name, now } = opts;
  const total = rows.length;
  const completedRows = rows.filter((r) => r.completedAt != null);
  const completed = completedRows.length;
  const open = total - completed;

  // ── Series window: from the earliest signal (baseline or first created) to now.
  const createds = rows.map((r) => r.createdAt.getTime());
  const earliest = opts.baselineDate
    ? Math.min(opts.baselineDate.getTime(), ...(createds.length ? createds : [now]))
    : (createds.length ? Math.min(...createds) : now);
  const startDay = Math.floor(earliest / DAY_MS);
  const endDay = Math.floor(now / DAY_MS);
  const spanDays = Math.max(1, endDay - startDay + 1);
  const stepDays = Math.max(1, Math.ceil(spanDays / MAX_POINTS)); // weekly bucketing for long ranges

  const series: BurnPoint[] = [];
  for (let day = startDay; day <= endDay; day += stepDays) {
    const cutoff = (day + 1) * DAY_MS - 1; // end of this bucket day (inclusive)
    const scopeN = rows.filter((r) => r.createdAt.getTime() <= cutoff).length;
    const doneN = completedRows.filter((r) => r.completedAt!.getTime() <= cutoff).length;
    series.push({ date: iso(new Date(day * DAY_MS)), scope: scopeN, completed: doneN, remaining: scopeN - doneN });
  }

  // ── Throughput (recent completions) → forecast.
  const win = opts.throughputWindowDays ?? 28;
  const winStart = now - win * DAY_MS;
  const recentDone = completedRows.filter((r) => r.completedAt!.getTime() >= winStart).length;
  const throughputPerWeek = (recentDone / win) * 7;

  let forecastDate: string | null = null, optimistic: string | null = null, pessimistic: string | null = null;
  if (open > 0 && throughputPerWeek > 0) {
    const weeks = open / throughputPerWeek;
    forecastDate = iso(new Date(now + weeks * 7 * DAY_MS));
    optimistic = iso(new Date(now + (open / (throughputPerWeek * 1.25)) * 7 * DAY_MS));
    pessimistic = iso(new Date(now + (open / (throughputPerWeek * 0.75)) * 7 * DAY_MS));
  }

  // ── Status verdict.
  let status: DeliveryStatus;
  if (total > 0 && open === 0) status = 'done';
  else if (open > 0 && throughputPerWeek === 0) status = 'no_signal';
  else if (forecastDate && opts.targetDate) {
    const f = new Date(forecastDate).getTime();
    const tgt = opts.targetDate.getTime();
    status = f <= tgt ? 'on_track' : (f <= tgt + 7 * DAY_MS ? 'at_risk' : 'late');
  } else status = 'no_signal';

  // ── Scope creep (EMP-8): created after the baseline = added scope.
  let baselineScope = total, addedScope = 0;
  if (opts.baselineDate) {
    const b = opts.baselineDate.getTime();
    baselineScope = rows.filter((r) => r.createdAt.getTime() <= b).length;
    addedScope = total - baselineScope;
  }
  const addedScopePct = baselineScope > 0 ? (addedScope / baselineScope) * 100 : 0;

  return {
    scope, scopeId, name,
    totalTasks: total, completedTasks: completed, openTasks: open,
    completionPct: total > 0 ? clampPct((completed / total) * 100) : 0,
    throughputPerWeek,
    forecastDate, forecastDateOptimistic: optimistic, forecastDatePessimistic: pessimistic,
    targetDate: opts.targetDate ? iso(opts.targetDate) : null,
    status,
    baselineDate: opts.baselineDate ? iso(opts.baselineDate) : null,
    baselineScope, addedScope, addedScopePct,
    series,
  };
}

/** Resolve a deliverable's name + baseline/target dates, then fetch its tasks. */
export async function computeDeliveryInsights(
  db: Db, tenantId: number, scope: DeliverableScope, scopeId: string, now: number,
): Promise<DeliveryInsights | null> {
  let name = '', baselineDate: Date | null = null, targetDate: Date | null = null;
  let taskFilter;

  if (scope === 'initiative') {
    const [row] = await db.select({ name: initiatives.name, startDate: initiatives.startDate, targetDate: initiatives.targetDate, createdAt: initiatives.createdAt })
      .from(initiatives).where(and(eq(initiatives.id, scopeId), eq(initiatives.tenantId, tenantId))).limit(1);
    if (!row) return null;
    name = row.name; baselineDate = row.startDate ?? row.createdAt; targetDate = row.targetDate;
    // A task rolls up to an initiative directly (0225) OR via its project's initiative.
    taskFilter = or(eq(tasks.initiativeId, scopeId), eq(projects.initiativeId, scopeId));
  } else if (scope === 'project') {
    const pid = Number(scopeId);
    const [row] = await db.select({ name: projects.name, createdAt: projects.createdAt })
      .from(projects).where(and(eq(projects.id, pid), eq(projects.tenantId, tenantId))).limit(1);
    if (!row) return null;
    name = row.name; baselineDate = row.createdAt;
    taskFilter = eq(tasks.projectId, pid);
  } else if (scope === 'release') {
    const [row] = await db.select({ name: productReleases.name, version: productReleases.version, releaseDate: productReleases.releaseDate, createdAt: productReleases.createdAt })
      .from(productReleases).where(and(eq(productReleases.id, scopeId), eq(productReleases.tenantId, tenantId))).limit(1);
    if (!row) return null;
    name = row.version ? `${row.name} (${row.version})` : row.name;
    baselineDate = row.createdAt; targetDate = row.releaseDate;
    taskFilter = eq(tasks.releaseId, scopeId);
  } else { // sprint
    const [row] = await db.select({ name: sprints.name, startDate: sprints.startDate, endDate: sprints.endDate, createdAt: sprints.createdAt })
      .from(sprints).where(and(eq(sprints.id, scopeId), eq(sprints.tenantId, tenantId))).limit(1);
    if (!row) return null;
    name = row.name; baselineDate = row.startDate ?? row.createdAt; targetDate = row.endDate;
    taskFilter = eq(tasks.sprintId, scopeId);
  }

  const rows = (await db
    .select({ createdAt: tasks.createdAt, completedAt: tasks.completedAt })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(projects.tenantId, tenantId), eq(tasks.archived, false), taskFilter))
    .limit(MAX_TASKS)) as DeliveryTaskRow[];

  return summarizeDelivery(rows, { scope, scopeId, name, now, baselineDate, targetDate });
}
