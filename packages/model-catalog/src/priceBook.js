/**
 * The PRICE BOOK port — "what does this model cost per token" — and the id rules every
 * host prices a routed model by. The gateway binds it to its live provider catalog
 * (`api/.../catalogView.ts`); a device binds it to the snapshot shipped in this package
 * (`snapshotPriceBook`), so a figure priced offline and one priced by the ledger read the
 * same ids the same way. A reader of the book never knows which one it holds.
 */
/** The catalog id a direct-vendor route names (`direct/<vendor>/<model>` → `<vendor>/<model>`,
 *  lower-cased as the catalog stores it), or `undefined` for any other id. */
export function directCatalogId(model) {
    return model.startsWith('direct/') ? model.slice('direct/'.length).toLowerCase() : undefined;
}
/**
 * The id the provider catalog prices a routed model under. A registered OpenRouter
 * connection routes as `openrouter/<org>/<model>` while the catalog stores the bare
 * `<org>/<model>`. Every other id is looked up verbatim — the SAME rule the ledger has
 * always priced by, so routing and billing never disagree on what a model costs.
 */
export function catalogPriceId(model) {
    return model.startsWith('openrouter/') ? model.slice('openrouter/'.length) : model;
}
/** A book's list price for `model` (see `PriceBook.listPriceOf`). */
export function listPriceOf(book, model) {
    return book.listPriceOf ? book.listPriceOf(model) : book.priceOf(model);
}
/** A book that knows no prices — routing degrades to tier order. */
export const EMPTY_PRICE_BOOK = { priceOf: () => undefined };
/** A book over `(catalog id, price)` pairs, with the id rules above. Pure. */
export function priceBookFromPrices(prices) {
    const byId = new Map();
    const byLowerId = new Map();
    for (const [id, price] of prices) {
        byId.set(id, price);
        byLowerId.set(id.toLowerCase(), price);
    }
    const priceOf = (model) => byId.get(catalogPriceId(model));
    return {
        priceOf,
        listPriceOf: (model) => {
            const direct = directCatalogId(model);
            return priceOf(model) ?? (direct ? byLowerId.get(direct) : undefined);
        },
    };
}
//# sourceMappingURL=priceBook.js.map