/**
 * What ONE model call cost, priced on the device — the figure a run's USD budget
 * accrues (`runStore/runSpendBudget.ts`) and the route report sums from the run usage
 * ledger (`routeLedger.ts`). The rule is `@builderforce/spend-contract`'s
 * `computeCostMillicents` over the release's bundled price book, so the device and the
 * api's ledger price a call with the same arithmetic.
 *
 * It is the device's ONE cost rule for a call, keyed by the call's TRANSPORT route
 * (`UsageRoute`, the ledger row's `route`): the run budget, the route report and the
 * chat spend panel's slices (`ledgerSpend.ts` `sliceOf`) all price through it.
 *
 *   - `local` — served on this machine: costs nothing.
 *   - `gateway` — what the platform bills: the catalog price (`priceOf`).
 *   - `byo-direct` — a provider the person keys directly, valued at LIST
 *     (`listPriceOf`, which also resolves `direct/<vendor>/<model>` ids): it is their own
 *     money, so it counts toward a budget and the spend total. The spend panel still
 *     shows it as "your key", never as platform spend (`isOwnKeySpend`).
 *
 * A route left out is read from the model id, as the stream would (`usageRouteOf`).
 */

import { hostedCatalogId, hostedDirectRef, runsOnDevice } from '@builderforce/local-inference';
import { directCatalogId, listPriceOf, snapshotPriceBook, type PriceBook } from '@builderforce/model-catalog';
import { computeCostMillicents } from '@builderforce/spend-contract';
import type { UsageRoute } from './usageLedger';

/** One call's token counts, as the stream or the ledger reports them. */
export interface CallTokens {
  prompt: number;
  completion: number;
  cacheRead?: number;
  cacheCreation?: number;
}

const n = (v: number | undefined): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** The route a model id alone implies — what a caller without the row's route prices by. */
function routeOfModel(model: string): UsageRoute {
  if (runsOnDevice(model)) return 'local';
  if (hostedDirectRef(model) !== undefined) return 'byo-direct';
  return directCatalogId(model) !== undefined ? 'byo-direct' : 'gateway';
}

/** True when a call on `route` is the person's own spend (their key), not the platform's. */
export function isOwnKeySpend(route: UsageRoute): boolean {
  return route === 'byo-direct';
}

/**
 * The id a call is priced under. A hosted local-grammar runtime's model (Kimi Code) is priced under the
 * catalog id its registry alias names (`local/kimi-code/k3` → `moonshotai/kimi-k3`), else under its direct
 * spelling (a live gateway book may know it); any other model under its own id.
 */
function pricedId(model: string): string {
  return hostedCatalogId(model) ?? hostedDirectRef(model) ?? model;
}

/**
 * The call's cost in millicents: 0 for a call on the device, the priced figure otherwise, and UNDEFINED
 * when the call is not on the device and no price is known for it (a model the book does not carry, a
 * hosted model with no registry alias). Unknown is not free: the spend cap flags it and the ledger
 * reports the tokens as unpriced, rather than valuing the call at zero.
 */
export function callCostOrUnknown(
  model: string | undefined,
  tokens: CallTokens,
  book: PriceBook = snapshotPriceBook(),
  route?: UsageRoute,
): number | undefined {
  if (!model) return undefined;
  const via = route ?? routeOfModel(model);
  // The route already says whether the device answered; the model id is not consulted again.
  if (via === 'local') return 0;
  const priced = pricedId(model);
  const price = isOwnKeySpend(via) ? listPriceOf(book, priced) : book.priceOf(priced);
  if (!price) return undefined;
  const prompt = n(tokens.prompt);
  const completion = n(tokens.completion);
  return computeCostMillicents({ prompt: price.input, completion: price.output }, {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: prompt + completion,
    cacheReadTokens: Math.min(n(tokens.cacheRead), prompt),
    cacheCreationTokens: Math.min(n(tokens.cacheCreation), prompt),
  });
}

/** {@link callCostOrUnknown} as a plain number, for a report that prints a figure (an unknown prints as 0).
 *  The spend cap and the ledger do NOT use this: they must see the difference. */
export function callCostMillicents(
  model: string | undefined,
  tokens: CallTokens,
  book: PriceBook = snapshotPriceBook(),
  route?: UsageRoute,
): number {
  return callCostOrUnknown(model, tokens, book, route) ?? 0;
}
