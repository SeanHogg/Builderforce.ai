#!/usr/bin/env node
/**
 * Cloudflare Worker size budget.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * A Worker script has a hard 10 MiB COMPRESSED ceiling, and until this guard the only
 * thing that measured it was Cloudflare, at upload, at the very end of a deploy:
 *
 *     ✘ [ERROR] Your Worker failed validation because it exceeded size limits.
 *       Your Worker exceeded the size limit of 10 MiB. [code: 10027]
 *
 * That arrives roughly eleven minutes into `cf-build` — after `next build`, after
 * `next-on-pages`, after the asset strip — and it names no file, so it tells you that
 * you are over without telling you by how much or because of what. Worse, it is a
 * CLIFF: the bundle grows a few hundred KB per feature and everything is green until
 * one route tips it, at which point the deploy that breaks is whichever one happened
 * to be next rather than the one that added the weight.
 *
 * So the budget is measured HERE, immediately after the bundle exists, and the failure
 * names the largest modules. Same argument as every ratchet in `api/scripts`: a limit
 * nothing checks is a limit you discover by hitting it.
 *
 * ── WHAT IT MEASURES ─────────────────────────────────────────────────────────
 * Every `*.js` module under `_worker.js`, because `wrangler.toml` uploads exactly that
 * (`find_additional_modules` + `rules: [{ type: 'ESModule', globs: ['**\/*.js'] }]`).
 * Static assets are NOT counted: `strip-worker-assets.js` has already moved them to the
 * assets directory, which has its own separate per-file cap.
 *
 * Compressed, because that is what Cloudflare weighs. The whole bundle is gzipped as
 * one stream rather than per file and summed — summing per-file overstates the total
 * (every module pays its own dictionary), and overstating a budget produces a guard
 * that fails builds which would in fact have deployed.
 *
 * Run via `npm run check:worker-size`; wired into `cf-build` after the bundle is built.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const workerDir = resolve(here, '../.vercel/output/static/_worker.js');

const MIB = 1024 * 1024;
/** Cloudflare's hard ceiling. Not a number this repo chooses. */
const LIMIT_BYTES = 10 * MIB;
/**
 * Fail below the ceiling, so the build that trips this is the one that added the
 * weight rather than the next one after it. A deploy at 99% of the limit is not a
 * healthy deploy; it is the one before the outage.
 */
const BUDGET_BYTES = Math.floor(LIMIT_BYTES * 0.9);

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

let files;
try {
  files = collect(workerDir);
} catch {
  console.error(
    `❌  check-worker-size: no worker bundle at ${relative(process.cwd(), workerDir)}.\n` +
    '   This runs AFTER the bundle is built — invoke it through `npm run cf-build`.\n',
  );
  process.exit(1);
}

if (files.length === 0) {
  console.error('❌  check-worker-size: the worker directory holds no .js modules — the build produced nothing to upload.\n');
  process.exit(1);
}

const sized = files
  .map((file) => ({ file, bytes: statSync(file).size }))
  .sort((a, b) => b.bytes - a.bytes);

const raw = sized.reduce((total, entry) => total + entry.bytes, 0);
// One stream, in descending size order — deterministic, and the closest cheap
// approximation of what Cloudflare compresses.
const compressed = gzipSync(Buffer.concat(sized.map((entry) => readFileSync(entry.file)))).length;

const mib = (bytes) => `${(bytes / MIB).toFixed(2)} MiB`;
const pct = ((compressed / LIMIT_BYTES) * 100).toFixed(1);

if (compressed > BUDGET_BYTES) {
  const over = compressed > LIMIT_BYTES;
  console.error(
    `❌  check-worker-size: the Worker bundle is ${mib(compressed)} compressed ` +
    `(${mib(raw)} raw across ${files.length} modules) — ${pct}% of Cloudflare's ${mib(LIMIT_BYTES)} limit.\n`,
  );
  console.error(over
    ? '   This WILL be rejected at upload (error 10027).\n'
    : `   Budget is ${mib(BUDGET_BYTES)} (90% of the limit), so this fails here rather than\n` +
      '   letting the next feature be the one that tips it.\n');
  console.error('   Largest modules:\n');
  for (const entry of sized.slice(0, 15)) {
    console.error(`     ${mib(entry.bytes).padStart(9)}  ${relative(workerDir, entry.file).split('\\').join('/')}`);
  }
  console.error(
    '\n   What actually reduces this: a route function carries everything it can REACH,\n' +
    '   so the lever is what the server renders, not what the browser downloads. Load a\n' +
    "   heavy component with `dynamic(..., { ssr: false })` so it never enters the edge\n" +
    '   bundle, keep large data out of module scope (the message catalogs are fetched as\n' +
    '   assets for exactly this reason — see src/i18n/catalog.ts), and prefer a server\n' +
    '   component over a client-rooted page, which drags its whole import subtree in.\n',
  );
  process.exit(1);
}

console.log(
  `✅  Worker size OK — ${mib(compressed)} compressed (${mib(raw)} raw, ${files.length} modules), ` +
  `${pct}% of the ${mib(LIMIT_BYTES)} limit.`,
);
