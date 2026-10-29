import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Learned Model Routing (PRD 13, §4.1/§5.3) — the routing-table KV blob.
 *
 * THE decision artifact. A compact JSON blob per scope (`project:<id>`, `tenant:<id>`,
 * `global`) ranking, per action type, the models that have empirically scored best.
 * It is what makes routing O(1) and DB-free on the hot path:
 *
 *   • READ  (router + analytics): `getRoutingTable` → `getOrSetCached` (L1 Map → L2
 *     KV). SQL only on a cold miss (the reconcile rebuilds the blob).
 *   • WRITE (each terminal run): `applyOutcomeToRoutingTable` does ONE read-modify-
 *     write of the affected scope blobs, updating the running n / avgScore / avgCost
 *     / mergeRate via Welford — NO table scan.
 *
 * The durable `run_model_outcomes` table is the source of truth; this blob is a
 * derived cache. A periodic/triggered reconcile (`reconcileRoutingTable`) rebuilds a
 * blob from a single grouped query — also the cold-start backfill and drift repair.
 * Losing the blob costs one reconcile, never correctness.
 */

import { and, eq, gte, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, peekCached, setCached } from '../../infrastructure/cache/readThroughCache';
import { llmActionRatings, runModelOutcomes } from '../../infrastructure/database/schema';
import { runTelemetryDatabase } from '../shared/runTelemetryDatabase';
import { codingEvidence } from '../shared/codingEvidence';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import {
  DECAYED_WINDOW_DAYS,
  DEFAULT_MIN_SAMPLES,
  ROUTING_HALF_LIFE_DAYS,
  learnedRoutingEnabled,
  normalizeActionType,
  parseScopeToken,
  scopeHasSignal,
  scopeToken,
  type ActionType,
  type RoutingScope,
} from '@builderforce/learned-routing';
import { isModelRole, type ModelRole } from '@builderforce/agent-tools';
import { roleUsesLearnedRanking } from '@builderforce/model-router';
import type { ArcStage } from '@builderforce/workload';
import { isCostLeverOn } from '@builderforce/cost-levers';
import {
  applyObservation,
  sortStats,
  type ActionModelStat,
  type FoldDecay,
  type RoutingObservation,
  type RoutingTable,
} from './routingFold';

// The blob's shapes live with the fold arithmetic; re-exported because this module is where its
// readers already look for them.
export type { ActionModelStat, RoutingTable };

// The scope type + its token are the shared contract (an on-prem host reads the same
// `?scope=` token), so they live in `@builderforce/learned-routing`. Re-exported here
// because this module is where the api's routing-table callers already look for them.
export { parseScopeToken, scopeToken, type RoutingScope };

/** Minimum samples in a (scope, action_type, model) bucket before learned routing
 *  will prefer it. Below this, the curated static order stands. The floor itself is
 *  the ranker's (`DEFAULT_MIN_SAMPLES`, shared with the on-prem host) — aliased here
 *  under the name the api's readers already use, so there is ONE number, not two
 *  eights that can drift apart. */
export const MIN_SAMPLES = DEFAULT_MIN_SAMPLES;

/** How far back the reconcile aggregates outcomes — keeps the fact scan bounded as
 *  the table grows and lets stale model preferences age out. */
export const ROUTING_WINDOW_DAYS = 60;

/**
 * Is the routing table built with RECENCY DECAY (cost PRD D3, lever
 * `d3_routing_exploration`)? Decided WITHOUT a tenant on purpose: the blob is a shared
 * artifact (the global scope serves every tenant), so a per-tenant arm would make one
 * blob flip between decayed and plain means depending on whose run folded last. The
 * table therefore decays only while the lever is fully on; request-time exploration is
 * the part that splits by tenant.
 */
export function routingDecayOn(env: unknown): boolean {
  return isCostLeverOn(env, 'd3_routing_exploration', null);
}

/** The stat for `model` under `key`, created empty when absent. Shared by every grain
 *  the reconcile folds (per action, per role). */
function statIn<K extends string>(map: Partial<Record<K, ActionModelStat[]>>, key: K, model: string): ActionModelStat {
  const list = (map[key] ??= []);
  const found = list.find((s) => s.model === model);
  if (found) return found;
  const fresh: ActionModelStat = { model, n: 0, avgScore: 0, mergeRate: 0, avgCostMc: 0, costN: 0, rateLimitRate: 0 };
  list.push(fresh);
  return fresh;
}

/** Copy one grouped outcome aggregate onto its stat. */
export function assignOutcomeAggregate(
  stat: ActionModelStat,
  r: { n: unknown; avgScore: unknown; avgCost: unknown; costN: unknown; mergeRate: unknown; rateLimitRate: unknown; effectiveN?: unknown; costEffectiveN?: unknown },
  nowMs: number,
): void {
  stat.n = Number(r.n) || 0;
  stat.avgScore = Number(r.avgScore) || 0;
  stat.mergeRate = Number(r.mergeRate) || 0;
  // The aggregate skips runs that reported no cost (NULL) and counts the ones that did (`costN`), as
  // the live fold does. A model none of whose runs did has no mean (`costN` 0): the tie-break
  // reads that as no information, and the numeric field holds 0 only to stay a number.
  stat.avgCostMc = Number(r.avgCost) || 0;
  stat.costN = Number(r.costN) || 0;
  stat.rateLimitRate = Number(r.rateLimitRate) || 0;
  if (r.effectiveN != null) {
    stat.effectiveN = Number(r.effectiveN) || 0;
    stat.costEffectiveN = Number(r.costEffectiveN) || 0;
    stat.at = nowMs;
  }
}

function cacheKey(scope: RoutingScope): string {
  return `routing:${scopeToken(scope)}`;
}

function emptyTable(): RoutingTable {
  return { updatedAt: new Date(0).toISOString(), byAction: {} };
}

/**
 * The scope predicate is written INLINE at each statement below rather than behind a
 * `scopeWhere(scope)` helper, deliberately. `check-tenant-scope` reads the STATEMENT,
 * not the local a predicate was assigned from — and so does a reviewer. Hiding "this
 * read crosses every tenant" inside a helper is exactly how a cross-tenant read stops
 * being visible where it matters. Two statements, one branch each, both legible.
 *
 * The GLOBAL branch is a declared `platform_aggregate`: each query is a GROUP BY
 * (action_type, model) selecting only counts and averages, so a returned row names a
 * MODEL and can never identify a tenant.
 */

function windowStart(decay: boolean): Date {
  const days = decay ? DECAYED_WINDOW_DAYS : ROUTING_WINDOW_DAYS;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

const HALF_LIFE_SECONDS = ROUTING_HALF_LIFE_DAYS * 24 * 60 * 60;

/** The per-model outcome aggregate — ONE definition, selected at both outcome grains
 *  (per action, per role). Plain window means; or, while the table decays, means
 *  weighted by `0.5^(age / half-life)` plus the effective count behind them. */
function outcomeAggregateFor(decay: boolean) {
  const base = {
    model: runModelOutcomes.resolvedModel,
    n: sql<number>`count(*)::int`,
    // Runs that REPORTED a cost: the count behind `avgCost`, which skips the rest (NULL = unknown).
    costN: sql<number>`count(${runModelOutcomes.costUsdMillicents})::int`,
  };
  if (!decay) {
    return {
      ...base,
      avgScore: sql<number>`avg(${runModelOutcomes.score})::float8`,
      avgCost: sql<number>`avg(${runModelOutcomes.costUsdMillicents})::float8`,
      mergeRate: sql<number>`(sum(case when ${runModelOutcomes.merged} then 1 else 0 end)::float8 / count(*))`,
      rateLimitRate: sql<number>`(sum(case when ${runModelOutcomes.rateLimited} then 1 else 0 end)::float8 / count(*))`,
      // Same row shape both ways; NULL = "not decayed", read as absent.
      effectiveN: sql<number | null>`null::float8`,
      costEffectiveN: sql<number | null>`null::float8`,
    };
  }
  const w = sql`power(0.5::float8, extract(epoch from (now() - ${runModelOutcomes.createdAt}))::float8 / ${sql.raw(String(HALF_LIFE_SECONDS))})`;
  // The denominator counts only the rows that HAVE a value: a NULL (a cost the run never reported)
  // is unknown, so it must not pull the mean toward zero.
  const weighted = (x: SQL) => sql<number>`(sum(${w} * ${x})::float8 / nullif(sum(case when ${x} is not null then ${w} end), 0)::float8)`;
  return {
    ...base,
    effectiveN: sql<number | null>`sum(${w})::float8`,
    costEffectiveN: sql<number | null>`sum(case when ${runModelOutcomes.costUsdMillicents} is not null then ${w} end)::float8`,
    avgScore: weighted(sql`${runModelOutcomes.score}`),
    avgCost: weighted(sql`${runModelOutcomes.costUsdMillicents}`),
    mergeRate: weighted(sql`(case when ${runModelOutcomes.merged} then 1 else 0 end)`),
    rateLimitRate: weighted(sql`(case when ${runModelOutcomes.rateLimited} then 1 else 0 end)`),
  };
}

/**
 * Rebuild a scope's blob from the durable table with a single grouped query, write
 * it to the cache, and return it. The cold-start backfill AND the drift-repair path.
 * Best-effort: on any DB error returns (and caches) an empty table so a read never
 * throws — the router then just keeps the static order.
 */
export async function reconcileRoutingTable(env: Env, db: Db, scope: RoutingScope): Promise<RoutingTable> {
  let table: RoutingTable;
  try {
    const decay = routingDecayOn(env);
    const nowMs = Date.now();
    const start = windowStart(decay);
    // TWO grouped queries, not a join: a run and a human press are different grains,
    // so joining them in SQL would multiply rows and inflate both counts. They are
    // merged by (action, model) in memory below.
    const outcomeAggregate = outcomeAggregateFor(decay);
    const outcomesDb = runTelemetryDatabase(db);
    // A row recorded as NOT a routing signal (a Creation Canvas run) is telemetry only: no
    // reconcile may re-admit it, or a rebuild would undo what the live fold declined to do.
    const teaches = codingEvidence;
    const [rows, ratingRows, roleRows] = await Promise.all([
      outcomesDb
        .select({ actionType: runModelOutcomes.actionType, ...outcomeAggregate })
        .from(runModelOutcomes)
        .where(
          scope.kind === 'project' ? and(eq(runModelOutcomes.projectId, scope.id), gte(runModelOutcomes.createdAt, start), teaches)
          : scope.kind === 'tenant' ? scopedToTenant(runModelOutcomes, scope.id, and(gte(runModelOutcomes.createdAt, start), teaches))
          : acrossTenants(runModelOutcomes, 'platform_aggregate', and(gte(runModelOutcomes.createdAt, start), teaches)),
        )
        .groupBy(runModelOutcomes.actionType, runModelOutcomes.resolvedModel),
      db
        .select({
          actionType: llmActionRatings.actionType,
          model: llmActionRatings.resolvedModel,
          up: sql<number>`count(*) FILTER (WHERE ${llmActionRatings.rating} = 1)::int`,
          down: sql<number>`count(*) FILTER (WHERE ${llmActionRatings.rating} = -1)::int`,
        })
        .from(llmActionRatings)
        .where(
          scope.kind === 'project' ? and(eq(llmActionRatings.projectId, scope.id), gte(llmActionRatings.createdAt, start))
          : scope.kind === 'tenant' ? scopedToTenant(llmActionRatings, scope.id, gte(llmActionRatings.createdAt, start))
          : acrossTenants(llmActionRatings, 'platform_aggregate', gte(llmActionRatings.createdAt, start)),
        )
        .groupBy(llmActionRatings.actionType, llmActionRatings.resolvedModel)
        // A dead rating table must not cost the router its outcome ranking.
        .catch(() => [] as Array<{ actionType: string; model: string; up: number; down: number }>),
      // The same outcomes by the ROLE their model played — a third grain, and only the
      // rows that recorded one (1169); an unknown role is not evidence about any role.
      outcomesDb
        .select({ role: runModelOutcomes.role, ...outcomeAggregate })
        .from(runModelOutcomes)
        .where(
          scope.kind === 'project' ? and(eq(runModelOutcomes.projectId, scope.id), gte(runModelOutcomes.createdAt, start), isNotNull(runModelOutcomes.role), teaches)
          : scope.kind === 'tenant' ? scopedToTenant(runModelOutcomes, scope.id, and(gte(runModelOutcomes.createdAt, start), isNotNull(runModelOutcomes.role), teaches))
          : acrossTenants(runModelOutcomes, 'platform_aggregate', and(gte(runModelOutcomes.createdAt, start), isNotNull(runModelOutcomes.role), teaches)),
        )
        .groupBy(runModelOutcomes.role, runModelOutcomes.resolvedModel),
    ]);

    const byAction: RoutingTable['byAction'] = {};
    for (const r of rows) {
      assignOutcomeAggregate(statIn(byAction, normalizeActionType(r.actionType), r.model), r, nowMs);
    }
    // A model rated by humans but never scored by a cloud run gets a stat row with
    // `n: 0` — which is correct and load-bearing: for chat and canvas work there IS
    // no run, and refusing to record the model would leave the router blind to the
    // only evidence that exists.
    for (const r of ratingRows) {
      const stat = statIn(byAction, normalizeActionType(r.actionType), r.model);
      stat.ratedUp = Number(r.up) || 0;
      stat.ratedDown = Number(r.down) || 0;
    }
    const byRole: NonNullable<RoutingTable['byRole']> = {};
    for (const r of roleRows) {
      if (isModelRole(r.role)) assignOutcomeAggregate(statIn(byRole, r.role, r.model), r, nowMs);
    }
    for (const action of Object.keys(byAction) as ActionType[]) {
      byAction[action] = sortStats(byAction[action]!);
    }
    for (const role of Object.keys(byRole) as ModelRole[]) {
      byRole[role] = sortStats(byRole[role]!);
    }
    table = { updatedAt: new Date().toISOString(), byAction, byRole };
  } catch {
    table = emptyTable();
  }
  await setCached(env, cacheKey(scope), table, { kvTtlSeconds: 86_400, l1TtlMs: 60_000 });
  return table;
}

/**
 * Read a scope's routing blob: L1 → L2 → (cold) reconcile. The single read path the
 * router AND the analytics endpoint share, so they never diverge.
 */
export async function getRoutingTable(env: Env, db: Db, scope: RoutingScope): Promise<RoutingTable> {
  return getOrSetCached(
    env,
    cacheKey(scope),
    () => reconcileRoutingTable(env, db, scope),
    { kvTtlSeconds: 86_400, l1TtlMs: 60_000 },
  );
}

/** The scope ladder, finest first: project (when known) → tenant → global. */
export function scopeLadder(tenantId: number, projectId?: number | null): RoutingScope[] {
  return [
    ...(projectId != null ? [{ kind: 'project', id: projectId } as const] : []),
    { kind: 'tenant', id: tenantId },
    { kind: 'global' },
  ];
}

/**
 * The stat slice of the FINEST scope that carries real evidence (a model clearing
 * MIN_SAMPLES), or undefined when every scope is cold. `pick` names the slice — one
 * action type for a cloud run, one role for a gateway call — so both walk the ladder
 * the same way and a coarser scope that knows something is never shadowed by a finer
 * one that does not.
 */
export async function finestScopeStats(
  env: Env,
  db: Db,
  scopes: readonly RoutingScope[],
  pick: (table: RoutingTable) => ActionModelStat[] | undefined,
): Promise<ActionModelStat[] | undefined> {
  // Every scope's read starts at once; they are still CONSUMED finest-first, so the
  // answer is the same and a coarser scope's failure only surfaces if it is reached.
  const tables = scopes.map((scope) => getRoutingTable(env, db, scope));
  for (const table of tables) table.catch(() => undefined);
  for (const table of tables) {
    const stats = pick(await table);
    if (scopeHasSignal(stats, MIN_SAMPLES)) return stats;
  }
  return undefined;
}

/**
 * Learned stats for ONE ROLE, for the gateway completion seed. Read only when they can
 * change the order — learned routing on, and a role the system chooses for (a planning
 * or chat call keeps the tenant's order, so its evidence is never fetched). Cached blob
 * reads, at most one per scope. Best-effort: undefined on any error.
 */
export async function roleRoutingStats(
  env: Env,
  db: Db,
  args: { tenantId: number; projectId?: number | null; role: ModelRole; arcStage?: ArcStage },
): Promise<ActionModelStat[] | undefined> {
  if (!learnedRoutingEnabled(env) || !roleUsesLearnedRanking(args.role, args.arcStage)) return undefined;
  try {
    return await finestScopeStats(env, db, scopeLadder(args.tenantId, args.projectId), (t) => t.byRole?.[args.role]);
  } catch (error) {
    reportCaughtError(error, { source: 'application/llm/routingTable.ts', operation: 'roleRoutingStats' });
    return undefined;
  }
}

/**
 * Fold ONE human rating into every affected scope blob (project → tenant → global),
 * exactly as {@link applyOutcomeToRoutingTable} folds a run outcome. Best-effort: a
 * cold blob reconciles from SQL (which already includes the just-written row, so the
 * increment is NOT also applied), and the scheduled reconcile repairs any drift.
 */
export async function applyRatingToRoutingTable(
  env: Env,
  db: Db,
  obs: { tenantId: number | null; projectId: number | null; actionType: ActionType; model: string; up: boolean },
): Promise<void> {
  const scopes: RoutingScope[] = [{ kind: 'global' }];
  if (obs.tenantId != null) scopes.push({ kind: 'tenant', id: obs.tenantId });
  if (obs.projectId != null) scopes.push({ kind: 'project', id: obs.projectId });

  await Promise.all(
    scopes.map(async (scope) => {
      try {
        const current = await peekCached<RoutingTable>(env, cacheKey(scope));
        if (current == null) {
          await reconcileRoutingTable(env, db, scope);
          return;
        }
        const next = applyRatingObservation(current, { actionType: obs.actionType, model: obs.model, up: obs.up });
        await setCached(env, cacheKey(scope), next, { kvTtlSeconds: 86_400, l1TtlMs: 60_000 });
      } catch (error) {
        reportCaughtError(error, { source: 'application/llm/routingTable.ts', operation: 'applyRatingToRoutingTable' });
      }
    }),
  );
}

/**
 * Incrementally fold ONE terminal-run outcome into all affected scope blobs
 * (project → tenant → global). One read-modify-write per scope: peek the current
 * blob (no loader) and apply Welford; only when a blob is absent do we reconcile
 * from SQL (which already includes the just-inserted row — so we DON'T double-apply
 * the increment). Called by the scorer right after the durable row is written.
 * Best-effort — a lost-update race is rare per low-frequency bucket and the
 * scheduled reconcile self-heals from the table.
 */
export async function applyOutcomeToRoutingTable(
  env: Env,
  db: Db,
  outcome: RoutingObservation & { tenantId: number | null; projectId: number | null },
): Promise<void> {
  const scopes: RoutingScope[] = [{ kind: 'global' }];
  if (outcome.tenantId != null) scopes.push({ kind: 'tenant', id: outcome.tenantId });
  if (outcome.projectId != null) scopes.push({ kind: 'project', id: outcome.projectId });
  const decay: FoldDecay | undefined = routingDecayOn(env) ? { nowMs: Date.now() } : undefined;

  await Promise.all(
    scopes.map(async (scope) => {
      try {
        const current = await peekCached<RoutingTable>(env, cacheKey(scope));
        if (current == null) {
          // Cold blob — the inserted row is already in the table, so a fresh
          // reconcile is correct and complete; do NOT also fold the increment.
          await reconcileRoutingTable(env, db, scope);
          return;
        }
        const next = applyObservation(current, {
          actionType: outcome.actionType,
          model: outcome.model,
          score: outcome.score,
          costMc: outcome.costMc,
          merged: outcome.merged,
          rateLimited: outcome.rateLimited === true,
          role: outcome.role ?? null,
        }, decay);
        await setCached(env, cacheKey(scope), next, { kvTtlSeconds: 86_400, l1TtlMs: 60_000 });
      } catch (error) {
        // Best-effort: the reconcile job repairs any dropped increment.
      
        reportCaughtError(error, { source: "application/llm/routingTable.ts", operation: "applyOutcomeToRoutingTable" });
      }
    }),
  );
}

