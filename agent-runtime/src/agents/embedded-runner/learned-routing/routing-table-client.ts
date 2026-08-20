/**
 * Learned Model Routing (PRD 13) — the host's READ of the fleet's learned ranking.
 *
 * The api's `GET /llm/v1/model-analytics?scope=<token>` serves the SAME cached
 * `routing:<scope>` blob the cloud router seeds from, shaped per action type. This is
 * the only place in the host that calls it, and the only place a routing response is
 * cached — one cache, one TTL, one shape.
 *
 * The cache is client-side and deliberately not the api's read-through primitive:
 * that one is a Worker L1 Map + KV, and this process has neither. What it must NOT be
 * is a second inline Map+TTL scattered through the runner, so the whole of it lives
 * in this module and is reset-able for tests.
 *
 * Best-effort by contract: an unlinked host, a 4xx/5xx, a timeout or garbage JSON all
 * resolve to "no stats", and the caller then keeps its configured model order. A run
 * must never fail because the fleet's opinion was unavailable.
 */

import type { ActionModelRankStat, ActionType } from "@builderforce/learned-routing";
import { MODEL_ANALYTICS_PATH } from "@builderforce/learned-routing";
import { logDebug } from "../../../logger.js";
import { resolveGatewayLink } from "./settings.js";

/** How long a fetched scope blob is trusted. The api rebuilds its own blob
 *  incrementally on every terminal run, so a few minutes of staleness costs at most a
 *  slightly-behind ranking — while a per-run fetch would put a network round-trip on
 *  the critical path of every single embedded run. */
export const ROUTING_CACHE_TTL_MS = 5 * 60 * 1000;

const REQUEST_TIMEOUT_MS = 5_000;

/** action type → models ranked best-first, for one scope. */
export type ScopeRanking = Partial<Record<ActionType, ActionModelRankStat[]>>;

type Entry = { at: number; ranking: ScopeRanking };

const cache = new Map<string, Entry>();

/** Wipe the client cache. Tests, and an operator forcing a re-read. */
export function clearRoutingCache(): void {
  cache.clear();
}

interface AnalyticsRow {
  model?: unknown;
  samples?: unknown;
  avgScore?: unknown;
  avgCostMillicents?: unknown;
  ratedUp?: unknown;
  ratedDown?: unknown;
  rateLimitRate?: unknown;
}

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Map one analytics row onto the ranker's stat shape. The endpoint carries every
 * field `rankModelsForAction` reads — including the human thumbs and the 429 share —
 * precisely so this mapping is total and the host ranks identical evidence the same
 * way the cloud router does. PURE.
 */
export function toRankStat(row: AnalyticsRow): ActionModelRankStat | null {
  const model = typeof row.model === "string" ? row.model.trim() : "";
  if (!model) {
    return null;
  }
  return {
    model,
    n: n(row.samples),
    avgScore: n(row.avgScore),
    avgCostMc: n(row.avgCostMillicents),
    ratedUp: n(row.ratedUp),
    ratedDown: n(row.ratedDown),
    rateLimitRate: n(row.rateLimitRate),
  };
}

/** Shape a whole `/model-analytics` body into a per-action ranking. PURE. */
export function toScopeRanking(body: unknown): ScopeRanking {
  const byAction = (body as { byAction?: unknown })?.byAction;
  if (!Array.isArray(byAction)) {
    return {};
  }
  const ranking: ScopeRanking = {};
  for (const bucket of byAction as Array<{ actionType?: unknown; models?: unknown }>) {
    const actionType =
      typeof bucket?.actionType === "string" ? (bucket.actionType as ActionType) : null;
    if (!actionType || !Array.isArray(bucket.models)) {
      continue;
    }
    const stats = (bucket.models as AnalyticsRow[])
      .map(toRankStat)
      .filter((s): s is ActionModelRankStat => s !== null);
    if (stats.length > 0) {
      ranking[actionType] = stats;
    }
  }
  return ranking;
}

/**
 * The fleet's ranking for one scope token, from cache when warm. Returns an empty
 * ranking (never throws) when the host is unlinked or the read fails.
 */
export async function fetchScopeRanking(
  scopeToken: string,
  now = Date.now(),
): Promise<ScopeRanking> {
  const hit = cache.get(scopeToken);
  if (hit && now - hit.at < ROUTING_CACHE_TTL_MS) {
    return hit.ranking;
  }

  const link = resolveGatewayLink();
  if (!link) {
    return {};
  }
  try {
    const url = `${link.base}${MODEL_ANALYTICS_PATH}?scope=${encodeURIComponent(scopeToken)}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${link.apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      logDebug(`[learned-routing] model-analytics scope=${scopeToken} returned HTTP ${res.status}`);
      // Cache the empty result too: a 403 on a scope this host may not read would
      // otherwise be re-requested on every run for as long as the host is up.
      cache.set(scopeToken, { at: now, ranking: {} });
      return {};
    }
    const ranking = toScopeRanking(await res.json());
    cache.set(scopeToken, { at: now, ranking });
    return ranking;
  } catch (err) {
    logDebug(`[learned-routing] model-analytics scope=${scopeToken} failed: ${String(err)}`);
    cache.set(scopeToken, { at: now, ranking: {} });
    return {};
  }
}
