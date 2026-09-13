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

import { and, eq, gte, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, peekCached, setCached } from '../../infrastructure/cache/readThroughCache';
import { llmActionRatings, runModelOutcomes } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import {
  blendedQualityScore,
  DEFAULT_MIN_SAMPLES,
  isChronicallyRateLimited,
  learnedRoutingEnabled,
  normalizeActionType,
  parseScopeToken,
  scopeHasSignal,
  scopeToken,
  type ActionType,
  type RoutingScope,
} from '@builderforce/learned-routing';
import { isModelRole, roleUsesLearnedRanking, type ArcStage, type ModelRole } from './modelRoles';

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

/** Per-model running stats for one action type. n/avgScore/avgCost are maintained
 *  incrementally (Welford); the array is kept sorted best-first (avgScore desc,
 *  then avgCost asc as the tie-break). */
export interface ActionModelStat {
  model: string;
  n: number;
  avgScore: number;
  /** Running merge rate (mean of the 0/1 merged flag) — a corroborating signal. */
  mergeRate: number;
  /** Running mean per-run cost in millicents — the tie-break between equal scorers. */
  avgCostMc: number;
  /**
   * HUMAN thumbs on this (action, model), from `llm_action_ratings` (migration 0468).
   *
   * Kept as raw counts rather than a pre-blended score because the blend depends on
   * how much evidence the OTHER side has, and that is a read-time decision
   * (`rankModelsForAction`). They are a genuinely independent signal: a chat or
   * canvas turn has no merge and no CI, so for most model calls these are the ONLY
   * quality evidence that exists. Optional — blobs written before 0468 have none.
   */
  ratedUp?: number;
  ratedDown?: number;
  /**
   * Share of this bucket's runs that died on a provider 429 (migration 0485).
   *
   * An AVAILABILITY signal, kept strictly beside the quality score rather than inside
   * it — see `modelQualityScore.ts` for why conflating the two poisons the ranking.
   * Optional: blobs written before 0485 have none, and absent reads as 0 (not
   * rate-limited), which under-reports rather than demoting on evidence nobody has.
   */
  rateLimitRate?: number;
}

export interface RoutingTable {
  updatedAt: string;
  /** action_type → models ranked best-first. */
  byAction: Partial<Record<ActionType, ActionModelStat[]>>;
  /** model ROLE → models ranked best-first, from the outcomes that recorded which role
   *  their model played (migration 1169). Optional: blobs written before it have none. */
  byRole?: Partial<Record<ModelRole, ActionModelStat[]>>;
}

/** The stat for `model` under `key`, created empty when absent. Shared by every grain
 *  the reconcile folds (per action, per role). */
function statIn<K extends string>(map: Partial<Record<K, ActionModelStat[]>>, key: K, model: string): ActionModelStat {
  const list = (map[key] ??= []);
  const found = list.find((s) => s.model === model);
  if (found) return found;
  const fresh: ActionModelStat = { model, n: 0, avgScore: 0, mergeRate: 0, avgCostMc: 0, rateLimitRate: 0 };
  list.push(fresh);
  return fresh;
}

/** Copy one grouped outcome aggregate onto its stat. */
function assignOutcomeAggregate(
  stat: ActionModelStat,
  r: { n: unknown; avgScore: unknown; avgCost: unknown; mergeRate: unknown; rateLimitRate: unknown },
): void {
  stat.n = Number(r.n) || 0;
  stat.avgScore = Number(r.avgScore) || 0;
  stat.mergeRate = Number(r.mergeRate) || 0;
  stat.avgCostMc = Number(r.avgCost) || 0;
  stat.rateLimitRate = Number(r.rateLimitRate) || 0;
}

function cacheKey(scope: RoutingScope): string {
  return `routing:${scopeToken(scope)}`;
}

function emptyTable(): RoutingTable {
  return { updatedAt: new Date(0).toISOString(), byAction: {} };
}

/** Re-sort a per-action stat list best-first on the BLENDED quality score (run
 *  outcomes + human thumbs, each weighted by how much evidence it has — see
 *  modelQualityScore.ts); ties break to the cheaper model (lower avgCostMc).
 *  Stable for deterministic output, and the same ordering `rankModelsForAction`
 *  applies, so the blob and the router never disagree. */
function sortStats(stats: ActionModelStat[]): ActionModelStat[] {
  return stats
    .map((s, i) => ({ s, i, q: blendedQualityScore(s), rl: isChronicallyRateLimited(s) ? 1 : 0 }))
    // Rate-limited models form a TRAILING BAND, ranked normally within it. They are not
    // removed — "the only model left is one the provider keeps refusing" is still
    // strictly better than returning nothing, and the cascade needs somewhere to land.
    .sort((a, b) => a.rl - b.rl || b.q - a.q || a.s.avgCostMc - b.s.avgCostMc || a.i - b.i)
    .map(({ s }) => s);
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

function windowStart(): Date {
  return new Date(Date.now() - ROUTING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
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
    const start = windowStart();
    // TWO grouped queries, not a join: a run and a human press are different grains,
    // so joining them in SQL would multiply rows and inflate both counts. They are
    // merged by (action, model) in memory below.
    // One definition of the per-model aggregate, selected at both outcome grains.
    const outcomeAggregate = {
      model: runModelOutcomes.resolvedModel,
      n: sql<number>`count(*)::int`,
      avgScore: sql<number>`avg(${runModelOutcomes.score})::float8`,
      avgCost: sql<number>`avg(${runModelOutcomes.costUsdMillicents})::float8`,
      mergeRate: sql<number>`(sum(case when ${runModelOutcomes.merged} then 1 else 0 end)::float8 / count(*))`,
      rateLimitRate: sql<number>`(sum(case when ${runModelOutcomes.rateLimited} then 1 else 0 end)::float8 / count(*))`,
    };
    const [rows, ratingRows, roleRows] = await Promise.all([
      db
        .select({ actionType: runModelOutcomes.actionType, ...outcomeAggregate })
        .from(runModelOutcomes)
        .where(
          scope.kind === 'project' ? and(eq(runModelOutcomes.projectId, scope.id), gte(runModelOutcomes.createdAt, start))
          : scope.kind === 'tenant' ? scopedToTenant(runModelOutcomes, scope.id, gte(runModelOutcomes.createdAt, start))
          : acrossTenants(runModelOutcomes, 'platform_aggregate', gte(runModelOutcomes.createdAt, start)),
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
      db
        .select({ role: runModelOutcomes.role, ...outcomeAggregate })
        .from(runModelOutcomes)
        .where(
          scope.kind === 'project' ? and(eq(runModelOutcomes.projectId, scope.id), gte(runModelOutcomes.createdAt, start), isNotNull(runModelOutcomes.role))
          : scope.kind === 'tenant' ? scopedToTenant(runModelOutcomes, scope.id, and(gte(runModelOutcomes.createdAt, start), isNotNull(runModelOutcomes.role)))
          : acrossTenants(runModelOutcomes, 'platform_aggregate', and(gte(runModelOutcomes.createdAt, start), isNotNull(runModelOutcomes.role))),
        )
        .groupBy(runModelOutcomes.role, runModelOutcomes.resolvedModel),
    ]);

    const byAction: RoutingTable['byAction'] = {};
    for (const r of rows) {
      assignOutcomeAggregate(statIn(byAction, normalizeActionType(r.actionType), r.model), r);
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
      if (isModelRole(r.role)) assignOutcomeAggregate(statIn(byRole, r.role, r.model), r);
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
  for (const scope of scopes) {
    const stats = pick(await getRoutingTable(env, db, scope));
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

/** One terminal run, as the blob folds it. `rateLimited` rides alongside `merged`
 *  because it is the same grain — a property of THIS run — and giving it its own
 *  fold path would mean two writers racing on one bucket. */
export interface RoutingObservation {
  actionType: ActionType;
  model: string;
  score: number;
  costMc: number;
  merged: boolean;
  /** The run died on a provider rate limit (`classifyRunFailure === 'rate_limited'`). */
  rateLimited?: boolean;
  /** The role the model played, when known — also folds into `byRole`. */
  role?: ModelRole | null;
}

/** Welford-style update of one model's running stats with a fresh observation. */
function foldObservation(prev: ActionModelStat | undefined, model: string, score: number, costMc: number, merged: boolean, rateLimited: boolean): ActionModelStat {
  const rl = rateLimited ? 1 : 0;
  if (!prev) return { model, n: 1, avgScore: score, mergeRate: merged ? 1 : 0, avgCostMc: costMc, rateLimitRate: rl };
  const n = prev.n + 1;
  return {
    ...prev,
    model,
    n,
    avgScore: prev.avgScore + (score - prev.avgScore) / n,
    mergeRate: prev.mergeRate + ((merged ? 1 : 0) - prev.mergeRate) / n,
    avgCostMc: prev.avgCostMc + (costMc - prev.avgCostMc) / n,
    rateLimitRate: (prev.rateLimitRate ?? 0) + (rl - (prev.rateLimitRate ?? 0)) / n,
  };
}

/** Fold an observation into one stat list (pure) — returns a NEW list, re-sorted. */
function foldIntoList(list: ActionModelStat[] | undefined, obs: RoutingObservation): ActionModelStat[] {
  const next = (list ?? []).slice();
  const idx = next.findIndex((s) => s.model === obs.model);
  const updated = foldObservation(idx >= 0 ? next[idx] : undefined, obs.model, obs.score, obs.costMc, obs.merged, obs.rateLimited === true);
  if (idx >= 0) next[idx] = updated;
  else next.push(updated);
  return sortStats(next);
}

/** Apply one fresh observation to a blob (pure) — returns a NEW table, re-sorted. A
 *  role-bearing observation also folds into that role's list. */
export function applyObservation(
  table: RoutingTable,
  obs: RoutingObservation,
): RoutingTable {
  const byAction = { ...table.byAction, [obs.actionType]: foldIntoList(table.byAction[obs.actionType], obs) };
  const byRole = obs.role
    ? { ...table.byRole, [obs.role]: foldIntoList(table.byRole?.[obs.role], obs) }
    : table.byRole;
  return { updatedAt: new Date().toISOString(), byAction, ...(byRole ? { byRole } : {}) };
}

/** Apply one human thumb to a blob (pure) — returns a NEW table, re-sorted. A model
 *  with no outcome row yet gets one at `n: 0`: for a chat or canvas turn there is no
 *  run to score, and the rating is the only evidence there will ever be. */
export function applyRatingObservation(
  table: RoutingTable,
  obs: { actionType: ActionType; model: string; up: boolean },
): RoutingTable {
  const byAction = { ...table.byAction };
  const list = (byAction[obs.actionType] ?? []).slice();
  const idx = list.findIndex((s) => s.model === obs.model);
  const prev = idx >= 0 ? list[idx]! : { model: obs.model, n: 0, avgScore: 0, mergeRate: 0, avgCostMc: 0, rateLimitRate: 0 };
  const updated: ActionModelStat = {
    ...prev,
    ratedUp: (prev.ratedUp ?? 0) + (obs.up ? 1 : 0),
    ratedDown: (prev.ratedDown ?? 0) + (obs.up ? 0 : 1),
  };
  if (idx >= 0) list[idx] = updated;
  else list.push(updated);
  byAction[obs.actionType] = sortStats(list);
  // A thumb carries no role, so the per-role lists pass through untouched.
  return { updatedAt: new Date().toISOString(), byAction, ...(table.byRole ? { byRole: table.byRole } : {}) };
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
        });
        await setCached(env, cacheKey(scope), next, { kvTtlSeconds: 86_400, l1TtlMs: 60_000 });
      } catch (error) {
        // Best-effort: the reconcile job repairs any dropped increment.
      
        reportCaughtError(error, { source: "application/llm/routingTable.ts", operation: "applyOutcomeToRoutingTable" });
      }
    }),
  );
}

