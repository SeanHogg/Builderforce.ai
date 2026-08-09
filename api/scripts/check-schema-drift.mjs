#!/usr/bin/env node
/**
 * Drift guard: every Drizzle `pgTable('X', { col_a, col_b, ... })` declaration
 * must have a corresponding CREATE TABLE statement somewhere in
 * api/migrations/*.sql, AND every column declared on that table must appear
 * either in the CREATE TABLE block OR in a later ALTER TABLE … ADD COLUMN
 * for the same table.
 *
 * Catches the class of bug that produced both production crashes earlier:
 *   - `tasks.github_issue_number` declared in schema but never migrated
 *     → "column \"github_issue_number\" does not exist"
 *   - `platform_modules.permissions` typed as `text` in schema but `jsonb` in
 *     the migration is a different drift category (column-type mismatch);
 *     this script flags missing columns, not type mismatches. Still a useful
 *     first-line guard.
 *
 * Run via `npm run check:schema` and wired into `npm test` so CI catches
 * any future drift before it ships.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDrizzleTables } from './lib/drizzleSchema.mjs';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const srcDir = resolve(here, '../src');
const migrationsDir = resolve(here, '../migrations');
const transactionalDir = resolve(here, '../transactional-migrations');
const allowlistFile = resolve(here, '.schema-drift-allowlist.txt');

// Pre-existing drift captured when this script first landed — mostly tables
// created by an early `drizzle-kit push` that was never converted to a tracked
// migration. Listed here to grandfather historical state; new drift introduced
// after this script lands will fail CI.
const allowlist = existsSync(allowlistFile)
  ? new Set(
      readFileSync(allowlistFile, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#')),
    )
  : new Set();

// ── Parse Drizzle schema ────────────────────────────────────────────────────
//
// Shared with check-migrations.mjs (which needs the column TYPES to verify foreign
// keys) — see scripts/lib/drizzleSchema.mjs. One parser so the two guards can never
// disagree about what the schema declares.

const drizzleTables = [...parseDrizzleTables(srcDir)].map(([table, cols]) => ({
  table,
  cols: new Set(cols.keys()),
}));

// ── Parse all migrations ────────────────────────────────────────────────────
//
// Parsed ONCE PER TRACK. `api/migrations` targets NEON_DATABASE_URL;
// `api/transactional-migrations` targets NEON_TRANSACTIONAL_DATABASE_URL. A
// table that lives on the operational track must have its columns declared
// THERE — see the operational-track check further down.

function parseTrack(dir) {

const sqlFiles = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const migratedColumns = new Map(); // table -> Set<column>

/**
 * Split a CREATE TABLE / ALTER TABLE body on its TOP-LEVEL commas.
 *
 * Splitting on newlines instead (the original approach) only ever sees the FIRST
 * column of a line, so a compactly-written migration — which is exactly how
 * transactional-migrations/0001 declares its tables:
 *   id serial PRIMARY KEY, method varchar(10), path varchar(500), message text,
 * silently contributes one column per line and reports the rest as missing.
 *
 * Commas inside parentheses (`numeric(10,2)`, `PRIMARY KEY (a, b)`) and inside
 * string literals (`DEFAULT 'a,b'`) are not separators.
 */
function splitTopLevel(sqlBlock) {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (let i = 0; i < sqlBlock.length; i++) {
    const ch = sqlBlock[i];
    if (quoted) {
      current += ch;
      if (ch === "'") quoted = false;
      continue;
    }
    if (ch === "'") { quoted = true; current += ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  parts.push(current);
  return parts;
}

function recordColumns(table, sqlBlock) {
  if (!migratedColumns.has(table)) migratedColumns.set(table, new Set());
  const cols = migratedColumns.get(table);
  // Capture column names — the leading identifier of each comma-separated clause
  // of the CREATE TABLE / ALTER TABLE … ADD COLUMN body. Strip a leading
  // "ADD COLUMN [IF NOT EXISTS]" so the multi-action ALTER form parses too.
  for (let part of splitTopLevel(sqlBlock)) {
    part = part.trim().replace(/^ADD COLUMN(?:\s+IF NOT EXISTS)?\s+/i, '');
    const m = part.match(/^([a-z_][a-z_0-9]*)/i);
    if (m && !['primary', 'unique', 'constraint', 'foreign', 'check', 'exclude'].includes(m[1].toLowerCase())) {
      cols.add(m[1].toLowerCase());
    }
  }
}

// ── Rename-awareness ─────────────────────────────────────────────────────────
//
// A migration can RENAME a table/column it (or an earlier migration) created.
// Without tracking that, the reconstructed model keeps the old name and reports
// the new schema.ts name as "uncreated" drift. We follow renames from two
// sources so the model reflects the true post-migration schema:
//   1. Explicit static SQL:  ALTER TABLE [IF EXISTS] x RENAME TO y;
//                            ALTER TABLE x RENAME COLUMN a TO b;
//   2. Declarative directives (for migrations whose renames are dynamic — e.g.
//      a DO-block that loops over information_schema and can't be parsed):
//        -- @schema-drift-rename-table   old_name -> new_name
//        -- @schema-drift-rename-replace old_substr -> new_substr   (applied to
//           every table key + column name; mirrors `replace(name, a, b)`)

function renameTableKey(oldT, newT) {
  if (oldT === newT || !migratedColumns.has(oldT)) return;
  const set = migratedColumns.get(oldT);
  if (migratedColumns.has(newT)) {
    for (const c of set) migratedColumns.get(newT).add(c);
  } else {
    migratedColumns.set(newT, set);
  }
  migratedColumns.delete(oldT);
}

function renameColumn(table, oldC, newC) {
  const set = migratedColumns.get(table);
  if (set && set.has(oldC)) { set.delete(oldC); set.add(newC); }
}

function replaceSubstr(a, b) {
  for (const key of [...migratedColumns.keys()]) {
    if (key.includes(a)) renameTableKey(key, key.split(a).join(b));
  }
  for (const set of migratedColumns.values()) {
    for (const c of [...set]) {
      if (c.includes(a)) { set.delete(c); set.add(c.split(a).join(b)); }
    }
  }
}

function applyRenames(raw, text) {
  // Directives first: explicit table renames (special-cases) before substring
  // replaces, mirroring how such migrations are written.
  for (const m of raw.matchAll(/--\s*@schema-drift-rename-table\s+([a-z_][a-z_0-9]*)\s*->\s*([a-z_][a-z_0-9]*)/gi))
    renameTableKey(m[1].toLowerCase(), m[2].toLowerCase());
  for (const m of raw.matchAll(/--\s*@schema-drift-rename-replace\s+([a-z_][a-z_0-9]*)\s*->\s*([a-z_][a-z_0-9]*)/gi))
    replaceSubstr(m[1].toLowerCase(), m[2].toLowerCase());
  // Explicit static rename statements.
  for (const m of text.matchAll(/ALTER TABLE\s+(?:IF EXISTS\s+)?([a-z_][a-z_0-9]*)\s+RENAME TO\s+([a-z_][a-z_0-9]*)/gi))
    renameTableKey(m[1].toLowerCase(), m[2].toLowerCase());
  for (const m of text.matchAll(/ALTER TABLE\s+(?:IF EXISTS\s+)?([a-z_][a-z_0-9]*)\s+RENAME COLUMN\s+([a-z_][a-z_0-9]*)\s+TO\s+([a-z_][a-z_0-9]*)/gi))
    renameColumn(m[1].toLowerCase(), m[2].toLowerCase(), m[3].toLowerCase());
}

for (const file of sqlFiles) {
  const raw = readFileSync(resolve(dir, file), 'utf8');
  // Strip BLOCK comments before line comments: several migrations document
  // columns with `/** … */` inside the CREATE TABLE body, and that prose
  // contains both commas and apostrophes — which the top-level comma splitter
  // would otherwise read as column separators and string literals.
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

  // CREATE TABLE [IF NOT EXISTS] <name> ( <cols> );
  const createRe = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([a-z_][a-z_0-9]*)\s*\(([\s\S]*?)\)\s*;/gi;
  for (const m of text.matchAll(createRe)) recordColumns(m[1].toLowerCase(), m[2]);

  // ALTER TABLE <name> ADD COLUMN [IF NOT EXISTS] <col> …;  — single-column form
  const alterSingleRe = /ALTER TABLE\s+(?:IF EXISTS\s+)?([a-z_][a-z_0-9]*)\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+([a-z_][a-z_0-9]*)/gi;
  for (const m of text.matchAll(alterSingleRe)) recordColumns(m[1].toLowerCase(), m[2]);

  // A later DROP COLUMN removes it from the live schema just like DROP TABLE removes
  // the table. Process before renames, in migration order.
  for (const m of text.matchAll(/ALTER TABLE\s+(?:IF EXISTS\s+)?([a-z_][a-z_0-9]*)\s+DROP COLUMN(?:\s+IF EXISTS)?\s+([a-z_][a-z_0-9]*)/gi)) {
    const table = m[1].toLowerCase();
    const column = m[2].toLowerCase();
    const direct = migratedColumns.get(table);
    if (direct) {
      direct.delete(column);
      continue;
    }
    // A migration may rename the table and then drop a legacy column in the same
    // file. Renames are applied at the end of the file, so resolve that one-step
    // alias here to preserve statement-order semantics.
    for (const rename of text.matchAll(/ALTER TABLE\s+(?:IF EXISTS\s+)?([a-z_][a-z_0-9]*)\s+RENAME TO\s+([a-z_][a-z_0-9]*)/gi)) {
      if (rename[2].toLowerCase() === table) migratedColumns.get(rename[1].toLowerCase())?.delete(column);
    }
  }

  // ALTER TABLE <name> [...]; — multi-action form with comma-separated ADD COLUMN clauses.
  const alterBlockRe = /ALTER TABLE\s+(?:IF EXISTS\s+)?([a-z_][a-z_0-9]*)\s+([\s\S]*?);/gi;
  for (const m of text.matchAll(alterBlockRe)) {
    const cols = m[2].matchAll(/ADD COLUMN(?:\s+IF NOT EXISTS)?\s+([a-z_][a-z_0-9]*)/gi);
    for (const c of cols) recordColumns(m[1].toLowerCase(), c[1]);
  }

  // DROP TABLE [IF EXISTS] a, b [CASCADE]; — a dropped table is no longer part of
  // the live schema, so it must leave the reconstructed model. Without this the
  // REVERSE check below would demand a schema.ts definition for a table that no
  // longer exists.
  for (const m of text.matchAll(/DROP TABLE(?:\s+IF EXISTS)?\s+([^;]+);/gi)) {
    for (const name of m[1].split(','))
      migratedColumns.delete(name.trim().replace(/\s+CASCADE|\s+RESTRICT/i, '').toLowerCase());
  }

  // Apply this migration's renames AFTER its creates, in file order, so a later
  // migration's rename mutates columns/tables added by earlier ones.
  applyRenames(raw, text);
}

return migratedColumns;

}

const migratedColumns = parseTrack(migrationsDir);
const operationalColumns = parseTrack(transactionalDir);

// ── Compare ─────────────────────────────────────────────────────────────────

const errors = [];
let allowed = 0;

for (const { table, cols } of drizzleTables) {
  const migrated = migratedColumns.get(table);
  if (!migrated) {
    const msg = `Table '${table}' is declared in schema.ts but never created by any migration.`;
    if (allowlist.has(msg)) { allowed++; continue; }
    errors.push(msg);
    continue;
  }
  for (const col of cols) {
    if (!migrated.has(col.toLowerCase())) {
      const msg = `Column '${table}.${col}' is declared in schema.ts but never created/added by any migration.`;
      if (allowlist.has(msg)) { allowed++; continue; }
      errors.push(msg);
    }
  }
}

// ── Operational track: a table's columns must exist on the DB it is WRITTEN to ──
//
// `api/migrations` and `api/transactional-migrations` target two DIFFERENT Neon
// databases. The forward check above is satisfied by EITHER track, so a column
// added to the primary track for a table that actually lives on the operational
// one looks perfectly migrated — and then fails at runtime, on every write,
// forever.
//
// That has now happened twice, both silent because the writers swallow their own
// errors:
//   - api_error_log.{tenant_id,source,operation,handled,context} (mig 0375 →
//     primary): the centralized error reporter persisted NOTHING in production.
//   - activity_log.event_key (mig 0374 → primary): the unified audit log dropped
//     every event, ~350/hour.
//
// Any table CREATED in transactional-migrations lives on the operational
// database, so every Drizzle column it declares must be present in THAT track.

const operationalTables = new Set(operationalColumns.keys());
let operationalAllowed = 0;

for (const { table, cols } of drizzleTables) {
  if (!operationalTables.has(table)) continue;
  const present = operationalColumns.get(table);
  for (const col of cols) {
    if (present.has(col.toLowerCase())) continue;
    const msg = `Column '${table}.${col}' is missing from the OPERATIONAL migration track — ${table} is written to NEON_TRANSACTIONAL_DATABASE_URL, so adding it under api/migrations/ does not create it.`;
    if (allowlist.has(msg)) { operationalAllowed++; continue; }
    errors.push(msg);
  }
}

// ── Reverse: every migrated table needs a Drizzle definition ────────────────
//
// Drizzle is the ONE database access layer, so a table that exists in the
// migrations but has NO `pgTable` declaration is unreachable by design: the
// only way to touch it would be a raw client, which is exactly what this
// codebase no longer allows. That gap is how 9 tables (freelancer_messages,
// ide_datasets, tenant_llm_provider_keys, …) ended up served by ad-hoc raw SQL.
// The forward check above could never see it — it only walks schema.ts.

const reverseAllowlistFile = resolve(here, '.schema-missing-allowlist.txt');
const reverseAllowlist = existsSync(reverseAllowlistFile)
  ? new Set(
      readFileSync(reverseAllowlistFile, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#')),
    )
  : new Set();

const declaredTables = new Set(drizzleTables.map((t) => t.table));
const declaredColumns = new Map(drizzleTables.map((t) => [t.table, t.cols]));
let reverseAllowed = 0;

for (const table of migratedColumns.keys()) {
  if (declaredTables.has(table)) continue;
  if (reverseAllowlist.has(table)) { reverseAllowed++; continue; }
  errors.push(
    `Table '${table}' is created by a migration but has no pgTable() declaration in schema.ts ` +
    `— it is unreachable, since Drizzle is the only database access layer.`,
  );
}

// A table-level reverse check is not enough: an omitted column still forces callers
// back onto untyped SQL even though the table itself looks mapped. Compare against the
// same rename-aware, post-migration model used by the forward check so historical
// table/column renames do not become false positives.
for (const [table, columns] of migratedColumns) {
  const declared = declaredColumns.get(table);
  if (!declared) continue; // Reported by the table-level reverse check above.
  for (const column of columns) {
    if (declared.has(column)) continue;
    const msg = `Column '${table}.${column}' exists in migrations but is missing from schema.ts.`;
    if (allowlist.has(msg)) { reverseAllowed++; continue; }
    errors.push(msg);
  }
}

if (errors.length > 0) {
  console.error('NEW schema drift detected (not in allowlist):\n');
  for (const err of errors) console.error('  - ' + err);
  console.error('\nAdd a migration in api/migrations/ that creates the missing column(s), or remove from schema.ts.');
  console.error('For an OPERATIONAL-track column, the migration belongs in api/transactional-migrations/ — that table is written to a different database.');
  console.error('For a reverse-column item, declare the migrated column in schema.ts or explicitly grandfather the exact message in scripts/.schema-drift-allowlist.txt.');
  console.error('To deliberately grandfather this drift (e.g. for a baseline-push table), add the bullet to scripts/.schema-drift-allowlist.txt.');
  console.error("For a migrated table with no pgTable() declaration: add it to schema.ts, or list the bare table name in scripts/.schema-missing-allowlist.txt if it is intentionally unmapped (e.g. a pure join/audit table written only by SQL migrations).");
  process.exit(1);
}

console.log(
  `Schema drift check passed: ${drizzleTables.length} drizzle tables, ` +
  `${[...migratedColumns.values()].reduce((sum, s) => sum + s.size, 0)} migrated columns, ` +
  `${operationalTables.size} operational-track tables verified against transactional-migrations, ` +
  `${allowed + operationalAllowed} pre-existing drift items grandfathered, ` +
  `${reverseAllowed} migrated tables intentionally unmapped.`,
);
