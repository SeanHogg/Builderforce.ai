#!/usr/bin/env node
/**
 * Root-route matrix guard — the deploy-time half of `rootRoutes.test.ts`.
 *
 * `src/middleware.ts` hard-404s any single-segment root path absent from
 * `lib/rootRoutes.ts`'s declared tables (`isUnknownRootSlug`), because
 * `app/[burnrateDomain]/page.tsx` is a catch-all over the whole root level and
 * a mistyped URL used to get a soft 404 — branded body, 200 status. That is
 * correct for a typo. It is a live-site outage for a real route: `/learning`,
 * `/method` and `/investor` all shipped and 404'd in production because their
 * `src/app/<segment>/` directories were never added to `APP_ROUTE_SEGMENTS` —
 * `rootRoutes.test.ts` asserts exactly this and would have caught all three,
 * but nothing in the deploy job runs vitest (`pnpm run check` — this
 * manifest — is the only gate `wrangler deploy` waits on; the full suite in
 * `npm test` takes long enough that it was deliberately kept out of the
 * per-deploy path, per the release workflow's own comment). This guard
 * reproduces the one assertion that actually broke production, in the same
 * few milliseconds every other guard here runs in, so a route stops shipping
 * silently 404ing rather than being caught only by someone running `npm test`
 * locally — which nothing requires before a push.
 *
 * Run via `npm run check:root-routes`; wired into `npm test` and the frontend
 * deploy job via `pnpm run check`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'src');

const failures = [];
const fail = (message) => failures.push(message);

// ── Every directory under src/app must be declared ─────────────────────────
const appDirs = readdirSync(resolve(SRC, 'app'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('['))
  .map((e) => e.name)
  .sort();

const rootRoutesSource = readFileSync(resolve(SRC, 'lib', 'rootRoutes.ts'), 'utf8');
const appSegmentsBlock = rootRoutesSource.match(/export const APP_ROUTE_SEGMENTS[\s\S]*?\];/)?.[0];
if (!appSegmentsBlock) fail('[rootRoutes] APP_ROUTE_SEGMENTS could not be located in rootRoutes.ts.');
const declaredAppSegments = [...(appSegmentsBlock ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();

for (const dir of appDirs) {
  if (!declaredAppSegments.includes(dir)) {
    fail(
      `[rootRoutes] \`src/app/${dir}/\` exists but is not declared in APP_ROUTE_SEGMENTS.\n` +
      '    Middleware treats an undeclared root segment as a typo and hard-404s it —' +
      `\n    add '${dir}' to APP_ROUTE_SEGMENTS in src/lib/rootRoutes.ts.`,
    );
  }
}
for (const seg of declaredAppSegments) {
  if (!appDirs.includes(seg)) {
    fail(
      `[rootRoutes] APP_ROUTE_SEGMENTS declares '${seg}', but src/app/${seg}/ does not exist.\n` +
      '    Remove the stale entry from src/lib/rootRoutes.ts.',
    );
  }
}

// ── Every single-segment public destination must resolve ───────────────────
// `[burnrateDomain]/page.tsx` serves the `PUBLIC_DESTINATIONS` rows (kind !==
// 'link') that have no `src/app` directory of their own — those must be
// declared in BURNRATE_DOMAIN_SEGMENTS or the same middleware check 404s them.
const publicDestSource = readFileSync(resolve(SRC, 'lib', 'publicDestinations.ts'), 'utf8');
const destBlock = publicDestSource.match(/export const PUBLIC_DESTINATIONS[\s\S]*?\n\];/)?.[0] ?? '';
const entryBlocks = destBlock.match(/\{[^{}]*\}/g) ?? [];
const referenceSlugs = new Set();
for (const entry of entryBlocks) {
  const kind = entry.match(/kind:\s*'([^']+)'/)?.[1];
  const href = entry.match(/marketingHref:\s*'([^']+)'/)?.[1];
  if (kind === 'link' || !href) continue;
  if (!href.startsWith('/') || href.slice(1).includes('/')) continue; // multi-segment — Next's own router 404s these
  const slug = href.slice(1);
  if (!appDirs.includes(slug)) referenceSlugs.add(slug);
}

const burnrateBlock = rootRoutesSource.match(/export const BURNRATE_DOMAIN_SEGMENTS[\s\S]*?\];/)?.[0];
if (!burnrateBlock) fail('[rootRoutes] BURNRATE_DOMAIN_SEGMENTS could not be located in rootRoutes.ts.');
const declaredBurnrateSegments = new Set([...(burnrateBlock ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]));

for (const slug of referenceSlugs) {
  if (!declaredBurnrateSegments.has(slug)) {
    fail(
      `[rootRoutes] publicDestinations.ts serves '/${slug}' via [burnrateDomain] but BURNRATE_DOMAIN_SEGMENTS\n` +
      `    does not declare '${slug}' — add it in src/lib/rootRoutes.ts.`,
    );
  }
}
for (const slug of declaredBurnrateSegments) {
  if (!referenceSlugs.has(slug)) {
    fail(
      `[rootRoutes] BURNRATE_DOMAIN_SEGMENTS declares '${slug}', which no PUBLIC_DESTINATIONS row (kind !== 'link') serves.\n` +
      '    Remove the stale entry from src/lib/rootRoutes.ts.',
    );
  }
}

if (failures.length > 0) {
  console.error(`❌  Root-route matrix check failed (${failures.length}):\n`);
  for (const f of failures) console.error(`  - ${f}\n`);
  process.exit(1);
}

console.log('✅  Root-route matrix check passed — every src/app directory and single-segment public destination is declared.');
