/**
 * The Worker's binding of the shared `CatalogView` port (`@builderforce/model-catalog`)
 * — how the pure router (`@builderforce/model-router`) reads THIS host's catalog.
 *
 *   • vendor + tier  — the vendor registry (`vendors/`), the routing source of truth;
 *                      tier goes through the shared rule (`resolveModelTier`): each
 *                      vendor declares one for every id it routes, so it always wins.
 *   • residency      — `local` for a vendor whose model runs on the tenant's OWN hardware
 *                      ({@link vendorRunsOnDevice}), the ONE declaration of "runs on the
 *                      tenant's machine" (the router costs `local` at zero). NOT a vendor
 *                      that merely refuses the Worker's egress ({@link vendorRequiresLocalEgress}):
 *                      Kimi is called through the tenant's runtime but runs, and is priced,
 *                      in the cloud.
 *   • price          — the live provider catalog (`modelCatalog.ts`, read-through
 *                      cached), the same prices the usage ledger records cost from.
 *
 * Prices are loaded only by a caller that will compare them: most calls never reorder
 * on price, and a {@link registryCatalogView} without a price book answers every
 * routing question but cost.
 */

import {
  EMPTY_PRICE_BOOK,
  priceBookFromPrices,
  resolveModelTier,
  withPriceTiers,
  type CatalogView,
  type ModelPrice,
  type PriceBook,
} from '@builderforce/model-catalog';
import { poolOrderIsCostFirst } from '@builderforce/model-router';
import { isModelRole } from '@builderforce/agent-tools';
import { isArcStage } from '@builderforce/workload';
import type { Env } from '../../env';
import { getCatalogCached, type CatalogModel } from './modelCatalog';
import { tierForModel, vendorForModel, vendorRunsOnDevice } from './vendors';

// The book and its id rules are the shared port (`@builderforce/model-catalog`
// `priceBook.ts`): the VS Code device prices its offline spend through the same one.
export {
  EMPTY_PRICE_BOOK,
  catalogPriceId,
  directCatalogId,
  listPriceOf,
  type PriceBook,
} from '@builderforce/model-catalog';

/** One index per catalog SNAPSHOT: the read-through cache hands back the same array
 *  until it refreshes, so the index is built once per refresh, not per call. */
const BOOKS = new WeakMap<readonly CatalogModel[], PriceBook>();

export function priceBookFrom(catalog: readonly CatalogModel[]): PriceBook {
  const cached = BOOKS.get(catalog);
  if (cached) return cached;
  const book = priceBookFromPrices(
    catalog.map((m) => [m.id, { input: m.pricing.prompt, output: m.pricing.completion }] as const),
  );
  BOOKS.set(catalog, book);
  return book;
}

/** The current price book. Never throws: an unreachable catalog is an empty book. */
export async function loadPriceBook(env: Env): Promise<PriceBook> {
  const catalog = await getCatalogCached(env);
  return catalog.length > 0 ? priceBookFrom(catalog) : EMPTY_PRICE_BOOK;
}

/**
 * The price book a call needs, or `undefined` when it would not read one. Only a
 * COST-FIRST call (explore / utility / verify, after the arc-stage nudge) orders by
 * price, so every other call skips the catalog read entirely. Never throws.
 */
export async function pricesForCall(env: Env, role: unknown, arcStage: unknown): Promise<PriceBook | undefined> {
  const workload = {
    role: isModelRole(role) ? role : undefined,
    arcStage: isArcStage(arcStage) ? arcStage : undefined,
  };
  return poolOrderIsCostFirst(workload) ? loadPriceBook(env) : undefined;
}

/**
 * The registry view, optionally priced. Each price carries the model's long-context
 * tiers (cost PRD C9, `withPriceTiers`), so cost-ordered routing prices a long request
 * at the rate it will actually be billed at, not the flat catalog rate below the step.
 */
export function registryCatalogView(prices: PriceBook = EMPTY_PRICE_BOOK): CatalogView {
  const tieredPriceOf = (model: string): ModelPrice | undefined => {
    const flat = prices.priceOf(model);
    return flat ? withPriceTiers(model, flat) : undefined;
  };
  return {
    vendorOf: vendorForModel,
    tierOf: (model) => resolveModelTier({ catalogTier: tierForModel(model), price: prices.priceOf(model) }),
    priceOf: tieredPriceOf,
    residencyOf: (model) => (vendorRunsOnDevice(vendorForModel(model)) ? 'local' : 'cloud'),
  };
}

/** The unpriced view — every routing question but cost. Shared; it holds no state. */
export const REGISTRY_CATALOG_VIEW: CatalogView = registryCatalogView();
