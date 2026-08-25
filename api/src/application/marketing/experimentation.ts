/**
 * A/B tests and the customer journey (PRD 19 §9).
 *
 * ── TWO CAPABILITIES, ONE MODULE, AND WHY ───────────────────────────────────
 * An A/B test asks "which variant converts"; a journey asks "what did they touch
 * on the way". Both are attribution over the same visitor, and keeping them in one
 * module is what lets {@link variantResults} and {@link journeyFunnel} agree on
 * what a conversion IS. Two modules would eventually give the dashboard two
 * conversion counts for the same week, which is the failure mode BurnRateOS
 * actually had: `productManagement` owned the tests and `analytics` owned the
 * journeys, and neither knew about the other.
 *
 * ── WHY THIS IS NOT `experiments` ───────────────────────────────────────────
 * `experiments` sits four tables away in the same schema file and is deliberately
 * NOT this: its docstring says "a product bet rather than a traffic split — no
 * variants and no traffic allocation, a decision with a review date". An A/B test
 * has variants, an allocation and a stopping rule. Merging them is how a
 * qualitative bet acquires a fake p-value.
 *
 * ── TRAFFIC ALLOCATION IS VALIDATED, NOT ASSUMED ────────────────────────────
 * {@link setVariants} rejects an allocation that does not total 100 and rejects a
 * test with no control. Both are silent killers: allocation summing to 90 means a
 * tenth of traffic sees nothing and never appears in the denominator, and a test
 * with no control produces a lift figure against nothing.
 *
 * ── THE STOPPING RULE IS ENFORCED BY THE READ ───────────────────────────────
 * {@link variantResults} reports `underpowered: true` until every variant has
 * `minimum_sample` exposures, and reports the lift as null while it is. That is
 * the single most valuable thing this module does — the reason A/B testing goes
 * wrong in practice is that somebody reads the result on day two, and a service
 * that hands back a number on day two is complicit.
 *
 * ── ATTRIBUTION IS STORED PER TOUCHPOINT, NOT DERIVED ───────────────────────
 * `journey_touchpoints.attribution` is a weight the writer sets. First-touch,
 * last-touch and linear are different models and the choice belongs to whoever
 * records the touch; a service that picked one would silently overrule it.
 * {@link journeyFunnel} therefore SUMS the stored weights rather than counting
 * rows.
 */

import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  abTestSegments,
  abTestVariants,
  abTests,
  customerJourneys,
  journeyTouchpoints,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { recordActivity, type ActorIdentity } from '../activity/activityLog';

/** `ab_tests.status`. */
export const TEST_STATUSES = ['draft', 'running', 'stopped', 'concluded'] as const;
export type TestStatus = (typeof TEST_STATUSES)[number];

export const isTestStatus = (v: unknown): v is TestStatus =>
  typeof v === 'string' && (TEST_STATUSES as readonly string[]).includes(v);

export class ExperimentError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'ExperimentError';
  }
}

export type VariantInput = {
  key: string;
  name: string;
  isControl?: boolean;
  trafficPercent: number;
  payload?: unknown;
};

const requireKey = (k: string): string => {
  const s = k.trim().toLowerCase();
  if (!s || s.length > 96) throw new ExperimentError('key is required and must be 96 characters or fewer');
  return s;
};

// ── A/B tests ───────────────────────────────────────────────────────────────

export async function listTests(db: Db, tenantId: number, status?: TestStatus) {
  if (status !== undefined && !isTestStatus(status)) {
    throw new ExperimentError(`status must be one of: ${TEST_STATUSES.join(', ')}`);
  }
  return db
    .select({
      id: abTests.id,
      key: abTests.key,
      name: abTests.name,
      hypothesis: abTests.hypothesis,
      primaryMetric: abTests.primaryMetric,
      minimumSample: abTests.minimumSample,
      status: abTests.status,
      startedAt: abTests.startedAt,
      endedAt: abTests.endedAt,
      variantCount: sql<number>`(
        select count(*)::int from ${abTestVariants} where ${abTestVariants.testId} = ${abTests.id}
      )`,
    })
    .from(abTests)
    .where(scopedToTenant(abTests, tenantId, status ? eq(abTests.status, status) : undefined))
    .orderBy(desc(abTests.startedAt), desc(abTests.id));
}

export async function createTest(
  db: Db,
  tenantId: number,
  input: { key: string; name: string; hypothesis?: string | null; primaryMetric?: string | null; minimumSample?: number | null },
) {
  const key = requireKey(input.key);
  const [existing] = await db
    .select({ id: abTests.id })
    .from(abTests)
    .where(scopedToTenant(abTests, tenantId, eq(abTests.key, key)))
    .limit(1);
  if (existing) throw new ExperimentError(`a test already uses the key '${key}'`, 409);

  const [row] = await db
    .insert(abTests)
    .values({
      tenantId,
      key,
      name: input.name.trim().slice(0, 200),
      hypothesis: input.hypothesis ?? null,
      primaryMetric: input.primaryMetric ?? null,
      minimumSample: input.minimumSample ?? null,
      status: 'draft',
    })
    .returning();
  if (!row) throw new ExperimentError('could not create the test');
  return row;
}

/**
 * Replace a test's variants wholesale.
 *
 * Wholesale rather than per-variant, because the invariants are about the SET:
 * traffic must total 100 and exactly one variant must be the control. Editing one
 * variant at a time means passing through states where neither holds, and the
 * only way to forbid those is to never have them.
 *
 * Refuses once the test is running. Re-allocating traffic mid-flight invalidates
 * every exposure already counted, and silently doing so is how a test produces a
 * confident answer to a question nobody asked.
 */
export async function setVariants(
  db: Db,
  tenantId: number,
  testId: number,
  variants: VariantInput[],
) {
  const [test] = await db
    .select({ id: abTests.id, status: abTests.status })
    .from(abTests)
    .where(scopedToTenant(abTests, tenantId, eq(abTests.id, testId)))
    .limit(1);
  if (!test) throw new ExperimentError('test not found', 404);
  if (test.status === 'running') {
    throw new ExperimentError('a running test cannot be re-allocated — stop it first', 409);
  }
  if (variants.length < 2) throw new ExperimentError('a test needs at least two variants');

  const controls = variants.filter((v) => v.isControl);
  if (controls.length !== 1) {
    throw new ExperimentError('exactly one variant must be the control, or lift is measured against nothing');
  }

  const total = variants.reduce((n, v) => n + v.trafficPercent, 0);
  // Tolerance rather than exact equality: 33.33 x 3 is a legitimate split.
  if (Math.abs(total - 100) > 0.05) {
    throw new ExperimentError(`traffic must total 100%, got ${total}% — the remainder would see nothing and never reach the denominator`);
  }

  const keys = new Set(variants.map((v) => v.key.trim().toLowerCase()));
  if (keys.size !== variants.length) throw new ExperimentError('variant keys must be unique');

  return db.transaction(async (tx) => {
    await tx
      .delete(abTestVariants)
      .where(scopedToTenant(abTestVariants, tenantId, eq(abTestVariants.testId, testId)));
    return tx
      .insert(abTestVariants)
      .values(variants.map((v) => ({
        tenantId,
        testId,
        key: v.key.trim().toLowerCase().slice(0, 48),
        name: v.name.trim().slice(0, 160),
        isControl: v.isControl ?? false,
        trafficPercent: v.trafficPercent.toFixed(2),
        payload: v.payload ?? null,
      })))
      .returning();
  });
}

/** Add a targeting or exclusion rule. Exclusions exist so a test can say "not
 *  existing customers" without enumerating everyone else. */
export async function addSegment(
  db: Db,
  tenantId: number,
  testId: number,
  input: { name: string; rule: Record<string, unknown>; isExclusion?: boolean },
) {
  const [row] = await db
    .insert(abTestSegments)
    .values({
      tenantId,
      testId,
      name: input.name.trim().slice(0, 160),
      rule: input.rule,
      isExclusion: input.isExclusion ?? false,
    })
    .returning();
  if (!row) throw new ExperimentError('could not add the segment');
  return row;
}

export async function startTest(db: Db, env: Env, tenantId: number, actor: ActorIdentity, testId: number) {
  const variants = await db
    .select({ id: abTestVariants.id })
    .from(abTestVariants)
    .where(scopedToTenant(abTestVariants, tenantId, eq(abTestVariants.testId, testId)));
  if (variants.length < 2) throw new ExperimentError('set the variants before starting the test', 409);

  const [row] = await db
    .update(abTests)
    .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
    .where(scopedToTenant(abTests, tenantId, and(eq(abTests.id, testId), eq(abTests.status, 'draft'))))
    .returning();
  if (!row) throw new ExperimentError('only a draft test can be started', 409);

  await recordActivity(env, db, {
    tenantId, actor, verb: 'ab_test.started',
    targetType: 'ab_test', targetId: String(testId), metadata: { key: row.key },
  });
  return row;
}

export async function stopTest(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  testId: number,
  concluded: boolean,
) {
  const [row] = await db
    .update(abTests)
    .set({ status: concluded ? 'concluded' : 'stopped', endedAt: new Date(), updatedAt: new Date() })
    .where(scopedToTenant(abTests, tenantId, eq(abTests.id, testId)))
    .returning();
  if (!row) throw new ExperimentError('test not found', 404);

  await recordActivity(env, db, {
    tenantId, actor, verb: concluded ? 'ab_test.concluded' : 'ab_test.stopped',
    targetType: 'ab_test', targetId: String(testId), metadata: { key: row.key },
  });
  return row;
}

/** One exposure. Counter-only: an exposure is high-volume and belongs in the
 *  counter the result reads, not in the audit trail a person scrolls. */
export async function recordExposure(db: Db, tenantId: number, variantId: number) {
  await db
    .update(abTestVariants)
    .set({ exposureCount: sql`${abTestVariants.exposureCount} + 1` })
    .where(scopedToTenant(abTestVariants, tenantId, eq(abTestVariants.id, variantId)));
}

export async function recordConversion(db: Db, tenantId: number, variantId: number) {
  await db
    .update(abTestVariants)
    .set({ conversionCount: sql`${abTestVariants.conversionCount} + 1` })
    .where(scopedToTenant(abTestVariants, tenantId, eq(abTestVariants.id, variantId)));
}

/**
 * The result, and whether it is allowed to be read yet.
 *
 * `underpowered` is the point. Until every variant has `minimum_sample`
 * exposures, `lift` and `winner` come back null — not a small number, null. A
 * service that returns a lift on day two is why A/B testing has the reputation it
 * has; refusing to is the single most useful thing this function does.
 *
 * When `minimum_sample` is unset the test is underpowered by definition: nobody
 * declared what "enough" means, so nothing can be enough.
 */
export async function variantResults(db: Db, tenantId: number, testId: number) {
  const [test] = await db
    .select()
    .from(abTests)
    .where(scopedToTenant(abTests, tenantId, eq(abTests.id, testId)))
    .limit(1);
  if (!test) throw new ExperimentError('test not found', 404);

  const variants = await db
    .select()
    .from(abTestVariants)
    .where(scopedToTenant(abTestVariants, tenantId, eq(abTestVariants.testId, testId)))
    .orderBy(desc(abTestVariants.isControl), asc(abTestVariants.key));

  const rows = variants.map((v) => ({
    id: v.id,
    key: v.key,
    name: v.name,
    isControl: v.isControl,
    trafficPercent: Number(v.trafficPercent),
    exposures: v.exposureCount,
    conversions: v.conversionCount,
    rate: v.exposureCount > 0 ? v.conversionCount / v.exposureCount : null,
  }));

  const minimum = test.minimumSample;
  const underpowered = minimum === null || rows.some((r) => r.exposures < minimum);
  const control = rows.find((r) => r.isControl) ?? null;

  return {
    test: { id: test.id, key: test.key, name: test.name, status: test.status, primaryMetric: test.primaryMetric, minimumSample: minimum },
    variants: rows.map((r) => ({
      ...r,
      // Null while underpowered, and null against a control that has no rate.
      lift: underpowered || !control || control.rate === null || r.rate === null || control.rate === 0
        ? null
        : (r.rate - control.rate) / control.rate,
    })),
    underpowered,
    // A winner is a claim, and a claim needs the sample it was promised.
    winner: underpowered ? null : rows.reduce<typeof rows[number] | null>(
      (best, r) => (r.rate !== null && (best === null || best.rate === null || r.rate > best.rate) ? r : best),
      null,
    )?.key ?? null,
    reason: underpowered
      ? (minimum === null
        ? 'No minimum sample was declared, so no result can be called.'
        : 'At least one variant has not reached the declared minimum sample.')
      : null,
  };
}

// ── Customer journeys ───────────────────────────────────────────────────────

export async function listJourneys(db: Db, tenantId: number) {
  return db
    .select()
    .from(customerJourneys)
    .where(scopedToTenant(customerJourneys, tenantId))
    .orderBy(desc(customerJourneys.isActive), asc(customerJourneys.name));
}

export async function createJourney(
  db: Db,
  tenantId: number,
  input: { name: string; persona?: string | null; stages: string[]; description?: string | null },
) {
  if (input.stages.length === 0) {
    throw new ExperimentError('a journey needs at least one stage — the stages ARE the funnel');
  }
  const [row] = await db
    .insert(customerJourneys)
    .values({
      tenantId,
      name: input.name.trim().slice(0, 200),
      persona: input.persona ?? null,
      stages: input.stages,
      description: input.description ?? null,
    })
    .returning();
  if (!row) throw new ExperimentError('could not create the journey');
  return row;
}

/**
 * Record a touch.
 *
 * `attribution` is supplied by the CALLER, not computed here — first-touch,
 * last-touch and linear are different models and the choice belongs to whoever
 * records the touch. Defaulting it to 1 would silently impose a "every touch gets
 * full credit" model that sums to more than one conversion per conversion.
 */
export async function recordTouchpoint(
  db: Db,
  tenantId: number,
  input: {
    journeyId: number;
    stage: string;
    subjectRef?: string | null;
    visitorId?: string | null;
    channel?: string | null;
    label?: string | null;
    attribution?: number | null;
    occurredAt?: Date;
  },
) {
  if (!input.subjectRef && !input.visitorId) {
    throw new ExperimentError('a touchpoint needs a subjectRef or a visitorId, or it belongs to nobody');
  }
  const [row] = await db
    .insert(journeyTouchpoints)
    .values({
      tenantId,
      journeyId: input.journeyId,
      subjectRef: input.subjectRef ?? null,
      visitorId: input.visitorId ?? null,
      stage: input.stage,
      channel: input.channel ?? null,
      label: input.label ?? null,
      attribution: input.attribution === null || input.attribution === undefined ? null : String(input.attribution),
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    })
    .returning();
  if (!row) throw new ExperimentError('could not record the touchpoint');
  return row;
}

/**
 * The funnel: how many distinct people reached each stage, and how much
 * attributed credit each stage carries.
 *
 * People are counted DISTINCT on the subject, because one person touching a stage
 * four times is one person who reached it — counting rows turns a chatty channel
 * into a wide funnel. Credit is SUMMED from the stored weights, for the reason in
 * the module docstring.
 */
export async function journeyFunnel(db: Db, tenantId: number, journeyId: number) {
  const [journey] = await db
    .select()
    .from(customerJourneys)
    .where(scopedToTenant(customerJourneys, tenantId, eq(customerJourneys.id, journeyId)))
    .limit(1);
  if (!journey) throw new ExperimentError('journey not found', 404);

  const reached = await db
    .select({
      stage: journeyTouchpoints.stage,
      people: sql<number>`count(distinct coalesce(${journeyTouchpoints.subjectRef}, ${journeyTouchpoints.visitorId}))::int`,
      touches: sql<number>`count(*)::int`,
      credit: sql<number>`coalesce(sum(${journeyTouchpoints.attribution}), 0)::float8`,
    })
    .from(journeyTouchpoints)
    .where(scopedToTenant(journeyTouchpoints, tenantId, eq(journeyTouchpoints.journeyId, journeyId)))
    .groupBy(journeyTouchpoints.stage);

  const byStage = new Map(reached.map((r) => [r.stage, r]));
  const stages = (journey.stages as string[]) ?? [];

  // Ordered by the journey's OWN stage list, so a stage nobody has reached still
  // appears — a funnel with the empty step missing is a funnel that looks fine.
  return {
    journey: { id: journey.id, name: journey.name, persona: journey.persona },
    stages: stages.map((stage) => byStage.get(stage) ?? { stage, people: 0, touches: 0, credit: 0 }),
  };
}

/** Which channels actually earn credit. Summed attribution rather than touch
 *  count, so a channel that touches everyone and converts nobody ranks last. */
export async function channelAttribution(db: Db, tenantId: number, journeyId?: number) {
  return db
    .select({
      channel: journeyTouchpoints.channel,
      touches: sql<number>`count(*)::int`,
      people: sql<number>`count(distinct coalesce(${journeyTouchpoints.subjectRef}, ${journeyTouchpoints.visitorId}))::int`,
      credit: sql<number>`coalesce(sum(${journeyTouchpoints.attribution}), 0)::float8`,
    })
    .from(journeyTouchpoints)
    .where(scopedToTenant(
      journeyTouchpoints,
      tenantId,
      journeyId ? eq(journeyTouchpoints.journeyId, journeyId) : undefined,
    ))
    .groupBy(journeyTouchpoints.channel)
    .orderBy(desc(sql`coalesce(sum(${journeyTouchpoints.attribution}), 0)`));
}
