#!/usr/bin/env node
/**
 * Edge-Runtime guard for the App Router.
 *
 * The frontend ships to Cloudflare Workers through `@cloudflare/next-on-pages`,
 * which refuses to build when ANY non-static route lacks the Edge Runtime:
 *
 *   ERROR: Failed to produce a Cloudflare Pages build from the project.
 *     The following routes were not configured to run with the Edge Runtime:
 *       - /integrations/[tool]
 *
 * That failure lands ~6 minutes into `cf-build`, in CI, after the whole Next
 * build has already succeeded — the most expensive possible place to learn it.
 * And it is easy to trip by accident: a route is static until someone LOCALIZES
 * it, at which point `getTranslations()` reads the locale cookie (cookie-based
 * i18n) and the route silently becomes dynamic. That is exactly how
 * /integrations/[tool] broke — it had `generateStaticParams` + `dynamicParams`
 * and no runtime export, which was correct right up until it was translated.
 *
 * So this guard reproduces the rule statically, in milliseconds:
 *
 *   a route file that is dynamic (itself or via an ancestor layout) must resolve
 *   to `export const runtime = 'edge'`, on itself or on an ancestor layout.
 *
 * Segment config is INHERITED, so `legal/layout.tsx` declaring edge covers every
 * page under /legal — the guard walks ancestors rather than demanding the export
 * on every leaf.
 *
 * Run via `npm run check:edge-runtime`; wired into `npm test` and into the
 * frontend deploy job, before `cf-build`.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const appDir = resolve(here, '../src/app');

/** Route entry points next-on-pages classifies. */
const ROUTE_FILES = new Set(['page.tsx', 'page.ts', 'route.ts', 'route.tsx']);

/**
 * Signals that a segment renders per-request. Each one is a documented Next.js
 * dynamic API — reaching for any of them opts the segment out of static
 * generation, which is precisely when next-on-pages requires the Edge Runtime.
 */
const DYNAMIC_SIGNALS = [
  {
    // Cookie-based i18n: getTranslations/getLocale/getMessages read the locale
    // cookie. THE most common way a static marketing route turns dynamic.
    test: /from\s+['"]next-intl\/server['"]/,
    why: "imports 'next-intl/server' (reads the locale cookie)",
  },
  { test: /from\s+['"]next\/headers['"]/, why: "imports 'next/headers' (cookies/headers)" },
  { test: /export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/, why: "declares dynamic = 'force-dynamic'" },
  { test: /export\s+const\s+revalidate\s*=\s*0\b/, why: 'declares revalidate = 0' },
];

const EDGE_RUNTIME = /export\s+const\s+runtime\s*=\s*['"]edge['"]/;
const OTHER_RUNTIME = /export\s+const\s+runtime\s*=\s*['"](?!edge)([^'"]+)['"]/;
const GENERATE_STATIC_PARAMS = /export\s+(?:async\s+)?function\s+generateStaticParams|export\s+const\s+generateStaticParams/;

const read = (file) => readFileSync(file, 'utf8');
const rel = (file) => relative(appDir, file).split('\\').join('/');

function collectRouteFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) collectRouteFiles(full, out);
    else if (ROUTE_FILES.has(entry.name)) out.push(full);
  }
  return out;
}

/** Every layout.tsx from src/app down to the route's own directory, outermost first. */
function ancestorLayouts(routeFile) {
  const layouts = [];
  let dir = dirname(routeFile);
  while (dir.startsWith(appDir)) {
    for (const name of ['layout.tsx', 'layout.ts']) {
      const candidate = resolve(dir, name);
      if (existsSync(candidate)) layouts.unshift(candidate);
    }
    if (dir === appDir) break;
    dir = dirname(dir);
  }
  return layouts;
}

const violations = [];

for (const routeFile of collectRouteFiles(appDir)) {
  const source = read(routeFile);
  const layouts = ancestorLayouts(routeFile);

  // Segment config is inherited: the nearest declaration up the tree wins.
  const chain = [...layouts, routeFile];
  let runtimeIsEdge = false;
  let runtimeDeclared = false;
  for (const file of chain) {
    const text = file === routeFile ? source : read(file);
    if (EDGE_RUNTIME.test(text)) { runtimeIsEdge = true; runtimeDeclared = true; }
    else if (OTHER_RUNTIME.test(text)) { runtimeIsEdge = false; runtimeDeclared = true; }
  }

  // A route handler has no static form at all — it is always a function.
  const reasons = /^route\.tsx?$/.test(routeFile.split(/[\\/]/).pop())
    ? ['is a route handler (always server-rendered)']
    : [];
  for (const file of chain) {
    const text = file === routeFile ? source : read(file);
    for (const signal of DYNAMIC_SIGNALS) {
      if (!signal.test.test(text)) continue;
      reasons.push(file === routeFile ? signal.why : `${rel(file)} ${signal.why}`);
    }
  }

  if (reasons.length > 0 && !runtimeIsEdge) {
    violations.push({
      file: rel(routeFile),
      problem: runtimeDeclared
        ? 'is dynamic but resolves to a non-edge runtime'
        : "is dynamic but never resolves to runtime = 'edge'",
      reasons,
    });
  }

  // Next 15.5 rejects prerendering config on an Edge Runtime segment, and the
  // combination reads as "this is static" while behaving as the opposite.
  if (runtimeIsEdge && GENERATE_STATIC_PARAMS.test(source)) {
    violations.push({
      file: rel(routeFile),
      problem: "combines runtime = 'edge' with generateStaticParams",
      reasons: ['an edge segment is never prerendered, so the enumerated params are dead'],
    });
  }
}

if (violations.length > 0) {
  console.error(`❌  Edge Runtime check failed (${violations.length} route(s)):\n`);
  for (const v of violations) {
    console.error(`  - ${v.file}  ${v.problem}`);
    for (const reason of v.reasons) console.error(`      · ${reason}`);
  }
  console.error(
    "\n   next-on-pages will fail the Cloudflare build on these. Add" +
      "\n     export const runtime = 'edge';" +
      '\n   to the route (or to a layout that covers it), and DROP any' +
      '\n   generateStaticParams / dynamicParams from that route — an edge segment' +
      '\n   is rendered per request, and invalid params should 404 via notFound().' +
      '\n   See src/app/compare/[competitor]/page.tsx for the canonical shape.\n',
  );
  process.exit(1);
}

console.log('✅  Edge Runtime check passed — every dynamic App Router route resolves to the Edge Runtime.');
