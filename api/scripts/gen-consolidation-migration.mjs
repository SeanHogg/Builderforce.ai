#!/usr/bin/env node
/**
 * Generate a consolidation migration from a Drizzle schema module (PRD 20 §5).
 *
 *   node scripts/gen-consolidation-migration.mjs kernel 0418 "Kernel primitives"
 *
 * Writes `migrations/<prefix>_<slug>.sql` containing a `CREATE TABLE IF NOT
 * EXISTS` for every table the module declares that no earlier migration already
 * creates, plus its indexes and the tenancy foreign key.
 *
 * WHY GENERATED. Step 2 adds 248 tables. `check-schema-drift.mjs` requires a
 * `CREATE TABLE` for each, and hand-transcribing that DDL is the
 * two-sources-of-truth problem PRD 20 is about, one layer down: the Drizzle
 * declaration and the SQL would agree on the day they were written and never
 * again. Deriving the SQL means the only way to change the schema is to change
 * the Drizzle file, which is where every reader already looks.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseModule, renderTable } from './lib/ddlFromDrizzle.mjs';

const here = resolve(fileURLToPath(import.meta.url), '..');
const schemaDir = resolve(here, '..', 'src', 'infrastructure', 'database', 'schema');
const migrationsDir = resolve(here, '..', 'migrations');

const [moduleName, prefix, ...titleParts] = process.argv.slice(2);
if (!moduleName || !/^\d{4}$/.test(prefix ?? '')) {
  console.error('usage: gen-consolidation-migration.mjs <schema-module> <4-digit-prefix> [title]');
  process.exit(1);
}
const title = titleParts.join(' ') || `${moduleName} consolidation`;
const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const modulePath = resolve(schemaDir, `${moduleName}.ts`);
if (!existsSync(modulePath)) {
  console.error(`❌  No such schema module: ${modulePath}`);
  process.exit(1);
}

/** Tables any existing migration already creates — never re-emit those. */
const existing = new Set();
const selfFile = `${prefix}_${slug}.sql`;
for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql') && f !== selfFile)) {
  const sql = readFileSync(resolve(migrationsDir, f), 'utf8');
  for (const m of sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?(\w+)"?/gi)) existing.add(m[1].toLowerCase());
}

/** Drizzle variable name → SQL table name, across EVERY module, so a foreign key
 *  into another domain still renders. The kernel declares no such references by
 *  design; the domains reference the kernel constantly. */
const varToTable = new Map();
for (const f of readdirSync(schemaDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
  try {
    for (const t of parseModule(resolve(schemaDir, f))) varToTable.set(t.varName, t.table);
  } catch {
    // A module this generator cannot parse is a module it is not generating DDL
    // for. Its tables are still needed as FK targets where they resolve, and the
    // ones that do not simply render without the constraint.
  }
}

/** Only the tables this consolidation added.
 *
 *  A module that predates the consolidation carries tables created by a
 *  `drizzle-kit push` that was never converted to a tracked migration — they are
 *  in `.schema-drift-allowlist.txt`, and to a generator that asks "does any
 *  migration create this?" they look brand new. Emitting DDL for them would
 *  invent a CREATE TABLE for something already in production.
 *
 *  `append-domain-tables.mjs` writes a marker above the block it appends, so the
 *  boundary is recorded in the file rather than inferred. A module written whole
 *  by this work (hiring, people, revenue, investor, support, kernel) has no
 *  marker and is generated in full. */
const MARKER = '// ═══ PRD 20 §5 step 2 — target-schema tables ═══';
const moduleText = readFileSync(modulePath, 'utf8');
const markerAt = moduleText.indexOf(MARKER);

const tables = parseModule(modulePath);
const belowMarker = new Set(
  markerAt === -1
    ? tables.map((t) => t.table)
    : [...moduleText.slice(markerAt).matchAll(/pgTable\(\s*'([^']+)'/g)].map((m) => m[1]),
);
const fresh = tables.filter((t) => belowMarker.has(t.table) && !existing.has(t.table.toLowerCase()));

/** A table the parser could not read is recorded rather than thrown on, because
 *  most modules already hold pre-existing tables using builders it does not model
 *  (a named `pgEnum`, an expression index) whose DDL has existed for years. It
 *  becomes fatal only when the unreadable table is one this run would EMIT —
 *  emitting a guess would put wrong SQL in a migration. */
const unreadable = fresh.filter((t) => t.error);
if (unreadable.length) {
  console.error(`❌  ${unreadable.length} new table(s) this generator cannot render:\n`);
  for (const t of unreadable) console.error(`    ${t.table}: ${t.error}`);
  console.error('\n    Extend scripts/lib/ddlFromDrizzle.mjs, or write these tables’ DDL by hand.');
  process.exit(1);
}

const body = fresh.map((t) => renderTable(t, (v) => varToTable.get(v) ?? null)).join('\n\n');

/** Tenancy FK — declared here rather than in the Drizzle file, because the kernel
 *  and the new domain modules import no sibling module by design (PRD 20 §6.2).
 *  The constraint belongs in the database either way. */
const tenancy = fresh
  .filter((t) => t.columns.some((c) => c.name === 'tenant_id') && !t.columns.some((c) => c.name === 'tenant_id' && c.fk))
  .map(
    (t) =>
      `ALTER TABLE ${t.table} DROP CONSTRAINT IF EXISTS fk_${t.table}_tenant;\n` +
      `ALTER TABLE ${t.table} ADD CONSTRAINT fk_${t.table}_tenant\n` +
      `  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;`,
  )
  .join('\n\n');

/** Statements the generator cannot derive: self-referencing foreign keys (a
 *  Drizzle self-reference needs a type annotation the lexical parser will not
 *  read), and `ADD COLUMN` for a table an earlier migration already created.
 *  Kept in a file beside the generator rather than appended to the output by
 *  hand, so regenerating never silently drops them. */
const extrasPath = resolve(here, 'migration-extras', `${moduleName}.sql`);
const extras = existsSync(extrasPath) ? `\n${readFileSync(extrasPath, 'utf8').trim()}\n` : '';

const out =
  `-- ${prefix}_${slug}.sql\n` +
  `--\n` +
  `-- ${title}\n` +
  `--\n` +
  `-- GENERATED from src/infrastructure/database/schema/${moduleName}.ts by\n` +
  `-- scripts/gen-consolidation-migration.mjs (PRD 20 §5 step 2). Edit the Drizzle\n` +
  `-- module and regenerate; do not hand-edit the DDL, or the two sources of truth\n` +
  `-- this file exists to collapse come straight back.\n` +
  `--\n` +
  `-- ${fresh.length} table(s). Idempotent: replayable against an environment at any\n` +
  `-- point in the sequence.\n\n` +
  `${body}\n\n` +
  (tenancy ? `-- Tenancy foreign keys (PRD 20 §4 — every table carries tenant_id).\n${tenancy}\n` : '') +
  extras;

const file = resolve(migrationsDir, `${prefix}_${slug}.sql`);
writeFileSync(file, out);
console.log(`✅  ${prefix}_${slug}.sql — ${fresh.length} table(s) from ${moduleName}.ts`);
