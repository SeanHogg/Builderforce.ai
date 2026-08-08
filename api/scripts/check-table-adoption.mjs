#!/usr/bin/env node
/**
 * Table-adoption ratchet (PRD 20 §5) — a `CREATE TABLE` is a claim, not a feature.
 *
 * PRD 20 is schema-first by design: consolidate the model, then layer the API, then
 * the UI. That sequencing has exactly one failure mode, and it is not drift —
 * `check-schema-drift.mjs` already covers drift. It is ABANDONMENT: 244 tables that
 * exist in Postgres and in Drizzle, that every other guard happily reports as
 * healthy, and that no code path ever touches. Nothing in the previous seventeen
 * guards can tell that apart from success, because to all of them it looks
 * identical: declared, migrated, mapped, in-boundary.
 *
 * So this guard counts the only number that distinguishes them — how many
 * consolidated tables something READS OR WRITES — and ratchets the remainder. The
 * cold list may shrink and never grow silently: wiring a table up is progress and
 * needs no ceremony, while adding a new unwired table requires `--update`, which is
 * a decision someone makes on purpose rather than a number that quietly drifts.
 *
 * It also fails HARD, outside the ratchet, when a migration creates a table with no
 * Drizzle declaration. That is not a judgement call about sequencing; it is a table
 * no typed code can ever reach.
 *
 * The measurement lives in `lib/tableAdoption.mjs` and is shared with
 * `src/application/kernel/tableAdoption.test.ts`, which pins the surfaces that must
 * stay live. One definition of "live", so the guard and the test cannot disagree.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyseTableAdoption, CONSOLIDATION_FROM_PREFIX } from './lib/tableAdoption.mjs';
import { reportRatchet } from './lib/ratchet.mjs';

const here = resolve(fileURLToPath(import.meta.url), '..');
const api = resolve(here, '..');

const { created, live, cold, missingExport } = analyseTableAdoption({
  srcDir: resolve(api, 'src'),
  migrationsDir: resolve(api, 'migrations'),
  schemaDir: resolve(api, 'src', 'infrastructure', 'database', 'schema'),
});

if (created.size === 0) {
  console.error(
    `❌  check-table-adoption: found zero tables in migrations ${CONSOLIDATION_FROM_PREFIX}+.\n` +
      '    The migration directory moved or the parser broke — failing rather than passing vacuously.',
  );
  process.exit(1);
}

if (missingExport.length) {
  console.error(`❌  check-table-adoption: ${missingExport.length} migrated table(s) have no Drizzle declaration.\n`);
  for (const t of missingExport) console.error(`    ${t}  (created by ${created.get(t)})`);
  console.error(
    '\n    A table with no `pgTable` export cannot be reached by typed code at all.\n' +
      '    Declare it in the matching schema module, or drop the CREATE TABLE.',
  );
  process.exit(1);
}

// The headline, printed before the ratchet line so `npm test` answers the question
// directly instead of requiring someone to re-derive it.
const byImport = [...live.values()].filter((v) => v.imports.length).length;
const byRawSql = [...live.values()].filter((v) => v.rawSql.length).length;
console.log(
  `ℹ️   Consolidation tables (migrations ${CONSOLIDATION_FROM_PREFIX}+): ${created.size} created, ` +
    `${live.size} with a live code path (${byImport} via a Drizzle import, ${byRawSql} via raw SQL), ` +
    `${cold.length} awaiting one.`,
);

reportRatchet({
  name: 'check-table-adoption',
  baselinePath: resolve(here, '.table-adoption-baseline.txt'),
  findings: cold.map((t) => ({
    key: t,
    detail: `created by ${created.get(t)}; no non-test code imports its Drizzle export or names it in raw SQL.`,
  })),
  unit: 'consolidated table(s) with no code path',
  header:
    'Tables created by PRD 20 migrations 0418+ that nothing reads or writes yet (PRD 20 §5 steps 6-7).\n' +
    '# Shrinks as each domain feature is migrated onto the target schema. It must never grow silently.',
  fixHint:
    'A new table landed with nothing reading or writing it. Wire the feature onto it in the\n' +
    '    same pass, or if the schema genuinely lands ahead of the code, record it deliberately.',
  update: process.argv.includes('--update'),
});
