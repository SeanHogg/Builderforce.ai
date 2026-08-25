/**
 * The CFO's what-if engine — scenarios, assumptions, Monte Carlo, payback, ROI
 * (PRD 19 §9).
 *
 * ── WHY THIS IS NET-NEW RATHER THAN A MERGE ─────────────────────────────────
 * PRD 19 §4 calls B1 "mostly net-new — merges only with FinOps", and the survey
 * bears that out: Builderforce's four finance-adjacent owners are each a
 * different, narrower job. `forecastRoutes` is an anomaly lens over existing
 * rollups, `roiRoutes` is a spend rollup that explicitly stores nothing,
 * `costForecastRoutes` predicts LLM tokens before a run, and `finopsRoutes` is
 * DevFinOps. None of them models a BUSINESS scenario, and none of them owns an
 * assumption. BurnRateOS's `breakEven`, `forecasting` and `predictiveAnalytics`
 * modules did, against schema Builderforce already had and never read.
 *
 * So this is the BurnRateOS capability on the Builderforce shape — and the
 * Builderforce shape is materially better, which is the reason not to port:
 * `forecast_scenarios`, `what_if_scenarios` and `validation_scenarios` were three
 * BurnRateOS tables that collapsed into `break_even_scenarios.kind`. The three
 * BurnRateOS modules could not compare a forecast with a what-if because they
 * were different tables; here they differ by one column and
 * {@link compareScenarios} is a single query.
 *
 * ── ASSUMPTIONS ARE DECLARED, NOT COMPUTED FROM A LEDGER ────────────────────
 * Every number that goes into a scenario is a `scenario_assumptions` row with a
 * `role` of `given`. That is not a limitation to be fixed later — it is the
 * Claim-to-Proof position: **no accounting adapter has run against live
 * production data**, so nothing here may be described as computed from anyone's
 * books. {@link scenarioProvenance} returns that fact with every scenario so a
 * surface cannot render one without it.
 *
 * ── THE BASELINE IS EXCLUSIVE, AND ENFORCED BY THE WRITER ───────────────────
 * `is_baseline` has no unique index, so "exactly one baseline per tenant" has to
 * be a property of {@link setBaseline}: it clears the flag and sets it in one
 * transaction. Two baselines is not a harmless data smell — every comparison in
 * this module is against the baseline, so a second one silently makes half the
 * comparisons meaningless.
 *
 * ── MONTE CARLO VARIES ONLY `sensitivity` ASSUMPTIONS ───────────────────────
 * `scenario_assumptions.role` already declares which inputs are uncertain.
 * {@link runMonteCarlo} varies exactly those and holds `given` fixed, which is
 * what makes a run reproducible from `(scenario, seed)` — recorded on the row, so
 * a result can be re-derived rather than merely believed.
 */

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  breakEvenScenarios,
  monteCarloSimulations,
  paybackPeriod,
  roiTimelineEntries,
  savedCalculations,
  scenarioAssumptions,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { recordActivity, type ActorIdentity } from '../activity/activityLog';
import { registerObject } from '../kernel/ObjectRegistry';

/** `break_even_scenarios.kind` — the column that replaced three tables. */
export const SCENARIO_KINDS = ['break_even', 'forecast', 'what_if', 'validation'] as const;
export type ScenarioKind = (typeof SCENARIO_KINDS)[number];

/** `scenario_assumptions.role`. `sensitivity` is the one a Monte Carlo run varies;
 *  `derived` is computed from others and must not be edited directly. */
export const ASSUMPTION_ROLES = ['given', 'derived', 'sensitivity'] as const;
export type AssumptionRole = (typeof ASSUMPTION_ROLES)[number];

export const isScenarioKind = (v: unknown): v is ScenarioKind =>
  typeof v === 'string' && (SCENARIO_KINDS as readonly string[]).includes(v);
export const isAssumptionRole = (v: unknown): v is AssumptionRole =>
  typeof v === 'string' && (ASSUMPTION_ROLES as readonly string[]).includes(v);

/**
 * What every scenario read carries.
 *
 * `declared` is the ONLY honest value today and flipping it is a decision, not an
 * edit: PRD 19 and the ROADMAP's Claim-to-Proof gate both record that no
 * accounting adapter has run against live production data. A surface that renders
 * a scenario is expected to render this beside it.
 */
export const SCENARIO_PROVENANCE = 'declared' as const;

export class ScenarioError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'ScenarioError';
  }
}

const requireName = (n: string): string => {
  const s = n.trim();
  if (!s) throw new ScenarioError('name is required');
  return s.slice(0, 200);
};

/** `numeric` columns round-trip as strings in Drizzle. Converting in one place
 *  keeps every call site from inventing its own precision. */
const dec = (n: number | null | undefined): string | null =>
  n === null || n === undefined ? null : String(n);
const numOf = (v: string | null): number | null => (v === null ? null : Number(v));

// ── Scenarios ───────────────────────────────────────────────────────────────

export type ScenarioInput = {
  name: string;
  kind?: ScenarioKind;
  description?: string | null;
  horizonMonths?: number;
};

export async function listScenarios(db: Db, tenantId: number, kind?: ScenarioKind) {
  return db
    .select({
      id: breakEvenScenarios.id,
      objectId: breakEvenScenarios.objectId,
      kind: breakEvenScenarios.kind,
      name: breakEvenScenarios.name,
      description: breakEvenScenarios.description,
      horizonMonths: breakEvenScenarios.horizonMonths,
      breakEvenAt: breakEvenScenarios.breakEvenAt,
      status: breakEvenScenarios.status,
      isBaseline: breakEvenScenarios.isBaseline,
      updatedAt: breakEvenScenarios.updatedAt,
      assumptionCount: sql<number>`(
        select count(*)::int from ${scenarioAssumptions}
        where ${scenarioAssumptions.scenarioId} = ${breakEvenScenarios.id}
      )`,
    })
    .from(breakEvenScenarios)
    .where(scopedToTenant(breakEvenScenarios, tenantId, kind ? eq(breakEvenScenarios.kind, kind) : undefined))
    .orderBy(desc(breakEvenScenarios.isBaseline), desc(breakEvenScenarios.updatedAt));
}

/** One scenario, its assumptions and its runs — everything a modelling panel
 *  needs, in three queries rather than one per assumption. */
export async function scenarioDetail(db: Db, tenantId: number, id: number) {
  const [scenario] = await db
    .select()
    .from(breakEvenScenarios)
    .where(scopedToTenant(breakEvenScenarios, tenantId, eq(breakEvenScenarios.id, id)))
    .limit(1);
  if (!scenario) throw new ScenarioError('scenario not found', 404);

  const [assumptions, runs] = await Promise.all([
    db.select().from(scenarioAssumptions)
      .where(scopedToTenant(scenarioAssumptions, tenantId, eq(scenarioAssumptions.scenarioId, id)))
      .orderBy(asc(scenarioAssumptions.key)),
    db.select().from(monteCarloSimulations)
      .where(scopedToTenant(monteCarloSimulations, tenantId, eq(monteCarloSimulations.scenarioId, id)))
      .orderBy(desc(monteCarloSimulations.runAt)),
  ]);

  return { ...scenario, assumptions, runs, provenance: SCENARIO_PROVENANCE };
}

/** The provenance of every number in this module, stated rather than implied. */
export function scenarioProvenance() {
  return {
    basis: SCENARIO_PROVENANCE,
    note: 'Every input is an assumption somebody entered. No accounting adapter has run against '
      + 'live production data, so nothing here is computed from your ledger.',
  };
}

export async function createScenario(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  input: ScenarioInput,
) {
  const name = requireName(input.name);
  const kind = input.kind ?? 'break_even';
  if (!isScenarioKind(kind)) throw new ScenarioError(`kind must be one of: ${SCENARIO_KINDS.join(', ')}`);

  const [inserted] = await db
    .insert(breakEvenScenarios)
    .values({
      tenantId,
      kind,
      name,
      description: input.description ?? null,
      horizonMonths: input.horizonMonths ?? 12,
      status: 'draft',
    })
    .returning();
  if (!inserted) throw new ScenarioError('could not create the scenario');

  const registered = await registerObject(db, env, {
    tenantId, kind: 'scenario', refId: inserted.id, domain: 'finance', title: name,
  });
  const [row] = await db
    .update(breakEvenScenarios)
    .set({ objectId: registered.id, updatedAt: new Date() })
    .where(scopedToTenant(breakEvenScenarios, tenantId, eq(breakEvenScenarios.id, inserted.id)))
    .returning();
  if (!row) throw new ScenarioError('could not create the scenario');

  await recordActivity(env, db, {
    tenantId, actor, verb: 'scenario.created',
    targetType: 'scenario', targetId: String(row.id), objectId: registered.id,
    metadata: { kind, name },
  });
  return row;
}

/**
 * Make this the baseline, and unmake the previous one.
 *
 * One transaction, because every comparison in this module is against "the"
 * baseline. Two baselines does not fail loudly — it silently halves the meaning
 * of every comparison, which is the worst kind of wrong.
 */
export async function setBaseline(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  id: number,
) {
  const row = await db.transaction(async (tx) => {
    await tx
      .update(breakEvenScenarios)
      .set({ isBaseline: false, updatedAt: new Date() })
      .where(scopedToTenant(breakEvenScenarios, tenantId, eq(breakEvenScenarios.isBaseline, true)));
    const [updated] = await tx
      .update(breakEvenScenarios)
      .set({ isBaseline: true, updatedAt: new Date() })
      .where(scopedToTenant(breakEvenScenarios, tenantId, eq(breakEvenScenarios.id, id)))
      .returning();
    return updated;
  });
  if (!row) throw new ScenarioError('scenario not found', 404);

  await recordActivity(env, db, {
    tenantId, actor, verb: 'scenario.baseline_set',
    targetType: 'scenario', targetId: String(id), metadata: { name: row.name },
  });
  return row;
}

/**
 * Compare scenarios against the baseline, assumption by assumption.
 *
 * The comparison a board asks for is never "what do these two say" — it is "what
 * did we CHANGE to get there". So this returns the per-key delta rather than two
 * columns of numbers, and a key present in one scenario and absent from the other
 * is reported as such rather than treated as zero: an assumption nobody made and
 * an assumption set to nothing are different statements.
 */
export async function compareScenarios(db: Db, tenantId: number, ids: number[]) {
  if (ids.length === 0) return { baseline: null, scenarios: [], keys: [] };

  const [baseline] = await db
    .select()
    .from(breakEvenScenarios)
    .where(scopedToTenant(breakEvenScenarios, tenantId, eq(breakEvenScenarios.isBaseline, true)))
    .limit(1);

  const wanted = baseline ? [...new Set([baseline.id, ...ids])] : ids;
  const [scenarios, assumptions] = await Promise.all([
    db.select().from(breakEvenScenarios)
      .where(scopedToTenant(breakEvenScenarios, tenantId, inArray(breakEvenScenarios.id, wanted))),
    db.select().from(scenarioAssumptions)
      .where(scopedToTenant(scenarioAssumptions, tenantId, inArray(scenarioAssumptions.scenarioId, wanted))),
  ]);

  const byScenario = new Map<number, Map<string, number | null>>();
  for (const a of assumptions) {
    if (a.scenarioId === null) continue;
    if (!byScenario.has(a.scenarioId)) byScenario.set(a.scenarioId, new Map());
    byScenario.get(a.scenarioId)!.set(a.key, numOf(a.value));
  }

  const keys = [...new Set(assumptions.map((a) => a.key))].sort();
  const base = baseline ? byScenario.get(baseline.id) : undefined;

  return {
    baseline: baseline ?? null,
    provenance: SCENARIO_PROVENANCE,
    scenarios: scenarios.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      isBaseline: s.isBaseline,
      assumptions: keys.map((k) => {
        const mine = byScenario.get(s.id)?.get(k);
        const theirs = base?.get(k);
        const present = byScenario.get(s.id)?.has(k) ?? false;
        return {
          key: k,
          present,
          value: present ? mine ?? null : null,
          // null, not 0: "not stated" and "stated as no change" are different.
          delta: present && mine !== null && mine !== undefined && theirs !== null && theirs !== undefined
            ? mine - theirs
            : null,
        };
      }),
    })),
    keys,
  };
}

// ── Assumptions ─────────────────────────────────────────────────────────────

export type AssumptionInput = {
  key: string;
  label?: string | null;
  value?: number | null;
  unit?: string | null;
  role?: AssumptionRole;
  minValue?: number | null;
  maxValue?: number | null;
  note?: string | null;
};

/**
 * Set one assumption. Upserts on (scenario, key) because re-modelling is editing
 * the same assumption, not adding another one with the same name.
 *
 * A `sensitivity` assumption must carry a range — that is what makes it varyable,
 * and a sensitivity row without one is a `given` row that a Monte Carlo run will
 * silently treat as fixed while the surface shows it as uncertain.
 */
export async function setAssumption(
  db: Db,
  tenantId: number,
  scenarioId: number,
  input: AssumptionInput,
) {
  const key = input.key.trim();
  if (!key) throw new ScenarioError('key is required');
  const role = input.role ?? 'given';
  if (!isAssumptionRole(role)) throw new ScenarioError(`role must be one of: ${ASSUMPTION_ROLES.join(', ')}`);
  if (role === 'sensitivity' && (input.minValue === undefined || input.maxValue === undefined
    || input.minValue === null || input.maxValue === null)) {
    throw new ScenarioError('a sensitivity assumption needs both minValue and maxValue');
  }
  if (role === 'sensitivity' && Number(input.minValue) > Number(input.maxValue)) {
    throw new ScenarioError('minValue must not exceed maxValue');
  }

  const [scenario] = await db
    .select({ id: breakEvenScenarios.id })
    .from(breakEvenScenarios)
    .where(scopedToTenant(breakEvenScenarios, tenantId, eq(breakEvenScenarios.id, scenarioId)))
    .limit(1);
  if (!scenario) throw new ScenarioError('scenario not found', 404);

  const [row] = await db
    .insert(scenarioAssumptions)
    .values({
      tenantId,
      scenarioId,
      key: key.slice(0, 96),
      label: input.label ?? null,
      value: dec(input.value),
      unit: input.unit ?? null,
      role,
      minValue: dec(input.minValue),
      maxValue: dec(input.maxValue),
      note: input.note ?? null,
    })
    .onConflictDoUpdate({
      target: [scenarioAssumptions.scenarioId, scenarioAssumptions.key],
      set: {
        label: input.label ?? null,
        value: dec(input.value),
        unit: input.unit ?? null,
        role,
        minValue: dec(input.minValue),
        maxValue: dec(input.maxValue),
        note: input.note ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) throw new ScenarioError('could not set the assumption');
  return row;
}

export async function deleteAssumption(db: Db, tenantId: number, scenarioId: number, key: string) {
  const [row] = await db
    .delete(scenarioAssumptions)
    .where(scopedToTenant(scenarioAssumptions, tenantId, and(
      eq(scenarioAssumptions.scenarioId, scenarioId),
      eq(scenarioAssumptions.key, key),
    )))
    .returning({ id: scenarioAssumptions.id });
  if (!row) throw new ScenarioError('assumption not found', 404);
  return { deleted: key };
}

// ── Break-even, computed from the declared assumptions ──────────────────────

/**
 * Project the scenario month by month and find where cumulative profit turns
 * positive.
 *
 * The arithmetic is deliberately the textbook one and deliberately visible:
 * contribution margin per unit, fixed costs per month, growth applied to units.
 * A financial model whose method is hidden inside an LLM call is a model nobody
 * can defend to an investor, and defending it is the entire use case.
 *
 * Returns `breakEvenMonth: null` when it never breaks even inside the horizon —
 * not the horizon, and not zero. "It does not, within a year" is the answer, and
 * rounding it to the edge of the window hides exactly the scenarios worth seeing.
 */
export async function computeBreakEven(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  scenarioId: number,
) {
  const detail = await scenarioDetail(db, tenantId, scenarioId);
  const at = (key: string): number | null => {
    const found = detail.assumptions.find((a) => a.key === key);
    return found ? numOf(found.value) : null;
  };

  const fixedMonthly = at('fixed_costs_monthly') ?? 0;
  const pricePerUnit = at('price_per_unit') ?? 0;
  const variablePerUnit = at('variable_cost_per_unit') ?? 0;
  const startingUnits = at('starting_units') ?? 0;
  const monthlyGrowth = at('monthly_growth_rate') ?? 0;

  const contribution = pricePerUnit - variablePerUnit;
  if (contribution <= 0) {
    throw new ScenarioError(
      'price_per_unit must exceed variable_cost_per_unit, or the scenario never breaks even at any volume',
      409,
    );
  }

  const horizon = detail.horizonMonths;
  const months: { month: number; units: number; revenue: number; cost: number; profit: number; cumulative: number }[] = [];
  let cumulative = 0;
  let breakEvenMonth: number | null = null;
  let units = startingUnits;

  for (let m = 1; m <= horizon; m += 1) {
    const revenue = units * pricePerUnit;
    const cost = fixedMonthly + units * variablePerUnit;
    const profit = revenue - cost;
    cumulative += profit;
    months.push({ month: m, units, revenue, cost, profit, cumulative });
    if (breakEvenMonth === null && cumulative >= 0 && m > 0) breakEvenMonth = m;
    units = units * (1 + monthlyGrowth);
  }

  const unitsToBreakEven = Math.ceil(fixedMonthly / contribution);

  const [row] = await db
    .update(breakEvenScenarios)
    .set({
      projections: { months, unitsToBreakEven, contributionMargin: contribution },
      // Stored as a date only when it actually happens inside the horizon.
      breakEvenAt: breakEvenMonth === null ? null : monthsFromNow(breakEvenMonth),
      status: 'computed',
      updatedAt: new Date(),
    })
    .where(scopedToTenant(breakEvenScenarios, tenantId, eq(breakEvenScenarios.id, scenarioId)))
    .returning();
  if (!row) throw new ScenarioError('scenario not found', 404);

  await recordActivity(env, db, {
    tenantId, actor, verb: 'scenario.computed',
    targetType: 'scenario', targetId: String(scenarioId),
    metadata: { breakEvenMonth, unitsToBreakEven, horizon },
  });

  return {
    scenarioId,
    provenance: SCENARIO_PROVENANCE,
    contributionMargin: contribution,
    unitsToBreakEven,
    breakEvenMonth,
    months,
  };
}

/** A date `n` months out, used only to stamp `break_even_at`. Kept as a helper so
 *  the month arithmetic has one implementation rather than one per caller. */
function monthsFromNow(n: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d;
}

// ── Monte Carlo ─────────────────────────────────────────────────────────────

/**
 * Vary the `sensitivity` assumptions and report the distribution.
 *
 * Seeded and reproducible: the seed is stored on the row, so a percentile a board
 * was shown can be re-derived rather than merely believed. The generator is a
 * small deterministic LCG for exactly that reason — `Math.random()` would make
 * every run unrepeatable and the stored `seed` a lie.
 *
 * Refuses to run when nothing is marked `sensitivity`: a Monte Carlo over zero
 * uncertain inputs returns the point estimate ten thousand times, which looks
 * like a tight distribution and is actually no simulation at all.
 */
export async function runMonteCarlo(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  scenarioId: number,
  options: { iterations?: number; seed?: number } = {},
) {
  const detail = await scenarioDetail(db, tenantId, scenarioId);
  const varying = detail.assumptions.filter((a) => a.role === 'sensitivity');
  if (varying.length === 0) {
    throw new ScenarioError(
      'no assumption is marked `sensitivity`, so there is nothing to vary — mark the uncertain inputs first',
      409,
    );
  }

  const iterations = Math.min(Math.max(options.iterations ?? 10_000, 100), 100_000);
  const seed = options.seed ?? 42;
  const started = Date.now();

  const fixed = new Map<string, number>();
  for (const a of detail.assumptions) {
    if (a.role !== 'sensitivity') fixed.set(a.key, numOf(a.value) ?? 0);
  }

  let state = seed >>> 0;
  const next = (): number => {
    // Numerical Recipes LCG. Deterministic from `seed`, which is what makes the
    // stored seed meaningful.
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };

  const results: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const draw = new Map(fixed);
    for (const a of varying) {
      const lo = numOf(a.minValue) ?? 0;
      const hi = numOf(a.maxValue) ?? 0;
      draw.set(a.key, lo + next() * (hi - lo));
    }
    const price = draw.get('price_per_unit') ?? 0;
    const variable = draw.get('variable_cost_per_unit') ?? 0;
    const fixedMonthly = draw.get('fixed_costs_monthly') ?? 0;
    const units = draw.get('starting_units') ?? 0;
    results.push(units * (price - variable) - fixedMonthly);
  }
  results.sort((a, b) => a - b);

  const at = (p: number): number => results[Math.min(results.length - 1, Math.floor((p / 100) * results.length))] ?? 0;
  const percentiles = { p5: at(5), p25: at(25), p50: at(50), p75: at(75), p95: at(95) };

  const buckets = 20;
  const lo = results[0] ?? 0;
  const hi = results[results.length - 1] ?? 0;
  const width = hi === lo ? 1 : (hi - lo) / buckets;
  const histogram = Array.from({ length: buckets }, (_, i) => ({
    from: lo + i * width,
    to: lo + (i + 1) * width,
    count: 0,
  }));
  for (const r of results) {
    const idx = Math.min(buckets - 1, Math.max(0, Math.floor((r - lo) / width)));
    const bucket = histogram[idx];
    if (bucket) bucket.count += 1;
  }

  const [row] = await db
    .insert(monteCarloSimulations)
    .values({
      tenantId,
      scenarioId,
      iterations,
      seed,
      percentiles,
      histogram,
      runAt: new Date(),
      durationMs: Date.now() - started,
    })
    .returning();
  if (!row) throw new ScenarioError('could not record the simulation');

  await recordActivity(env, db, {
    tenantId, actor, verb: 'scenario.simulated',
    targetType: 'scenario', targetId: String(scenarioId),
    metadata: { iterations, seed, varied: varying.length },
  });

  return { ...row, provenance: SCENARIO_PROVENANCE, probabilityOfProfit: results.filter((r) => r > 0).length / results.length };
}

// ── Payback and ROI ─────────────────────────────────────────────────────────

/**
 * Stamp how long an investment takes to pay for itself.
 *
 * `payback_months` is null when the monthly return is zero or negative, not
 * Infinity and not a large number: "it does not pay back" is a real answer and a
 * sentinel value is one that eventually gets averaged.
 */
export async function stampPayback(
  db: Db,
  tenantId: number,
  subject: { kind: string; ref: string },
  investment: number,
  monthlyReturn: number | null,
  currency = 'USD',
) {
  const months = monthlyReturn !== null && monthlyReturn > 0 ? investment / monthlyReturn : null;

  const existing = await db
    .select({ id: paybackPeriod.id })
    .from(paybackPeriod)
    .where(scopedToTenant(paybackPeriod, tenantId, and(
      eq(paybackPeriod.subjectKind, subject.kind),
      eq(paybackPeriod.subjectRef, subject.ref),
    )))
    .limit(1);

  const values = {
    tenantId,
    subjectKind: subject.kind,
    subjectRef: subject.ref,
    investment: String(investment),
    monthlyReturn: dec(monthlyReturn),
    paybackMonths: months === null ? null : months.toFixed(2),
    currency,
    computedAt: new Date(),
  };

  const first = existing[0];
  const [row] = first
    ? await db.update(paybackPeriod).set(values)
      .where(scopedToTenant(paybackPeriod, tenantId, eq(paybackPeriod.id, first.id))).returning()
    : await db.insert(paybackPeriod).values(values).returning();
  if (!row) throw new ScenarioError('could not stamp the payback period');
  return row;
}

/**
 * Append a period to a subject's ROI timeline and roll the cumulative forward.
 *
 * `cumulative` is stored rather than summed on read because the timeline is
 * append-only and the running total is what every chart plots — recomputing it on
 * every read turns a chart into an O(n) scan, and back-dating a correction then
 * silently rewrites every later point.
 */
export async function recordRoiPeriod(
  db: Db,
  tenantId: number,
  subject: { kind: string; ref: string },
  periodAt: Date,
  cost: number,
  benefit: number,
  currency = 'USD',
  note: string | null = null,
) {
  const [prior] = await db
    .select({ cumulative: roiTimelineEntries.cumulative })
    .from(roiTimelineEntries)
    .where(scopedToTenant(roiTimelineEntries, tenantId, and(
      eq(roiTimelineEntries.subjectKind, subject.kind),
      eq(roiTimelineEntries.subjectRef, subject.ref),
      sql`${roiTimelineEntries.periodAt} < ${periodAt}`,
    )))
    .orderBy(desc(roiTimelineEntries.periodAt))
    .limit(1);

  const running = (numOf(prior?.cumulative ?? null) ?? 0) + benefit - cost;

  const [row] = await db
    .insert(roiTimelineEntries)
    .values({
      tenantId,
      subjectKind: subject.kind,
      subjectRef: subject.ref,
      periodAt,
      cost: String(cost),
      benefit: String(benefit),
      cumulative: String(running),
      currency,
      note,
    })
    .onConflictDoUpdate({
      target: [roiTimelineEntries.tenantId, roiTimelineEntries.subjectKind, roiTimelineEntries.subjectRef, roiTimelineEntries.periodAt],
      set: { cost: String(cost), benefit: String(benefit), cumulative: String(running), note },
    })
    .returning();
  if (!row) throw new ScenarioError('could not record the ROI period');
  return row;
}

/** The timeline and its payback stamp — the two halves of "was this worth it". */
export async function roiFor(db: Db, tenantId: number, subject: { kind: string; ref: string }) {
  const [timeline, payback] = await Promise.all([
    db.select().from(roiTimelineEntries)
      .where(scopedToTenant(roiTimelineEntries, tenantId, and(
        eq(roiTimelineEntries.subjectKind, subject.kind),
        eq(roiTimelineEntries.subjectRef, subject.ref),
      )))
      .orderBy(asc(roiTimelineEntries.periodAt)),
    db.select().from(paybackPeriod)
      .where(scopedToTenant(paybackPeriod, tenantId, and(
        eq(paybackPeriod.subjectKind, subject.kind),
        eq(paybackPeriod.subjectRef, subject.ref),
      )))
      .limit(1),
  ]);
  return { subject, timeline, payback: payback[0] ?? null, provenance: SCENARIO_PROVENANCE };
}

// ── Saved calculations ──────────────────────────────────────────────────────

/**
 * A named, reusable calculation — the free-tools half of BurnRateOS's
 * `freeTools` module, which is the only place its `saved_calculations` rows came
 * from.
 *
 * The `formula` is stored as TEXT and is not evaluated here. That is deliberate:
 * evaluating caller-supplied expressions server-side is an execution sink, and
 * the value that matters — `result` — is supplied by whoever computed it, with
 * the formula kept beside it so the number can be checked rather than trusted.
 */
export async function saveCalculation(
  db: Db,
  tenantId: number,
  input: { name: string; formula: string; inputs?: unknown; result?: number | null; unit?: string | null; ownerRef?: string | null },
) {
  const [row] = await db
    .insert(savedCalculations)
    .values({
      tenantId,
      name: requireName(input.name),
      formula: input.formula,
      inputs: input.inputs ?? null,
      result: dec(input.result),
      unit: input.unit ?? null,
      ownerRef: input.ownerRef ?? null,
      computedAt: input.result === null || input.result === undefined ? null : new Date(),
    })
    .returning();
  if (!row) throw new ScenarioError('could not save the calculation');
  return row;
}

export async function listCalculations(db: Db, tenantId: number, ownerRef?: string) {
  return db
    .select()
    .from(savedCalculations)
    .where(scopedToTenant(savedCalculations, tenantId, ownerRef ? eq(savedCalculations.ownerRef, ownerRef) : undefined))
    .orderBy(desc(savedCalculations.updatedAt));
}

export async function deleteCalculation(db: Db, tenantId: number, id: number) {
  const [row] = await db
    .delete(savedCalculations)
    .where(scopedToTenant(savedCalculations, tenantId, eq(savedCalculations.id, id)))
    .returning({ id: savedCalculations.id });
  if (!row) throw new ScenarioError('calculation not found', 404);
  return { deleted: id };
}
