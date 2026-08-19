/**
 * Value rollups — the same session-grained metrics, aggregated to a project, a
 * workspace, or the whole platform.
 *
 * Every number here comes from {@link OUTCOME_METRICS}: this module owns the
 * COHORT (which sessions, which window, whose) and nothing else. It used to own
 * a second, hand-written copy of every metric definition, which is how the
 * platform ended up able to compute "delivery success rate" two ways.
 *
 * The baseline is the immediately preceding window of equal length — the only
 * honest comparison for a rate whose denominator grows with time.
 */

import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  DELIVERY_ACTIONS,
  NORTH_STAR_METRIC_KEY,
  OUTCOME_DEFINITION_VERSION,
  OUTCOME_FAMILY_LABELS,
  OUTCOME_METRIC_FAMILIES,
  aggregateMetricValue,
  outcomeActionList,
  outcomeAggregateSql,
  outcomeFactsSql,
  toOutcomeMetricValues,
  type OutcomeMetricValue,
} from '../outcomes/outcomeMetricContract';

export interface OutcomeValueFilters {
  days: number;
  tenantId?: number;
  projectId?: number;
}

/** Kept as the panel's own type name; the shape is the contract's. */
export type OutcomeValueMetric = OutcomeMetricValue;

type RollupRow = Record<string, unknown>;

const n = (value: unknown): number => Number(value ?? 0);

/** Externally quotable only above this cohort size — a "92% of teams" built on
 *  four sessions is not a claim, it is an anecdote with a percentage sign. */
const MINIMUM_EXTERNAL_COHORT = 10;

function cohortWhere(start: Date, end: Date, filters: OutcomeValueFilters): SQL {
  const clauses: SQL[] = [
    sql`s.status <> 'deleted'`,
    sql`s.created_at >= ${start}`,
    sql`s.created_at < ${end}`,
  ];
  if (filters.tenantId) clauses.push(sql`s.tenant_id = ${filters.tenantId}`);
  if (filters.projectId) clauses.push(sql`EXISTS (SELECT 1 FROM creation_session_project_links filter_link WHERE filter_link.session_id = s.id AND filter_link.project_id = ${filters.projectId})`);
  return sql.join(clauses, sql` AND `);
}

async function queryPeriod(db: Db, start: Date, end: Date, filters: OutcomeValueFilters): Promise<RollupRow> {
  const cohort = sql`SELECT s.id, s.tenant_id, s.created_at FROM creation_sessions s WHERE ${cohortWhere(start, end, filters)}`;
  const result = await db.execute(sql`
    WITH facts AS (${outcomeFactsSql(cohort)})
    SELECT ${outcomeAggregateSql()} FROM facts
  `);
  return (result.rows[0] ?? {}) as RollupRow;
}

export async function getOutcomeValueRollup(db: Db, filters: OutcomeValueFilters) {
  const now = new Date();
  const currentStart = new Date(now.getTime() - filters.days * 86_400_000);
  const previousStart = new Date(currentStart.getTime() - filters.days * 86_400_000);
  const delivery = outcomeActionList(DELIVERY_ACTIONS);
  const tenantFilter = filters.tenantId ? sql`AND s.tenant_id = ${filters.tenantId}` : sql``;
  const projectFilter = filters.projectId
    ? sql`AND EXISTS (SELECT 1 FROM creation_session_project_links l WHERE l.session_id = s.id AND l.project_id = ${filters.projectId})`
    : sql``;
  // A delivered/graded breakdown is a COUNT OF SESSIONS, never of events: one
  // board that published nine times is one delivered session, not nine.
  const deliveredSessions = sql`EXISTS (SELECT 1 FROM creation_outcome_events e WHERE e.session_id = s.id AND e.phase = 'succeeded' AND e.action IN (${delivery}))`;
  const gradedSessions = sql`EXISTS (SELECT 1 FROM creation_outcome_events e WHERE e.session_id = s.id AND e.action = 'proof.grade' AND e.phase = 'validated')`;

  const [current, previous, trends, tenantBreakdown, projectBreakdown] = await Promise.all([
    queryPeriod(db, currentStart, now, filters),
    queryPeriod(db, previousStart, currentStart, filters),
    db.execute(sql`
      WITH days AS (SELECT generate_series(${currentStart}::date, ${now}::date, interval '1 day')::date AS day)
      SELECT d.day::text,
        (SELECT COUNT(*)::int FROM creation_sessions s WHERE s.status <> 'deleted' AND s.created_at::date = d.day ${tenantFilter} ${projectFilter}) AS sessions,
        (SELECT COUNT(*)::int FROM creation_outcome_events e WHERE e.phase = 'succeeded' AND e.action IN (${delivery}) AND e.occurred_at::date = d.day ${filters.tenantId ? sql`AND e.tenant_id = ${filters.tenantId}` : sql``} ${filters.projectId ? sql`AND e.project_id = ${filters.projectId}` : sql``}) AS deliveries,
        (SELECT COUNT(*)::int FROM creation_outcome_events e WHERE e.phase = 'validated' AND e.action = 'proof.grade' AND e.occurred_at::date = d.day ${filters.tenantId ? sql`AND e.tenant_id = ${filters.tenantId}` : sql``} ${filters.projectId ? sql`AND e.project_id = ${filters.projectId}` : sql``}) AS graded
      FROM days d ORDER BY d.day
    `),
    db.execute(sql`
      SELECT t.id AS "tenantId", t.name AS "tenantName",
        COUNT(DISTINCT s.id)::int AS sessions,
        COUNT(DISTINCT s.id) FILTER (WHERE ${deliveredSessions})::int AS deliveries,
        COUNT(DISTINCT s.id) FILTER (WHERE ${gradedSessions})::int AS graded
      FROM creation_sessions s JOIN tenants t ON t.id = s.tenant_id
      WHERE s.status <> 'deleted' AND s.created_at >= ${currentStart} ${tenantFilter} ${projectFilter}
      GROUP BY t.id, t.name ORDER BY graded DESC, deliveries DESC, sessions DESC LIMIT 50
    `),
    db.execute(sql`
      SELECT p.id AS "projectId", p.name AS "projectName", p.tenant_id AS "tenantId", t.name AS "tenantName",
        COUNT(DISTINCT s.id)::int AS sessions,
        COUNT(DISTINCT s.id) FILTER (WHERE ${deliveredSessions})::int AS deliveries,
        COUNT(DISTINCT s.id) FILTER (WHERE ${gradedSessions})::int AS graded
      FROM creation_session_project_links l
      JOIN creation_sessions s ON s.id = l.session_id
      JOIN projects p ON p.id = l.project_id
      JOIN tenants t ON t.id = p.tenant_id
      WHERE s.status <> 'deleted' AND s.created_at >= ${currentStart} ${tenantFilter} ${filters.projectId ? sql`AND p.id = ${filters.projectId}` : sql``}
      GROUP BY p.id, p.name, p.tenant_id, t.name ORDER BY graded DESC, deliveries DESC, sessions DESC LIMIT 50
    `),
  ]);

  const sampleSize = n(current.sessionCount);
  return {
    scope: filters.projectId ? 'project' : filters.tenantId ? 'tenant' : 'platform',
    filters,
    period: { start: currentStart.toISOString(), end: now.toISOString(), days: filters.days },
    previousPeriod: { start: previousStart.toISOString(), end: currentStart.toISOString() },
    sampleSize,
    deliveredSessions: n(current.deliveredSessions),
    gradedSessions: n(current.gradedSessions),
    /** So a deck can state which definition set produced the number it quotes. */
    definitionVersion: OUTCOME_DEFINITION_VERSION,
    northStarKey: NORTH_STAR_METRIC_KEY,
    families: OUTCOME_METRIC_FAMILIES.map((key) => ({ key, label: OUTCOME_FAMILY_LABELS[key] })),
    metrics: toOutcomeMetricValues(
      (metric) => aggregateMetricValue(current, metric.key),
      (metric) => aggregateMetricValue(previous, metric.key),
    ),
    trends: trends.rows.map((row) => ({ day: String(row.day), sessions: n(row.sessions), deliveries: n(row.deliveries), graded: n(row.graded) })),
    tenants: tenantBreakdown.rows.map((row) => ({ tenantId: n(row.tenantId), tenantName: String(row.tenantName), sessions: n(row.sessions), deliveries: n(row.deliveries), graded: n(row.graded) })),
    projects: projectBreakdown.rows.map((row) => ({ projectId: n(row.projectId), projectName: String(row.projectName), tenantId: n(row.tenantId), tenantName: String(row.tenantName), sessions: n(row.sessions), deliveries: n(row.deliveries), graded: n(row.graded) })),
    generatedAt: now.toISOString(),
    privacy: { contentFree: true, minimumExternalCohort: MINIMUM_EXTERNAL_COHORT, externalClaimsEligible: sampleSize >= MINIMUM_EXTERNAL_COHORT },
  };
}
