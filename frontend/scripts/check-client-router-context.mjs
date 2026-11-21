#!/usr/bin/env node
/**
 * ONE copy of Next's `app-router-context` in the browser bundle.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * 2026-11-21: every page of builderforce.ai crashed on load with
 *
 *     Error: invariant expected layout router to be mounted
 *
 * `CanonicalPackagePathsPlugin` (next.config.js) re-keyed `next` to
 * `frontend/node_modules/next` in the server compilation only. The RSC client-reference
 * manifest carries the SERVER's module paths, so the browser bundle got `layout-router`
 * through the re-keyed path and the app bootstrap through the original `.pnpm` one —
 * two `app-router-context` modules, two `LayoutRouterContext` objects. The router
 * provided one and the root page slot read the other, so the slot always saw `null`.
 *
 * Nothing caught it: the build, the type check and every unit test pass, and the
 * server-rendered HTML is correct. Only the browser hydrating it fails. This guard
 * reads the emitted client chunks and fails when that module appears more than once.
 *
 * ── HOW IT FINDS IT ──────────────────────────────────────────────────────────
 * The module's export list (`AppRouterContext`, `GlobalLayoutRouterContext`,
 * `LayoutRouterContext`, `MissingSlotContext`, `TemplateContext`) survives
 * minification as property names, so each emitted copy is one match of that list.
 *
 * Run via `npm run check:client-router-context`; wired into `cf-build`.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const chunksDir = resolve(root, '.next/static/chunks');

if (!existsSync(chunksDir)) {
  console.error(`check-client-router-context: ${relative(root, chunksDir)} not found — run \`next build\` first.`);
  process.exit(1);
}

const MODULE_SIGNATURE =
  /AppRouterContext:function\(\)\{[^}]*\},GlobalLayoutRouterContext:function\(\)\{[^}]*\},LayoutRouterContext:function\(\)\{[^}]*\},MissingSlotContext:function\(\)\{[^}]*\},TemplateContext:function\(\)\{/g;

function* jsFiles(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* jsFiles(full);
    else if (name.endsWith('.js')) yield full;
  }
}

const copies = [];
for (const file of jsFiles(chunksDir)) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(MODULE_SIGNATURE)) {
    copies.push(`${relative(root, file)} @ ${match.index}`);
  }
}

if (copies.length === 0) {
  console.error(
    'check-client-router-context: found NO copy of the app-router-context module. The signature no longer '
      + 'matches this Next version — update MODULE_SIGNATURE rather than deleting the guard.',
  );
  process.exit(1);
}
if (copies.length > 1) {
  console.error(`check-client-router-context: ${copies.length} copies of Next's app-router-context in the browser bundle:`);
  for (const copy of copies) console.error(`  ${copy}`);
  console.error(
    'The router provides one LayoutRouterContext and layout-router reads another, so every page crashes with '
      + '"invariant expected layout router to be mounted". A webpack plugin or alias is resolving `next` through '
      + 'two paths, or the same file is instantiated once per webpack layer — see CanonicalPackagePathsPlugin '
      + 'in next.config.js.',
  );
  process.exit(1);
}
console.log('check-client-router-context: one app-router-context module in the browser bundle.');
