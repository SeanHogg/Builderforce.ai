/**
 * Copy ORT/WASM assets from the worker bundle to static assets, then remove
 * them from the worker so the deploy stays under Cloudflare's 3 MiB limit.
 * The client loads these from the same origin (static assets).
 */
const fs = require('fs');
const path = require('path');

const workerDir = path.join(
  process.cwd(),
  '.vercel/output/static/_worker.js/__next-on-pages-dist__'
);
const assetsSrc = path.join(workerDir, 'assets');
const staticDir = path.join(process.cwd(), '.vercel/output/static');

if (!fs.existsSync(assetsSrc)) {
  console.log('No worker assets dir to strip; skipping.');
  process.exit(0);
}

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
