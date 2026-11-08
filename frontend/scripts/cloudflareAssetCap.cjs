/**
 * Cloudflare rejects a static asset over 25 MiB. ONE definition of that cap and of
 * the ORT wasm strip decision, shared by `copy-ort-runtime.mjs` (publishes
 * `public/ort/`) and `strip-worker-assets.js` (prunes the deploy output) so the two
 * can never disagree about which runtime files ship.
 *
 * CommonJS so both the ESM and the CJS script can load it.
 */

const MAX_ASSET_BYTES = 25 * 1024 * 1024;

// Matches: ort-wasm-*.wasm, ort-wasm-*.wasm.bin, ort-training-*.wasm[.bin],
// any next-on-pages-renamed variant with a content hash inside the name.
const ORT_WASM_PATTERN = /^ort-(wasm|training).*\.wasm(\.bin)?$/i;

/** 'strip' only for an ORT wasm the platform would reject; everything else under the cap ships. */
function ortWasmDecision(name, size) {
  return ORT_WASM_PATTERN.test(name) && size > MAX_ASSET_BYTES ? 'strip' : 'keep';
}

module.exports = { MAX_ASSET_BYTES, ORT_WASM_PATTERN, ortWasmDecision };
