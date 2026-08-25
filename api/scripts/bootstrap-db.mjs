#!/usr/bin/env node
/**
 * Fresh-database bootstrap.
 *
 * This is NOT a migration, and deliberately does not live in migrations/.
 *
 * The 509 files in migrations/ are the historical record of an existing
 * database: they are deltas, and the earliest of them (0001_add_missing_columns)
 * already assumes tables nothing in that directory creates. Applying them to an
 * empty database therefore fails immediately — there is no 0000 baseline, and
 * adding one would break `pnpm deploy`, which runs db:migrate against
 * production, where a new 0000 would read as pending and re-CREATE every table.
 *
 * So a new database is materialised from the Drizzle schema instead — the
 * actual source of truth — and its ledger is then backfilled so the runner
 * treats the existing migrations as already applied, which by construction they
 * are: the schema they add up to is the schema we just created.
 *
 *   pnpm db:bootstrap
 *
 * Refuses to touch a database that already has tables. Use --force only on a
 * database you are willing to lose.
 */

import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { neon, neonConfig } from '@neondatabase/serverless';
import { splitSqlStatements } from './lib/splitSqlStatements.mjs';
import { loadDotEnv } from './lib/loadDotEnv.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, '..');

loadDotEnv(join(apiRoot, '.env'));

const force = process.argv.includes('--force');

const NEON_DATABASE_URL = process.env['NEON_DATABASE_URL'];
if (!NEON_DATABASE_URL) {
  console.error('❌  NEON_DATABASE_URL not set.');
  console.error('   Create api/.env with: NEON_DATABASE_URL=postgresql://...');
  process.exit(1);
}

// Local development reaches Postgres through a proxy that speaks Neon's HTTP
// SQL protocol (see docker-compose.yml). Without this the driver derives its
// endpoint from the connection host and never reaches the container.
if (process.env['NEON_FETCH_ENDPOINT']?.trim()) {
  neonConfig.fetchEndpoint = process.env['NEON_FETCH_ENDPOINT'].trim();
}

const sql = neon(NEON_DATABASE_URL);

// ---------------------------------------------------------------------------
// Refuse to run against a database that already has content
// ---------------------------------------------------------------------------

const [{ count: existingTables }] = await sql(`
  SELECT COUNT(*)::int AS count
    FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_type   = 'BASE TABLE'
`);

if (existingTables > 0 && !force) {
  console.error(`❌  Refusing to bootstrap: 'public' already has ${existingTables} table(s).`);
  console.error('   This command builds a database from nothing. For an existing');
  console.error('   database you want `pnpm db:migrate`.');
  console.error('   If you really mean to rebuild it, drop the schema first, or pass --force.');
  process.exit(1);
}
if (existingTables > 0) {
  console.log(`⚠️   --force: bootstrapping over ${existingTables} existing table(s).`);
}

// ---------------------------------------------------------------------------
// Generate the schema DDL from the Drizzle schema
//
// drizzle-kit is a devDependency, so npx runs the local binary — one fetched by
// `npx drizzle-kit@version` resolves drizzle-orm from the npx cache instead of
// from here and dies with "Please install latest version of drizzle-orm".
//
// Every flag is passed explicitly so drizzle-kit never reads drizzle.config.ts,
// whose `import { defineConfig } from 'drizzle-kit'` is its own resolution trap.
// ---------------------------------------------------------------------------

const outDir = mkdtempSync(join(tmpdir(), 'bf-baseline-'));
let generated;

try {
  console.log('⏳  Generating schema from src/infrastructure/database/schema.ts…');
  try {
    execFileSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      [
        'drizzle-kit', 'generate',
        `--out=${outDir}`,
        '--dialect=postgresql',
        '--schema=./src/infrastructure/database/schema.ts',
      ],
      // drizzle-kit reports its failures on stdout, so both streams are captured
      // and replayed only when it exits non-zero — a successful run stays quiet.
      { cwd: apiRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    console.error('❌  drizzle-kit generate failed:');
    if (error.stdout) console.error(error.stdout.toString());
    if (error.stderr) console.error(error.stderr.toString());
    process.exit(1);
  }

  const sqlFile = readdirSync(outDir).find((f) => f.endsWith('.sql'));
  if (!sqlFile) throw new Error('drizzle-kit produced no .sql file');
  generated = readFileSync(join(outDir, sqlFile), 'utf8');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Resolve double primary keys
//
// A few tables declare both a column-level `.primaryKey()` and a composite
// `primaryKey({ columns: [...] })`. Postgres accepts only one per table, so the
// generated DDL is invalid as written. The composite is demoted to UNIQUE,
// which keeps the uniqueness guarantee the schema is asking for while leaving
// the surrogate `id` as the key rows are addressed by.
//
// This is a real inconsistency between the Drizzle schema and the database it
// describes, not a quirk of generation — hence the warning rather than a silent
// rewrite. Fixing the schema is what actually retires this block.
// ---------------------------------------------------------------------------

const demoted = [];
const ddl = generated
  .replace(/--> statement-breakpoint/g, '')
  .replace(/CREATE TABLE "([^"]+)" \(([\s\S]*?)\n\);/g, (whole, table, body) => {
    const hasColumnPk = /^\s*"[^"]+"[^,]*\bPRIMARY KEY\b/m.test(body);
    if (!hasColumnPk) return whole;
    let changed = false;
    const rewritten = body.replace(
      /CONSTRAINT "([^"]+)" PRIMARY KEY\(/g,
      (_, name) => { changed = true; return `CONSTRAINT "${name}" UNIQUE(`; },
    );
    if (!changed) return whole;
    demoted.push(table);
    return `CREATE TABLE "${table}" (${rewritten}\n);`;
  });

if (demoted.length) {
  console.log(`⚠️   ${demoted.length} table(s) declare two primary keys; composite demoted to UNIQUE:`);
  for (const t of demoted) console.log(`      ${t}`);
  console.log('    Fix these in src/infrastructure/database/schema/ — the schema and the');
  console.log('    database it describes have drifted.');
}

// ---------------------------------------------------------------------------
// Apply
//
// One statement per call rather than a single transaction: the DDL runs to a
// couple of thousand statements, which is far past what one HTTP request should
// carry. A failure therefore leaves a partial schema — acceptable because this
// only ever runs against a database that was empty when it started, so the
// recovery is to drop the schema and run it again.
// ---------------------------------------------------------------------------

const statements = splitSqlStatements(ddl);
console.log(`⏳  Applying ${statements.length} statements…`);

for (let i = 0; i < statements.length; i++) {
  try {
    await sql(statements[i]);
  } catch (error) {
    console.error(`\n❌  Statement ${i + 1}/${statements.length} failed:`);
    console.error(statements[i].slice(0, 500));
    console.error(`\n   ${error.message}`);
    console.error('\n   The schema is now partially built. Drop it and re-run:');
    console.error('   DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    process.exit(1);
  }
  if ((i + 1) % 500 === 0) console.log(`    ${i + 1}/${statements.length}`);
}

// ---------------------------------------------------------------------------
// Backfill the ledger
//
// The schema just created already includes everything migrations/ adds up to,
// so every one of those files is recorded as applied. Skipping this would leave
// the next `db:migrate` trying to apply 0001 to a database that is already at
// head — which fails, because these are deltas, not idempotent scripts.
// ---------------------------------------------------------------------------

await sql(`
  CREATE TABLE IF NOT EXISTS _migrations (
    name       TEXT        PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);

const files = readdirSync(join(apiRoot, 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort();

for (const file of files) {
  await sql('INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [file]);
}

console.log(`✅  Bootstrapped: ${statements.length} statements, ${files.length} migration(s) recorded.`);
console.log('    Run `pnpm db:migrate` to confirm it reports the database up to date.');
