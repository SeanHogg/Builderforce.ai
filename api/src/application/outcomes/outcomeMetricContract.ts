/**
 * THE outcome metric contract — every value metric this platform claims,
 * declared once.
 *
 * ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
 * The same fifteen metrics were written twice, in two hand-rolled SQL blocks:
 * once in `admin/outcomeValueRollup.ts` (platform/tenant/project cohorts) and
 * once inline in the session scorecard route. Two copies of "what a delivery
 * is", two copies of the resume windows, two copies of the correlation-coverage
 * join — and the two already disagreed, because the scorecard's baseline was a
 * MEAN OF PER-SESSION RATES while the rollup's was a RATIO OVER THE COHORT. A
 * session could therefore be told it was above a baseline the sales deck
 * computed differently from the same rows. A metric that means two things is
 * not a metric.
 *
 * So a metric is declared here exactly once, and carries both halves of its own
 * definition:
 *
 *   session(fact)   the SESSION-grain value, in TypeScript, from the shared
 *                   fact row — the number the scorecard shows for "this board".
 *   aggregate       the COHORT value, as a SQL expression over the same facts —
 *                   the number every rollup (project, tenant, platform) and
 *                   every baseline shows.
 *
 * Both read the SAME fact columns, produced by the SAME CTE ({@link outcomeFactsSql}).
 * Session is the source grain, as the metric contract requires; project, tenant
 * and platform are derived from it and can never be hand-entered.
 *
 * ── WHY THE METHOD'S OWN SHAPE IS IN HERE ───────────────────────────────────
 * The metrics are grouped by the act of the method they measure — Read → Prove,
 * Build, Measure — rather than by a flat alphabetical list, because the whole
 * opinion of this product is that those acts are DIFFERENT and that the middle
 * one is the one people skip. A dashboard that lists "delivery success rate"
 * next to "share of proofs whose kill condition was graded" as two equal rows
 * is telling a team they are equally important, which is precisely the claim
 * this method exists to deny.
 *
 * ── THE NORTH STAR ──────────────────────────────────────────────────────────
 * `gradedProofRate`: the share of ideas that reached a GRADED proof — a Build
 * whose kill condition was actually measured. Not "a deliverable was produced";
 * a deliverable that nobody graded is a launch with extra steps. It is the one
 * metric flagged `northStar`, so every surface leads with the same number
 * rather than each choosing its own favourite.
 *
 * ── VANITY METRICS ARE DELIBERATELY ABSENT ──────────────────────────────────
 * GitHub stars, package downloads, workflow counts, MCP connections and
 * active-agent counts are operational and acquisition diagnostics. They live on
 * their own dashboards; they are not evidence of customer value, so they are
 * not in this registry and cannot lead a value review by accident.
 *
 * ── VERSIONING ──────────────────────────────────────────────────────────────
 * {@link OUTCOME_DEFINITION_VERSION} rides every payload. A deck that quoted a
 * number states which definition produced it, so tightening a qualification
 * rule later cannot silently rewrite a prior claim.
 */

import { sql, type SQL } from 'drizzle-orm';

/** The definition set these numbers were computed under. Bump on any change to
 *  a qualification rule, a denominator, or the action vocabulary below. */
export const OUTCOME_DEFINITION_VERSION = '2026.08-idea-to-graded-proof';

/**
 * How many of a workspace's most recently active boards make up the scorecard's
 * baseline. A comparison, not a census: the panel states the sample size it
 * actually used rather than implying the whole workspace was counted.
 */
export const OUTCOME_BASELINE_COHORT = 500;

export type OutcomeMetricUnit = 'seconds' | 'percent' | 'agents' | 'count' | 'usd';
export type OutcomeMetricDirection = 'higher' | 'lower';

/**
 * The acts of the method, in the order they happen. A metric belongs to exactly
 * one, and the order here is the order every surface renders them in.
 */
export const OUTCOME_METRIC_FAMILIES = [
  'read-prove',
  'build',
  'measure',
  'collaboration',
  'compounding',
  'efficiency',
  'integrity',
] as const;
export type OutcomeMetricFamily = (typeof OUTCOME_METRIC_FAMILIES)[number];

/** English family names. Clients localise from the family KEY; this is the
 *  fallback and the wording used by the content-free sales brief. */
export const OUTCOME_FAMILY_LABELS: Record<OutcomeMetricFamily, string> = {
  'read-prove': 'Read → Prove',
  build: 'Build',
  measure: 'Measure',
  collaboration: 'Collaboration',
  compounding: 'Compounding value',
  efficiency: 'Efficiency',
  integrity: 'Measurement integrity',
};

/**
 * The canonical delivery actions. "A real deliverable" means one of these
 * succeeded — publishing, handing off to a project, or executing a workflow.
 * Creating a draft canvas object is not on this list and never qualifies.
 */
export const DELIVERY_ACTIONS = ['artifact.deliver', 'artifact.publish', 'workflow.execute'] as const;

/**
 * The proof-lifecycle actions — the loop, in the ledger.
 *
 * `idea.read`   an idea was read into a spec and the proofs were ranked (Read)
 * `proof.choose` a proof form was chosen for it (Prove)
 * `proof.build`  the proof was built; `succeeded` carries `metadata.reachable`
 *                when it produced an address a person can actually open (Build)
 * `proof.grade`  the kill condition was measured. `started` is emitted the
 *                moment a proof goes live — the clock on "did anyone grade
 *                this?" starts then — and `validated` when a verdict arrived,
 *                carrying 1 for met and 0 for missed. A parked idea terminates
 *                the same correlation as `failed`: abandoning is a judgement,
 *                not a measurement, and must not count as graded. (Measure)
 */
export const PROOF_ACTIONS = ['idea.read', 'proof.choose', 'proof.build', 'proof.grade'] as const;

/** Actions that count as a person stepping in. Used by the efficiency family. */
export const INTERVENTION_ACTIONS = ['agent.approve', 'artifact.revise', 'delivery.retry'] as const;

/** The terminal phases. `started` is the only non-terminal one. */
export const OUTCOME_PHASES = ['started', 'succeeded', 'failed', 'validated', 'reused'] as const;
export type OutcomePhase = (typeof OUTCOME_PHASES)[number];

/** One row of {@link outcomeFactsSql}. Column names are snake_case because they
 *  come straight back from Postgres; the accessors below are the only readers. */
export type OutcomeFact = Record<string, unknown> & { id: string };

export interface OutcomeMetricSpec {
  key: string;
  /** English label. Clients localise from `key`; this is the fallback and the
   *  wording the content-free sales brief uses. */
  label: string;
  unit: OutcomeMetricUnit;
  direction: OutcomeMetricDirection;
  family: OutcomeMetricFamily;
  /** The one metric every surface leads with. Exactly one spec sets it. */
  northStar?: true;
  /** One sentence: what qualifies, and what deliberately does not. */
  definition: string;
  /** This session's value. `null` means "not measured" — never zero. */
  session(fact: OutcomeFact): number | null;
  /** The cohort value, over the `facts` relation produced by {@link outcomeFactsSql}. */
  aggregate: SQL;
}

/** The value a metric reports at whichever grain it was asked for. */
export interface OutcomeMetricValue {
  key: string;
  label: string;
  unit: OutcomeMetricUnit;
  direction: OutcomeMetricDirection;
  family: OutcomeMetricFamily;
  northStar: boolean;
  definition: string;
  current: number | null;
  baseline: number | null;
}

const num = (value: unknown): number => Number(value ?? 0);
const nullable = (value: unknown): number | null =>
  value == null || !Number.isFinite(Number(value)) ? null : Number(value);
const bool = (value: unknown): boolean => value === true || value === 'true';
/** A rate with no denominator is NOT measured. Reporting zero would let an
 *  empty cohort read as a failed one. */
const rate = (part: number, total: number): number | null => (total > 0 ? part / total : null);

/**
 * The bound parameter list for `action IN (…)` over a closed action vocabulary.
 * Exported so a breakdown query cannot hand-type a fourth spelling of "what a
 * delivery is" next to the three this contract recognises.
 */
export function outcomeActionList(actions: readonly string[]): SQL {
  return sql.join(actions.map((action) => sql`${action}`), sql`, `);
}

const actionsIn = outcomeActionList;

/**
 * The per-session fact CTE — the ONE place a session's raw counters are
 * derived. `cohort` must select `id`, `tenant_id` and `created_at`.
 *
 * Every timestamp marker is computed once in a LATERAL rather than repeated per
 * derived column: `time to first artifact` and `time to a chosen proof form`
 * both measure from the first PROMPT, and two copies of "when did this idea
 * start" is exactly how two clocks end up disagreeing.
 */
export function outcomeFactsSql(cohort: SQL): SQL {
  const delivery = actionsIn(DELIVERY_ACTIONS);
  const intervention = actionsIn(INTERVENTION_ACTIONS);
  return sql`
    SELECT s.id, s.tenant_id, s.created_at,
      EXTRACT(EPOCH FROM (marks.first_artifact_at - COALESCE(marks.first_prompt_at, s.created_at))) AS time_to_artifact,
      EXTRACT(EPOCH FROM (marks.proof_chosen_at - COALESCE(marks.first_prompt_at, s.created_at))) AS time_to_proof_choice,
      (marks.first_build_at IS NOT NULL) AS built_any,
      (marks.read_at IS NOT NULL AND (marks.first_build_at IS NULL OR marks.read_at <= marks.first_build_at)) AS read_before_build,
      (SELECT COUNT(*) FROM creation_session_members m WHERE m.session_id = s.id) AS members,
      (SELECT COUNT(DISTINCT NULLIF(t.metadata #>> '{authoredBy,ref}', '')) FROM creation_session_timeline t
        WHERE t.session_id = s.id AND t.metadata #>> '{authoredBy,kind}' = 'agent') AS agents,
      EXISTS (
        SELECT 1 FROM creation_session_timeline brain_turn
        WHERE brain_turn.session_id = s.id AND brain_turn.metadata #>> '{authoredBy,kind}' = 'brain'
          AND brain_turn.created_at > COALESCE(
            (SELECT MAX(agent_turn.created_at) FROM creation_session_timeline agent_turn
              WHERE agent_turn.session_id = s.id AND agent_turn.metadata #>> '{authoredBy,kind}' = 'agent'),
            'infinity'::timestamp)
      ) AS synthesized,
      (SELECT COUNT(*) FROM creation_outcome_events e WHERE e.session_id = s.id AND e.action IN (${delivery}) AND e.phase = 'started') AS delivery_attempts,
      (SELECT COUNT(*) FROM creation_outcome_events e WHERE e.session_id = s.id AND e.action IN (${delivery}) AND e.phase = 'succeeded') AS deliveries,
      (SELECT COUNT(*) FROM creation_outcome_events e WHERE e.session_id = s.id AND e.action = 'delivery.retry' AND e.phase = 'succeeded') AS delivery_retries,
      (SELECT COUNT(*) FROM creation_outcome_events e WHERE e.session_id = s.id AND e.phase = 'validated' AND e.action <> 'proof.grade') AS validations,
      (SELECT COUNT(*) FROM creation_outcome_events e WHERE e.session_id = s.id AND e.phase = 'validated' AND e.action <> 'proof.grade' AND COALESCE(e.metric_value, 1) > 0) AS validation_passes,
      (SELECT COUNT(*) FROM creation_outcome_events e WHERE e.session_id = s.id AND e.action = 'proof.build' AND e.phase = 'started') AS proof_attempts,
      (SELECT COUNT(*) FROM creation_outcome_events e WHERE e.session_id = s.id AND e.action = 'proof.build' AND e.phase = 'succeeded') AS proofs_built,
      (SELECT COUNT(*) FROM creation_outcome_events e WHERE e.session_id = s.id AND e.action = 'proof.build' AND e.phase = 'succeeded' AND e.metadata ->> 'reachable' = 'true') AS proofs_reachable,
      (SELECT COUNT(*) FROM creation_outcome_events e WHERE e.session_id = s.id AND e.action = 'proof.grade' AND e.phase = 'validated') AS proofs_graded,
      EXISTS (SELECT 1 FROM creation_outcome_events e WHERE e.session_id = s.id AND e.action = 'session.open' AND e.phase = 'succeeded'
        AND e.occurred_at > s.created_at + interval '1 hour' AND e.occurred_at <= s.created_at + interval '7 days') AS resumed_7d,
      EXISTS (SELECT 1 FROM creation_outcome_events e WHERE e.session_id = s.id AND e.action = 'session.open' AND e.phase = 'succeeded'
        AND e.occurred_at > s.created_at + interval '1 hour' AND e.occurred_at <= s.created_at + interval '30 days') AS resumed_30d,
      (SELECT COUNT(*) FROM creation_outcome_events e WHERE e.session_id = s.id AND e.phase = 'reused') AS reused_outputs,
      (SELECT COUNT(*) FROM creation_outcome_events e WHERE e.session_id = s.id AND e.actor_type = 'user' AND e.action IN (${intervention}) AND e.phase = 'succeeded') AS interventions,
      (SELECT SUM(e.cost_usd_millicents) FROM creation_outcome_events e WHERE e.session_id = s.id) AS cost_millicents,
      (SELECT AVG(e.duration_ms) FROM creation_outcome_events e WHERE e.session_id = s.id AND e.action IN (${delivery}) AND e.phase = 'succeeded' AND e.duration_ms IS NOT NULL) AS latency_ms,
      (SELECT COUNT(*) FROM creation_outcome_events e WHERE e.session_id = s.id AND e.phase <> 'started') AS terminal_events,
      (SELECT COUNT(*) FROM creation_outcome_events terminal WHERE terminal.session_id = s.id AND terminal.phase <> 'started' AND EXISTS (
        SELECT 1 FROM creation_outcome_events started
        WHERE started.session_id = terminal.session_id AND started.correlation_id = terminal.correlation_id
          AND started.action = terminal.action AND started.phase = 'started'
      )) AS correlated_events
    FROM (${cohort}) s
    LEFT JOIN LATERAL (
      SELECT
        (SELECT MIN(o.created_at) FROM creation_session_objects o WHERE o.session_id = s.id AND o.kind <> 'chat') AS first_artifact_at,
        (SELECT MIN(t.created_at) FROM creation_session_timeline t WHERE t.session_id = s.id AND t.message_role = 'user') AS first_prompt_at,
        (SELECT MIN(e.occurred_at) FROM creation_outcome_events e WHERE e.session_id = s.id AND e.action = 'idea.read' AND e.phase = 'succeeded') AS read_at,
        (SELECT MIN(e.occurred_at) FROM creation_outcome_events e WHERE e.session_id = s.id AND e.action = 'proof.choose' AND e.phase = 'succeeded') AS proof_chosen_at,
        (SELECT MIN(e.occurred_at) FROM creation_outcome_events e WHERE e.session_id = s.id AND e.action = 'proof.build' AND e.phase = 'started') AS first_build_at
    ) marks ON TRUE
  `;
}

/**
 * The registry. Order is render order, and it walks the method: what it cost to
 * decide, what got built, whether anyone graded it, then who helped, what came
 * back, what it cost, and whether the measurement itself can be trusted.
 */
export const OUTCOME_METRICS: readonly OutcomeMetricSpec[] = [
  {
    key: 'gradedProofRate',
    label: 'Ideas reaching a graded proof',
    unit: 'percent',
    direction: 'higher',
    family: 'measure',
    northStar: true,
    definition: 'Ideas whose proof had its kill condition measured. A deliverable nobody graded does not qualify.',
    session: (f) => (num(f.proofs_graded) > 0 ? 1 : 0),
    aggregate: sql`COUNT(*) FILTER (WHERE proofs_graded > 0)::float / NULLIF(COUNT(*), 0)`,
  },
  {
    key: 'timeToProofChoice',
    label: 'Time to a chosen proof form',
    unit: 'seconds',
    direction: 'lower',
    family: 'read-prove',
    definition: 'First prompt to the moment a proof form was chosen. Measures the decision, not the build.',
    session: (f) => nullable(f.time_to_proof_choice),
    aggregate: sql`AVG(time_to_proof_choice) FILTER (WHERE time_to_proof_choice >= 0)`,
  },
  {
    key: 'readBeforeBuildRate',
    label: 'Ideas that Read before they Build',
    unit: 'percent',
    direction: 'higher',
    family: 'read-prove',
    definition: 'Of ideas that started a build, those whose idea was read and its proofs ranked first. Not measured until something is built.',
    session: (f) => (bool(f.built_any) ? (bool(f.read_before_build) ? 1 : 0) : null),
    aggregate: sql`COUNT(*) FILTER (WHERE built_any AND read_before_build)::float / NULLIF(COUNT(*) FILTER (WHERE built_any), 0)`,
  },
  {
    key: 'timeToArtifact',
    label: 'Time to first meaningful artifact',
    unit: 'seconds',
    direction: 'lower',
    family: 'read-prove',
    definition: 'First prompt to the first non-chat artifact on the board.',
    session: (f) => nullable(f.time_to_artifact),
    aggregate: sql`AVG(time_to_artifact) FILTER (WHERE time_to_artifact >= 0)`,
  },
  {
    key: 'reachableProofRate',
    label: 'Proofs reaching a real, reachable artifact',
    unit: 'percent',
    direction: 'higher',
    family: 'build',
    definition: 'Build attempts that produced an address a person can open. A built proof with no address does not qualify.',
    session: (f) => rate(num(f.proofs_reachable), num(f.proof_attempts)),
    aggregate: sql`SUM(proofs_reachable)::float / NULLIF(SUM(proof_attempts), 0)`,
  },
  {
    key: 'deliverableRate',
    label: 'Sessions reaching a real deliverable',
    unit: 'percent',
    direction: 'higher',
    family: 'build',
    definition: 'A successful publish, project handoff or workflow execution. A draft canvas object does not qualify.',
    session: (f) => (num(f.deliveries) > 0 ? 1 : 0),
    aggregate: sql`COUNT(*) FILTER (WHERE deliveries > 0)::float / NULLIF(COUNT(*), 0)`,
  },
  {
    key: 'validationRate',
    label: 'Artifact validation pass rate',
    unit: 'percent',
    direction: 'higher',
    family: 'build',
    definition: 'Validations that passed. Proof grading is excluded — a missed kill condition is a finding, not a defect.',
    session: (f) => rate(num(f.validation_passes), num(f.validations)),
    aggregate: sql`SUM(validation_passes)::float / NULLIF(SUM(validations), 0)`,
  },
  {
    key: 'deliverySuccessRate',
    label: 'Delivery success rate',
    unit: 'percent',
    direction: 'higher',
    family: 'build',
    definition: 'Successful deliveries over delivery attempts.',
    session: (f) => rate(num(f.deliveries), num(f.delivery_attempts)),
    aggregate: sql`SUM(deliveries)::float / NULLIF(SUM(delivery_attempts), 0)`,
  },
  {
    key: 'deliveryRetryRate',
    label: 'Delivery retry rate',
    unit: 'percent',
    direction: 'lower',
    family: 'build',
    definition: 'Failed attempts that were followed by another attempt, over attempts.',
    session: (f) => rate(num(f.delivery_retries), num(f.delivery_attempts)),
    aggregate: sql`SUM(delivery_retries)::float / NULLIF(SUM(delivery_attempts), 0)`,
  },
  {
    key: 'proofGradingRate',
    label: 'Proofs whose kill condition was graded',
    unit: 'percent',
    direction: 'higher',
    family: 'measure',
    definition: 'Built proofs that got a measured verdict. The one metric separating this method from a launch with extra steps.',
    session: (f) => rate(num(f.proofs_graded), num(f.proofs_built)),
    aggregate: sql`SUM(proofs_graded)::float / NULLIF(SUM(proofs_built), 0)`,
  },
  {
    key: 'collaborationRate',
    label: 'Sessions inviting a human or agent',
    unit: 'percent',
    direction: 'higher',
    family: 'collaboration',
    definition: 'Sessions with a second member or at least one contributing agent.',
    session: (f) => (num(f.members) > 1 || num(f.agents) > 0 ? 1 : 0),
    aggregate: sql`COUNT(*) FILTER (WHERE members > 1 OR agents > 0)::float / NULLIF(COUNT(*), 0)`,
  },
  {
    key: 'agentParticipation',
    label: 'Agent group-chat participation',
    unit: 'agents',
    direction: 'higher',
    family: 'collaboration',
    definition: 'Distinct agents that contributed a turn. Counted only where agents took part at all.',
    session: (f) => num(f.agents),
    aggregate: sql`AVG(agents) FILTER (WHERE agents > 0)`,
  },
  {
    key: 'synthesisRate',
    label: 'Successful agent synthesis',
    unit: 'percent',
    direction: 'higher',
    family: 'collaboration',
    definition: 'Group sessions closed by an explicit Brain synthesis after the agent turns. Message volume alone does not qualify.',
    session: (f) => (num(f.agents) > 0 ? (bool(f.synthesized) ? 1 : 0) : null),
    aggregate: sql`COUNT(*) FILTER (WHERE synthesized AND agents > 0)::float / NULLIF(COUNT(*) FILTER (WHERE agents > 0), 0)`,
  },
  {
    key: 'resumed7d',
    label: 'Sessions resumed within 7 days',
    unit: 'percent',
    direction: 'higher',
    family: 'compounding',
    definition: 'Reopened more than an hour after creation and inside 7 days. Only sessions old enough to have had the chance count.',
    session: (f) => (bool(f.resumed_7d) ? 1 : 0),
    aggregate: sql`COUNT(*) FILTER (WHERE resumed_7d)::float / NULLIF(COUNT(*) FILTER (WHERE created_at <= NOW() - interval '7 days'), 0)`,
  },
  {
    key: 'resumed30d',
    label: 'Sessions resumed within 30 days',
    unit: 'percent',
    direction: 'higher',
    family: 'compounding',
    definition: 'Reopened more than an hour after creation and inside 30 days. Only sessions old enough to have had the chance count.',
    session: (f) => (bool(f.resumed_30d) ? 1 : 0),
    aggregate: sql`COUNT(*) FILTER (WHERE resumed_30d)::float / NULLIF(COUNT(*) FILTER (WHERE created_at <= NOW() - interval '30 days'), 0)`,
  },
  {
    key: 'outputReuse',
    label: 'Created outputs reused as inputs',
    unit: 'count',
    direction: 'higher',
    family: 'compounding',
    definition: 'Reuse events — a created output fed back in as the input to something else.',
    session: (f) => num(f.reused_outputs),
    aggregate: sql`AVG(reused_outputs)`,
  },
  {
    key: 'humanIntervention',
    label: 'Human interventions per delivery',
    unit: 'count',
    direction: 'lower',
    family: 'efficiency',
    definition: 'Approvals, revisions and retries a person performed, per successful delivery. Lower is better only while quality holds.',
    session: (f) => (num(f.deliveries) > 0 ? num(f.interventions) / num(f.deliveries) : null),
    aggregate: sql`SUM(interventions)::float / NULLIF(SUM(deliveries), 0)`,
  },
  {
    key: 'costPerDelivery',
    label: 'Cost per delivered outcome',
    unit: 'usd',
    direction: 'lower',
    family: 'efficiency',
    definition: 'Attributed cost per successful delivery. Not measured until authoritative cost telemetry is attached.',
    session: (f) =>
      num(f.deliveries) > 0 && nullable(f.cost_millicents) != null
        ? num(f.cost_millicents) / 100_000 / num(f.deliveries)
        : null,
    aggregate: sql`SUM(cost_millicents)::float / 100000 / NULLIF(SUM(deliveries), 0)`,
  },
  {
    key: 'latencyPerDelivery',
    label: 'Latency per delivered outcome',
    unit: 'seconds',
    direction: 'lower',
    family: 'efficiency',
    definition: 'Mean wall-clock duration of a successful delivery. Not measured until durations are recorded.',
    session: (f) => (nullable(f.latency_ms) == null ? null : num(f.latency_ms) / 1_000),
    aggregate: sql`AVG(latency_ms) / 1000`,
  },
  {
    key: 'correlationCoverage',
    label: 'Actions with a correlated outcome',
    unit: 'percent',
    direction: 'higher',
    family: 'integrity',
    definition: 'Terminal events that have a matching started event. A feature is not fully instrumented below 100%.',
    session: (f) => rate(num(f.correlated_events), num(f.terminal_events)),
    aggregate: sql`SUM(correlated_events)::float / NULLIF(SUM(terminal_events), 0)`,
  },
];

/** The north star, resolved from the registry rather than named by each caller. */
export const NORTH_STAR_METRIC_KEY =
  OUTCOME_METRICS.find((metric) => metric.northStar)?.key ?? OUTCOME_METRICS[0]!.key;

/**
 * The aggregate SELECT list, plus the two cohort counters every consumer needs.
 * Aliases are metric keys, so a row from this select is keyed the same way a
 * metric is — no second mapping table to drift.
 */
export function outcomeAggregateSql(): SQL {
  const columns: SQL[] = [
    sql`COUNT(*)::int AS "sessionCount"`,
    sql`COUNT(*) FILTER (WHERE deliveries > 0)::int AS "deliveredSessions"`,
    sql`COUNT(*) FILTER (WHERE proofs_graded > 0)::int AS "gradedSessions"`,
    ...OUTCOME_METRICS.map((metric) => sql`${metric.aggregate} AS ${sql.raw(`"${metric.key}"`)}`),
  ];
  return sql.join(columns, sql`, `);
}

/** Read one metric out of an aggregate row produced by {@link outcomeAggregateSql}. */
export function aggregateMetricValue(row: Record<string, unknown> | undefined, key: string): number | null {
  return nullable(row?.[key]);
}

/**
 * Assemble the reported metric list. `current` and `baseline` are supplied by
 * the caller at whichever grain it works in — the scorecard passes a session
 * value against a cohort aggregate, a rollup passes this period against the
 * previous one — but the labels, families, direction and the north-star flag
 * come from here, so every surface describes a metric identically.
 */
export function toOutcomeMetricValues(
  current: (metric: OutcomeMetricSpec) => number | null,
  baseline: (metric: OutcomeMetricSpec) => number | null,
): OutcomeMetricValue[] {
  return OUTCOME_METRICS.map((metric) => ({
    key: metric.key,
    label: metric.label,
    unit: metric.unit,
    direction: metric.direction,
    family: metric.family,
    northStar: metric.northStar === true,
    definition: metric.definition,
    current: current(metric),
    baseline: baseline(metric),
  }));
}
