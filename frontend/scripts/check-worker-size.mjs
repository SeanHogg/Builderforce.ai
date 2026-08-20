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
 * WARN here; fail only at the ceiling above.
 *
 * The first cut failed at 90%, so the build that tripped the guard would be the one that
 * added the weight rather than the next one. Measuring the real bundle retired that idea:
 * this app sits legitimately close to the ceiling, and a gate that rejects deploys
 * Cloudflare would accept is a gate somebody switches off — after which it guards
 * nothing. So the FAILURE is Cloudflare's own limit, and 90% is a loud warning carrying
 * the same module breakdown.
 */
const WARN_BYTES = Math.floor(LIMIT_BYTES * 0.9);

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

if (compressed > WARN_BYTES) {
  const over = compressed > LIMIT_BYTES;
  const say = over ? console.error : console.warn;

  say(
    `${over ? '\u274c' : '\u26a0\ufe0f '}  check-worker-size: the Worker bundle is ${mib(compressed)} compressed ` +
    `(${mib(raw)} raw across ${files.length} modules) \u2014 ${pct}% of Cloudflare's ${mib(LIMIT_BYTES)} limit.\n`,
  );
  say(over
    ? '   This WILL be rejected at upload (error 10027).\n'
    : '   Still deployable, but the headroom is nearly gone \u2014 the next feature is liable to\n' +
      '   be the one that tips it, and the error when that happens names no file.\n');

  say('   Largest modules:\n');
  for (const entry of sized.slice(0, 15)) {
    say(`     ${mib(entry.bytes).padStart(9)}  ${relative(workerDir, entry.file).split('\\').join('/')}`);
  }

  say(
    '\n   What actually reduces this: a route function carries everything it can REACH,\n' +
    '   so the lever is what the SERVER renders, not what the browser downloads.\n' +
    '     \u2022 Load a heavy component with `dynamic(..., { ssr: false })` so it never enters\n' +
    '       the edge bundle at all.\n' +
    '     \u2022 Keep large data out of module scope \u2014 the message catalogs are fetched as\n' +
    '       static assets for exactly this reason (see src/i18n/catalog.ts).\n' +
    '     \u2022 Prefer a server component over a client-rooted page, which drags its whole\n' +
    '       import subtree in.\n' +
    '     \u2022 Look for a BARREL. `simple-icons` is ONE 4.98 MiB module with no per-icon\n' +
    '       entry points, so importing 31 icons from it shipped all ~3,300 \u2014 and because a\n' +
    '       server component resolves the CommonJS build, which cannot be tree-shaken, it\n' +
    '       arrived whole. Fixed by generating a subset: scripts/gen-brand-paths.mjs.\n',
  );

  /*
   * WHAT IS ACTUALLY IN THE BIGGEST ONE.
   *
   * The list above says WHICH file is heavy; it cannot say why, and guessing from the
   * dependency list is how an afternoon disappears — a plausible 4.98 MiB barrel import
   * was blamed for this bundle, and removing it left the chunk hash byte-for-byte
   * identical. So this reports evidence instead: the largest embedded STRING LITERALS,
   * which is what data-shaped weight looks like (JSON, base64, path data, wordlists), and
   * the most repeated long identifiers, which is what code-shaped weight looks like.
   */
  const biggest = sized[0];
  if (biggest) {
    const text = readFileSync(biggest.file, 'utf8');
    say(`\n   Inside ${relative(workerDir, biggest.file).split('\\').join('/')}:\n`);

    const literals = [...text.matchAll(/"((?:[^"\\]|\\.){2000,})"|'((?:[^'\\]|\\.){2000,})'/g)]
      .map((m) => m[1] ?? m[2] ?? '')
      .sort((a, b) => b.length - a.length)
      .slice(0, 8);

    if (literals.length > 0) {
      const held = literals.reduce((total, literal) => total + literal.length, 0);
      say(`     largest embedded strings (${mib(held)} across the top ${literals.length}):`);
      for (const literal of literals) {
        const preview = literal.slice(0, 70).replace(/\s+/g, ' ');
        say(`       ${String(Math.round(literal.length / 1024)).padStart(6)} KB  ${preview}…`);
      }
    } else {
      say('     no large embedded strings — this chunk is CODE, not data.');
    }

    const freq = new Map();
    const SCAN_BYTES = 4 * MIB;
    // Bounded at 40 chars: a real identifier is not 400 long -- past that it is data
    // (base64, a hash, a key) wearing an identifier's shape. Sampled because counting
    // every match over megabytes builds one Map entry per unique base64 run and dies
    // before reporting; a webpack chunk repeats its identifiers, so the head is
    // representative.
    for (const [ident] of text.slice(0, SCAN_BYTES).matchAll(/[A-Za-z_$][A-Za-z0-9_$]{11,39}/g)) {
      freq.set(ident, (freq.get(ident) ?? 0) + 1);
    }
    const top = [...freq.entries()]
      .sort((a, b) => b[1] * b[0].length - a[1] * a[0].length)
      .slice(0, 12);
    say(`\n     most repeated long identifiers (by length × count${text.length > SCAN_BYTES ? `, first ${mib(SCAN_BYTES)} sampled` : ''}):`);
    for (const [ident, n] of top) say(`       ${String(n).padStart(6)}x  ${ident}`);
    say('');
  }

  // Only a bundle Cloudflare would REJECT fails the build. The warning above is loud on
  // purpose; failing early on a deploy that would have worked is how a guard gets muted.
  if (over) process.exit(1);
} else {
  console.log(
    `✅  Worker size OK — ${mib(compressed)} compressed (${mib(raw)} raw, ${files.length} modules), ` +
    `${pct}% of the ${mib(LIMIT_BYTES)} limit.`,
  );
}
