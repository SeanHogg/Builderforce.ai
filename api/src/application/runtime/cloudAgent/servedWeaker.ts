/**
 * "Was this cloud turn served by a WEAKER model than the run asked for?" - decided ONCE PER TURN, where the
 * turn is recorded (`recordCloudLlmTurn`), by the catalog's one rule (`isWeakerModel`), and written on the
 * turn's `llm.complete` event. The outcome scorer only READS the flag back (`scoreRunOutcome`): it never
 * re-derives it from a sample of events, and it does not depend on `coding_model_degraded` (which fires only
 * for a model that is not a curated coder, so a curated-but-weaker coder - ULTRA asked, STANDARD served -
 * never raised it).
 */

import { isWeakerModel, listPriceOf, snapshotPriceBook, type PriceBook } from '@builderforce/model-catalog';
import { loadPriceBook } from '../../llm/catalogView';
import type { Env } from '../../../env';

/** The `llm.complete` detail key the verdict rides on, and the exact text the scorer filters for. */
export const WEAKER_SERVED_KEY = 'weaker';
export const WEAKER_SERVED_MARKER = JSON.stringify({ [WEAKER_SERVED_KEY]: true }).slice(1, -1);

/** The Worker's live catalog view where it prices a model, the bundled snapshot for one it does not. */
function liveOverSnapshot(live: PriceBook): PriceBook {
  const snapshot = snapshotPriceBook();
  return {
    priceOf: (model) => live.priceOf(model) ?? snapshot.priceOf(model),
    listPriceOf: (model) => listPriceOf(live, model) ?? listPriceOf(snapshot, model),
  };
}

/** Whether `served` is a weaker catalog tier than `requested` (a model the books cannot rank is unknown, not weak). */
export async function servedWeakerThanRequested(env: Env, requested: string | undefined, served: string | undefined): Promise<boolean> {
  if (!requested || !served) return false;
  return isWeakerModel(requested, served, liveOverSnapshot(await loadPriceBook(env)));
}
