/**
 * The ONE answer to "how many consolidated tables are actually in use?"
 *
 * PRD 20 created 244 tables in migrations 0418–0433. Counting them is easy and
 * almost meaningless: a `CREATE TABLE` is a claim, not a feature. The number that
 * matters is how many of them something READS OR WRITES — because PRD 20's method
 * is schema-first, and schema-first has exactly one failure mode: a schema that
 * ships and a code path that never arrives.
 *
 * That question was answered once by an ad-hoc script, which is the wrong place
 * for it: an ad-hoc script answers on the day you run it. This module is the
 * measurement, shared by the ratchet (`check-table-adoption.mjs`, which makes the
 * cold list shrink-only) and by the contract test (`tableAdoption.test.ts`, which
 * pins the surfaces that must stay live). Two consumers, one definition of "live",
 * so the guard and the test can never disagree about the number.
 *
 * Lexical, like every other guard here — these run in CI before anything is built.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectSourceFiles } from './drizzleSchema.mjs';

/**
 * The consolidation series. Migration 0418 is `0418_kernel_primitives.sql`; every
 * prefix at or above it belongs to PRD 20's target-schema build-out. A number
 * rather than a hand-kept list, so the next domain migration is counted the day it
 * lands instead of the day somebody remembers to add it here.
 */
export const CONSOLIDATION_FROM_PREFIX = 418;

/** SQL keywords that precede a table name in the raw-SQL the repo writes.
 *  Matched CASE-SENSITIVELY: raw SQL here is uppercase by convention, and prose
 *  ("the sweep updates settings") is not, so case is what separates a real
 *  reference from a sentence about one. */
const SQL_KEYWORDS = ['FROM', 'INTO', 'UPDATE', 'JOIN', 'TABLE'];

/** Comments are prose. A table named in a comment is documentation, not a code
 *  path, and counting it would inflate the only number this module exists to
 *  report honestly. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** Every table created by the consolidation migrations, by name. */
export function collectCreatedTables(migrationsDir) {
  const created = new Map(); // table -> migration file that creates it
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))) {
    const prefix = Number.parseInt(file.slice(0, 4), 10);
    if (!Number.isFinite(prefix) || prefix < CONSOLIDATION_FROM_PREFIX) continue;
    const text = stripSqlComments(readFileSync(resolve(migrationsDir, file), 'utf8'));
    for (const m of text.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?([a-z0-9_]+)"?/gi)) {
      if (!created.has(m[1])) created.set(m[1], file);
    }
  }
  return created;
}

/** `--` and `/* *\/` in SQL. Migration 0418's header prose mentions `CREATE TABLE`
 *  while explaining why `activity_log` does NOT get one; without this the count is
 *  246 statements for 244 tables. */
function stripSqlComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/** table name -> exported Drizzle identifier, for the schema modules only. */
export function collectTableExports(schemaDir) {
  const varFor = new Map();
  for (const file of collectSourceFiles(schemaDir)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/export const (\w+)\s*=\s*pgTable\(\s*'([^']+)'/g)) {
      varFor.set(m[2], m[1]);
    }
  }
  return varFor;
}

/**
 * Analyse adoption.
 *
 * A table is LIVE when non-test application code either imports its Drizzle export
 * or names it in raw SQL. Deliberately generous on the read side — a single
 * `SELECT` counts — because the claim being tested is "something reaches this
 * table at all", and a stricter definition would fail tables that are legitimately
 * read-only.
 *
 * @returns {{created: Map<string,string>, exports: Map<string,string>,
 *            live: Map<string,{imports: string[], rawSql: string[]}>,
 *            cold: string[], missingExport: string[]}}
 */
export function analyseTableAdoption({ srcDir, migrationsDir, schemaDir }) {
  const created = collectCreatedTables(migrationsDir);
  const exports_ = collectTableExports(schemaDir);
  const varToTable = new Map();
  for (const [table, varName] of exports_) if (created.has(table)) varToTable.set(varName, table);

  const live = new Map();
  const note = (table, bucket, file) => {
    if (!live.has(table)) live.set(table, { imports: [], rawSql: [] });
    const entry = live.get(table)[bucket];
    if (!entry.includes(file)) entry.push(file);
  };

  const schemaPrefix = resolve(schemaDir);
  for (const file of collectSourceFiles(srcDir)) {
    if (file.startsWith(schemaPrefix)) continue; // the declaration is not a use of it
    const rel = file.slice(resolve(srcDir, '..').length + 1).replace(/\\/g, '/');
    const text = stripComments(readFileSync(file, 'utf8'));

    for (const m of text.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'([^']*schema[^']*)'/g)) {
      for (const piece of m[1].split(',')) {
        const name = piece.trim().split(/\s+as\s+/)[0].trim();
        if (varToTable.has(name)) note(varToTable.get(name), 'imports', rel);
      }
    }
    for (const table of created.keys()) {
      const re = new RegExp(`\\b(?:${SQL_KEYWORDS.join('|')})\\s+"?${table}"?\\b`);
      if (re.test(text)) note(table, 'rawSql', rel);
    }
  }

  return {
    created,
    exports: exports_,
    live,
    cold: [...created.keys()].filter((t) => !live.has(t)).sort(),
    missingExport: [...created.keys()].filter((t) => !exports_.has(t)).sort(),
  };
}
