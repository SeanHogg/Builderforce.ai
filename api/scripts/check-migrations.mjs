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
for (const fk of migFks) {
  const target = resolveTargetType(fk.refTable, fk.refColumn);
  // Still unresolved → the referenced table is declared somewhere neither pass can
  // see. Silence beats a false failure that blocks every deploy.
  if (!target) continue;
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
//   - a table neither the migrations nor the schema declare is skipped;
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

/** Split on top-level `;`, leaving `$tag$ … $tag$` bodies intact. */
function splitStatements(sql) {
  const out = [];
  let current = '';
  let i = 0;
  let dollarTag = null;
  while (i < sql.length) {
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) { current += dollarTag; i += dollarTag.length; dollarTag = null; continue; }
      current += sql[i++];
      continue;
    }
    if (sql[i] === '$') {
      const m = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i));
      if (m) { dollarTag = m[0]; current += dollarTag; i += dollarTag.length; continue; }
    }
    if (sql[i] === ';') { out.push(current); current = ''; i++; continue; }
    current += sql[i++];
  }
  out.push(current);
  return out.filter((s) => s.trim());
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
  const sql = text.replace(/--[^\n]*/g, '');
  for (const statement of splitStatements(sql)) {
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
      if (!table) continue;
      const cols = knownColumns.get(table);
      // An empty column set means the parse failed, not that the table is empty.
      if (!cols || cols.size === 0) continue;
      if (cols.has(column)) continue;
      const line = statement.slice(0, m.index).split('\n').length
        + sql.slice(0, sql.indexOf(statement)).split('\n').length - 1;
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

if (failed) process.exit(1);

const allowed = [...collidingPrefixes].filter((p) => allowlist.has(p));
console.log(
  `✅  Migration sequence OK — ${files.length} files, no new duplicate prefixes` +
    (allowed.length ? ` (${allowed.length} grandfathered: ${allowed.sort().join(', ')})` : '') +
    `; no stray .sql outside ${SANCTIONED_DIRS.join(' / ')}.`,
);
