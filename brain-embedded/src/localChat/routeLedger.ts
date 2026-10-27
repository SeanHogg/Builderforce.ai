/**
 * The run usage ledger as the ROUTE REPORT reads it — this device's routed runs over a
 * window, one {@link RouteRunRecord} per run, priced with the one device cost rule
 * (`callCost.ts`). The report's arithmetic is `@builderforce/pipeline-route`'s; the host
 * renders it (VS Code: `BuilderForce: Pipeline Route Report`).
 *
 * A run is one user submit: its calls share {@link RunUsageValue.runId}. A row from
 * before the run id was stamped falls back to its chat and run key. How the run ended
 * is its `run-outcome` record, written once at run end under the same id.
 */

import type { LocalFirstStore } from '@builderforce/local-first';
import type { PriceBook } from '@builderforce/model-catalog';
import type { RouteRunRecord } from '@builderforce/pipeline-route';
import { callCostMillicents } from './callCost';
import { liveRecords } from './records';
import type { RunEndOutcome, RunOutcomeValue, RunUsageValue } from './usageLedger';

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
      if (row.payload.at >= from) out.set(row.payload.runId, row.payload.outcome);
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
