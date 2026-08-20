/**
 * Post-build patch of the minified `_worker.js` — the one that used to be a bare
 * `sed -i` in the `cf-build` script.
 *
 * ── WHAT IT PATCHES ──────────────────────────────────────────────────────────────
 * next-on-pages emits a bundle that calls `r.fetch(...)`, where `r` is the minified
 * binding for the Workers runtime object. On some entry paths that binding is
 * undefined at call time and the request dies with a bare runtime error, so every
 * `r.fetch` is rewritten to `(r||self).fetch`.
 *
 * ── WHY IT IS NOT A `sed` ANY MORE ───────────────────────────────────────────────
 * `r` is a MINIFIER-CHOSEN name. Nothing pins it: a next-on-pages bump, an esbuild
 * version change, or one more top-level binding in the chunk and it becomes `n`.
 * `sed` cannot tell "already fine" from "anchor gone" — it exits 0 either way, so the
 * failure mode was a SILENT one: the patch stops applying, the build stays green, and
 * the broken bundle ships to production.
 *
 * This script asserts the anchor instead. Zero matches is a hard FAILURE with the
 * surrounding context printed, because at that point the only safe answers are "the
 * minified name changed — re-derive it" or "next-on-pages fixed it upstream — delete
 * this patch", and both need a human.
 *
 * Deliberately a source-level regex over the ONE token shape, not a full AST parse:
 * the target is a multi-megabyte minified bundle, parsing it costs more than the whole
 * rest of the build, and the guarantee that actually matters — "the thing I meant to
 * patch was really there" — comes from the assertion, not from the parser.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const target = resolve(process.cwd(), '.vercel/output/static/_worker.js/index.js');

/** `\b` on both sides so `r.fetch` never matches `ctr.fetch` or `r.fetchAll`. */
const ANCHOR = /\br\.fetch\b/g;
const REPLACEMENT = '(r||self).fetch';
/** Already-patched output contains this; used to tell "no-op rerun" from "anchor gone". */
const PATCHED = '(r||self).fetch';

let source;
try {
  source = readFileSync(target, 'utf8');
} catch (error) {
  console.error(`[patch-worker-fetch] cannot read ${target}\n${error.message}`);
  console.error('[patch-worker-fetch] run this AFTER `next-on-pages`, from the frontend package root.');
  process.exit(1);
}

const matches = source.match(ANCHOR) ?? [];

if (matches.length === 0) {
  // Idempotence: a rerun over an already-patched bundle is success, not a missing anchor.
  if (source.includes(PATCHED)) {
    console.log('[patch-worker-fetch] already patched — nothing to do.');
    process.exit(0);
  }
  console.error('[patch-worker-fetch] FAILED: no `r.fetch` call found in the worker bundle.');
  console.error('');
  console.error('  The minified binding this patch anchors on has changed name, or');
  console.error('  next-on-pages no longer emits the call at all.');
  console.error('');
  console.error('  Do NOT ignore this: the previous `sed` exited 0 in exactly this case,');
  console.error('  which is how an unpatched worker could reach production unnoticed.');
  console.error('');
  const sample = [...source.matchAll(/\b[A-Za-z_$][\w$]*\.fetch\b/g)].slice(0, 10).map((m) => m[0]);
  console.error(`  \`*.fetch\` call shapes present in the bundle: ${sample.length ? [...new Set(sample)].join(', ') : '(none)'}`);
  console.error('  Re-derive the binding from that list, or delete this patch if it is obsolete.');
  process.exit(1);
}

writeFileSync(target, source.replace(ANCHOR, REPLACEMENT));
console.log(`[patch-worker-fetch] patched ${matches.length} \`r.fetch\` call site(s) → \`${REPLACEMENT}\`.`);
