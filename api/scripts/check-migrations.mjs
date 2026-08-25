#!/usr/bin/env node
/**
 * Migration sequence guard (T9 · Platform · DB · CI steward).
 *
 * "Migration numbering is the one true serialization point." Two migration files
 * that share a numeric prefix are a latent bug: scripts/migrate.mjs sorts by FULL
 * filename so both apply in a deterministic order today, but a runner that dedupes
 * on the bare prefix token could silently SKIP one (the `0109`/`0111` collisions
 * that bit us). This guard fails the build on ANY duplicate numeric prefix that is
 * not explicitly grandfathered.
 *
 * The numeric prefix is the token before the first `_` (so `0068a_…` is distinct
 * from `0068_…` — intentional point-release inserts do not collide).
 *
 * Grandfathered historical collisions live in
 * migrations/.migration-collisions-allowlist.txt — they were applied identically
 * to every live DB before this guard existed, so renumbering them is a deliberate
 * release-level op, not a CI cleanup (tracked in the README gap register). A stale
 * allowlist entry (a prefix that no longer collides) is reported so the list can be
 * trimmed as the historical debt is paid down.
 *
 * SECOND GUARD — stray migration directories. `scripts/migrate.mjs` only ever
 * reads `api/migrations` (and `api/transactional-migrations`), so a `.sql` written
 * anywhere else is invisible to every environment: it never applies, and its number
 * gets handed out again to a DIFFERENT migration. That is exactly what happened to
 * `api/api/migrations/0197_tasks_action_type.sql` + `0198_run_model_outcomes.sql`
 * (a generator run from the wrong cwd) — both orphaned while the real 0197/0198
 * shipped other work. This guard fails the build on any `.sql` outside the two
 * sanctioned directories so the mistake cannot recur silently.
 *
 * Run via `npm run check:migrations` and wired into `npm test` so CI catches any
 * new collision before it ships.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDrizzleTables } from './lib/drizzleSchema.mjs';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const migrationsDir = resolve(here, '../migrations');
const repoRoot = resolve(here, '../..');
const allowlistFile = resolve(migrationsDir, '.migration-collisions-allowlist.txt');

const allowlist = existsSync(allowlistFile)
  ? new Set(
      readFileSync(allowlistFile, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#')),
    )
  : new Set();

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

// Group by numeric prefix = the token before the first underscore.
const byPrefix = new Map(); // prefix -> string[] filenames
for (const file of files) {
  const us = file.indexOf('_');
  const prefix = us === -1 ? file.replace(/\.sql$/, '') : file.slice(0, us);
  if (!/^[0-9]/.test(prefix)) continue; // ignore non-numbered files
  if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
  byPrefix.get(prefix).push(file);
}

const newCollisions = []; // [{ prefix, files }]
const collidingPrefixes = new Set();
for (const [prefix, group] of byPrefix) {
  if (group.length > 1) {
    collidingPrefixes.add(prefix);
    if (!allowlist.has(prefix)) newCollisions.push({ prefix, files: group });
  }
}

// Allowlist hygiene: an entry that no longer collides is dead weight.
const staleAllowlist = [...allowlist].filter((p) => !collidingPrefixes.has(p));

// ---------------------------------------------------------------------------
// Stray migration directories — a .sql outside the two directories migrate.mjs
// reads is dead on arrival, and burns a number a real migration will reuse.
// ---------------------------------------------------------------------------

/** The only directories `scripts/migrate.mjs` applies from, repo-root-relative. */
const SANCTIONED_DIRS = ['api/migrations', 'api/transactional-migrations'];
/** Directories that legitimately hold .sql fixtures/scripts that are NOT migrations. */
const IGNORED_DIRS = new Set(['node_modules', '.git', '.next', 'dist', '.wrangler', 'build', 'out']);
/**
 * SQL that is deliberately NOT an api migration. Each entry needs a reason —
 * "it was already there" is how a stray file becomes permanent.
 */
const ALLOWED_SQL_FILES = new Set([
  // Hand-run rollback for the claw→builderforce rename; never auto-applied.
  'api/scripts/rollback-0078-claw-rename.sql',
  // Docker's postgres entrypoint script. It CREATEs the two databases — the
  // primary and the transactional one — so it necessarily runs before either
  // migration runner has a database to connect to. Numbering it would be wrong:
  // it is not a schema change, it is the container that holds the schemas.
  'docker/postgres-init/01-databases.sql',
  // The standalone `worker/` package owns its own schema and applies it with
  // worker/scripts/migrate.ts — a different database and a different runner.
  'worker/schema.sql',
]);

/** Fragments INLINED into a generated migration rather than applied on their own.
 *  `gen-consolidation-migration.mjs` derives the consolidation DDL from the Drizzle
 *  module (PRD 20 §5 step 2) and appends the matching file from here — the
 *  statements it cannot derive lexically, such as a self-referencing foreign key.
 *  They carry no migration number and cannot have one reissued, because they are
 *  not files the runner ever sees; the numbered file that embeds them is. */
const INLINED_FRAGMENT_DIR = 'api/scripts/migration-extras';

function collectSql(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      collectSql(full, out);
    } else if (entry.name.endsWith('.sql')) {
      out.push(full);
    }
  }
  return out;
}

const strays = [];
for (const file of collectSql(repoRoot)) {
  const rel = relative(repoRoot, file).split('\\').join('/');
  if (ALLOWED_SQL_FILES.has(rel)) continue;
  if (rel.startsWith(INLINED_FRAGMENT_DIR + '/')) continue;
  if (SANCTIONED_DIRS.some((d) => rel.startsWith(d + '/'))) continue;
  strays.push(rel);
}

let failed = false;

if (strays.length > 0) {
  failed = true;
  console.error(`❌  Migration .sql files outside the applied directories (${strays.length}):\n`);
  for (const s of strays) console.error(`      - ${s}`);
  console.error(
    `\n   scripts/migrate.mjs only applies ${SANCTIONED_DIRS.join(' and ')}.` +
      '\n   A .sql anywhere else NEVER runs, and its number gets reissued to another' +
      '\n   migration (see api/api/migrations/0197+0198, deleted 2026-07-26). Move the' +
      '\n   file into api/migrations with a free number from your track\'s band, or — if' +
      '\n   it is a hand-run operational script — add it to ALLOWED_SQL_FILES here.\n',
  );
}

if (newCollisions.length > 0) {
  failed = true;
  console.error('❌  Duplicate migration numbers detected:\n');
  for (const { prefix, files: group } of newCollisions) {
    console.error(`   ${prefix}:`);
    for (const f of group) console.error(`      - ${f}`);
  }
  console.error(
    '\n   Renumber the newer file of each pair into a free slot from your\n' +
      '   track\'s migration band (README → 🧵 Isolation Tracks). Never reuse a\n' +
      '   number. If the collision is historical and already deployed everywhere,\n' +
      '   add its prefix to migrations/.migration-collisions-allowlist.txt with a\n' +
      '   note — but new collisions must be renumbered, not allowlisted.',
  );
}

if (staleAllowlist.length > 0) {
  // Not a hard failure on its own — but if it is the ONLY finding we still exit
  // non-zero so the list gets trimmed; pair it with the collision failure above
  // otherwise.
  console.error(
    `\n⚠️  Stale collision-allowlist entries (no longer collide, remove them): ${staleAllowlist.join(', ')}`,
  );
  failed = true;
}

// ---------------------------------------------------------------------------
// THIRD GUARD — foreign-key column types.
//
// Postgres REFUSES to create a foreign key whose column type is incompatible with
// the referenced key's type: `foreign key constraint "…_fkey" cannot be implemented
// … "created_by" of the referencing table and "id" of the referenced table are of
// incompatible types: integer and character varying`. That is not a warning — the
// CREATE TABLE fails, the migration aborts, and the DEPLOY dies.
//
// Nothing caught it before it shipped: `check-schema-drift.mjs` deliberately checks
// only that a column EXISTS ("this script flags missing columns, not type
// mismatches"), tsgo happily typechecks a Drizzle `integer()` pointed at a
// `varchar()` primary key, and no test touches real DDL. So the first signal was a
// red deploy (0372_rehearsal.sql: `created_by INTEGER REFERENCES users(id)` against
// `users.id VARCHAR(36)`).
//
// This guard closes that hole statically: collect every column declaration across
// all migrations, then re-read each inline `REFERENCES <table>(<col>)` and compare
// the declared type of both sides. Purely lexical — no database needed — so it runs
// in the same CI step as the rest of the migration guards.
// ---------------------------------------------------------------------------

/**
 * The type token(s) at the start of a column definition, stopping BEFORE the
 * constraint keywords that follow it (`NOT NULL`, `PRIMARY KEY`, `REFERENCES`,
 * `DEFAULT`…). Handles the multi-word Postgres spellings; everything else is a
 * single identifier.
 */
const TYPE_TOKEN_RE =
  /^(character\s+varying|double\s+precision|timestamp\s+with(?:out)?\s+time\s+zone|time\s+with(?:out)?\s+time\s+zone|bit\s+varying|[A-Za-z]\w*)\s*(\([^)]*\))?/i;

/** Postgres type aliases folded to one canonical name, so `INT4`/`INTEGER`/`SERIAL`
 *  and `VARCHAR(36)`/`CHARACTER VARYING` compare as equal rather than as drift. */
function canonicalSqlType(raw) {
  const m = TYPE_TOKEN_RE.exec(raw.trim());
  // Unparseable → return something that can never match, so the caller's
  // "target not found" path skips it rather than reporting a phantom mismatch.
  if (!m) return '';
  const bare = m[1].toLowerCase().replace(/\s+/g, ' ');
  const ALIASES = {
    int: 'integer', int4: 'integer', integer: 'integer',
    serial: 'integer', serial4: 'integer',
    int8: 'bigint', bigint: 'bigint', bigserial: 'bigint', serial8: 'bigint',
    int2: 'smallint', smallint: 'smallint', smallserial: 'smallint',
    varchar: 'varchar', 'character varying': 'varchar', char: 'varchar', 'character': 'varchar',
    text: 'text',
    uuid: 'uuid',
    bool: 'boolean', boolean: 'boolean',
  };
  return ALIASES[bare] ?? bare;
}

/**
 * FK compatibility as Postgres actually enforces it: the types must be comparable.
 * `varchar` vs `text` IS allowed (both are string types with an equality operator);
 * `integer` vs `varchar` is not. Kept deliberately narrow — this guard exists to
 * catch the fatal mismatch, not to police style.
 */
function fkTypesCompatible(a, b) {
  if (!a || !b) return true; // unparseable side — never fail on a guess
  if (a === b) return true;
  const STRINGY = new Set(['varchar', 'text']);
  if (STRINGY.has(a) && STRINGY.has(b)) return true;
  const INTY = new Set(['integer', 'bigint', 'smallint']);
  if (INTY.has(a) && INTY.has(b)) return true; // Postgres permits int-family FKs
  return false;
}

/**
 * Parse every `CREATE TABLE` body across the migrations into
 * `table -> column -> { type, refTable, refColumn, file }`.
 *
 * Deliberately lexical and forgiving: a line it cannot parse is skipped rather than
 * guessed at, because a false FAILURE here blocks every deploy while a false pass
 * only means we keep the status quo.
 */
function collectMigrationColumns(sqlFiles) {
  const columns = new Map(); // table -> Map<column, {type,file}>
  const fks = [];            // { table, column, type, refTable, refColumn, file }

  /**
   * Split a definition list on TOP-LEVEL commas only, so `NUMERIC(10,2)` stays one
   * clause. This is what makes both the CREATE-TABLE body and the multi-column
   * `ALTER TABLE … ADD COLUMN a …, ADD COLUMN b …` form parse correctly — reading
   * either as "everything up to the next `;`" let one column's `REFERENCES` be
   * attributed to the previous column, which is a false positive that would block
   * every deploy.
   */
  function splitTopLevelCommas(body) {
    const out = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) { out.push(body.slice(start, i)); start = i + 1; }
    }
    out.push(body.slice(start));
    return out.map((s) => s.trim()).filter(Boolean);
  }

  /** Record one `<name> <type> … [REFERENCES t(c)]` clause. */
  function readClause(table, clause, file) {
    // Table-level constraints carry no column type.
    if (/^(primary\s+key|unique|constraint|foreign\s+key|check|exclude)\b/i.test(clause)) return;
    const colM = /^["']?(\w+)["']?\s+([\s\S]+)$/.exec(clause);
    if (!colM) return;
    const column = colM[1].toLowerCase();
    const type = canonicalSqlType(colM[2]);
    if (!type) return;
    if (!columns.has(table)) columns.set(table, new Map());
    if (!columns.get(table).has(column)) columns.get(table).set(column, { type, file });
    const refM = /references\s+["']?(\w+)["']?\s*\(\s*["']?(\w+)["']?\s*\)/i.exec(clause);
    if (refM) fks.push({ table, column, type, refTable: refM[1].toLowerCase(), refColumn: refM[2].toLowerCase(), file });
  }

  for (const { file, text } of sqlFiles) {
    // Strip line comments so a commented-out REFERENCES never registers.
    const sql = text.replace(/--[^\n]*/g, '');

    const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?["']?(\w+)["']?\s*\(([\s\S]*?)\n\s*\)\s*;/gi;
    let m;
    while ((m = createRe.exec(sql)) !== null) {
      const table = m[1].toLowerCase();
      for (const clause of splitTopLevelCommas(m[2])) readClause(table, clause, file);
    }

    // `ALTER TABLE x ADD COLUMN y <type> … REFERENCES z(c)[, ADD COLUMN …]` — the
    // other way a typed FK column enters the schema.
    const alterRe = /alter\s+table\s+["']?(\w+)["']?\s+([\s\S]*?);/gi;
    while ((m = alterRe.exec(sql)) !== null) {
      const table = m[1].toLowerCase();
      for (const clause of splitTopLevelCommas(m[2])) {
        const addM = /^add\s+column\s+(?:if\s+not\s+exists\s+)?([\s\S]+)$/i.exec(clause);
        if (addM) readClause(table, addM[1], file);
      }
    }
  }
  return { columns, fks };
}

const sqlTexts = files.map((f) => ({ file: f, text: readFileSync(join(migrationsDir, f), 'utf8') }));
const { columns: migColumns, fks: migFks } = collectMigrationColumns(sqlTexts);

// Baseline tables (`users`, …) predate the tracked migration set — nothing in
// api/migrations/ creates them — so the SQL pass alone cannot resolve `users.id`.
// That is precisely the FK that broke the deploy, so fall back to the Drizzle
// schema, which is the live declaration of those columns. Shared parser with
// check-schema-drift.mjs so the two guards read the schema identically.
const drizzleTypes = parseDrizzleTables(resolve(here, '../src'));

/** The declared type of a referenced column: migrations first (they are the DDL of
 *  record), then the schema for tables no migration creates. */
function resolveTargetType(table, column) {
  const fromSql = migColumns.get(table)?.get(column);
  if (fromSql) return { type: fromSql.type, source: fromSql.file };
  const fromSchema = drizzleTypes.get(table)?.get(column);
  if (fromSchema?.type) return { type: fromSchema.type, source: `schema: ${table}.${column}` };
  return null;
}

const fkTypeMismatches = [];
const fkUnresolvedTargets = [];
for (const fk of migFks) {
  const target = resolveTargetType(fk.refTable, fk.refColumn);
  // Still unresolved → the referenced table is declared somewhere neither pass can
  // see. Silence beats a false failure that blocks every deploy, so this NEVER
  // fails the build — but it is reported, because the same shape is produced by a
  // genuine typo (`REFERENCES userz(id)`), which otherwise surfaces only as a red
  // deploy. Warning, not gate: see the report below.
  if (!target) {
    fkUnresolvedTargets.push(fk);
    continue;
  }
  if (!fkTypesCompatible(fk.type, target.type)) {
    fkTypeMismatches.push({ ...fk, targetType: target.type, targetFile: target.source });
  }
}

if (fkTypeMismatches.length > 0) {
  console.error('\n❌  Foreign key with an incompatible column type — Postgres will REFUSE this constraint and the migration will fail on deploy:\n');
  for (const f of fkTypeMismatches) {
    console.error(`   ${f.file}: ${f.table}.${f.column} ${f.type.toUpperCase()} → ${f.refTable}.${f.refColumn} ${f.targetType.toUpperCase()} (${f.targetFile})`);
  }
  console.error(
    '\n   Give the referencing column the SAME type as the key it points at, and fix\n' +
      '   the Drizzle column in src/infrastructure/database/schema/ to match — a\n' +
      '   mismatch there typechecks fine but silently discards every value (an\n' +
      '   integer column fed a VARCHAR user id stores NULL forever).',
  );
  failed = true;
}

if (fkUnresolvedTargets.length > 0) {
  // NON-FATAL by design. `resolveTargetType` returning null means neither the
  // migrations nor the Drizzle schema declares the referenced column — which is
  // produced by exactly two situations that this pass cannot tell apart: a table
  // that legitimately predates the tracked migration set and never got a pgTable
  // (silence is correct), and a misspelling (`REFERENCES userz(id)`), which is a
  // guaranteed red deploy. Failing would block every deploy on the first kind, so
  // the typo is surfaced as a warning the reader can act on instead.
  const byTarget = new Map();
  for (const fk of fkUnresolvedTargets) {
    const key = `${fk.refTable}.${fk.refColumn}`;
    if (!byTarget.has(key)) byTarget.set(key, []);
    byTarget.get(key).push(fk);
  }
  console.warn(
    `\n⚠️  Foreign key target not declared anywhere (${byTarget.size} distinct, not a failure):\n`,
  );
  for (const [target, group] of [...byTarget].sort()) {
    const [refTable, refColumn] = target.split('.');
    const knownTable = migColumns.has(refTable) || drizzleTypes.has(refTable);
    const near = knownTable
      ? [...(migColumns.get(refTable)?.keys() ?? []), ...(drizzleTypes.get(refTable)?.keys() ?? [])]
          .filter((c) => c.includes(refColumn) || refColumn.includes(c))
      : [...new Set([...migColumns.keys(), ...drizzleTypes.keys()])].filter(
          (t) => t.includes(refTable) || refTable.includes(t),
        );
    const hint = near.length
      ? ` — did you mean ${[...new Set(near)].slice(0, 4).map((n) => (knownTable ? `${refTable}.${n}` : n)).join(', ')}?`
      : knownTable
        ? ` — table '${refTable}' is known but declares no column '${refColumn}'.`
        : ` — no table '${refTable}' is declared in the migrations or the schema.`;
    console.warn(`   ${target}${hint}`);
    for (const fk of group.slice(0, 3)) console.warn(`      referenced by ${fk.file}: ${fk.table}.${fk.column}`);
    if (group.length > 3) console.warn(`      … and ${group.length - 3} more`);
  }
  console.warn(
    '\n   A target that is genuinely a legacy/baseline table is expected here; give it\n' +
      '   a pgTable in src/infrastructure/database/schema/ to silence it. A target that\n' +
      '   is a TYPO will fail db:migrate — fix it before it ships.\n',
  );
}

// ---------------------------------------------------------------------------
// FOURTH GUARD — a qualified column reference that does not exist.
//
// The FK guard above closes "the constraint cannot be built". This closes the
// other half of the same hole: a migration's DML naming a column that was never
// declared. `0467_developer_portal.sql` backfilled a publisher name from
// `TRIM(u.name)` — but `users` has `display_name`, and has never had `name`.
// tsgo does not read SQL, no test executes a migration, and `check-schema-drift`
// only asks whether a Drizzle column exists in the DDL — never the reverse. So
// the first and only signal was `NeonDbError: column u.name does not exist`,
// mid-file, at deploy.
//
// The same failure is one typo away in any of the 419 files, and it costs a full
// red deploy every time. This resolves each `alias.column` against the alias's
// table, using the union of every column the migrations declare and everything
// the Drizzle schema declares.
//
// CONSERVATIVE BY CONSTRUCTION — this guard blocks deploys, so every ambiguity
// resolves to SILENCE rather than to a finding:
//   - an alias bound to a derived table, a CTE or a LATERAL is skipped entirely,
//     because its columns are computed and cannot be looked up;
//   - an alias bound to two different tables in one statement is skipped;
//   - only a table with a CREATE TABLE in the migrations, or a pgTable in the
//     schema, is judged. A table known ONLY through `ALTER TABLE … ADD COLUMN`
//     (the legacy `coderclaw_instances`, guarded behind `to_regclass(…)`) has an
//     unknown base shape, and every column it already had would report as missing;
//   - string literals are blanked, so prose inside a seeded prompt cannot be read
//     as SQL — `e.g.` is not a reference to a column named `g`;
//   - the column set is a UNION over ALL migrations, so a column that was later
//     dropped or renamed still resolves for the migration that legitimately used
//     it while it existed.
// ---------------------------------------------------------------------------

const transactionalDir = resolve(here, '../transactional-migrations');
let transactionalTexts = [];
try {
  transactionalTexts = readdirSync(transactionalDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: `transactional-migrations/${f}`, text: readFileSync(join(transactionalDir, f), 'utf8') }));
} catch { /* no transactional migrations — nothing to add */ }

const allSqlTexts = [...sqlTexts, ...transactionalTexts];

/** table -> Set<column>: every column any migration declares, plus the live schema. */
function buildKnownColumns() {
  const known = new Map();
  const add = (table, column) => {
    const t = table.toLowerCase();
    if (!known.has(t)) known.set(t, new Set());
    known.get(t).add(column.toLowerCase());
  };
  for (const [table, cols] of collectMigrationColumns(allSqlTexts).columns) {
    for (const col of cols.keys()) add(table, col);
  }
  for (const [table, cols] of drizzleTypes) {
    for (const col of cols.keys()) add(table, col);
  }
  // A renamed column is legitimately referenced under BOTH names — the old one by
  // every migration before the rename, the new one by every migration after it.
  const renameRe = /alter\s+table\s+(?:if\s+exists\s+)?["']?(\w+)["']?\s+rename\s+column\s+["']?(\w+)["']?\s+to\s+["']?(\w+)["']?/gi;
  for (const { text } of allSqlTexts) {
    for (const m of text.replace(/--[^\n]*/g, '').matchAll(renameRe)) {
      add(m[1], m[2]);
      add(m[1], m[3]);
    }
  }
  return known;
}

const knownColumns = buildKnownColumns();

/**
 * The tables whose FULL shape is known — a `CREATE TABLE` in the migrations, or a
 * `pgTable` in the schema. A table seen only through `ALTER TABLE … ADD COLUMN`
 * is deliberately excluded: `knownColumns` would hold just the added column, and
 * every pre-existing one it references would be reported as missing.
 */
const declaredTables = new Set(drizzleTypes.keys());
for (const { text } of allSqlTexts) {
  for (const m of text.replace(/--[^\n]*/g, '').matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?["']?(\w+)/gi)) {
    declaredTables.add(m[1].toLowerCase());
  }
}

/** After a `,`, a `(` or an `=`, a dollar-quoted block is a VALUE. Anywhere else
 *  (`DO $$`, `AS $$`) it is executable code. */
const VALUE_POSITION = new Set([',', '(', '=']);

/**
 * Blank the CONTENT of every literal, preserving length and newlines.
 *
 * Seed migrations insert English prose — `0210_seed_system_prompts.sql` ships a
 * prompt variable described as "e.g. idea, pre-launch", which parses as `e.g`, a
 * qualified reference to a column named `g` on whatever `e` is bound to in the
 * same statement. Blanking is by content, not by removal, so reported line numbers
 * still point at real source.
 *
 * Dollar-quoted blocks split by position. In VALUE position (`$v$[…]$v$` as an
 * INSERT value) the body is prose and is blanked. Everywhere else it is plpgsql —
 * `DO $$ … $$`, `CREATE FUNCTION … AS $$ … $$` — and is KEPT, because the
 * segment_id backfills in `0056` live inside those blocks and are exactly the DML
 * this guard exists to read. Their inner `'…'` literals are still blanked.
 */
function blankLiterals(text) {
  const out = text.split('');
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  let lastNonWs = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'") {
      let j = i + 1;
      for (; j < text.length; j++) {
        if (text[j] === "'") {
          if (text[j + 1] === "'") { j++; continue; } // '' is an escaped quote
          break;
        }
      }
      blank(i + 1, j);
      i = j + 1;
      lastNonWs = "'";
      continue;
    }
    const tag = ch === '$' ? /^\$[A-Za-z0-9_]*\$/.exec(text.slice(i))?.[0] : null;
    if (tag) {
      const close = text.indexOf(tag, i + tag.length);
      const bodyEnd = close === -1 ? text.length : close;
      if (VALUE_POSITION.has(lastNonWs)) {
        blank(i + tag.length, bodyEnd);
      } else {
        const inner = blankLiterals(text.slice(i + tag.length, bodyEnd));
        for (let k = 0; k < inner.length; k++) out[i + tag.length + k] = inner[k];
      }
      i = close === -1 ? text.length : close + tag.length;
      lastNonWs = '$';
      continue;
    }
    if (!/\s/.test(ch)) lastNonWs = ch;
    i++;
  }
  return out.join('');
}

/** Words that can follow a table name without being an alias. */
const NOT_AN_ALIAS = new Set([
  'as', 'on', 'using', 'where', 'set', 'select', 'from', 'join', 'inner', 'left', 'right',
  'full', 'outer', 'cross', 'lateral', 'natural', 'group', 'order', 'having', 'limit',
  'offset', 'fetch', 'for', 'union', 'except', 'intersect', 'window', 'returning', 'values',
  'and', 'or', 'not', 'is', 'null', 'in', 'exists', 'when', 'then', 'else', 'end', 'case',
  'add', 'drop', 'alter', 'rename', 'column', 'table', 'index', 'only', 'do', 'nothing',
  'conflict', 'constraint', 'default', 'with', 'without', 'distinct', 'all', 'into',
  'tablesample', 'ordinality', 'primary', 'key', 'unique', 'references', 'cascade', 'restrict',
]);

/**
 * Split on top-level `;`, leaving `$tag$ … $tag$` bodies intact, and return each
 * statement with its offset so a finding can be reported at its real line.
 *
 * A `DO $$ … $$` block is ONE statement and keeps its body: the segment_id
 * backfills in 0056 live inside those blocks, and dropping them would blind the
 * guard to the exact shape of DML most likely to name a column wrong.
 */
function splitStatements(sql) {
  const out = [];
  let start = 0;
  let i = 0;
  let dollarTag = null;
  const push = (end) => { if (sql.slice(start, end).trim()) out.push({ text: sql.slice(start, end), offset: start }); };
  while (i < sql.length) {
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) { i += dollarTag.length; dollarTag = null; continue; }
      i++;
      continue;
    }
    const tag = sql[i] === '$' ? /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i)) : null;
    if (tag) { dollarTag = tag[0]; i += tag[0].length; continue; }
    if (sql[i] === ';') { push(i); start = i + 1; }
    i++;
  }
  push(sql.length);
  return out;
}

const BIND_RE = /\b(?:from|join|update|insert\s+into|into)\s+(?:only\s+)?["']?(\w+)["']?(?:\s+as\b)?(?:\s+(\w+))?/gi;
/** `) alias` — a derived table, a LATERAL or a parenthesised set. Its columns are
 *  computed, so any alias bound this way is unresolvable and must be left alone. */
const DERIVED_RE = /\)\s*(?:as\s+)?(\w+)/gi;
/** `name AS (` — a CTE. Same reasoning. */
const CTE_RE = /\b(\w+)\s+as\s*\(/gi;
const REF_RE = /\b(\w+)\.(\w+)\b/g;

const unknownRefs = [];
for (const { file, text } of allSqlTexts) {
  const sql = blankLiterals(text.replace(/--[^\n]*/g, ''));
  for (const { text: statement, offset } of splitStatements(sql)) {
    // Names that cannot be resolved to a real table, and are therefore off limits.
    const opaque = new Set();
    for (const m of statement.matchAll(DERIVED_RE)) opaque.add(m[1].toLowerCase());
    for (const m of statement.matchAll(CTE_RE)) opaque.add(m[1].toLowerCase());

    /** alias -> table, or null once the alias is ambiguous. */
    const bound = new Map();
    const bind = (alias, table) => {
      const a = alias.toLowerCase();
      if (bound.has(a) && bound.get(a) !== table) bound.set(a, null);
      else bound.set(a, table);
    };
    for (const m of statement.matchAll(BIND_RE)) {
      const table = m[1].toLowerCase();
      bind(table, table); // an unaliased table is referenced by its own name
      const alias = m[2];
      if (alias && !NOT_AN_ALIAS.has(alias.toLowerCase())) bind(alias, table);
    }

    for (const m of statement.matchAll(REF_RE)) {
      const alias = m[1].toLowerCase();
      const column = m[2].toLowerCase();
      if (opaque.has(alias)) continue;
      const table = bound.get(alias);
      if (!table || !declaredTables.has(table)) continue;
      const cols = knownColumns.get(table);
      // An empty column set means the parse failed, not that the table is empty.
      if (!cols || cols.size === 0) continue;
      if (cols.has(column)) continue;
      const line = sql.slice(0, offset + m.index).split('\n').length;
      unknownRefs.push({ file, line, alias, table, column });
    }
  }
}

if (unknownRefs.length > 0) {
  console.error('\n❌  Migration references a column that does not exist — this is a red deploy at db:migrate, not a test failure:\n');
  for (const r of unknownRefs) {
    const near = [...(knownColumns.get(r.table) ?? [])]
      .filter((c) => c.includes(r.column) || r.column.includes(c))
      .slice(0, 4);
    console.error(
      `   ${r.file}:${r.line}: ${r.alias}.${r.column} — ${r.table} has no column '${r.column}'` +
        (near.length ? `. Did you mean ${near.join(', ')}?` : '.'),
    );
  }
  console.error(
    '\n   The column set is the UNION of every column the migrations declare and\n' +
      '   everything src/infrastructure/database/schema/ declares, so a column that\n' +
      '   merely moved or was dropped later still resolves. A name reported here was\n' +
      '   never declared anywhere.\n',
  );
  failed = true;
}

// ---------------------------------------------------------------------------
// FIFTH GUARD — column TYPE drift between the Drizzle schema and the migrations.
//
// The FK guard catches the subset of type drift Postgres REFUSES outright. This
// catches the rest, which is worse because nothing rejects it: a column declared
// `jsonb()` in schema/*.ts and `TEXT` in the migration typechecks, migrates, and
// then hands the application a STRING everywhere it expects an object — the
// `platform_modules.permissions` case named in check-schema-drift.mjs's own
// header. `check-schema-drift.mjs` only asks whether the column EXISTS.
//
// Compared by type FAMILY, not by exact spelling. `VARCHAR(255)` vs `text` is a
// width/spelling difference with identical runtime behaviour and would drown the
// real findings; `text` vs `jsonb`, `integer` vs `varchar`, `boolean` vs
// `integer` change what the application receives. Only the second kind is a
// finding.
//
// Existing mismatches are grandfathered in
// migrations/.schema-type-drift-allowlist.txt — each is a real defect that needs
// a migration to pay down, but failing the build on the historical set would
// block every deploy today. A stale entry (one that no longer drifts) is
// reported so the list shrinks as the debt is paid.
// ---------------------------------------------------------------------------

/** The behavioural family of a Postgres/Drizzle type. Two types in the same
 *  family hand the application the same JavaScript shape; two in different
 *  families do not, which is the entire point of this guard. */
function typeFamily(type) {
  if (!type) return null;
  const t = type.toLowerCase();
  if (['varchar', 'text', 'char', 'character', 'character varying', 'bpchar', 'citext'].includes(t)) return 'string';
  if (['integer', 'bigint', 'smallint'].includes(t)) return 'integer';
  if (['real', 'double precision', 'numeric', 'decimal', 'money'].includes(t)) return 'number';
  if (t === 'boolean') return 'boolean';
  if (t === 'uuid') return 'uuid';
  if (['json', 'jsonb'].includes(t)) return 'json';
  if (t.startsWith('timestamp') || t === 'date' || t.startsWith('time') || t === 'interval') return 'temporal';
  if (['bytea', 'blob'].includes(t)) return 'binary';
  if (t.endsWith('[]')) return 'array';
  return null; // unknown → never judged
}

/**
 * table -> column -> type, as the MIGRATIONS finally leave it. The base type comes
 * from CREATE TABLE / ADD COLUMN (already collected), then every
 * `ALTER TABLE t ALTER COLUMN c [SET DATA] TYPE x` overrides it — without that
 * override a column that was legitimately migrated to a new type would report as
 * drift against the schema that correctly followed it.
 */
function buildMigrationTypes() {
  const types = new Map();
  for (const [table, cols] of collectMigrationColumns(allSqlTexts).columns) {
    types.set(table, new Map([...cols].map(([c, v]) => [c, v.type])));
  }
  const alterTypeRe =
    /alter\s+table\s+(?:if\s+exists\s+)?["']?(\w+)["']?\s+alter\s+column\s+["']?(\w+)["']?\s+(?:set\s+data\s+)?type\s+([\s\S]*?)(?=\s+using\b|,|;)/gi;
  for (const { text } of allSqlTexts) {
    for (const m of text.replace(/--[^\n]*/g, '').matchAll(alterTypeRe)) {
      const table = m[1].toLowerCase();
      const column = m[2].toLowerCase();
      const type = canonicalSqlType(m[3]);
      if (!type) continue;
      if (!types.has(table)) types.set(table, new Map());
      types.get(table).set(column, type);
    }
  }
  return types;
}

const migrationTypes = buildMigrationTypes();
const driftAllowlistFile = resolve(migrationsDir, '.schema-type-drift-allowlist.txt');
const driftAllowlist = existsSync(driftAllowlistFile)
  ? new Set(
      readFileSync(driftAllowlistFile, 'utf8')
        .split('\n')
        .map((l) => l.split('#')[0].trim())
        .filter(Boolean),
    )
  : new Set();

const typeDrift = [];
const seenDriftKeys = new Set();
for (const [table, cols] of drizzleTypes) {
  const migCols = migrationTypes.get(table);
  if (!migCols) continue; // table declared only in the schema — check-schema-drift's job
  for (const [column, { type: schemaType, builder }] of cols) {
    const sqlType = migCols.get(column);
    if (!sqlType || !schemaType) continue; // one side unknown → never judged
    const schemaFamily = typeFamily(schemaType);
    const sqlFamily = typeFamily(sqlType);
    if (!schemaFamily || !sqlFamily || schemaFamily === sqlFamily) continue;
    const key = `${table}.${column}`;
    seenDriftKeys.add(key);
    if (driftAllowlist.has(key)) continue;
    typeDrift.push({ table, column, schemaType, sqlType, builder });
  }
}
const staleDriftAllowlist = [...driftAllowlist].filter((k) => !seenDriftKeys.has(k));

if (typeDrift.length > 0) {
  console.error(
    `\n❌  Column type drift between the Drizzle schema and the migrations (${typeDrift.length}):\n`,
  );
  for (const d of typeDrift) {
    console.error(
      `   ${d.table}.${d.column}: schema declares ${d.builder}() → ${d.schemaType.toUpperCase()}, the migration declares ${d.sqlType.toUpperCase()}`,
    );
  }
  console.error(
    '\n   These are different behavioural families, so the application receives a\n' +
      '   different shape than the schema says it does (a jsonb column declared text()\n' +
      "   hands back a string, and every `.field` read on it is undefined). Fix the\n" +
      '   Drizzle column, or write a migration that ALTERs the SQL column to match.\n' +
      '   Width/spelling differences (VARCHAR vs TEXT, INTEGER vs BIGINT) are NOT\n' +
      '   reported. If a mismatch is historical and cannot be migrated yet, add\n' +
      '   `table.column` to migrations/.schema-type-drift-allowlist.txt with a note.\n',
  );
  failed = true;
}

if (staleDriftAllowlist.length > 0) {
  console.error(
    `\n⚠️  Stale schema-type-drift allowlist entries (no longer drift, remove them): ${staleDriftAllowlist.sort().join(', ')}`,
  );
  failed = true;
}

// ---------------------------------------------------------------------------
// SIXTH GUARD — SEED DATA that cannot satisfy its own foreign key.
//
// The third guard closes "the constraint cannot be BUILT". This closes the other
// half of the deploy-killing pair: a constraint that builds perfectly and then
// REFUSES the very rows a later migration inserts.
//
// The case that shipped it: `0242_deck_templates_and_decks.sql` declared
// `tenant_id INTEGER NOT NULL DEFAULT 0 REFERENCES tenants(id)`, and
// `0243_seed_builtin_deck_templates.sql` seeded the two built-in board decks at
// the sentinel `tenant_id = 0`. `tenants.id` is a SERIAL, and a serial never
// issues 0 — so Postgres answered `Key (tenant_id)=(0) is not present in table
// "tenants"`, aborted db:migrate mid-file, and blocked EVERY API deploy until
// somebody read the failure and dropped the constraint by hand. Nothing static
// caught it: the FK is type-correct, the column exists, the INSERT is valid SQL,
// and no test executes a migration. The first signal was a red deploy.
//
// The 0-tenant sentinel is not a mistake — a GLOBAL row owned by no tenant is a
// real pattern here (built-in templates, platform-wide defaults) — which is
// exactly why this has to be caught statically: the fix is to NOT put an FK on
// that column, and that decision belongs at the moment the table is written, not
// at the moment the deploy is red.
//
// WHAT IT ASSERTS. A literal 0 (or negative) INSERTed into a column whose foreign
// key points at a SERIAL / IDENTITY key can never resolve, on any database, ever.
//
// CONSERVATIVE BY CONSTRUCTION — this guard blocks deploys, so every ambiguity
// resolves to SILENCE rather than to a finding:
//   - only NUMERIC literals are judged. An expression, a subquery, a parameter or
//     a cast is skipped, because its value is not knowable from the text;
//   - a POSITIVE literal is never judged. Whether row 42 exists is a question
//     about data, and this guard reads only DDL;
//   - the FK must be one this pass actually saw declared, pointing at a column
//     this pass actually saw declared as auto-numbered;
//   - an INSERT is read only when its column list is explicit. `INSERT INTO t
//     VALUES (…)` binds positionally against a shape that may have changed since,
//     and guessing it wrong reports a phantom;
//   - a DROP CONSTRAINT earlier in the run clears the finding. That is what makes
//     0243 pass today: it drops `deck_templates_tenant_id_fkey` in the same
//     transaction, immediately before the seed — which is the documented fix, so
//     a guard that still failed on it would be telling people to undo it;
//   - a `DEFAULT 0` on an FK column is NOT flagged on its own. A default is not a
//     write — nothing fails until an insert omits the column — and flagging it
//     would fail the build on 0242, whose hazard 0243 already removed. The
//     guidance below names it, because that is where the next one comes from.
// ---------------------------------------------------------------------------

/** Split a definition list on TOP-LEVEL commas, so `NUMERIC(10,2)` stays one
 *  clause and a multi-column `ALTER TABLE … ADD COLUMN a …, ADD COLUMN b …` does
 *  not read as one enormous clause — which is exactly how `0075`'s `tenant_id`
 *  came to look like it carried the NEXT column's `DEFAULT 0`. */
function splitSeedClauses(body) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) { out.push(body.slice(start, i)); start = i + 1; }
  }
  out.push(body.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Split `(a, b), (c, d)` into `[[a,b],[c,d]]`, respecting nesting. Literals are
 *  already blanked, so a comma inside a seeded JSON string cannot split a tuple. */
function splitValueTuples(body) {
  const tuples = [];
  let depth = 0;
  let current = null;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '(') {
      if (depth === 0) { current = []; start = i + 1; }
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0 && current) { current.push(body.slice(start, i)); tuples.push(current); current = null; }
    } else if (ch === ',' && depth === 1 && current) {
      current.push(body.slice(start, i));
      start = i + 1;
    }
  }
  return tuples;
}

/** The `REFERENCES t(c)` a column clause carries, or null. */
function readColumnReference(clause) {
  const colM = /^["']?(\w+)["']?\s+([\s\S]+)$/.exec(clause.trim());
  if (!colM) return null;
  const ref = /references\s+["']?(\w+)["']?\s*\(\s*["']?(\w+)["']?\s*\)/i.exec(colM[2]);
  if (!ref) return null;
  return { column: colM[1].toLowerCase(), refTable: ref[1].toLowerCase(), refColumn: ref[2].toLowerCase() };
}

/** Columns declared `SERIAL`/`BIGSERIAL`/`SMALLSERIAL` or `GENERATED … AS
 *  IDENTITY` — the ones whose values start at 1 and can never be 0 or negative. */
function collectAutoNumberedColumns(sqlFiles) {
  const auto = new Set(); // 'table.column'
  for (const { text } of sqlFiles) {
    const sql = blankLiterals(text.replace(/--[^\n]*/g, ''));
    const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?["']?(\w+)["']?\s*\(([\s\S]*?)\n\s*\)\s*;/gi;
    let m;
    while ((m = createRe.exec(sql)) !== null) {
      const table = m[1].toLowerCase();
      for (const clause of splitSeedClauses(m[2])) {
        const colM = /^["']?(\w+)["']?\s+([\s\S]+)$/.exec(clause);
        if (!colM) continue;
        if (/^\s*(?:big|small)?serial\b/i.test(colM[2]) || /generated\s+(?:always|by\s+default)\s+as\s+identity/i.test(colM[2])) {
          auto.add(`${table}.${colM[1].toLowerCase()}`);
        }
      }
    }
  }
  return auto;
}

const autoNumbered = collectAutoNumberedColumns(allSqlTexts);
// The Drizzle schema is the declaration of record for baseline tables no
// migration creates — `tenants.id` among them, which is the whole case.
for (const [table, cols] of drizzleTypes) {
  for (const [column, meta] of cols) {
    if (meta?.builder === 'serial' || meta?.builder === 'bigserial') autoNumbered.add(`${table}.${column}`);
  }
}

/**
 * The three events that decide whether a sentinel write is fatal — a FK
 * appearing, a FK being dropped, and a value being written — in the order
 * `scripts/migrate.mjs` actually applies them, so "the constraint was dropped
 * first" is answered the way Postgres answers it.
 */
const seedEvents = [];
for (const { file, text } of allSqlTexts) {
  const sql = blankLiterals(text.replace(/--[^\n]*/g, ''));
  let m;

  const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?["']?(\w+)["']?\s*\(([\s\S]*?)\n\s*\)\s*;/gi;
  while ((m = createRe.exec(sql)) !== null) {
    const table = m[1].toLowerCase();
    for (const clause of splitSeedClauses(m[2])) {
      const ref = readColumnReference(clause);
      if (ref) seedEvents.push({ at: m.index, file, kind: 'fk-add', table, ...ref });
    }
  }

  const alterRe = /alter\s+table\s+(?:if\s+exists\s+)?["']?(\w+)["']?\s+([\s\S]*?);/gi;
  while ((m = alterRe.exec(sql)) !== null) {
    const table = m[1].toLowerCase();
    const at = m.index;
    for (const clause of splitSeedClauses(m[2])) {
      const addCol = /^add\s+column\s+(?:if\s+not\s+exists\s+)?([\s\S]+)$/i.exec(clause);
      if (addCol) {
        const ref = readColumnReference(addCol[1]);
        if (ref) seedEvents.push({ at, file, kind: 'fk-add', table, ...ref });
        continue;
      }
      const addFk = /^(?:add\s+constraint\s+["']?\w+["']?\s+)?(?:add\s+)?foreign\s+key\s*\(\s*["']?(\w+)["']?\s*\)\s*references\s+["']?(\w+)["']?\s*\(\s*["']?(\w+)["']?\s*\)/i.exec(clause);
      if (addFk) {
        seedEvents.push({ at, file, kind: 'fk-add', table, column: addFk[1].toLowerCase(), refTable: addFk[2].toLowerCase(), refColumn: addFk[3].toLowerCase() });
        continue;
      }
      // A dropped constraint, split against the table the ALTER already named
      // rather than by guessing where the name divides: `deck_templates_tenant_
      // id_fkey` splits as (deck_templates, tenant_id), and a greedy regex reads
      // it as (deck_templates_tenant, id) — a column that does not exist, so the
      // drop silently fails to clear anything.
      const drop = /^drop\s+constraint\s+(?:if\s+exists\s+)?["']?(\w+)["']?/i.exec(clause);
      if (drop) {
        const name = drop[1].toLowerCase();
        if (name.startsWith(`${table}_`) && name.endsWith('_fkey')) {
          seedEvents.push({ at, file, kind: 'fk-drop', table, column: name.slice(table.length + 1, -'_fkey'.length) });
        }
      }
    }
  }

  // `INSERT INTO t (a, b) VALUES (…), (…)` — explicit column list only.
  const insertRe = /insert\s+into\s+["']?(\w+)["']?\s*\(([^)]*)\)\s*values\s*([\s\S]*?);/gi;
  while ((m = insertRe.exec(sql)) !== null) {
    const table = m[1].toLowerCase();
    const cols = m[2].split(',').map((c) => c.trim().replace(/["']/g, '').toLowerCase());
    for (const tuple of splitValueTuples(m[3])) {
      tuple.forEach((raw, i) => {
        const column = cols[i];
        if (!column || !/^-?\d+$/.test(raw.trim())) return;
        seedEvents.push({ at: m.index, file, kind: 'write', table, column, value: Number(raw.trim()) });
      });
    }
  }
}

/** Within one statement a constraint EXISTS before the row that has to satisfy
 *  it, so equal offsets order adds first and writes last. Without this a column
 *  declared and seeded in the same breath sorts arbitrarily. */
const SEED_EVENT_RANK = { 'fk-add': 0, 'fk-drop': 1, write: 2 };
seedEvents.sort((a, b) =>
  (a.file < b.file ? -1 : a.file > b.file ? 1 : a.at - b.at || SEED_EVENT_RANK[a.kind] - SEED_EVENT_RANK[b.kind]));

/** FKs live at this point in the run: 'table.column' -> { refTable, refColumn }. */
const liveFks = new Map();
const sentinelFkWrites = new Map(); // deduped: many rows repeat one mistake
for (const e of seedEvents) {
  const key = `${e.table}.${e.column}`;
  if (e.kind === 'fk-add') { liveFks.set(key, { refTable: e.refTable, refColumn: e.refColumn }); continue; }
  if (e.kind === 'fk-drop') { liveFks.delete(key); continue; }
  if (e.value > 0) continue;                        // a real id — a data question, not ours
  const fk = liveFks.get(key);
  if (!fk || !autoNumbered.has(`${fk.refTable}.${fk.refColumn}`)) continue;
  sentinelFkWrites.set(`${e.file}:${key}:${e.value}`, { ...e, ...fk });
}

if (sentinelFkWrites.size > 0) {
  console.error(
    '\n❌  Seed value can never satisfy its foreign key — Postgres will REJECT the row and abort db:migrate on deploy:\n',
  );
  for (const w of sentinelFkWrites.values()) {
    console.error(
      `   ${w.file}: INSERT ${w.table}.${w.column} = ${w.value} → ${w.refTable}.${w.refColumn}, ` +
        'which is auto-numbered and starts at 1',
    );
  }
  console.error(
    '\n   A 0 / negative sentinel means "owned by no tenant" (a built-in, a platform\n' +
      '   default) and is a legitimate pattern — but it is incompatible WITH a foreign\n' +
      '   key, not merely awkward beside one. Either drop the constraint in the same\n' +
      '   migration (ALTER TABLE … DROP CONSTRAINT <table>_<column>_fkey) and enforce\n' +
      '   the scoping in the query layer, or seed the row against a real key instead.\n' +
      '   The same hazard sits latent in `DEFAULT 0 … REFERENCES` on a column: nothing\n' +
      '   fails until the first insert omits it, and then every deploy does.\n',
  );
  failed = true;
}

if (failed) process.exit(1);

const allowed = [...collidingPrefixes].filter((p) => allowlist.has(p));
console.log(
  `✅  Migration sequence OK — ${files.length} files, no new duplicate prefixes` +
    (allowed.length ? ` (${allowed.length} grandfathered: ${allowed.sort().join(', ')})` : '') +
    `; no stray .sql outside ${SANCTIONED_DIRS.join(' / ')}.`,
);
