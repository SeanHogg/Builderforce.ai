#!/usr/bin/env node
/**
 * Coverage guard (PRD 20 §4) — no capability disappears in the consolidation.
 *
 * The consolidation moves 1,130 distinct source tables into 387. The failure mode
 * that number invites is silent: a table nobody claimed, dropped because no one
 * noticed it was load-bearing. The defence is a committed map — every source
 * table, the move that takes it there, and the target it lands in — with zero
 * rows unaccounted. `specs/builderforce/data-model/source-to-target.tsv` is that
 * map, and this guard is what stops it rotting into a document nobody re-checks.
 *
 * TWO PHASES, because the target schema does not exist yet.
 *
 *   NOW — integrity of the map itself, which is checkable today and is not
 *   vacuous: every row well-formed, every row's move recognised, no row missing a
 *   target, no source listed twice, and the distinct `keep` targets reconciling
 *   with the 362 the roster enumerates. This is the arithmetic that produced the
 *   headline; if it stops holding, the headline is wrong.
 *
 *   LATER — as each domain's tables are written (§5 step 2), the guard reports how
 *   many `keep` targets now exist in the Drizzle schema. Presence is reported
 *   rather than required, because requiring it before step 2 would fail every
 *   build for the length of the migration and get the guard disabled. It becomes
 *   a gate when coverage reaches 100%.
 *
 * A guard whose only check is "the file parses" is decoration. The reconciliation
 * below is the part that has teeth: it is an independent recount of the number the
 * whole PRD rests on.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDrizzleTables } from './lib/drizzleSchema.mjs';

const here = resolve(fileURLToPath(import.meta.url), '..');
const srcDir = resolve(here, '..', 'src');
const mapPath = resolve(here, '..', '..', 'specs', 'builderforce', 'data-model', 'source-to-target.tsv');

/** The roster totals PRD 20 §3 enumerates. If the map stops agreeing with these,
 *  one of the two is wrong and the build should say so rather than pick a winner. */
const EXPECTED = { rows: 1130, keeps: 362, kernel: 25, total: 387 };
const MOVES = new Set(['keep', 'merged', 'primitive', 'flatten', 'session']);

if (!existsSync(mapPath)) {
  console.error(`❌  Coverage map missing: ${mapPath}`);
  console.error('    PRD 20 §4 requires it to exist and to reconcile. Regenerate it from the analysis scripts beside it.');
  process.exit(1);
}

const lines = readFileSync(mapPath, 'utf8').split(/\r?\n/).filter((l) => l.trim());
const header = lines.shift();
if (header !== 'product\tsource_table\tdomain\tmove\ttarget') {
  console.error(`❌  Unexpected header in ${mapPath}:\n    ${header}`);
  process.exit(1);
}

const problems = [];
const sources = new Set();
const keeps = new Set();
const byMove = new Map();

lines.forEach((line, i) => {
  const row = i + 2; // 1-based, header consumed
  const f = line.split('\t');
  if (f.length !== 5) return problems.push(`row ${row}: expected 5 columns, found ${f.length}`);
  const [product, source, domain, move, target] = f.map((s) => s.trim());
  if (!product || !source || !domain) return problems.push(`row ${row} (${source || '?'}): missing product, source or domain`);
  if (!MOVES.has(move)) problems.push(`row ${row} (${source}): unknown move '${move}'`);
  if (!target) problems.push(`row ${row} (${source}): no target — this is the unaccounted case the map exists to prevent`);
  if (sources.has(source)) problems.push(`row ${row}: '${source}' listed twice`);
  sources.add(source);
  if (move === 'keep') keeps.add(target);
  byMove.set(move, (byMove.get(move) ?? 0) + 1);
});

if (lines.length !== EXPECTED.rows) {
  problems.push(`row count is ${lines.length}, PRD 20 states ${EXPECTED.rows}`);
}
if (keeps.size !== EXPECTED.keeps) {
  problems.push(`distinct \`keep\` targets total ${keeps.size}, the domain roster enumerates ${EXPECTED.keeps}`);
}

if (problems.length) {
  console.error(`❌  check-model-coverage: ${problems.length} problem(s) in the consolidation map.\n`);
  for (const p of problems.slice(0, 40)) console.error(`    ${p}`);
  if (problems.length > 40) console.error(`    … and ${problems.length - 40} more`);
  console.error('\n    Either the map or PRD 20 §3 is wrong. Reconcile them before any migration runs.');
  process.exit(1);
}

// Phase two: how much of the target schema exists yet. Reported, not required.
// Parse ONCE — the schema is ~10k lines across 16 modules, and calling the parser
// inside the filter would re-read and re-parse all of it 362 times.
const schemaTables = parseDrizzleTables(srcDir);
const present = [...keeps].filter((t) => schemaTables.has(t));
const pct = ((present.length / keeps.size) * 100).toFixed(1);
const moves = [...byMove].sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m} ${n}`).join(' · ');

console.log(
  `✅  check-model-coverage OK — ${lines.length} source tables mapped, 0 unaccounted (${moves}).\n` +
    `      ${keeps.size} distinct keep targets + ${EXPECTED.kernel} kernel = ${EXPECTED.total}, reconciled with PRD 20 §3.\n` +
    `      Target schema written so far: ${present.length}/${keeps.size} (${pct}%) — becomes a gate at 100%.`,
);
