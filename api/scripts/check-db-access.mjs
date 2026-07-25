#!/usr/bin/env node
/**
 * Single-database-access-layer guard.
 *
 * Drizzle is THE database access layer for the api. Every query goes through a
 * `Db` built in `infrastructure/database/connection.ts` — either via the typed
 * query builder (`db.select().from(...)`) or, for SQL the builder cannot express
 * (window functions, `pg_stat_*`, `VACUUM`), via `db.execute(sql\`...\`)`.
 *
 * Before this guard the codebase ran TWO access layers side by side: DDD
 * repositories used Drizzle, while ~21 route/service files dropped to a raw
 * `neon(env.NEON_DATABASE_URL)` tagged-template client. That split was not
 * cosmetic — it caused real drift:
 *
 *   - Raw SQL bypasses the schema types, so 9 tables (freelancer_messages,
 *     ide_datasets, tenant_llm_provider_keys, …) lived in migrations with NO
 *     Drizzle definition at all. Nothing could catch a typo'd column.
 *   - Raw rows come back snake_case while Drizzle returns camelCase, so the two
 *     layers disagreed about the shape of the very same row.
 *   - Each call site re-validated (or forgot to validate) the connection URL.
 *
 * A raw client also silently re-introduces those problems, so the import is
 * banned outright rather than merely discouraged. `connection.ts` is the single
 * sanctioned exception: it is where the driver is wrapped.
 *
 * Run via `npm run check:db-access` and wired into `npm test`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const srcDir = resolve(here, '../src');

/** The ONE file allowed to touch the driver directly. */
const ALLOWED = ['infrastructure/database/connection.ts'];

const BANNED = '@neondatabase/serverless';
/** The package named as a QUOTED module specifier — i.e. actually imported/mocked. */
const SPECIFIER = new RegExp(`['"\`]${BANNED.replace('/', '\\/')}['"\`]`);

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const violations = [];

for (const file of collect(srcDir)) {
  const rel = relative(srcDir, file).split('\\').join('/');
  if (ALLOWED.includes(rel)) continue;

  const text = readFileSync(file, 'utf8');
  text.split('\n').forEach((line, i) => {
    // Match the module SPECIFIER (quoted), so `import ... from '…'`, bare
    // side-effect imports, `require(…)`, dynamic `import(…)` and `vi.mock(…)` are all
    // caught — while prose that merely NAMES the package in a comment is not.
    if (SPECIFIER.test(line)) violations.push(`${rel}:${i + 1}  ${line.trim()}`);
  });
}

if (violations.length > 0) {
  console.error(`Raw database driver used outside the access layer (${violations.length} site(s)):\n`);
  for (const v of violations) console.error('  - ' + v);
  console.error(
    `\nDrizzle is the single database access layer. Build a Db with buildDatabase(env) from` +
    `\n  infrastructure/database/connection.ts and use the query builder.` +
    `\nFor SQL the builder cannot express, use db.execute(sql\`...\`) — still Drizzle, still typed access.` +
    `\nIf a table has no pgTable() definition yet, add one (npm run check:schema enforces that both ways).`,
  );
  process.exit(1);
}

console.log(`DB access-layer check passed: ${BANNED} is imported only by ${ALLOWED.join(', ')}.`);
