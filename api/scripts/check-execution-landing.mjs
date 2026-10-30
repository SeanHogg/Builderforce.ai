#!/usr/bin/env node
/**
 * Execution-landing guard - a terminal status is written ONLY through `ExecutionRepository.land` (or, for the bulk cron sweep, the
 * reaper's own conditional batch UPDATE).
 *
 * A raw `db.update(executions).set({ status: 'completed' | 'failed' | 'cancelled' ... })`, or a raw `UPDATE executions SET status =
 * <terminal>`, is a second writer: it can overwrite a run another writer already landed, and it skips the run's one outcome row.
 * This guard fails on any such write outside ExecutionRepository and staleExecutionReaper. Not a ratchet: the baseline is EMPTY.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');
const ALLOWED = new Set(['infrastructure/repositories/ExecutionRepository.ts', 'application/runtime/staleExecutionReaper.ts']);
const TERMINAL = String.raw`(?:'(?:completed|failed|cancelled)'|"(?:completed|failed|cancelled)"|ExecutionStatus\.(?:COMPLETED|FAILED|CANCELLED))`;
// `.update(executions ...) ... .set({ ... status: <terminal>` (within one statement), and raw SQL.
const DRIZZLE = new RegExp(String.raw`\.update\(\s*executions(?:Table)?\b[^;]*?\.set\(\s*\{[^}]*?\bstatus\s*:\s*` + TERMINAL, 's');
const RAW_SQL = new RegExp(String.raw`UPDATE\s+executions\s+SET[^;]*?\bstatus\s*=\s*` + TERMINAL.replace(/\(\?:/g, '(?:'), 'is');

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { if (name !== 'node_modules') yield* walk(path); } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) yield path;
  }
}

const violations = [];
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  if (ALLOWED.has(rel)) continue;
  const text = readFileSync(file, 'utf8');
  if (DRIZZLE.test(text) || RAW_SQL.test(text)) violations.push(rel);
}

if (violations.length > 0) {
  console.error('Execution-landing guard: a terminal execution status is written outside ExecutionRepository.land:\n');
  for (const v of violations) console.error(`   ${v}`);
  console.error('\nLand it through `landExecution` (application/runtime/executionLanding.ts) / `ExecutionRepository.land` - one winner, one outcome row.');
  process.exit(1);
}
console.log('Execution-landing guard OK - no raw terminal status write outside ExecutionRepository / the reaper.');
