/**
 * The three real-world constraints the pure scheduler needs handed to it:
 * WHO is free, WHEN the workspace works, and WHAT cadence work lands in.
 *
 * `scheduleItems` ordered by rank and honoured the dependency DAG, but it modelled
 * an infinitely available workforce on a permanent Monday-to-Friday week. Two
 * tickets on one person overlapped completely, a sprint boundary meant nothing,
 * and a public holiday did not exist. The plans it drew were arithmetically
 * correct and operationally impossible.
 *
 * This module is the seam between "what the database knows" and that pure
 * function: {@link loadSchedulingContext} reads, {@link capacityFromMemberMetrics}
 * and {@link assigneeKeyOf} are pure so the derivation itself is testable without
 * a database.
 */

import { and, eq, gte, isNull, or } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { sprints } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';
import {
  computeMemberMetrics,
  memberMetricsCacheKey,
  readWorkforceMetricsVersion,
  type MemberScorecard,
} from '../metrics/workforceMetrics';
import { loadWorkingCalendar } from './workingCalendar';
import type { AssigneeCapacity, SprintWindow, WorkingCalendar } from './scheduleWork';

/** Window the member-load signal is read over. Matches the workforce surfaces. */
export const CAPACITY_METRICS_DAYS = 30;

/**
 * Open items at which an owner is treated as fully saturated.
 *
 * Not a guess about productivity — a guess about ATTENTION, and deliberately
 * generous. Below it, load scales availability down smoothly; at or above it the
 * owner is pinned to {@link MIN_AVAILABILITY} rather than to zero, because an
 * availability of zero would mean an infinite estimate and a plan that never ends.
 */
export const SATURATION_OPEN_ITEMS = 8;
/** Nobody is modelled as less than a quarter available; see {@link SATURATION_OPEN_ITEMS}. */
export const MIN_AVAILABILITY = 0.25;

/** How far ahead the sprint cadence is loaded — a year of boundaries is plenty. */
const SPRINT_LOOKBACK_DAYS = 60;

/** Everything the pure scheduler needs that lives in the database. */
export interface SchedulingContext {
  calendar: WorkingCalendar;
  /** Keyed by {@link assigneeKeyOf}. */
  capacity: Map<string, AssigneeCapacity>;
  sprints: SprintWindow[];
}

/**
 * The owner key a task contends for capacity under.
 *
 * MUST agree with `workforceMetrics.identityOf` — the member scorecard is keyed by
 * `(memberKind, memberRef)` and a capacity map keyed any other way would silently
 * match nothing, giving every owner the default and re-introducing the exact
 * overlap this closes. Null = unowned, and unowned work constrains nobody.
 */
export function assigneeKeyOf(task: {
  assignedUserId?: string | null;
  assignedAgentHostId?: number | null;
  assignedAgentRef?: string | null;
}): string | null {
  if (task.assignedUserId) return `human:${task.assignedUserId}`;
  if (task.assignedAgentHostId != null) return `host_agent:${task.assignedAgentHostId}`;
  if (task.assignedAgentRef) return `cloud_agent:${task.assignedAgentRef}`;
  return null;
}

/**
 * Member scorecards → per-owner capacity. PURE.
 *
 * `concurrency` stays 1 for everyone: a person does one ticket at a time, and that
 * is precisely what makes two tickets on one assignee serialise instead of
 * overlapping. Load moves `availability` instead — an owner already carrying open
 * work gets proportionally less of each day, so their tickets stretch rather than
 * pretending the work is free.
 */
export function capacityFromMemberMetrics(cards: readonly MemberScorecard[]): Map<string, AssigneeCapacity> {
  const out = new Map<string, AssigneeCapacity>();
  for (const card of cards) {
    const openLoad = Math.max(0, (card.assignedCount ?? 0) - (card.completedCount ?? 0));
    const availability = Math.max(MIN_AVAILABILITY, 1 - openLoad / SATURATION_OPEN_ITEMS);
    out.set(`${card.memberKind}:${card.memberRef}`, { concurrency: 1, availability });
  }
  return out;
}

/**
 * Load the constraints for one project's plan.
 *
 * Every input is cached or bounded: the calendar changes a few times a year, the
 * member metrics ride the shared workforce-metrics version token, and the sprint
 * read is a small indexed slice. The manager sweep runs this per project on every
 * pass, so "cheap" is a requirement rather than a nicety.
 */
export async function loadSchedulingContext(
  env: Env | undefined,
  db: Db,
  tenantId: number,
  projectId?: number,
): Promise<SchedulingContext> {
  const since = new Date(Date.now() - SPRINT_LOOKBACK_DAYS * 86_400_000);
  const [calendar, cards, sprintRows] = await Promise.all([
    loadWorkingCalendar(env, db, tenantId),
    loadMemberCapacityCards(env, db, tenantId, projectId),
    // A project's own cadence, plus the portfolio-level cadence (project_id NULL)
    // that a project with no sprints of its own still plans against.
    db.select({ startDate: sprints.startDate, endDate: sprints.endDate })
      .from(sprints)
      .where(and(
        eq(sprints.tenantId, tenantId),
        projectId != null ? or(eq(sprints.projectId, projectId), isNull(sprints.projectId)) : undefined,
        gte(sprints.endDate, since),
      )),
  ]);

  return {
    calendar,
    capacity: capacityFromMemberMetrics(cards),
    sprints: sprintRows
      .filter((s): s is { startDate: Date; endDate: Date } => s.startDate != null && s.endDate != null)
      .map((s) => ({ startDate: s.startDate, endDate: s.endDate })),
  };
}

/** Member load through the shared workforce-metrics cache (never a second query path). */
async function loadMemberCapacityCards(
  env: Env | undefined,
  db: Db,
  tenantId: number,
  projectId?: number,
): Promise<MemberScorecard[]> {
  const compute = () => computeMemberMetrics(db, tenantId, CAPACITY_METRICS_DAYS, projectId);
  if (!env) return compute();
  const version = await readWorkforceMetricsVersion(env, tenantId);
  return getOrSetCached(
    env,
    memberMetricsCacheKey(tenantId, version, CAPACITY_METRICS_DAYS, projectId),
    compute,
    { kvTtlSeconds: 300, l1TtlMs: 30_000 },
  );
}
