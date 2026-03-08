#!/usr/bin/env node
/**
 * Lightweight migration runner for Neon (HTTP transport).
 *
 * - Reads NEON_DATABASE_URL from api/.env or the environment.
 * - Tracks applied migrations in a _migrations table.
 * - Runs all *.sql files in migrations/ that haven't been applied yet.
 * - Called automatically by `pnpm deploy` before wrangler deploy.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Load .env (NEON_DATABASE_URL is a secret, never committed)
// ---------------------------------------------------------------------------

function loadDotEnv(path) {
  try {
    const text = readFileSync(path, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !process.env[key]) process.env[key] = val;
    }
  } catch { /* file not found – that's fine */ }
}

loadDotEnv(join(here, '../.env'));

const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL;
if (!NEON_DATABASE_URL) {
  console.error('❌  NEON_DATABASE_URL not set.');
  console.error('   Create api/.env with: NEON_DATABASE_URL=postgresql://...');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------

const sql = neon(NEON_DATABASE_URL);

function splitSqlStatements(input) {
  const statements = [];
  let current = '';
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag = null;

  while (i < input.length) {
    const ch = input[i];
    const next = input[i + 1];

    if (inLineComment) {
      current += ch;
      if (ch === '\n') inLineComment = false;
      i += 1;
      continue;
    }

    if (inBlockComment) {
      current += ch;
      if (ch === '*' && next === '/') {
        current += '/';
        i += 2;
        inBlockComment = false;
      } else {
        i += 1;
      }
      continue;
    }

    if (!inSingle && !inDouble && dollarTag !== null) {
      if (input.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
      } else {
        current += ch;
        i += 1;
      }
      continue;
    }

    if (!inSingle && !inDouble && ch === '-' && next === '-') {
      current += '--';
      i += 2;
      inLineComment = true;
      continue;
    }

    if (!inSingle && !inDouble && ch === '/' && next === '*') {
      current += '/*';
      i += 2;
      inBlockComment = true;
      continue;
    }

    if (!inDouble && ch === "'") {
      if (inSingle && next === "'") {
        current += "''";
        i += 2;
        continue;
      }
      inSingle = !inSingle;
      current += ch;
      i += 1;
      continue;
    }

    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      current += ch;
      i += 1;
      continue;
    }

    if (!inSingle && !inDouble && ch === '$') {
      const match = input.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        i += dollarTag.length;
        continue;
      }
    }

    if (!inSingle && !inDouble && dollarTag === null && ch === ';') {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  const final = current.trim();
  if (final) statements.push(final);
  return statements;
}

// ---------------------------------------------------------------------------
// Migration tracking table
// ---------------------------------------------------------------------------

await sql(`
  CREATE TABLE IF NOT EXISTS _migrations (
    name       TEXT        PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);

const applied = new Set(
  (await sql('SELECT name FROM _migrations')).map(r => r.name),
);

// ---------------------------------------------------------------------------
// Discover & apply pending migrations
// ---------------------------------------------------------------------------

const migrationsDir = join(here, '../migrations');

let files;
try {
  files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();                     // apply in lexicographic order (0001_, 0002_, …)
} catch {
  console.log('ℹ️  No migrations/ directory – nothing to do.');
  process.exit(0);
}

let applied_count = 0;

for (const file of files) {
  if (applied.has(file)) continue;

  console.log(`  ⏳ Applying ${file}…`);

  const sqlText = readFileSync(join(migrationsDir, file), 'utf8');

  const stmts = splitSqlStatements(sqlText);

  for (const stmt of stmts) {
    await sql(stmt);
  }

  await sql('INSERT INTO _migrations (name) VALUES ($1)', [file]);
  applied_count++;
  console.log(`  ✅ ${file}`);
}

if (applied_count === 0) {
  console.log('✅  Database is up to date.');
} else {
  console.log(`\n✅  Applied ${applied_count} migration(s).`);
}
