/**
 * The Worker's binding of the shared `CatalogView` port (`@builderforce/model-catalog`)
 * — how the pure router (`@builderforce/model-router`) reads THIS host's catalog.
 *
 *   • vendor + tier  — the vendor registry (`vendors/`), the routing source of truth;
 *                      tier goes through the shared rule (`resolveModelTier`): each
 *                      vendor declares one for every id it routes, so it always wins.
 *   • residency      — `local` for a vendor that can only be reached through the
 *                      tenant's own runtime ({@link vendorRequiresLocalEgress}), the ONE
 *                      declaration of "runs on the tenant's machine".
 *   • price          — the live provider catalog (`modelCatalog.ts`, read-through
 *                      cached), the same prices the usage ledger records cost from.
 *
 * Prices are loaded only by a caller that will compare them: most calls never reorder
 * on price, and a {@link registryCatalogView} without a price book answers every
 * routing question but cost.
 */

import { resolveModelTier, withPriceTiers, type CatalogView, type ModelPrice } from '@builderforce/model-catalog';
import { poolOrderIsCostFirst } from '@builderforce/model-router';
import { isModelRole } from '@builderforce/agent-tools';
import { isArcStage } from '@builderforce/workload';
import type { Env } from '../../env';
import { getCatalogCached, type CatalogModel } from './modelCatalog';
import { tierForModel, vendorForModel, vendorRequiresLocalEgress } from './vendors';

export interface PriceBook {
  priceOf(model: string): ModelPrice | undefined;
  /**
   * The LIST price used to value a call someone else paid for (a BYO key's spend, the
   * tokens memory kept off a call): `priceOf`, then a direct-vendor id
   * (`direct/minimax/MiniMax-M2.7`) matched to the catalog's `minimax/minimax-m2.7`.
   * Never used for billing — what the platform charges stays on `priceOf`.
   */
  listPriceOf?(model: string): ModelPrice | undefined;
}

/** The catalog id a direct-vendor route names (`direct/<vendor>/<model>` → `<vendor>/<model>`,
 *  lower-cased as the catalog stores it), or `undefined` for any other id. */
export function directCatalogId(model: string): string | undefined {
  return model.startsWith('direct/') ? model.slice('direct/'.length).toLowerCase() : undefined;
}

/** A book's list price for `model` (see `PriceBook.listPriceOf`). */
export function listPriceOf(book: PriceBook, model: string): ModelPrice | undefined {
  return book.listPriceOf ? book.listPriceOf(model) : book.priceOf(model);
}

/** A book that knows no prices — routing degrades to tier order. */
export const EMPTY_PRICE_BOOK: PriceBook = { priceOf: () => undefined };

/**
 * The id the provider catalog prices a routed model under. A registered OpenRouter
 * connection routes as `openrouter/<org>/<model>` while the catalog stores the bare
 * `<org>/<model>`. Every other id is looked up verbatim — the SAME rule the ledger has
 * always priced by, so routing and billing never disagree on what a model costs.
 */
export function catalogPriceId(model: string): string {
  return model.startsWith('openrouter/') ? model.slice('openrouter/'.length) : model;
}

/** One index per catalog SNAPSHOT: the read-through cache hands back the same array
 *  until it refreshes, so the index is built once per refresh, not per call. */
const BOOKS = new WeakMap<readonly CatalogModel[], PriceBook>();

export function priceBookFrom(catalog: readonly CatalogModel[]): PriceBook {
  const cached = BOOKS.get(catalog);
  if (cached) return cached;
  const byId = new Map<string, ModelPrice>();
  const byLowerId = new Map<string, ModelPrice>();
  for (const m of catalog) {
    const price = { input: m.pricing.prompt, output: m.pricing.completion };
    byId.set(m.id, price);
    byLowerId.set(m.id.toLowerCase(), price);
  }
  const priceOf = (model: string) => byId.get(catalogPriceId(model));
  const book: PriceBook = {
    priceOf,
    listPriceOf: (model) => {
      const direct = directCatalogId(model);
      return priceOf(model) ?? (direct ? byLowerId.get(direct) : undefined);
    },
  };
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
    residencyOf: (model) => (vendorRequiresLocalEgress(vendorForModel(model)) ? 'local' : 'cloud'),
  };
}

/** The unpriced view — every routing question but cost. Shared; it holds no state. */
export const REGISTRY_CATALOG_VIEW: CatalogView = registryCatalogView();
