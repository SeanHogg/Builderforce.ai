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

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, peekCached, setCached } from '../../infrastructure/cache/readThroughCache';
import {
  DEFAULT_MIN_SAMPLES,
  learnedRoutingEnabled,
  parseScopeToken,
  scopeHasSignal,
  scopeToken,
  type ActionType,
  type RoutingScope,
} from '@builderforce/learned-routing';
import type { ModelRole } from '@builderforce/agent-tools';
import { roleUsesLearnedRanking } from '@builderforce/model-router';
import type { ArcStage } from '@builderforce/workload';
import {
  applyObservation,
  applyRatingObservation,
  type ActionModelStat,
  type FoldDecay,
  type RoutingObservation,
  type RoutingTable,
} from './routingFold';
import { reconcileRoutingTable, routingCacheKey, routingDecayOn } from './routingReconcile';

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

/**
 * Read a scope's routing blob: L1 → L2 → (cold) reconcile. The single read path the
 * router AND the analytics endpoint share, so they never diverge.
 */
export async function getRoutingTable(env: Env, db: Db, scope: RoutingScope): Promise<RoutingTable> {
  return getOrSetCached(
    env,
    routingCacheKey(scope),
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
        const current = await peekCached<RoutingTable>(env, routingCacheKey(scope));
        if (current == null) {
          await reconcileRoutingTable(env, db, scope);
          return;
        }
        const next = applyRatingObservation(current, { actionType: obs.actionType, model: obs.model, up: obs.up });
        await setCached(env, routingCacheKey(scope), next, { kvTtlSeconds: 86_400, l1TtlMs: 60_000 });
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
        const current = await peekCached<RoutingTable>(env, routingCacheKey(scope));
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
        await setCached(env, routingCacheKey(scope), next, { kvTtlSeconds: 86_400, l1TtlMs: 60_000 });
      } catch (error) {
        // Best-effort: the reconcile job repairs any dropped increment.
      
        reportCaughtError(error, { source: "application/llm/routingTable.ts", operation: "applyOutcomeToRoutingTable" });
      }
    }),
  );
}

