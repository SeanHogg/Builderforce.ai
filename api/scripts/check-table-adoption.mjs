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

const { created, live, cold, registered, featureReached, registryOnly, missingExport } = analyseTableAdoption({
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
//
// TWO TIERS, because one number would mislead in one direction or the other. The
// generic entity layer registers all 245 tables, so "reachable" went from 7 to 245
// the day it landed without a single feature having been migrated; and calling
// those tables unreachable would be simply false. Registered is the floor,
// feature-reached is the progress.
const byImport = [...live.values()].filter((v) => v.imports.length).length;
const byRawSql = [...live.values()].filter((v) => v.rawSql.length).length;
console.log(
  `ℹ️   Consolidation tables (migrations ${CONSOLIDATION_FROM_PREFIX}+): ${created.size} created · ` +
    `${registered.length} reachable via the entity layer · ` +
    `${featureReached.length} reached by a feature path (${byImport} import, ${byRawSql} raw SQL) · ` +
    `${registryOnly.length} registry-only · ${cold.length} unreachable.`,
);

if (cold.length) {
  console.error(`❌  check-table-adoption: ${cold.length} table(s) are not reachable at all.\n`);
  for (const t of cold) console.error(`    ${t}  (created by ${created.get(t)})`);
  console.error(
    '\n    Every consolidated table is registered by its domain\'s `entities.ts`. One that is\n' +
      '    not is either missing from that file or misspelled in it.',
  );
  process.exit(1);
}

reportRatchet({
  name: 'check-table-adoption',
  baselinePath: resolve(here, '.table-adoption-baseline.txt'),
  findings: registryOnly.map((t) => ({
    key: t,
    detail: `created by ${created.get(t)}; reachable only through the generic entity layer — no feature reads or writes it.`,
  })),
  unit: 'consolidated table(s) reachable only through the generic entity layer',
  header:
    'Tables created by PRD 20 migrations 0418+ that only the generic entity layer touches\n' +
    '# (PRD 20 §5 steps 6-7). Registration is not adoption: this shrinks as each domain\n' +
    '# feature is migrated onto the target schema, and must never grow silently.',
  fixHint:
    'A new table landed with nothing but the entity registry touching it. Migrate the\n' +
    '    feature onto it in the same pass, or record the wait deliberately.',
  update: process.argv.includes('--update'),
});
