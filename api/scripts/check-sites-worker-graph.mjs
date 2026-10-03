#!/usr/bin/env node
/**
 * The published-site Worker must stay small.
 *
 * `src/sitesWorker.ts` exists so a visit to a tenant's published site cold-starts
 * ~1.4 MB of code instead of the API's ~21 MB. The bundler has no code splitting,
 * so that holds only while the entry's IMPORT GRAPH stays small — and the API's
 * graph is one import away almost everywhere: the first measurement of this entry
 * came out LARGER than the API, because `siteServer → siteData → siteTicketBridge →
 * laneEntryTrigger → cloudAgentEngine → builtinMcpService → … → src/index.ts` pulled
 * the composition root in.
 *
 * This walks the entry's static and dynamic imports (type-only imports are erased
 * and skipped) and fails when the graph reaches any of the regions below, printing
 * the chain that got there so the fix is obvious: route that path through the API
 * (`serveStaticSiteRequest` returning `dynamic`) instead of importing it.
 *
 * Run via `npm run check:sites-worker-graph` and wired into `npm test`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const entry = resolve(srcDir, 'sitesWorker.ts');

/** Regions the site Worker must never reach, as src-relative path prefixes. */
const FORBIDDEN = [
  'index.ts',
  'presentation/',
  'application/llm/',
  'application/runtime/',
  'application/brain/',
  'application/swimlane/',
  'infrastructure/relay/',
];

const IMPORT = /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolveModule(fromFile, spec) {
  if (!spec.startsWith('.')) return null; // packages are not first-party regions
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, base.replace(/\.js$/, '.ts'), resolve(base, 'index.ts')]) {
    if (existsSync(candidate) && candidate.endsWith('.ts')) return candidate;
  }
  return null;
}

const parent = new Map([[entry, null]]);
const queue = [entry];
const violations = [];
while (queue.length > 0) {
  const file = queue.shift();
  const text = readFileSync(file, 'utf8');
  const specs = [];
  for (const m of text.matchAll(IMPORT)) if (!m[2]) specs.push(m[3]);
  for (const m of text.matchAll(DYNAMIC)) specs.push(m[1]);
  for (const spec of specs) {
    const target = resolveModule(file, spec);
    if (!target || parent.has(target)) continue;
    parent.set(target, file);
    const rel = relative(srcDir, target).split('\\').join('/');
    if (FORBIDDEN.some((prefix) => rel === prefix || rel.startsWith(prefix))) {
      const chain = [];
      for (let at = target; at; at = parent.get(at)) chain.unshift(relative(srcDir, at).split('\\').join('/'));
      violations.push(chain.join('\n      → '));
      continue;
    }
    queue.push(target);
  }
}

if (violations.length > 0) {
  console.error(`The published-site Worker's import graph reaches the API (${violations.length} path(s)):\n`);
  for (const v of violations) console.error(`  - ${v}\n`);
  console.error('Serve that request through the API instead: have serveStaticSiteRequest (application/ide/siteStaticServe.ts)');
  console.error("return { kind: 'dynamic' } for it, and keep the import on the API side (siteServer.ts).");
  process.exit(1);
}

console.log(`Sites Worker graph check passed: ${parent.size} first-party modules, none in ${FORBIDDEN.join(', ')}.`);
