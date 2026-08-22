#!/usr/bin/env node
/**
 * Swept-table maintenance guard.
 *
 * `application/maintenance/sweptTables.ts` is the ONE declaration of the platform's
 * unbounded log tables, and three things have to stay in step with it or the storage
 * policy silently develops a hole:
 *
 *   1. Every declared `relation` must be a REAL table — the name is what `VACUUM` and
 *      `pg_class` are given as a literal, so a typo does not fail a type-check, it
 *      fails at 03:00 in a best-effort catch nobody reads.
 *   2. Every declared relation must carry the per-table autovacuum tuning — applied
 *      by migrations/1104 (primary) or transactional-migrations/0009 (operational),
 *      or by any LATER migration on the same endpoint. Without it a new high-write
 *      feed inherits the 0.2 default that produced the 593 MB `manager_actions`
 *      relation in the first place.
 *
 *      The later migrations are read because of the case that broke this guard:
 *      a swept table gets RENAMED (1109's `demo_events` -> `visitor_events`).
 *      Postgres carries the storage parameters through a rename, so the live
 *      database is correct — but 1104 still names the old table, and it cannot be
 *      edited to name the new one, because on a fresh database 1104 runs BEFORE
 *      the rename and would fail on a table that does not exist yet. So the
 *      re-statement belongs in the migration that did the rename, and this guard
 *      has to look there.
 *   3. The declared `connection` must match which of the two migrations tuned it —
 *      the endpoints are separate databases and a mismatch means the purge and the
 *      vacuum are talking to different servers.
 *
 * Run via `npm run check:swept-tables` and wired into `npm test`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const registryFile = resolve(here, '../src/application/maintenance/sweptTables.ts');
const schemaDir = resolve(here, '../src/infrastructure/database/schema');
const primaryTuning = resolve(here, '../migrations/1104_swept_table_autovacuum.sql');
const operationalTuning = resolve(here, '../transactional-migrations/0009_swept_table_autovacuum.sql');

const failures = [];

// --- 1. Parse the registry --------------------------------------------------
const registry = readFileSync(registryFile, 'utf8');
const entries = [];
for (const match of registry.matchAll(/relation:\s*'([a-z0-9_]+)',\s*\n\s*connection:\s*'(primary|transactional)'/g)) {
  entries.push({ relation: match[1], connection: match[2] });
}
if (entries.length === 0) {
  failures.push(`Could not parse any SWEPT_TABLES entries out of ${registryFile} — has the shape changed?`);
}

// --- 2. Every relation is a real pgTable ------------------------------------
const declaredTables = new Set();
for (const file of readdirSync(schemaDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
  const text = readFileSync(resolve(schemaDir, file), 'utf8');
  for (const match of text.matchAll(/pgTable\(\s*'([a-z0-9_]+)'/g)) declaredTables.add(match[1]);
}
for (const entry of entries) {
  if (!declaredTables.has(entry.relation)) {
    failures.push(`SWEPT_TABLES declares '${entry.relation}', which is not a pgTable in src/infrastructure/database/schema.`);
  }
}

// --- 3. Every relation is tuned, on the matching endpoint -------------------
const tunedBy = new Map(); // relation -> 'primary' | 'transactional'
const readTuning = (file, connection) => {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    failures.push(`Missing autovacuum tuning migration: ${file}`);
    return;
  }
  for (const match of text.matchAll(/ALTER TABLE\s+([a-z0-9_]+)\s+SET\s*\(([^)]*)\)/gi)) {
    const [, relation, params] = match;
    if (!/autovacuum_vacuum_scale_factor/i.test(params)) continue;
    tunedBy.set(relation, connection);
  }
};
/** Every other .sql on one endpoint, in filename order, after its base tuning file. */
const readLaterTuning = (dir, baseFile, connection) => {
  const baseName = baseFile.split(/[\\/]/).pop();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (file === baseName) continue;
    readTuning(resolve(dir, file), connection);
  }
};

readTuning(primaryTuning, 'primary');
readTuning(operationalTuning, 'transactional');
// Later migrations may re-state the tuning for a table they created or renamed.
// Read in filename order so the LAST statement wins, which is what the database
// ends up with too.
readLaterTuning(resolve(here, '../migrations'), primaryTuning, 'primary');
readLaterTuning(resolve(here, '../transactional-migrations'), operationalTuning, 'transactional');

for (const entry of entries) {
  const tuned = tunedBy.get(entry.relation);
  if (!tuned) {
    failures.push(
      `'${entry.relation}' is retention-swept but has no autovacuum_vacuum_scale_factor override. `
      + `Add an ALTER TABLE ... SET (...) to ${entry.connection === 'primary' ? 'migrations/1104_swept_table_autovacuum.sql' : 'transactional-migrations/0009_swept_table_autovacuum.sql'}, `
      + 'or to the migration that creates or renames it.',
    );
  } else if (tuned !== entry.connection) {
    failures.push(
      `'${entry.relation}' is declared on the ${entry.connection} connection but tuned in the ${tuned} migration — `
      + 'the two endpoints are separate databases, so one of them is wrong.',
    );
  }
}

// --- Report -----------------------------------------------------------------
if (failures.length > 0) {
  console.error('❌ check:swept-tables');
  for (const failure of failures) console.error(`   • ${failure}`);
  process.exit(1);
}
console.log(`✅ check:swept-tables — ${entries.length} log tables declared, all tuned on their own endpoint.`);
