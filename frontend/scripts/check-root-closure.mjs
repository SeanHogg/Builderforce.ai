#!/usr/bin/env node
/**
 * Root-closure ratchet: how much of `src/` the root layout statically imports.
 *
 * Every module reachable from `app/layout.tsx` through STATIC imports is parsed
 * on every first paint of every route — the task board, the whole API client,
 * the marketing content module, whether or not the page uses them. `dynamic()`
 * and `import()` cut an edge out of that closure; this guard makes sure nobody
 * quietly wires one back in.
 *
 * Counts files and lines reachable through `import … from '…'` and
 * `export … from '…'` statements (type-only imports excluded — they never
 * bundle) starting at the root layout, resolving `@/` and relative specifiers
 * inside `src/`. Package imports are leaves. Compared against
 * `.root-closure-baseline.json`; either number growing fails.
 *
 *   node scripts/check-root-closure.mjs            # verify
 *   node scripts/check-root-closure.mjs --update   # re-baseline after cutting edges
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../src');
const root = resolve(src, 'app/layout.tsx');
const baselineFile = resolve(here, '.root-closure-baseline.json');
const UPDATE = process.argv.includes('--update');
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];

const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)[^'"]*?\sfrom\s+['"]([^'"]+)['"]/gm;
const SIDE_EFFECT_IMPORT = /^\s*import\s+['"]([^'"]+)['"]/gm;

function resolveSpecifier(from, spec) {
  let base;
  if (spec.startsWith('@/')) base = resolve(src, spec.slice(2));
  else if (spec.startsWith('./') || spec.startsWith('../')) base = resolve(dirname(from), spec);
  else return null; // a package — a leaf of this graph
  const candidates = [base, ...EXTENSIONS.map((e) => base + e), ...EXTENSIONS.map((e) => resolve(base, 'index' + e))];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

const seen = new Map(); // abs path → line count
const queue = [root];
while (queue.length) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  const text = readFileSync(file, 'utf8');
  seen.set(file, text.split('\n').length);
  if (/\.(css|json)$/.test(file)) continue;
  const specs = new Set();
  for (const m of text.matchAll(STATIC_IMPORT)) specs.add(m[1]);
  for (const m of text.matchAll(SIDE_EFFECT_IMPORT)) specs.add(m[1]);
  for (const spec of specs) {
    const target = resolveSpecifier(file, spec);
    if (target && !seen.has(target)) queue.push(target);
  }
}

const files = seen.size;
const lines = [...seen.values()].reduce((a, b) => a + b, 0);
const heaviest = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  .map(([f, n]) => `      ${String(n).padStart(6)}  ${relative(src, f).replace(/\\/g, '/')}`).join('\n');

if (UPDATE) {
  writeFileSync(baselineFile, JSON.stringify({ files, lines }, null, 2) + '\n');
  console.log(`✅ root closure baseline rewritten: ${files} files / ${lines} lines`);
  process.exit(0);
}

const baseline = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, 'utf8')) : { files: Infinity, lines: Infinity };
if (files > baseline.files || lines > baseline.lines) {
  console.error(`❌  The root layout's static closure grew: ${files} files / ${lines} lines (baseline ${baseline.files} / ${baseline.lines}).\n`);
  console.error('   Something newly imported from app/layout.tsx (through ConditionalAppShell and its\n' +
    '   providers) is now parsed on every first paint. Load it with next/dynamic (or an\n' +
    '   import() inside the handler that needs it) instead of a static import, or — if the\n' +
    '   edge is genuinely load-bearing for the shell — re-baseline deliberately:\n' +
    '   node scripts/check-root-closure.mjs --update\n');
  console.error('   Heaviest modules in the closure:\n' + heaviest + '\n');
  process.exit(1);
}
if (files < baseline.files || lines < baseline.lines) {
  console.error(`✅→❌  The root closure shrank to ${files} files / ${lines} lines (baseline ${baseline.files} / ${baseline.lines}) — lower the baseline so the ratchet holds:\n   node scripts/check-root-closure.mjs --update\n`);
  process.exit(1);
}
console.log(`✅ root closure: ${files} files / ${lines} lines (at baseline)`);
