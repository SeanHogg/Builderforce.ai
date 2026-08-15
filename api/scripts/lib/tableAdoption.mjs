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

/**
 * The generic entity layer: `application/domains/<domain>/entities.ts`.
 *
 * These sixteen files register every PRD-20 table with one `EntityService` — the
 * consolidation's answer to "never a per-table service". That makes them a real
 * code path, and it also makes "something imports this table" true for all 245 at
 * once, which is why the measurement is reported in TWO tiers. Counting only the
 * first tier would report the schema as fully adopted the day the registry landed;
 * ignoring it would call a table unreachable when it is not. Both numbers are
 * facts, and they answer different questions.
 */
const ENTITY_LAYER = /\/application\/domains\/[^/]+\/entities\.ts$/;

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

/**
 * Every table the consolidation migrations create AND LEAVE BEHIND, by name.
 *
 * ── WHY DROPS ARE READ, NOT JUST CREATES ────────────────────────────────────
 * A migration chain is replayed in order, so what matters is the state at the
 * END of it — and a table can be created by one migration and dropped by a later
 * one. Reading only `CREATE TABLE` made the guard fail on a table that no longer
 * exists, then instruct the reader to "declare it in the matching schema module",
 * which would have added a `pgTable` for a relation Postgres does not have.
 *
 * Measured 2026-08-15: 0467 created `developer_orgs` and `developer_org_members`
 * as a publisher party distinct from a tenant; 0472 rejected that design and
 * dropped all three of its tables into `tenants` / `tenant_members` /
 * `tenant_api_keys`. The schema was RIGHT not to declare them, and the guard
 * failed the build for it — the worst kind of guard, one that is louder about
 * being obeyed than about being correct.
 *
 * Order matters: a table dropped and then re-created later is created, so this
 * walks the files in sequence and lets the last statement win.
 */
export function collectCreatedTables(migrationsDir) {
  const created = new Map(); // table -> migration file that creates it
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    const prefix = Number.parseInt(file.slice(0, 4), 10);
    if (!Number.isFinite(prefix) || prefix < CONSOLIDATION_FROM_PREFIX) continue;
    const text = stripSqlComments(readFileSync(resolve(migrationsDir, file), 'utf8'));
    for (const m of text.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?([a-z0-9_]+)"?/gi)) {
      if (!created.has(m[1])) created.set(m[1], file);
    }
    for (const m of text.matchAll(/DROP TABLE\s+(?:IF EXISTS\s+)?"?([a-z0-9_]+)"?/gi)) {
      created.delete(m[1]);
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
    if (!live.has(table)) live.set(table, { imports: [], rawSql: [], entityLayer: [] });
    const target = ENTITY_LAYER.test(file) ? 'entityLayer' : bucket;
    const entry = live.get(table)[target];
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

    // Dynamic SQL built from a manifest. `registryProjection.ts` reads twenty
    // tables through `FROM ${sql.raw(p.table)}`, where the name lives in a data
    // literal — a real read the keyword scan above cannot see, because at the
    // point of the SQL there is no table name to match.
    //
    // Gated on the file actually using `sql.raw(`, which is what keeps this from
    // becoming the bare-string match that made the first draft of this
    // measurement report ten live tables when the truth was seven: `'settings'`
    // and `'orders'` appear as ordinary strings all over the codebase, but not
    // in files that interpolate raw identifiers into SQL.
    if (text.includes('sql.raw(')) {
      for (const table of created.keys()) {
        if (text.includes(`'${table}'`)) note(table, 'rawSql', rel);
      }
    }
  }

  /** Tier 1: reachable at all — through the entity layer or directly. */
  const registered = [...created.keys()].filter((t) => live.has(t));
  /** Tier 2: something OTHER than the generic registry reads or writes it. This
   *  is the number that moves as PRD 20 steps 6–7 migrate features across, and
   *  the one the ratchet guards. */
  const featureReached = registered.filter((t) => {
    const u = live.get(t);
    return u.imports.length > 0 || u.rawSql.length > 0;
  });
  const featureSet = new Set(featureReached);

  return {
    created,
    exports: exports_,
    live,
    registered,
    featureReached,
    /** Created, registered in the entity layer, but no feature path yet. */
    registryOnly: [...created.keys()].filter((t) => live.has(t) && !featureSet.has(t)).sort(),
    /** Created and not reachable at all. */
    cold: [...created.keys()].filter((t) => !live.has(t)).sort(),
    missingExport: [...created.keys()].filter((t) => !exports_.has(t)).sort(),
  };
}
