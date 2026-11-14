#!/usr/bin/env node
/**
 * MEASURE FIRST (PRD 39 §1, step 1): compare the gateway Worker's bundle against
 * the API's with esbuild metafiles, before any deploy config is trusted.
 *
 * `src/gatewayWorker.ts` only earns its split if its import graph stays well under
 * the API bundle (the PRD stops the program at "more than half"). This builds BOTH
 * entries with esbuild, writes the metafiles under out/, prints input counts and
 * byte sizes, and exits 1 if the gateway is >= half the API — printing the largest
 * gateway inputs so the imports holding it there are named, not guessed.
 *
 * Run via `npm run measure:gateway-bundle`. esbuild is not a direct dependency;
 * it is pinned by this package's pnpm override and resolved from node_modules/.pnpm.
 */
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const apiDir = join(here, '..');

function findEsbuild() {
  try {
    return require('esbuild');
  } catch {
    /* not a direct dependency — resolve wrangler's pinned copy */
  }
  const pnpmDir = join(apiDir, 'node_modules', '.pnpm');
  for (const name of readdirSync(pnpmDir)) {
    if (!name.startsWith('esbuild@')) continue;
    try {
      return require(join(pnpmDir, name, 'node_modules', 'esbuild'));
    } catch {
      /* try the next copy */
    }
  }
  throw new Error('esbuild not found under node_modules/.pnpm (run pnpm install)');
}

const esbuild = findEsbuild();

async function measure(entry) {
  const result = await esbuild.build({
    entryPoints: [join(apiDir, 'src', entry)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node', // node builtins are external — the Workers runtime provides them via nodejs_compat
    target: 'es2022',
    sourcemap: false,
    logLevel: 'warning',
    metafile: true,
    outfile: join('out', `${entry.replace(/\.ts$/, '')}.js`),
    loader: { '.png': 'empty', '.jpg': 'empty', '.wasm': 'empty' },
  });
  let inputs = 0;
  let bytes = 0;
  for (const info of Object.values(result.metafile.inputs)) {
    inputs += 1;
    bytes += info.bytes || 0;
  }
  return { inputs, bytes, metafile: result.metafile };
}

(async () => {
  mkdirSync(join(apiDir, 'out'), { recursive: true });
  const gateway = await measure('gatewayWorker.ts');
  writeFileSync(join(apiDir, 'out', 'gateway.metafile.json'), JSON.stringify(gateway.metafile));
  const api = await measure('index.ts');
  writeFileSync(join(apiDir, 'out', 'api.metafile.json'), JSON.stringify(api.metafile));

  console.log(`gateway  inputs=${gateway.inputs}  bytes=${gateway.bytes}`);
  console.log(`api      inputs=${api.inputs}  bytes=${api.bytes}`);
  const ratio = gateway.bytes / api.bytes;
  console.log(`ratio gateway/api = ${ratio.toFixed(3)}`);

  if (gateway.bytes >= api.bytes / 2) {
    console.error('\nMEASURE FAIL: the gateway graph is still >= half the API bundle.');
    console.error('Largest gateway inputs (what holds it there):');
    const top = Object.entries(gateway.metafile.inputs)
      .sort((a, b) => (b[1].bytes || 0) - (a[1].bytes || 0))
      .slice(0, 10);
    for (const [path, info] of top) console.error(`  ${String(info.bytes).padStart(9)}  ${path}`);
    process.exit(1);
  }
  console.log('MEASURE PASS: gateway < half the API bundle.');
})().catch((error) => {
  console.error('MEASURE ERROR:', error && error.message ? error.message : error);
  process.exit(2);
});
