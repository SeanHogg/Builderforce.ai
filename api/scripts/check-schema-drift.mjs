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

const sqlFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const migratedColumns = new Map(); // table -> Set<column>

function recordColumns(table, sqlBlock) {
  if (!migratedColumns.has(table)) migratedColumns.set(table, new Set());
  const cols = migratedColumns.get(table);
  // Capture column names — first identifier on each non-empty line of the
  // CREATE TABLE / ALTER TABLE … ADD COLUMN block. Strip leading "ADD COLUMN [IF NOT EXISTS]".
  const lines = sqlBlock.split('\n');
  for (let line of lines) {
    line = line.trim().replace(/^,\s*/, '').replace(/^ADD COLUMN(?:\s+IF NOT EXISTS)?\s+/i, '');
    const m = line.match(/^([a-z_][a-z_0-9]*)/i);
    if (m) cols.add(m[1].toLowerCase());
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
  const raw = readFileSync(resolve(migrationsDir, file), 'utf8');
  const text = raw.replace(/--[^\n]*/g, '');

  // CREATE TABLE [IF NOT EXISTS] <name> ( <cols> );
  const createRe = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([a-z_][a-z_0-9]*)\s*\(([\s\S]*?)\)\s*;/gi;
  for (const m of text.matchAll(createRe)) recordColumns(m[1].toLowerCase(), m[2]);

  // ALTER TABLE <name> ADD COLUMN [IF NOT EXISTS] <col> …;  — single-column form
  const alterSingleRe = /ALTER TABLE\s+([a-z_][a-z_0-9]*)\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+([a-z_][a-z_0-9]*)/gi;
  for (const m of text.matchAll(alterSingleRe)) recordColumns(m[1].toLowerCase(), m[2]);

  // ALTER TABLE <name> [...]; — multi-action form with comma-separated ADD COLUMN clauses.
  const alterBlockRe = /ALTER TABLE\s+([a-z_][a-z_0-9]*)\s+([\s\S]*?);/gi;
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
let reverseAllowed = 0;

for (const table of migratedColumns.keys()) {
  if (declaredTables.has(table)) continue;
  if (reverseAllowlist.has(table)) { reverseAllowed++; continue; }
  errors.push(
    `Table '${table}' is created by a migration but has no pgTable() declaration in schema.ts ` +
    `— it is unreachable, since Drizzle is the only database access layer.`,
  );
}

if (errors.length > 0) {
  console.error('NEW schema drift detected (not in allowlist):\n');
  for (const err of errors) console.error('  - ' + err);
  console.error('\nAdd a migration in api/migrations/ that creates the missing column(s), or remove from schema.ts.');
  console.error('To deliberately grandfather this drift (e.g. for a baseline-push table), add the bullet to scripts/.schema-drift-allowlist.txt.');
  console.error("For a migrated table with no pgTable() declaration: add it to schema.ts, or list the bare table name in scripts/.schema-missing-allowlist.txt if it is intentionally unmapped (e.g. a pure join/audit table written only by SQL migrations).");
  process.exit(1);
}

console.log(
  `Schema drift check passed: ${drizzleTables.length} drizzle tables, ` +
  `${[...migratedColumns.values()].reduce((sum, s) => sum + s.size, 0)} migrated columns, ` +
  `${allowed} pre-existing drift items grandfathered, ` +
  `${reverseAllowed} migrated tables intentionally unmapped.`,
);
