#!/usr/bin/env node
/**
 * Runs a project's repository guards CONCURRENTLY.
 *
 *   node ../scripts/run-checks.mjs scripts/checks.manifest.mjs
 *
 * Both `api` and `frontend` chained their guards with `&&` through `npm run`, which
 * cost twice over. An `npm run` spawn is ~6.3s on Windows before any work happens,
 * so api's 24-guard chain paid ~150s just starting npm on top of ~46s of real work.
 * And the guards are pure readers over the same source and migration trees — they
 * share nothing and write nothing, so the only ordering they ever needed was "all
 * of them finished".
 *
 * Serial `&&` also means the FIRST red guard hides every guard behind it, so a run
 * reports one problem per attempt. Here every guard runs and the summary lists all
 * the failures at once.
 *
 * Each project owns its guard list in its own manifest; this file owns the running
 * of them, so neither project restates the scheduling, the reporting or the exit
 * contract.
 */
import { spawn } from 'node:child_process';
import { availableParallelism, totalmem } from 'node:os';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const manifestArg = process.argv[2];
if (!manifestArg) {
  process.stderr.write('usage: run-checks.mjs <path-to-checks.manifest.mjs>\n');
  process.exit(2);
}

const manifestPath = resolve(process.cwd(), manifestArg);
const manifestDir = dirname(manifestPath);
const { default: GUARDS } = await import(pathToFileURL(manifestPath).href);

if (!Array.isArray(GUARDS) || GUARDS.length === 0) {
  process.stderr.write(`run-checks: ${manifestArg} did not default-export a non-empty array\n`);
  process.exit(2);
}

// Each guard is a node process that reads the whole source tree, so the ceiling is
// memory and disk, not CPU. Leave a core for the parent and cap the rest.
const LIMIT = Math.max(2, Math.min(8, availableParallelism() - 1));

/**
 * Heap ceiling for each guard, in MB.
 *
 * `tsc --noEmit` over the api tree dies on the default heap — "FATAL ERROR: Ineffective
 * mark-compacts near heap limit … JavaScript heap out of memory", ~144s in, on a machine
 * with memory to spare. That failure is indistinguishable from a real type error at the
 * exit code, so `pnpm --filter builderforce-api type-check` reported RED for a tree that
 * typechecks clean (the same run's `tsgo` passed in 29s, and `tsc` with a raised heap
 * exits 0). A guard that cannot finish is worse than a slow one: it trains everyone to
 * ignore it.
 *
 * This is a CEILING, not a reservation — V8 grows into it only as needed, so raising it
 * costs nothing on the guards that never approach it. Scaled to the machine so a smaller
 * one is not told to promise memory it does not have, and skipped entirely when the
 * caller has set NODE_OPTIONS, which would otherwise be silently overridden.
 */
const HEAP_MB = Math.min(8192, Math.max(4096, Math.floor(totalmem() / 2 / 1024 / 1024)));
const HEAP_ARGS = process.env.NODE_OPTIONS ? [] : [`--max-old-space-size=${HEAP_MB}`];

function runGuard([name, file, ...args]) {
  return new Promise((done) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [...HEAP_ARGS, resolve(manifestDir, file), ...args], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (c) => { output += c; });
    child.stderr.on('data', (c) => { output += c; });
    child.on('error', (err) => done({ name, code: 1, ms: Date.now() - startedAt, output: String(err) }));
    child.on('close', (code) => done({ name, code: code ?? 1, ms: Date.now() - startedAt, output }));
  });
}

const queue = [...GUARDS];
const results = [];
async function worker() {
  for (let next = queue.shift(); next; next = queue.shift()) results.push(await runGuard(next));
}

const startedAt = Date.now();
await Promise.all(Array.from({ length: Math.min(LIMIT, GUARDS.length) }, worker));

const failed = results.filter((r) => r.code !== 0);
// Report in declaration order so the output is stable run to run, not completion-ordered.
const order = new Map(GUARDS.map(([name], i) => [name, i]));
results.sort((a, b) => order.get(a.name) - order.get(b.name));

for (const r of failed) {
  process.stdout.write(`\n${'='.repeat(70)}\n✗ ${r.name}\n${'='.repeat(70)}\n${r.output.trim()}\n`);
}

const slowest = [...results].sort((a, b) => b.ms - a.ms).slice(0, 3);
process.stdout.write(
  `\n${failed.length ? '✗' : '✅'} ${results.length - failed.length}/${results.length} guards passed `
  + `in ${((Date.now() - startedAt) / 1000).toFixed(1)}s (concurrency ${LIMIT}). `
  + `Slowest: ${slowest.map((r) => `${r.name} ${(r.ms / 1000).toFixed(1)}s`).join(', ')}.\n`,
);
if (failed.length) {
  process.stdout.write(`Failed: ${failed.map((r) => r.name).join(', ')}\n`);
  process.exit(1);
}
