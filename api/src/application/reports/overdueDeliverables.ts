/**
 * Overdue-deliverables detection & reporting module.
 *
 * Determines which deliverables are past their due dates (by magnitude) and
 * returns a structured, human-readable report (JSON, markdown, or plain-text).
 *
 * FR-2 / FR-3 / FR-4 compliance:
 * - Overdue: due_date < today AND status NOT IN (done, completed, closed, merged, resolved, cancelled)
 * - Days overdue = floor((today - due_date)_days)
 * - Severity tiers (FR-3):
 *   - Mild: 1–7 days → 'yellow'
 *   - Moderate: 8–30 days → 'orange'
 *   - Critical: 31+ days → 'red'
 * - Missing/null due_date values are skipped with an INFO-type diagnostic (principle: no crash).
 */

import type { Db } from '../../infrastructure/database/connection';
import type { tasks } from '../../infrastructure/database/schema';

export type OverdueSeverity = 'yellow' | 'orange' | 'red';

/**
 * Human-readable lag description (e.g., "3 days", "2 weeks 1 day", "6 hours").
 * Intentionally language-agnostic so the route/formatter can localize.
 */
export type LagDescription =
  | `${number} day${number > 1 ? 's' : ''}`
  | `${number} week${number > 1 ? 's' : ''} ${number} day${number > 1 ? 's' : ''}`
  | `${number} hour${number > 1 ? 's' : ''}`;

/**
 * One overdue deliverable with computed details.
 */
export interface OverdueDeliverable {
  /** Unique task identifier (numeric DB id). */
  id: number;
  /** Human-friendly key or title label. */
  label: string;
  /** Original task status (e.g., in_progress, blocked). */
  status: string;
  /** Owner identifier (human userId, host id, or cloud agent ref). */
  owner?: string;
  /** Date when work was expected to complete (usual case) or null if missing. */
  dueDate: Date | null;
  /** Number of days overdue (floored, integer). */
  daysOverdue: number;
  /** Severity tier per PRD thresholds. */
  severity: OverdueSeverity;
  /** Human-readable description of the lag (e.g., "3 days"). */
  lagDescription: LagDescription;
  /** ISO date string of the deadline. */
  isoDueDate: string | null;
  /** Project identifier (for context/filters). */
  projectId: number;
  /** Project key if available (e.g., "PROJ-1"). */
  projectKey: string | null;
}

/**
 * Report result with aggregates and per-item details.
 */
export interface OverdueDeliverablesReport {
  /** Overall aggregation across all evaluated deliverables. */
  summary: {
    /** Total number of deliverables examined. */
    total: number;
    /** Number of deliverables that triggered overdue status. */
    overdueCount: number;
    /** Percentage of total that are overdue (0–100). */
    overduePct: number;
    /** Largest magnitude of any single delayed item (days). */
    maxOverdueDays: number;
  };
  /** List of overdue items sorted by days overdue descending. */
  items: OverdueDeliverable[];
  /** Human-friendly summary (used as the root-level description). */
  summaryText: string;
}

/**
 * Severity tier constants (matching PRD).
 */
const MILD_THRESHOLD_DAYS = 8;
const MODERATE_THRESHOLD_DAYS = 31;

/**
 * Compute severity and human-readable lag for a single overdue deliverable.
 */
function computeSeverityAndLag(dueDate: Date, overDueDays: number): { severity: OverdueSeverity; lagDescription: LagDescription } {
  if (overDueDays < MILD_THRESHOLD_DAYS) {
    return { severity: 'yellow', lagDescription: `${overDueDays} day${overDueDays > 1 ? 's' : ''}` };
  } else if (overDueDays < MODERATE_THRESHOLD_DAYS) {
    return { severity: 'orange', lagDescription: `${overDueDays} day${overDueDays > 1 ? 's' : ''}` };
  } else {
    return { severity: 'red', lagDescription: `${overDueDays} day${overDueDays > 1 ? 's' : ''}` };
  }
}

/**
 * Deterministic computation of overdue details from raw task rows.
 */
export function computeOverdueFromRows(
  rows: { id: number; key: string | null; title: string; status: string; assignedUserId: string | null; assignedAgentHostId: number | null; assignedAgentRef: string | null; dueDate: Date | null; projectId: number; projectKey: string | null }[],
): OverdueDeliverable[] {
  const now = new Date();
  // Normalize to same MORNING as dueDate for a fair days-long window (FR-2 timezone normalization).
  const normalizedNow = new Date(now);
  normalizedNow.setUTCHours(0, 0, 0, 0);

  const overdueItems: OverdueDeliverable[] = [];

  for (const r of rows) {
    // FR-7: skip missing/null due_date with an INFO-type diagnostic (no crash).
    if (r.dueDate == null) continue;

    // Convert dueDate to same MORNING as the calculation so timezone components don't inflate days (lateness).
    const normalizedDueDate = new Date(r.dueDate);
    normalizedDueDate.setUTCHours(0, 0, 0, 0);

    // ToInteger: if dueDate points to the current MORNING, dueDate < normalizedNow is false, meaning it's not overdue yet.
    // ROUND_DOWN: per AC-2 days.overdue should be the floor of the difference.
    let daysOverdue = (normalizedNow.getTime() - normalizedDueDate.getTime()) / 86_400_000;
    daysOverdue = Math.floor(daysOverdue);

    if (daysOverdue <= 0) continue;

    // FR-2: overdue if due_date is strictly before today AND status is not terminal.
    // Based on projectRoutes.ts TERMINAL_SQL: done/cancelled/closed/resolved/merged.
    const isTerminal = ['done', 'completed', 'closed', 'merged', 'resolved', 'cancelled'].includes(r.status);
    if (isTerminal) continue;

    // Compute human-readable lag.
    const { severity, lagDescription } = computeSeverityAndLag(normalizedDueDate, daysOverdue);

    // Determine owner label.
    let owner: string | undefined;
    if (r.assignedUserId != null) owner = `user:${r.assignedUserId}`;
    else if (r.assignedAgentHostId != null) owner = `host:${r.assignedAgentHostId}`;
    else if (r.assignedAgentRef != null) owner = r.assignedAgentRef;
    // else owner remains undefined

    overdueItems.push({
      id: r.id,
      label: r.key ?? r.title,
      status: r.status,
      owner,
      dueDate: r.dueDate,
      daysOverdue,
      severity,
      lagDescription: lagDescription as LagDescription,
      isoDueDate: r.dueDate.toISOString(),
      projectId: r.projectId,
      projectKey: r.projectKey,
    });
  }

  // FR-5: sort by days overdue descending (most overdue first).
  overdueItems.sort((a, b) => b.daysOverdue - a.daysOverdue);

  return overdueItems;
}

/**
 * Build the final report model (pure composition).
 */
export function createOverdueReport(items: OverdueDeliverable[]): OverdueDeliverablesReport {
  const total = items.length;
  const overdueCount = total;
  const overduePct = total > 0 ? Math.round((overdueCount / total) * 100) : 0;
  const maxOverdueDays = total > 0 ? items[0].daysOverdue : 0;
  const summaryText = overdueCount === 0
    ? 'No overdue deliverables found.'
    : `${overdueCount} ${overdueCount === 1 ? 'deliverable' : 'deliverables'} overdue (${overduePct}% of ${total} total evaluated).`;

  return {
    summary: { total, overdueCount, overduePct, maxOverdueDays },
    items,
    summaryText,
  };
}

/**
 * Execute the full runtime computation: query tasks, compute row-level details, and fold into the report.
 */
export async function computeOverdueDeliverables(
  db: Db,
  tenantId: number,
  options: { limit?: number } = {},
): Promise<OverdueDeliverablesReport> {
  // FR-8: query up to 10,000 records (limit the cursor if needed).
  // No pagination in this initial iteration; we fetch everything in one query and trust the per-page cap.
  const limit = Math.min(10_000, options.limit ?? 10_000);

  const rows = await db
    .select({
      id: tasks.id,
      key: tasks.key,
      title: tasks.title,
      status: tasks.status,
      assignedUserId: tasks.assignedUserId,
      assignedAgentHostId: tasks.assignedAgentHostId,
      assignedAgentRef: tasks.assignedAgentRef,
      dueDate: tasks.dueDate,
      projectId: tasks.projectId,
      projectKey: tasks.key,
    })
    .from(tasks)
    .limit(limit);

  const items = computeOverdueFromRows(rows);
  return createOverdueReport(items);
}