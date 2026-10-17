/**
 * The engine binary's URL, written the one way every asset-aware bundler recognises:
 * a RELATIVE `new URL(…, import.meta.url)` inside this package. webpack 5 and Turbopack
 * (the web app) emit `bfi_web_bg.wasm` as a static asset and rewrite this to its served
 * path. Hand-written, not part of the wasm-pack output — `scripts/vendor-bfi-web.mjs`
 * never overwrites it. Vite hosts use `@seanhogg/bfi-web/bfi_web_bg.wasm?url` instead,
 * and Rovr copies the file and passes `chrome.runtime.getURL`.
 */
export const bfiWasmUrl = new URL('./bfi_web_bg.wasm', import.meta.url);
