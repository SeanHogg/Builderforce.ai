/**
 * LANE STAFFING, read and written through the canonical `agent_assignments` table.
 *
 * Until migration 1085 lane staffing lived in its own `swimlane_agent_assignments`
 * table, while `agent_assignments` (0082) declared itself "the single source the surfaces
 * read, superseding the fragmented project_agents / swimlane target / assignedAgentHost
 * notions over time" and carried a documented `scope = 'swimlane'` value with zero rows.
 * So "where is this agent assigned?" had two answers depending on which table you asked,
 * and fourteen modules hardcoded the second one.
 *
 * The rows moved. This module is the ONE place the `scope = 'swimlane'` predicate is
 * written, so a caller cannot forget it and accidentally read a project-scoped or
 * brain-scoped assignment as lane staffing — which is the single failure mode the merge
 * introduces, and the reason a bare `agentAssignments` reference in lane code should be
 * treated as a bug.
 *
 * The lane id lives in `scope_id` (a text column holding the swimlane uuid). Use
 * {@link laneAgentScopeId} rather than casting at each site.
 */
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { agentAssignments } from '../../infrastructure/database/schema';

/** The `scope` value that marks an assignment as lane staffing. */
export const LANE_AGENT_SCOPE = 'swimlane';

/** The canonical table, re-exported so lane code has one import to reach for. */
export { agentAssignments as laneAgentAssignments };

/** A swimlane id as `agent_assignments.scope_id` stores it. */
export const laneAgentScopeId = (swimlaneId: string): string => swimlaneId;

/**
 * `WHERE scope = 'swimlane' AND scope_id = <lane>` plus any extra conditions.
 *
 * Every read and write of lane staffing goes through this or {@link forLanes}; a query
 * that omits the scope predicate would silently mix in project-, workflow- and
 * brain-scoped assignments.
 */
export function forLane(swimlaneId: string, ...extra: Array<SQL | undefined>): SQL {
  return and(
    eq(agentAssignments.scope, LANE_AGENT_SCOPE),
    eq(agentAssignments.scopeId, laneAgentScopeId(swimlaneId)),
    ...extra,
  )!;
}

/** The set form of {@link forLane}, for a whole board's lanes in one query. */
export function forLanes(swimlaneIds: readonly string[], ...extra: Array<SQL | undefined>): SQL {
  return and(
    eq(agentAssignments.scope, LANE_AGENT_SCOPE),
    inArray(agentAssignments.scopeId, swimlaneIds.map(laneAgentScopeId)),
    ...extra,
  )!;
}

/** `WHERE scope = 'swimlane'` alone — for a query that joins to `swimlanes` for its
 *  own narrowing (a board-wide staffing scan) rather than naming lane ids. */
export function laneScoped(...extra: Array<SQL | undefined>): SQL {
  return and(eq(agentAssignments.scope, LANE_AGENT_SCOPE), ...extra)!;
}

/**
 * The JOIN condition between a lane assignment and `swimlanes.id`.
 *
 * `agent_assignments.scope_id` is `varchar(64)` — it has to be, because it holds ids from
 * every scope (integer project ids, uuid workflow ids, nothing at all for brain/global) —
 * while `swimlanes.id` is a `uuid`. Postgres will not compare `text = uuid`, so the cast
 * is mandatory and lives HERE rather than at each join site: a missed cast is a runtime
 * SQL error TypeScript cannot catch.
 */
export function laneJoinOn(swimlaneIdColumn: AnyPgColumn): SQL {
  return sql`${agentAssignments.scopeId}::uuid = ${swimlaneIdColumn} AND ${agentAssignments.scope} = ${LANE_AGENT_SCOPE}`;
}

/** The values a lane-staffing INSERT must carry, so no writer forgets the scope. */
export function laneAssignmentValues(input: {
  tenantId: number;
  segmentId?: string | null;
  swimlaneId: string;
  agentKind: string;
  agentRef: string;
  role: string;
  name?: string | null;
  runtime?: string | null;
  target?: string | null;
  taskTemplate?: string | null;
  requiredCapabilities?: string | null;
  model?: string | null;
  position?: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return {
    tenantId: input.tenantId,
    segmentId: input.segmentId ?? null,
    scope: LANE_AGENT_SCOPE,
    scopeId: laneAgentScopeId(input.swimlaneId),
    executionScope: 'project',
    agentKind: input.agentKind,
    agentRef: input.agentRef,
    role: input.role,
    name: input.name ?? null,
    // Cloud is the historical default and what every un-set row resolved to.
    runtime: input.runtime ?? 'cloud',
    target: input.target ?? null,
    taskTemplate: input.taskTemplate ?? null,
    requiredCapabilities: input.requiredCapabilities ?? null,
    model: input.model ?? null,
    position: input.position ?? 0,
    createdAt: now,
    updatedAt: now,
  };
}
