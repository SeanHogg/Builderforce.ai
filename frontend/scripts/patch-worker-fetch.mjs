/**
 * Post-build patch of the minified `_worker.js` — the one that used to be a bare
 * `sed -i` in the `cf-build` script.
 *
 * ── WHAT IT PATCHES ──────────────────────────────────────────────────────────────
 * next-on-pages routes every static / `override` route through the `assetsFetcher`
 * it destructures out of its request context (`templates/_worker.js/utils/routing.ts`,
 * and again in `utils/images.ts`). That fetcher is `env.ASSETS`, and on some entry
 * paths — a Worker deployed with `--no-bundle` and no ASSETS binding on the request
 * that reached it — it is UNDEFINED at call time, so the request dies with a bare
 * `Cannot read properties of undefined` instead of falling back to the global fetch.
 * Every call through that binding is therefore rewritten to `(x||self).fetch`.
 *
 * ── WHY THE NAME IS DERIVED AND NOT WRITTEN DOWN ─────────────────────────────────
 * The binding is MINIFIER-CHOSEN. It was `r` when this patch was a `sed`; a
 * next-on-pages bump moved it to `n` (measured 2026-08-20, next-on-pages 1.13.16 —
 * the build failed with "no `r.fetch` call found"), and the next bump will move it
 * again. Hard-coding the new letter buys one release and re-arms the same trap, so
 * the letter is READ OUT OF THE BUNDLE instead.
 *
 * What is stable is the PROPERTY name: esbuild renames locals but never the key of
 * an object pattern, so `{ request, assetsFetcher, ctx }` minifies to
 * `{request:e,assetsFetcher:n,ctx:r}` — the destructured binding is whatever follows
 * `assetsFetcher:`, and `assetsFetcher:` itself survives every minifier setting.
 * (The object LITERAL in `index.ts` reads `assetsFetcher:<env>.ASSETS`; a member
 * expression, not a bare identifier, so the lookahead below skips it.)
 *
 * A rewrite is a no-op wherever the binding is truthy — `(n||self).fetch(x)` and
 * `n.fetch(x)` call the same method with the same `this` — so rewriting by name is
 * safe even where the minifier reused the letter in another scope.
 *
 * Zero derivable bindings, or a binding with no call sites, is a hard FAILURE with
 * the surrounding shapes printed: at that point the only safe answers are "the
 * template changed — re-derive it" or "next-on-pages fixed it upstream — delete this
 * patch", and both need a human. The `sed` could not tell those from "already fine";
 * it exited 0 either way, which is how an unpatched worker could ship unnoticed.
 *
 * Deliberately a source-level regex over two token shapes, not a full AST parse: the
 * target is a multi-megabyte minified bundle, parsing it costs more than the whole
 * rest of the build, and the guarantee that matters — "the thing I meant to patch was
 * really there" — comes from the assertion, not from the parser.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const target = resolve(process.cwd(), '.vercel/output/static/_worker.js/index.js');

/**
 * The destructured binding — `assetsFetcher:n` in `{request:e,assetsFetcher:n,ctx:r}`.
 * The lookahead keeps it to a BARE identifier so `assetsFetcher:t.ASSETS` (the object
 * literal that supplies the fetcher) is not mistaken for one.
 */
const BINDING = /\bassetsFetcher\s*:\s*([A-Za-z_$][\w$]*)\s*(?=[,}])/g;
/** `\b` on both sides so `n.fetch` never matches `ctn.fetch` or `n.fetchAll`. */
const callSites = (name) => new RegExp(String.raw`\b${name}\.fetch\b`, 'g');
const patched = (name) => `(${name}||self).fetch`;

let source;
try {
  source = readFileSync(target, 'utf8');
} catch (error) {
  console.error(`[patch-worker-fetch] cannot read ${target}\n${error.message}`);
  console.error('[patch-worker-fetch] run this AFTER `next-on-pages`, from the frontend package root.');
  process.exit(1);
}

/** Why the failures print it: it is the list a human re-derives the binding from. */
const fetchShapes = () => {
  const shapes = [...new Set([...source.matchAll(/\b[A-Za-z_$][\w$]*\.fetch\b/g)].map((m) => m[0]))];
  return shapes.length ? shapes.slice(0, 10).join(', ') : '(none)';
};

const bindings = [...new Set([...source.matchAll(BINDING)].map((m) => m[1]))];

if (bindings.length === 0) {
  console.error('[patch-worker-fetch] FAILED: no `assetsFetcher:` binding found in the worker bundle.');
  console.error('');
  console.error('  next-on-pages no longer destructures its assets fetcher under that name,');
  console.error('  so there is nothing left for this patch to anchor on.');
  console.error('');
  console.error('  Do NOT ignore this: the `sed` this replaced exited 0 in exactly this case,');
  console.error('  which is how an unpatched worker could reach production unnoticed.');
  console.error('');
  console.error(`  \`*.fetch\` call shapes present in the bundle: ${fetchShapes()}`);
  console.error('  Re-derive the binding from that list, or delete this patch if it is obsolete.');
  process.exit(1);
}

let rewritten = 0;
const alreadyPatched = [];
for (const name of bindings) {
  const found = source.match(callSites(name)) ?? [];
  if (found.length === 0) {
    // Idempotence: a rerun over an already-patched bundle is success, not a missing anchor.
    if (source.includes(patched(name))) alreadyPatched.push(name);
    continue;
  }
  source = source.replace(callSites(name), patched(name));
  rewritten += found.length;
}

if (rewritten === 0 && alreadyPatched.length === 0) {
  console.error(`[patch-worker-fetch] FAILED: \`assetsFetcher\` binds ${bindings.join(', ')}, and none of them is ever called.`);
  console.error('');
  console.error('  The binding is still destructured but the `.fetch` call it exists for is gone,');
  console.error('  so this patch is guarding a call site that no longer runs.');
  console.error('');
  console.error(`  \`*.fetch\` call shapes present in the bundle: ${fetchShapes()}`);
  console.error('  Re-derive the call shape from that list, or delete this patch if it is obsolete.');
  process.exit(1);
}

if (rewritten === 0) {
  console.log(`[patch-worker-fetch] already patched (${alreadyPatched.join(', ')}) — nothing to do.`);
  process.exit(0);
}

writeFileSync(target, source);
console.log(`[patch-worker-fetch] patched ${rewritten} call site(s) on \`${bindings.join('`, `')}\` → \`(x||self).fetch\`.`);
