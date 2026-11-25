/**
 * What `./messages/en.json` resolves to in the EDGE server build (aliased in
 * `next.config.js`): no bundled catalog. `./catalog` then reads the default locale
 * from its published static asset — see `primeDefaultCatalog`. Never imported
 * directly.
 */
const unbundled: undefined = undefined;
export default unbundled;
