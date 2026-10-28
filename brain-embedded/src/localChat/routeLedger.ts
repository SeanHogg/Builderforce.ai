/**
 * The run usage ledger as the ROUTE REPORT reads it — this device's routed runs over a
 * window, one {@link RouteRunRecord} per run, priced with the one device cost rule
 * (`callCost.ts`). The report's arithmetic is `@builderforce/pipeline-route`'s; the host
 * renders it (VS Code: `BuilderForce: Pipeline Route Report`).
 *
 * A run is one user submit: its calls share {@link RunUsageValue.runId}. A row from
 * before the run id was stamped falls back to its chat and run key. How the run ended
 * is its `run-outcome` record, written once at run end under the same id.
 *
 * The report's GATE column (docs/design/deterministic-prefetch.md) reads the same rows:
 * an ANSWERED run is its `deterministic` row (`answeredBy`), every other gated run's calls
 * carry `gateRoute` (`prefetch` / `llm`), and whether the decision was accepted is the
 * run-outcome record's `gateAccepted` — no other store.
 */

import type { LocalFirstStore } from '@builderforce/local-first';
import type { PriceBook } from '@builderforce/model-catalog';
import type { RouteRunRecord } from '@builderforce/pipeline-route';
import { callCostMillicents } from './callCost';
import { liveRecords } from './records';
import type { RunEndOutcome } from '../runStore/runTypes';
import type { RunOutcomeValue } from './gateLedger';
import type { RunUsageValue } from './usageLedger';

/** This device's usage rows written at or after `since`, oldest first. */
export async function usageRowsSince(store: LocalFirstStore, deviceId: string, since: Date): Promise<RunUsageValue[]> {
  const from = since.toISOString();
  return store.transact(async (tx) =>
    (await liveRecords<RunUsageValue>(tx, 'usage', deviceId))
      .map((row) => row.payload)
      .filter((row) => row.at >= from)
      .sort((a, b) => a.at.localeCompare(b.at)),
  );
}

/** How this device's runs since `since` ended, by run id (`recordOutcome`). */
export async function runOutcomesSince(store: LocalFirstStore, deviceId: string, since: Date): Promise<Map<string, RunEndOutcome>> {
  const from = since.toISOString();
  return store.transact(async (tx) => {
    const out = new Map<string, RunEndOutcome>();
    for (const row of await liveRecords<RunOutcomeValue>(tx, 'run-outcome', deviceId)) {
      if (row.payload.at >= from && row.payload.outcome) out.set(row.payload.runId, row.payload.outcome);
    }
    return out;
  });
}

/**
 * The routed runs among `rows` (oldest first): route, score, cost and start per run.
 * `outcomes` (from {@link runOutcomesSince}) marks a run that FAILED, which the report's
 * misroute proxy counts for a quick run; a run with no recorded outcome is unknown.
 */
export function routeRunRecords(
  rows: readonly RunUsageValue[],
  book?: PriceBook,
  outcomes?: ReadonlyMap<string, RunEndOutcome>,
): RouteRunRecord[] {
  const runs = new Map<string, RouteRunRecord>();
  for (const row of rows) {
    if (row.pipelineRoute !== 'full' && row.pipelineRoute !== 'quick') continue;
    const key = row.runId ?? `${row.clientChatId}:${row.runKey}`;
    const costMc = callCostMillicents(row.model, {
      prompt: row.promptTokens,
      completion: row.completionTokens,
      cacheRead: row.cacheReadTokens,
      cacheCreation: row.cacheCreationTokens,
    }, book, row.route);
    const seen = runs.get(key);
    if (seen) {
      seen.costMc += costMc;
      if (row.at < seen.startedAt) seen.startedAt = row.at;
      continue;
    }
    const outcome = row.runId ? outcomes?.get(row.runId) : undefined;
    runs.set(key, {
      route: row.pipelineRoute,
      score: typeof row.routeScore === 'number' ? row.routeScore : null,
      costMc,
      conversation: row.clientChatId,
      startedAt: row.at,
      ...(outcome ? { failed: outcome === 'failed' } : {}),
    });
  }
  return [...runs.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/** Whether each gated run's decision was accepted, by run id (`recordOutcome` `gateAccepted`). */
export async function gateAcceptedSince(store: LocalFirstStore, deviceId: string, since: Date): Promise<Map<string, boolean>> {
  const from = since.toISOString();
  return store.transact(async (tx) => {
    const out = new Map<string, boolean>();
    for (const row of await liveRecords<RunOutcomeValue>(tx, 'run-outcome', deviceId)) {
      if (row.payload.at >= from && typeof row.payload.gateAccepted === 'boolean') out.set(row.payload.runId, row.payload.gateAccepted);
    }
    return out;
  });
}

/** One gate route's runs and how many of its judged decisions were accepted. */
export interface GateRouteStats {
  runs: number;
  /** Runs whose next request has said whether the decision was accepted. */
  judged: number;
  accepted: number;
}

/** The pipeline route report's gate column: the answer / prefetch / llm split, with accuracy. */
export interface GateReport {
  /** Runs the gate decided. */
  runs: number;
  answer: GateRouteStats;
  prefetch: GateRouteStats;
  llm: { runs: number };
  /** ANSWER runs per action, most first (ties by id). */
  answeredBy: Array<{ actionId: string; runs: number }>;
  /** The estimated saving of the answered runs, in millicents. */
  savedCostMc: number;
}

type GateRoute = 'answer' | 'prefetch' | 'llm';
/** A run's route: an answer wins (it made no calls), then prefetch over llm. */
const RANK: Record<GateRoute, number> = { answer: 2, prefetch: 1, llm: 0 };

/** The gate column over `rows` (any order); `accepted` from {@link gateAcceptedSince}. */
export function summarizeGateRuns(rows: readonly RunUsageValue[], accepted: ReadonlyMap<string, boolean> = new Map()): GateReport {
  const runs = new Map<string, { route: GateRoute; runId?: string; actionId?: string }>();
  let savedCostMc = 0;
  for (const row of rows) {
    const answered = row.savingsSource === 'deterministic';
    const route: GateRoute | undefined = answered ? 'answer' : row.gateRoute;
    if (!route) continue;
    if (answered) savedCostMc += row.savedCostMc ?? 0;
    const key = row.runId ?? `${row.clientChatId}:${row.runKey}`;
    const seen = runs.get(key);
    if (seen && RANK[seen.route] >= RANK[route]) continue;
    runs.set(key, { route, ...(row.runId ? { runId: row.runId } : {}), ...(answered && row.answeredBy ? { actionId: row.answeredBy } : {}) });
  }
  const stats = (): GateRouteStats => ({ runs: 0, judged: 0, accepted: 0 });
  const report: GateReport = { runs: runs.size, answer: stats(), prefetch: stats(), llm: { runs: 0 }, answeredBy: [], savedCostMc };
  const byAction = new Map<string, number>();
  for (const run of runs.values()) {
    if (run.route === 'llm') {
      report.llm.runs += 1;
      continue;
    }
    const s = report[run.route];
    s.runs += 1;
    const verdict = run.runId ? accepted.get(run.runId) : undefined;
    if (verdict !== undefined) {
      s.judged += 1;
      if (verdict) s.accepted += 1;
    }
    if (run.actionId) byAction.set(run.actionId, (byAction.get(run.actionId) ?? 0) + 1);
  }
  report.answeredBy = [...byAction].map(([actionId, n]) => ({ actionId, runs: n }))
    .sort((a, b) => b.runs - a.runs || a.actionId.localeCompare(b.actionId));
  return report;
}
