/**
 * toolAuditTrail — reading the agent tool-audit trail, which lives in TWO relations.
 *
 * `tool_audit_events` holds recent history at one row per tool CALL. Past the fold
 * boundary the same history is `tool_audit_daily`, one row per
 * (tenant, day, tool, category, agent) — see `maintenance/toolAuditRollup.ts` for the
 * why. The rollup deletes a raw row in the same statement that writes its tally, so
 * the two never describe the same call and a union double-counts nothing.
 *
 * WHY A MODULE RATHER THAN A QUERY IN EACH CALLER. Every aggregate over this trail is
 * a sum over dimensions the fold preserves, which means every one of them stays
 * correct across the boundary — but only if it reads BOTH relations. A caller that
 * reads just the raw table silently under-reports the moment its window is longer
 * than the fold boundary, and reports a number rather than an error. That failure is
 * exactly what happened to the analytics leaderboard when the rollup landed, so the
 * union lives here and callers ask for a shape instead of writing the join.
 *
 * Reading both unconditionally is deliberate: the boundary is a retention policy that
 * moves, and a read that picked a relation based on the requested window would go
 * wrong the moment the two disagreed.
 */
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { toolAuditDaily, toolAuditEvents } from '../../infrastructure/database/schema';

/**
 * One unit of audit evidence — EITHER a single raw tool call or a day already folded
 * to a tally.
 *
 * The two are one type on purpose: a consumer that sums over these dimensions is
 * correct for both without branching, which is what keeps the totals identical either
 * side of the fold.
 */
export interface AuditRow {
  toolName: string;
  category: string | null;
  agentHostId: number | null;
  cloudAgentRef: string | null;
  /** Raw rows only: the execution this single call belongs to. */
  executionId?: number | null;
  /** Calls represented. Absent on a raw row, which is one call. */
  events?: number;
  /** Rollup rows only: distinct executions WITHIN that day. Summed across days it is
   *  an upper bound — a run spanning midnight counts in both — so it is carried apart
   *  from the exact per-call `executionId` rather than merged into it. */
  distinctExecutions?: number;
}

/**
 * A window start, as both the timestamp the raw table is keyed by and the calendar day
 * the tallies are.
 *
 * One helper because every read here needs both, and they must describe the same
 * instant or the boundary leaks a gap (evidence missing from both relations) or an
 * overlap (counted twice) into the totals.
 */
export function auditWindow(from: Date): { since: Date; sinceDay: string } {
  return { since: from, sinceDay: from.toISOString().slice(0, 10) };
}

/** `days` ago, in both forms. */
export const auditWindowDays = (days: number): { since: Date; sinceDay: string } =>
  auditWindow(new Date(Date.now() - days * 86_400_000));

/** Dimension rows for a tenant's window, across both grains, for aggregation. */
export async function readAuditWindow(db: Db, tenantId: number, days: number): Promise<AuditRow[]> {
  const { since, sinceDay } = auditWindowDays(days);
  const [raw, tallies] = await Promise.all([
    db.select({
      toolName: toolAuditEvents.toolName,
      category: toolAuditEvents.category,
      agentHostId: toolAuditEvents.agentHostId,
      cloudAgentRef: toolAuditEvents.cloudAgentRef,
      executionId: toolAuditEvents.executionId,
    })
      .from(toolAuditEvents)
      .where(and(eq(toolAuditEvents.tenantId, tenantId), gte(toolAuditEvents.ts, since))),
    db.select({
      toolName: toolAuditDaily.toolName,
      category: toolAuditDaily.category,
      agentHostId: toolAuditDaily.agentHostId,
      cloudAgentRef: toolAuditDaily.cloudAgentRef,
      events: toolAuditDaily.events,
      distinctExecutions: toolAuditDaily.distinctExecutions,
    })
      .from(toolAuditDaily)
      .where(and(eq(toolAuditDaily.tenantId, tenantId), gte(toolAuditDaily.day, sinceDay))),
  ]);
  return [...(raw as AuditRow[]), ...(tallies as AuditRow[])];
}

export interface AgentDayCount {
  agentHostId: number | null;
  day: string;
  count: number;
}

/**
 * Tool-call volume per (agent host, day) over an explicit range — the activity
 * leaderboard's shape.
 *
 * This one is EXACTLY the fold's grain, so the tallies reproduce it without loss: a
 * day the rollup has folded contributes the same per-agent count it would have
 * contributed as raw rows. The two sides are summed rather than concatenated because
 * the range can straddle the boundary mid-day only at the boundary itself, and a day
 * is never half-folded.
 */
export async function countAuditByAgentDay(
  db: Db,
  tenantId: number,
  from: Date,
  to: Date,
): Promise<AgentDayCount[]> {
  const { sinceDay } = auditWindow(from);
  const toDay = to.toISOString().slice(0, 10);
  const [raw, tallies] = await Promise.all([
    db.select({
      agentHostId: toolAuditEvents.agentHostId,
      day: sql<string>`to_char(date_trunc('day', ${toolAuditEvents.ts}), 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
      .from(toolAuditEvents)
      .where(and(
        eq(toolAuditEvents.tenantId, tenantId),
        gte(toolAuditEvents.ts, from),
        lte(toolAuditEvents.ts, to),
      ))
      .groupBy(toolAuditEvents.agentHostId, sql`date_trunc('day', ${toolAuditEvents.ts})`),
    db.select({
      agentHostId: toolAuditDaily.agentHostId,
      day: sql<string>`to_char(${toolAuditDaily.day}, 'YYYY-MM-DD')`,
      count: sql<number>`sum(${toolAuditDaily.events})::int`,
    })
      .from(toolAuditDaily)
      .where(and(
        eq(toolAuditDaily.tenantId, tenantId),
        gte(toolAuditDaily.day, sinceDay),
        lte(toolAuditDaily.day, toDay),
      ))
      .groupBy(toolAuditDaily.agentHostId, toolAuditDaily.day),
  ]);

  const merged = new Map<string, AgentDayCount>();
  for (const r of [...raw, ...tallies]) {
    const key = `${r.agentHostId ?? ''}|${r.day}`;
    const cur = merged.get(key);
    if (cur) cur.count += Number(r.count);
    else merged.set(key, { agentHostId: r.agentHostId, day: r.day, count: Number(r.count) });
  }
  return [...merged.values()];
}
