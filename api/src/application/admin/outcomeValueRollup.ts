import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';

export interface OutcomeValueFilters {
  days: number;
  tenantId?: number;
  projectId?: number;
}

export interface OutcomeValueMetric {
  key: string;
  label: string;
  unit: 'seconds' | 'percent' | 'agents' | 'count' | 'usd';
  direction: 'higher' | 'lower';
  current: number | null;
  baseline: number | null;
}

type RollupRow = Record<string, unknown>;

const n = (value: unknown): number => Number(value ?? 0);
const maybe = (value: unknown): number | null => value == null || !Number.isFinite(Number(value)) ? null : Number(value);

const METRICS = [
  ['timeToArtifact', 'Time to first meaningful artifact', 'seconds', 'lower'],
  ['deliverableRate', 'Sessions reaching a real deliverable', 'percent', 'higher'],
  ['collaborationRate', 'Sessions inviting a human or agent', 'percent', 'higher'],
  ['agentParticipation', 'Agent group-chat participation', 'agents', 'higher'],
  ['synthesisRate', 'Successful agent synthesis', 'percent', 'higher'],
  ['validationRate', 'Artifact validation pass rate', 'percent', 'higher'],
  ['deliverySuccessRate', 'Delivery success rate', 'percent', 'higher'],
  ['deliveryRetryRate', 'Delivery retry rate', 'percent', 'lower'],
  ['resumed7d', 'Sessions resumed within 7 days', 'percent', 'higher'],
  ['resumed30d', 'Sessions resumed within 30 days', 'percent', 'higher'],
  ['outputReuse', 'Created outputs reused as inputs', 'count', 'higher'],
  ['humanIntervention', 'Human interventions per delivery', 'count', 'lower'],
  ['costPerDelivery', 'Cost per delivered outcome', 'usd', 'lower'],
  ['latencyPerDelivery', 'Latency per delivered outcome', 'seconds', 'lower'],
  ['correlationCoverage', 'Actions with correlated outcomes', 'percent', 'higher'],
] as const;

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
  const where = cohortWhere(start, end, filters);
  const result = await db.execute(sql`
    WITH cohort AS (
      SELECT s.id, s.tenant_id, s.created_at
      FROM creation_sessions s
      WHERE ${where}
    ), facts AS (
      SELECT s.id, s.tenant_id, s.created_at,
        EXTRACT(EPOCH FROM (
          (SELECT MIN(o.created_at) FROM creation_session_objects o WHERE o.session_id = s.id AND o.kind <> 'chat') -
          COALESCE((SELECT MIN(t.created_at) FROM creation_session_timeline t WHERE t.session_id = s.id AND t.message_role = 'user'), s.created_at)
        )) AS time_to_artifact,
        (SELECT COUNT(*) FROM creation_session_members m WHERE m.session_id = s.id) AS members,
        (SELECT COUNT(DISTINCT NULLIF(t.metadata #>> '{authoredBy,ref}', '')) FROM creation_session_timeline t WHERE t.session_id = s.id AND t.metadata #>> '{authoredBy,kind}' = 'agent') AS agents,
        EXISTS (
          SELECT 1 FROM creation_session_timeline brain
          WHERE brain.session_id = s.id AND brain.metadata #>> '{authoredBy,kind}' = 'brain'
            AND brain.created_at > COALESCE((SELECT MAX(agent.created_at) FROM creation_session_timeline agent WHERE agent.session_id = s.id AND agent.metadata #>> '{authoredBy,kind}' = 'agent'), 'infinity'::timestamp)
        ) AS synthesized,
        (SELECT COUNT(*) FROM creation_outcome_events e WHERE e.session_id = s.id AND e.action IN ('artifact.deliver','artifact.publish','workflow.execute') AND e.phase = 'started') AS attempts,
        (SELECT COUNT(*) FROM creation_outcome_events e WHERE e.session_id = s.id AND e.action IN ('artifact.deliver','artifact.publish','workflow.execute') AND e.phase = 'succeeded') AS deliveries,
        (SELECT COUNT(*) FROM creation_outcome_events e WHERE e.session_id = s.id AND e.action = 'delivery.retry' AND e.phase = 'succeeded') AS retries,
        (SELECT COUNT(*) FROM creation_outcome_events e WHERE e.session_id = s.id AND e.phase = 'validated') AS validations,
        (SELECT COUNT(*) FROM creation_outcome_events e WHERE e.session_id = s.id AND e.phase = 'validated' AND COALESCE(e.metric_value, 1) > 0) AS validation_passes,
        EXISTS (SELECT 1 FROM creation_outcome_events e WHERE e.session_id = s.id AND e.action = 'session.open' AND e.phase = 'succeeded' AND e.occurred_at > s.created_at + interval '1 hour' AND e.occurred_at <= s.created_at + interval '7 days') AS resumed_7d,
        EXISTS (SELECT 1 FROM creation_outcome_events e WHERE e.session_id = s.id AND e.action = 'session.open' AND e.phase = 'succeeded' AND e.occurred_at > s.created_at + interval '1 hour' AND e.occurred_at <= s.created_at + interval '30 days') AS resumed_30d,
        (SELECT COUNT(*) FROM creation_outcome_events e WHERE e.session_id = s.id AND e.phase = 'reused') AS reused,
        (SELECT COUNT(*) FROM creation_outcome_events e WHERE e.session_id = s.id AND e.actor_type = 'user' AND e.action IN ('agent.approve','artifact.revise','delivery.retry') AND e.phase = 'succeeded') AS interventions,
        (SELECT SUM(e.cost_usd_millicents) FROM creation_outcome_events e WHERE e.session_id = s.id) AS cost,
        (SELECT AVG(e.duration_ms) FROM creation_outcome_events e WHERE e.session_id = s.id AND e.action IN ('artifact.deliver','artifact.publish','workflow.execute') AND e.phase = 'succeeded' AND e.duration_ms IS NOT NULL) AS latency,
        (SELECT COUNT(*) FROM creation_outcome_events e WHERE e.session_id = s.id AND e.phase <> 'started') AS terminal_events,
        (SELECT COUNT(*) FROM creation_outcome_events terminal WHERE terminal.session_id = s.id AND terminal.phase <> 'started' AND EXISTS (
          SELECT 1 FROM creation_outcome_events started WHERE started.session_id = terminal.session_id AND started.correlation_id = terminal.correlation_id AND started.action = terminal.action AND started.phase = 'started'
        )) AS correlated_events
      FROM cohort s
    )
    SELECT
      COUNT(*)::int AS "sessionCount",
      COUNT(*) FILTER (WHERE deliveries > 0)::int AS "deliveredSessions",
      AVG(time_to_artifact) FILTER (WHERE time_to_artifact >= 0) AS "timeToArtifact",
      COUNT(*) FILTER (WHERE deliveries > 0)::float / NULLIF(COUNT(*), 0) AS "deliverableRate",
      COUNT(*) FILTER (WHERE members > 1 OR agents > 0)::float / NULLIF(COUNT(*), 0) AS "collaborationRate",
      AVG(agents) FILTER (WHERE agents > 0) AS "agentParticipation",
      COUNT(*) FILTER (WHERE synthesized AND agents > 0)::float / NULLIF(COUNT(*) FILTER (WHERE agents > 0), 0) AS "synthesisRate",
      SUM(validation_passes)::float / NULLIF(SUM(validations), 0) AS "validationRate",
      SUM(deliveries)::float / NULLIF(SUM(attempts), 0) AS "deliverySuccessRate",
      SUM(retries)::float / NULLIF(SUM(attempts), 0) AS "deliveryRetryRate",
      COUNT(*) FILTER (WHERE resumed_7d)::float / NULLIF(COUNT(*) FILTER (WHERE created_at <= ${end}::timestamp - interval '7 days'), 0) AS "resumed7d",
      COUNT(*) FILTER (WHERE resumed_30d)::float / NULLIF(COUNT(*) FILTER (WHERE created_at <= ${end}::timestamp - interval '30 days'), 0) AS "resumed30d",
      AVG(reused) AS "outputReuse",
      SUM(interventions)::float / NULLIF(SUM(deliveries), 0) AS "humanIntervention",
      SUM(cost)::float / 100000 / NULLIF(SUM(deliveries), 0) AS "costPerDelivery",
      AVG(latency) / 1000 AS "latencyPerDelivery",
      SUM(correlated_events)::float / NULLIF(SUM(terminal_events), 0) AS "correlationCoverage"
    FROM facts
  `);
  return (result.rows[0] ?? {}) as RollupRow;
}

export async function getOutcomeValueRollup(db: Db, filters: OutcomeValueFilters) {
  const now = new Date();
  const currentStart = new Date(now.getTime() - filters.days * 86_400_000);
  const previousStart = new Date(currentStart.getTime() - filters.days * 86_400_000);
  const [current, previous, trends, tenantBreakdown, projectBreakdown] = await Promise.all([
    queryPeriod(db, currentStart, now, filters),
    queryPeriod(db, previousStart, currentStart, filters),
    db.execute(sql`
      WITH days AS (SELECT generate_series(${currentStart}::date, ${now}::date, interval '1 day')::date AS day)
      SELECT d.day::text,
        (SELECT COUNT(*)::int FROM creation_sessions s WHERE s.status <> 'deleted' AND s.created_at::date = d.day ${filters.tenantId ? sql`AND s.tenant_id = ${filters.tenantId}` : sql``} ${filters.projectId ? sql`AND EXISTS (SELECT 1 FROM creation_session_project_links l WHERE l.session_id = s.id AND l.project_id = ${filters.projectId})` : sql``}) AS sessions,
        (SELECT COUNT(*)::int FROM creation_outcome_events e JOIN creation_sessions s ON s.id = e.session_id WHERE e.phase = 'succeeded' AND e.action IN ('artifact.deliver','artifact.publish','workflow.execute') AND e.occurred_at::date = d.day ${filters.tenantId ? sql`AND e.tenant_id = ${filters.tenantId}` : sql``} ${filters.projectId ? sql`AND e.project_id = ${filters.projectId}` : sql``}) AS deliveries
      FROM days d ORDER BY d.day
    `),
    db.execute(sql`
      SELECT t.id AS "tenantId", t.name AS "tenantName",
        COUNT(DISTINCT s.id)::int AS sessions,
        COUNT(DISTINCT s.id) FILTER (WHERE EXISTS (SELECT 1 FROM creation_outcome_events e WHERE e.session_id = s.id AND e.phase = 'succeeded' AND e.action IN ('artifact.deliver','artifact.publish','workflow.execute')))::int AS deliveries
      FROM creation_sessions s JOIN tenants t ON t.id = s.tenant_id
      WHERE s.status <> 'deleted' AND s.created_at >= ${currentStart} ${filters.tenantId ? sql`AND s.tenant_id = ${filters.tenantId}` : sql``} ${filters.projectId ? sql`AND EXISTS (SELECT 1 FROM creation_session_project_links l WHERE l.session_id = s.id AND l.project_id = ${filters.projectId})` : sql``}
      GROUP BY t.id, t.name ORDER BY deliveries DESC, sessions DESC LIMIT 50
    `),
    db.execute(sql`
      SELECT p.id AS "projectId", p.name AS "projectName", p.tenant_id AS "tenantId", t.name AS "tenantName",
        COUNT(DISTINCT s.id)::int AS sessions,
        COUNT(DISTINCT s.id) FILTER (WHERE EXISTS (SELECT 1 FROM creation_outcome_events e WHERE e.session_id = s.id AND e.phase = 'succeeded' AND e.action IN ('artifact.deliver','artifact.publish','workflow.execute')))::int AS deliveries
      FROM creation_session_project_links l
      JOIN creation_sessions s ON s.id = l.session_id
      JOIN projects p ON p.id = l.project_id
      JOIN tenants t ON t.id = p.tenant_id
      WHERE s.status <> 'deleted' AND s.created_at >= ${currentStart} ${filters.tenantId ? sql`AND s.tenant_id = ${filters.tenantId}` : sql``} ${filters.projectId ? sql`AND p.id = ${filters.projectId}` : sql``}
      GROUP BY p.id, p.name, p.tenant_id, t.name ORDER BY deliveries DESC, sessions DESC LIMIT 50
    `),
  ]);

  return {
    scope: filters.projectId ? 'project' : filters.tenantId ? 'tenant' : 'platform',
    filters,
    period: { start: currentStart.toISOString(), end: now.toISOString(), days: filters.days },
    previousPeriod: { start: previousStart.toISOString(), end: currentStart.toISOString() },
    sampleSize: n(current.sessionCount),
    deliveredSessions: n(current.deliveredSessions),
    metrics: METRICS.map(([key, label, unit, direction]): OutcomeValueMetric => ({ key, label, unit, direction, current: maybe(current[key]), baseline: maybe(previous[key]) })),
    trends: trends.rows.map((row) => ({ day: String(row.day), sessions: n(row.sessions), deliveries: n(row.deliveries) })),
    tenants: tenantBreakdown.rows.map((row) => ({ tenantId: n(row.tenantId), tenantName: String(row.tenantName), sessions: n(row.sessions), deliveries: n(row.deliveries) })),
    projects: projectBreakdown.rows.map((row) => ({ projectId: n(row.projectId), projectName: String(row.projectName), tenantId: n(row.tenantId), tenantName: String(row.tenantName), sessions: n(row.sessions), deliveries: n(row.deliveries) })),
    generatedAt: now.toISOString(),
    privacy: { contentFree: true, minimumExternalCohort: 10, externalClaimsEligible: n(current.sessionCount) >= 10 },
  };
}
