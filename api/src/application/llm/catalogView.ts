/**
 * The Worker's binding of the shared `CatalogView` port (`@builderforce/model-catalog`)
 * — how the pure router (`@builderforce/model-router`) reads THIS host's catalog.
 *
 *   • vendor + tier  — the vendor registry (`vendors/`), the routing source of truth.
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

import type { CatalogView, ModelPrice } from '@builderforce/model-catalog';
import { poolOrderIsCostFirst } from '@builderforce/model-router';
import { isModelRole } from '@builderforce/agent-tools';
import { isArcStage } from '@builderforce/workload';
import type { Env } from '../../env';
import { getCatalogCached, type CatalogModel } from './modelCatalog';
import { tierForModel, vendorForModel, vendorRequiresLocalEgress } from './vendors';

export interface PriceBook {
  priceOf(model: string): ModelPrice | undefined;
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
  for (const m of catalog) byId.set(m.id, { input: m.pricing.prompt, output: m.pricing.completion });
  const book: PriceBook = { priceOf: (model) => byId.get(catalogPriceId(model)) };
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

/** The registry view, optionally priced. */
export function registryCatalogView(prices: PriceBook = EMPTY_PRICE_BOOK): CatalogView {
  return {
    vendorOf: vendorForModel,
    tierOf: tierForModel,
    priceOf: (model) => prices.priceOf(model),
    residencyOf: (model) => (vendorRequiresLocalEgress(vendorForModel(model)) ? 'local' : 'cloud'),
  };
}

/** The unpriced view — every routing question but cost. Shared; it holds no state. */
export const REGISTRY_CATALOG_VIEW: CatalogView = registryCatalogView();
