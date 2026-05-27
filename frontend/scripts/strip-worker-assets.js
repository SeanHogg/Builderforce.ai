/**
 * Cloudflare deploy size pruning.
 *
 * Two passes:
 *   1. Copy worker's __next-on-pages-dist__/assets/ to static (keeps the
 *      worker bundle under Cloudflare's 3 MiB Worker-script limit), then
 *      delete the assets dir from the worker.
 *   2. Strip large ORT WASM binaries from the static assets dir. The studio
 *      and the training pipeline both load ORT WASM from a CDN at runtime
 *      via `configureOnnxRuntime()`, so bundling these files only inflates
 *      the deploy (they're 20+ MiB each and would breach the 25 MiB
 *      per-asset cap).
 */
const fs = require('fs');
const path = require('path');

const workerDir = path.join(
  process.cwd(),
  '.vercel/output/static/_worker.js/__next-on-pages-dist__'
);
const assetsSrc = path.join(workerDir, 'assets');
const staticDir = path.join(process.cwd(), '.vercel/output/static');

// ---------------------------------------------------------------------------
// Pass 1: worker → static migration
// ---------------------------------------------------------------------------

if (fs.existsSync(assetsSrc)) {
  const names = fs.readdirSync(assetsSrc);
  for (const n of names) {
    const full = path.join(assetsSrc, n);
    if (fs.statSync(full).isFile()) {
      const dest = path.join(staticDir, n);
      fs.copyFileSync(full, dest);
      console.log('Copied to static:', n);
    }
  }
  for (const n of names) {
    const full = path.join(assetsSrc, n);
    if (fs.statSync(full).isFile()) fs.unlinkSync(full);
  }
  fs.rmdirSync(assetsSrc);
  console.log('Removed worker __next-on-pages-dist__/assets/ (saves ~21 MiB from worker bundle).');
} else {
  console.log('No worker assets dir to strip; skipping pass 1.');
}

// ---------------------------------------------------------------------------
// Pass 2: drop ORT WASM from static (loaded from CDN at runtime)
// ---------------------------------------------------------------------------

// Matches: ort-wasm-*.wasm, ort-wasm-*.wasm.bin, ort-training-*.wasm[.bin],
// any next-on-pages-renamed variant with a content hash inside the name.
const ORT_WASM_PATTERN = /^ort-(wasm|training).*\.wasm(\.bin)?$/i;

let stripped = 0;
let strippedBytes = 0;
function walkAndStrip(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip _worker.js (handled elsewhere) but recurse the rest of static.
      if (entry.name === '_worker.js') continue;
      walkAndStrip(full);
      continue;
    }
    if (ORT_WASM_PATTERN.test(entry.name)) {
      const size = fs.statSync(full).size;
      fs.unlinkSync(full);
      stripped += 1;
      strippedBytes += size;
      console.log(`Stripped ${(size / 1024 / 1024).toFixed(1)} MiB ORT WASM:`, entry.name);
    }
  }
}
walkAndStrip(staticDir);
console.log(
  `Stripped ${stripped} ORT WASM file${stripped === 1 ? '' : 's'} ` +
    `(${(strippedBytes / 1024 / 1024).toFixed(1)} MiB total) from static assets — runtime loads from CDN.`
);
