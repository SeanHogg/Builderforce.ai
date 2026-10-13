/**
 * The page-review kit published to the CDN (PRD 33 §5.2): THE selector derivation
 * and THE visual patch, as an IIFE global (`BuilderforcePageKit`).
 *
 * The capture runner (`api/qa-container/pageCapture.mjs`) is plain Node and cannot
 * import the TypeScript contract, so it injects this bundle into the page under
 * review — the rect map it builds names elements with the same `deriveSelector` the
 * recorder used for clicks and heat, and `page_render_after` applies a patch with
 * the same `applyVisualPatch` the API validated against. One derivation, one patch
 * semantics, no copy in JavaScript to drift.
 */
export { applyVisualPatch, deriveSelector, selectorIndex } from '@builderforce/interaction-contract';
