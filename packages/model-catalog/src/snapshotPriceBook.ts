/**
 * The price book a DEVICE prices with — the snapshot shipped in this package
 * (`generated/priceSnapshot.ts`, regenerated each release by
 * `scripts/gen-price-snapshot.mjs`), read through the same {@link PriceBook} port and id
 * rules the gateway prices its live catalog with. Each price carries the model's
 * long-context tiers (`withPriceTiers`), exactly as the gateway's routing view does.
 */

import { PRICE_SNAPSHOT } from './generated/priceSnapshot.js';
import { priceBookFromPrices, type PriceBook } from './priceBook.js';
import { withPriceTiers } from './priceTiers.js';

let book: PriceBook | undefined;

/** The bundled snapshot as a price book. Built once, on first use. */
export function snapshotPriceBook(): PriceBook {
  book ??= priceBookFromPrices(
    Object.entries(PRICE_SNAPSHOT).map(([id, [input, output]]) => [id, withPriceTiers(id, { input, output })] as const),
  );
  return book;
}
