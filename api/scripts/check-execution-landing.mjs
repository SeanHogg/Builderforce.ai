#!/usr/bin/env node
/**
 * Execution-landing guard - the status of an execution is written ONLY by `ExecutionRepository` (`land` for a terminal status, the
 * guarded `update` for a non-terminal one) or, for the bulk cron sweep, the reaper's own conditional batch UPDATE.
 *
 * Any other write to `executions.status` - a drizzle `update(executions).set({ status ... })` (nested, conditional or computed
 * included) or a raw `UPDATE executions SET status =` (in a `sql` template too) - is a second writer: it can overwrite or resurrect a
 * run another writer already landed (`'paused'` over a cancelled row is as bad as `'failed'` over a completed one), and a terminal
 * one skips the run's one outcome row. The scan is value-agnostic (see `lib/executionLandingScan.mjs`, self-tested by
 * `executionLandingGuard.test.ts`). Not a ratchet: the baseline is EMPTY.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanExecutionStatusWrites } from './lib/executionLandingScan.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');
const ALLOWED_FILES = new Set(['infrastructure/repositories/ExecutionRepository.ts', 'application/runtime/staleExecutionReaper.ts']);
/**
 * Explicit per-site exceptions for a NON-terminal raw writer that cannot go through the repository: `{ file, contains, reason }`, where
 * `contains` is a fragment of the flagged statement. Empty: every status writer today is the repository or the reaper.
 */
const ALLOWED_SITES = [];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { if (name !== 'node_modules') yield* walk(path); } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) yield path;
  }
}

const violations = [];
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  if (ALLOWED_FILES.has(rel)) continue;
  for (const hit of scanExecutionStatusWrites(readFileSync(file, 'utf8'))) {
    if (ALLOWED_SITES.some((site) => site.file === rel && hit.snippet.includes(site.contains))) continue;
    violations.push(`${rel}  [${hit.kind}]  ${hit.snippet}`);
  }
}

if (violations.length > 0) {
  console.error('Execution-landing guard: executions.status is written outside ExecutionRepository / the reaper:\n');
  for (const v of violations) console.error(`   ${v}`);
  console.error('\nTerminal: `landExecution` (application/runtime/executionLanding.ts) / `ExecutionRepository.land` - one winner, one outcome row.\nNon-terminal: `ExecutionRepository.update` (guarded: never resurrects a landed run).');
  process.exit(1);
}
console.log('Execution-landing guard OK - no executions.status write outside ExecutionRepository / the reaper.');
