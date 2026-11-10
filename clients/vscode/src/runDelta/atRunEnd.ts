/**
 * The end-of-run recorders of one run's stored deltas (PRD 41 Part D), in ONE place so the delta's composition root
 * (`editorRunDelta.ts`) stays flat:
 *   - {@link onDeltaStored}: per stored delta, as it is stored — the run's features are frozen (`recordRunOutcome.ts`, §D1;
 *     unchanged: detached, never fails the run);
 *   - {@link atRunEnd}: once the WHOLE run delta has settled (its budget is over, stored or not) — naturalness (§D6), one
 *     repository at a time, never competing with the delta's own budget.
 * Both are best-effort: a failure is logged and never reaches the run.
 */

import type { LocalFirstStore } from "@builderforce/local-first";
import { recordRunOutcomeAtEnd } from "../runOutcomes/recordRunOutcome";
import { recordNaturalness, type NaturalnessDeps } from "./recordNaturalness";
import type { StoredRunDelta } from "./runDeltaRecords";

export interface RunEndDeps {
  store: LocalFirstStore;
  deviceId(): string;
  /** `what` names the recorder (`run outcome`, `naturalness`). */
  log(what: string, error: unknown): void;
  enabled: NaturalnessDeps["enabled"];
  preimages?: NaturalnessDeps["preimages"];
  signal?: AbortSignal;
}

/** One stored delta: the run's features, frozen now (§D1). */
export function onDeltaStored(deps: RunEndDeps, stored: StoredRunDelta): Promise<void> {
  return recordRunOutcomeAtEnd({
    store: deps.store, deviceId: deps.deviceId, onError: (error) => deps.log("run outcome", error),
    ...(deps.preimages ? { preimages: deps.preimages } : {}),
  }, stored);
}

/**
 * The run's settled deltas: naturalness per repository, in turn (§D6). Never throws. True when it stored an `ok` prediction
 * with something to show (the only case a card's re-post adds anything).
 */
export async function atRunEnd(deps: RunEndDeps, stored: readonly StoredRunDelta[]): Promise<boolean> {
  const naturalness: NaturalnessDeps = {
    store: deps.store, deviceId: deps.deviceId, onError: (error) => deps.log("naturalness", error), enabled: deps.enabled,
    ...(deps.preimages ? { preimages: deps.preimages } : {}), ...(deps.signal ? { signal: deps.signal } : {}),
  };
  let shown = false;
  for (const s of stored) {
    if (deps.signal?.aborted) break;
    if (await recordNaturalness(naturalness, s)) shown = true;
  }
  return shown;
}
