#!/usr/bin/env node
/**
 * The gateway Worker must stay small — its whole reason to exist (PRD 39 §1).
 *
 * `src/gatewayWorker.ts` exists so an `/llm` or `/v1` call cold-starts the LLM
 * gateway, the video routes and the semantic cache — NOT the entire API (~21 MB,
 * ~280 mounts, every Durable Object). The bundler has no code splitting, so that
 * holds only while the entry's IMPORT GRAPH stays out of the API. The one import
 * that used to pull the whole API in was the builtin-MCP route replay
 * (`application/llm/replayApp.ts` → dynamic `import('../../index')`); that cycle is
 * now cut by the RouteReplay PORT (`application/llm/routeReplay.ts`), which the
 * gateway binds to its `API` service binding instead of importing the app.
 *
 * This walks the entry's static and dynamic imports (type-only imports are erased
 * and skipped) and fails when the graph reaches `src/index.ts` — the composition
 * root — printing the chain that got there so the fix is obvious: route that path
 * through the API service binding instead of importing it.
 *
 * Run via `npm run check:gateway-worker-graph` and wired into `npm test`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const entry = resolve(srcDir, 'gatewayWorker.ts');

/** The one region the gateway must never reach: the API composition root. */
const FORBIDDEN = ['index.ts'];

const IMPORT = /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
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
  console.error(`The gateway Worker's import graph reaches the API composition root (${violations.length} path(s)):\n`);
  for (const v of violations) console.error(`  - ${v}\n`);
  console.error('That import would bundle the whole API into the gateway, saving nothing.');
  console.error('Serve it through the API service binding instead: bind the RouteReplay port to');
  console.error('env.API.fetch (see application/llm/routeReplay.ts) rather than importing src/index.ts.');
  process.exit(1);
}

console.log(`Gateway Worker graph check passed: ${parent.size} first-party modules, none reach ${FORBIDDEN.join(', ')}.`);
