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

import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, peekCached, setCached } from '../../infrastructure/cache/readThroughCache';
import { runModelOutcomes } from '../../infrastructure/database/schema';
import { normalizeActionType, type ActionType } from './actionTypes';

/** Minimum samples in a (scope, action_type, model) bucket before learned routing
 *  will prefer it. Below this, the curated static order stands. Single source of
 *  truth — the router and the scope-precedence reader both gate on it. */
export const MIN_SAMPLES = 8;

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
}

export interface RoutingTable {
  updatedAt: string;
  /** action_type → models ranked best-first. */
  byAction: Partial<Record<ActionType, ActionModelStat[]>>;
}

/** A routing scope, finest-first in precedence. */
export type RoutingScope =
  | { kind: 'project'; id: number }
  | { kind: 'tenant'; id: number }
  | { kind: 'global' };

/** Stable string form used as the cache key suffix and the analytics query param. */
export function scopeToken(scope: RoutingScope): string {
  return scope.kind === 'global' ? 'global' : `${scope.kind}:${scope.id}`;
}

/** Parse a `scope` query param (`project:<id>` | `tenant:<id>` | `global`). Returns
 *  null for anything malformed so the caller can 400. */
export function parseScopeToken(raw: string | undefined | null): RoutingScope | null {
  if (!raw || raw === 'global') return raw === 'global' ? { kind: 'global' } : null;
  const [kind, idStr] = raw.split(':');
  const id = Number(idStr);
  if ((kind === 'project' || kind === 'tenant') && Number.isInteger(id) && id > 0) {
    return { kind, id };
  }
  return null;
}

function cacheKey(scope: RoutingScope): string {
  return `routing:${scopeToken(scope)}`;
}

function emptyTable(): RoutingTable {
  return { updatedAt: new Date(0).toISOString(), byAction: {} };
}

/** Re-sort a per-action stat list best-first: higher avgScore wins; ties break to
 *  the cheaper model (lower avgCostMc). Stable for deterministic output. */
function sortStats(stats: ActionModelStat[]): ActionModelStat[] {
  return stats
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s.avgScore - a.s.avgScore || a.s.avgCostMc - b.s.avgCostMc || a.i - b.i)
    .map(({ s }) => s);
}

/** The drizzle WHERE that scopes the fact table to a routing scope + the window. */
function scopeWhere(scope: RoutingScope, windowStart: Date) {
  const windowClause = gte(runModelOutcomes.createdAt, windowStart);
  if (scope.kind === 'project') return and(eq(runModelOutcomes.projectId, scope.id), windowClause);
  if (scope.kind === 'tenant') return and(eq(runModelOutcomes.tenantId, scope.id), windowClause);
  // Global: every outcome in the window. (A tenant_id of null can still appear if the
  // run's tenant was deleted; it's fine to include in the global view.)
  return windowClause;
}

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
    const rows = await db
      .select({
        actionType: runModelOutcomes.actionType,
        model: runModelOutcomes.resolvedModel,
        n: sql<number>`count(*)::int`,
        avgScore: sql<number>`avg(${runModelOutcomes.score})::float8`,
        avgCost: sql<number>`avg(${runModelOutcomes.costUsdMillicents})::float8`,
        mergeRate: sql<number>`(sum(case when ${runModelOutcomes.merged} then 1 else 0 end)::float8 / count(*))`,
      })
      .from(runModelOutcomes)
      .where(scopeWhere(scope, windowStart()))
      .groupBy(runModelOutcomes.actionType, runModelOutcomes.resolvedModel);

    const byAction: RoutingTable['byAction'] = {};
    for (const r of rows) {
      const action = normalizeActionType(r.actionType);
      (byAction[action] ??= []).push({
        model: r.model,
        n: Number(r.n) || 0,
        avgScore: Number(r.avgScore) || 0,
        mergeRate: Number(r.mergeRate) || 0,
        avgCostMc: Number(r.avgCost) || 0,
      });
    }
    for (const action of Object.keys(byAction) as ActionType[]) {
      byAction[action] = sortStats(byAction[action]!);
    }
    table = { updatedAt: new Date().toISOString(), byAction };
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

/** Welford-style update of one model's running stats with a fresh observation. */
function foldObservation(prev: ActionModelStat | undefined, model: string, score: number, costMc: number, merged: boolean): ActionModelStat {
  if (!prev) return { model, n: 1, avgScore: score, mergeRate: merged ? 1 : 0, avgCostMc: costMc };
  const n = prev.n + 1;
  return {
    model,
    n,
    avgScore: prev.avgScore + (score - prev.avgScore) / n,
    mergeRate: prev.mergeRate + ((merged ? 1 : 0) - prev.mergeRate) / n,
    avgCostMc: prev.avgCostMc + (costMc - prev.avgCostMc) / n,
  };
}

/** Apply one fresh observation to a blob (pure) — returns a NEW table, re-sorted. */
export function applyObservation(
  table: RoutingTable,
  obs: { actionType: ActionType; model: string; score: number; costMc: number; merged: boolean },
): RoutingTable {
  const byAction = { ...table.byAction };
  const list = (byAction[obs.actionType] ?? []).slice();
  const idx = list.findIndex((s) => s.model === obs.model);
  const updated = foldObservation(idx >= 0 ? list[idx] : undefined, obs.model, obs.score, obs.costMc, obs.merged);
  if (idx >= 0) list[idx] = updated;
  else list.push(updated);
  byAction[obs.actionType] = sortStats(list);
  return { updatedAt: new Date().toISOString(), byAction };
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
  outcome: {
    tenantId: number | null;
    projectId: number | null;
    actionType: ActionType;
    model: string;
    score: number;
    costMc: number;
    merged: boolean;
  },
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
        });
        await setCached(env, cacheKey(scope), next, { kvTtlSeconds: 86_400, l1TtlMs: 60_000 });
      } catch {
        // Best-effort: the reconcile job repairs any dropped increment.
      }
    }),
  );
}

