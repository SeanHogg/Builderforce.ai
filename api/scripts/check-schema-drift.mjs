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

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const schemaFile = resolve(here, '../src/infrastructure/database/schema.ts');
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
// Capture every block of the form:
//   export const fooBar = pgTable('foo_bar', {
//     col_a: integer('col_a'),
//     col_b: varchar('col_b', { ... }),
//     ...
//   });

const schemaText = readFileSync(schemaFile, 'utf8');

const drizzleTables = []; // [{ table, cols: Set<string> }]
const tableRe = /pgTable\(\s*'([^']+)'\s*,\s*\{([\s\S]*?)\n\}\)/g;

for (const match of schemaText.matchAll(tableRe)) {
  const table = match[1];
  const block = match[2];
  const cols = new Set();
  // Look for the SQL column name, which is always the first string literal
  // inside the column-builder call: e.g. `varchar('foo_bar', ...)`.
  const colRe = /(?:integer|varchar|text|boolean|timestamp|serial|uuid|json|jsonb|customType|pgEnum)\s*\(\s*'([^']+)'/g;
  for (const colMatch of block.matchAll(colRe)) cols.add(colMatch[1]);
  drizzleTables.push({ table, cols });
}

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

for (const file of sqlFiles) {
  const text = readFileSync(resolve(migrationsDir, file), 'utf8').replace(/--[^\n]*/g, '');

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

if (errors.length > 0) {
  console.error('NEW schema drift detected (not in allowlist):\n');
  for (const err of errors) console.error('  - ' + err);
  console.error('\nAdd a migration in api/migrations/ that creates the missing column(s), or remove from schema.ts.');
  console.error('To deliberately grandfather this drift (e.g. for a baseline-push table), add the bullet to scripts/.schema-drift-allowlist.txt.');
  process.exit(1);
}

console.log(
  `Schema drift check passed: ${drizzleTables.length} drizzle tables, ` +
  `${[...migratedColumns.values()].reduce((sum, s) => sum + s.size, 0)} migrated columns, ` +
  `${allowed} pre-existing drift items grandfathered.`,
);
