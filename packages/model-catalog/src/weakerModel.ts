/**
 * "Served by a WEAKER model than the run asked for" - THE rule for a run being `degraded` (PRD 35
 * §8.2), whichever host reports it: the ONE agent's outcome row, the legacy embedded runner and the
 * cloud scorer all ask this and nothing else. The catalog owns it because it owns the tier rule
 * (`resolveModelTier`, `tierRank`) and the id rules a model is priced by.
 *
 * Hosts name a model differently: the gateway and the cloud say `anthropic/claude-opus-4.5`; a
 * provider-native runner knows `claude-opus-4-5` and its provider. Both resolve here, through the
 * catalog's own rules (`directCatalogId` / `catalogPriceId` inside the book, and the Anthropic id
 * grammar in `parseAnthropicModelId`) - callers never strip prefixes themselves.
 */

import { parseAnthropicModelId } from './anthropic.js';
import { listPriceOf, type PriceBook } from './priceBook.js';
import { snapshotPriceBook } from './snapshotPriceBook.js';
import { resolveModelTier, tierRank, type ModelTier } from './tier.js';

/**
 * The catalog ids a host's spelling of a model can mean, most specific first: the id as given, then -
 * for a Claude id in Anthropic's native grammar (`claude-opus-4-5`, with or without a provider prefix) -
 * the catalog's dotted `anthropic/claude-opus-4.5` (and the bare-major form for a whole-number release).
 * Pure.
 */
export function catalogIdCandidates(model: string): string[] {
  const ids = [model];
  const claude = parseAnthropicModelId(model.slice(model.lastIndexOf('/') + 1));
  if (claude) {
    const [major, minor] = claude.version;
    ids.push(`anthropic/claude-${claude.family}-${major}.${minor}`);
    if (minor === 0) ids.push(`anthropic/claude-${claude.family}-${major}`);
  }
  return ids;
}

/** A model's catalog tier, or `undefined` when the book does not price it (unknown, never a guess). */
export function tierOfModel(model: string | undefined, book: PriceBook = snapshotPriceBook()): ModelTier | undefined {
  if (!model || model === 'default') return undefined;
  for (const id of catalogIdCandidates(model)) {
    const price = listPriceOf(book, id);
    if (price) return resolveModelTier({ price });
  }
  return undefined;
}

/**
 * Is `served` a WEAKER model than `requested`? Weaker = a worse catalog tier (ULTRA > PREMIUM >
 * STANDARD > FREE). A model the book does not price is UNKNOWN, not weak, and a move to a model of the
 * same standing - or to a stronger one - is not a downgrade. Pure.
 */
export function isWeakerModel(requested: string | undefined, served: string | undefined, book: PriceBook = snapshotPriceBook()): boolean {
  const asked = tierOfModel(requested, book);
  const got = tierOfModel(served, book);
  return asked !== undefined && got !== undefined && tierRank(got) > tierRank(asked);
}
