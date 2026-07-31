/**
 * The ONE Drizzle-schema parser the migration guards share.
 *
 * `check-schema-drift.mjs` needs table → column NAMES; `check-migrations.mjs` needs
 * table → column TYPES (to verify a foreign key's column type matches the key it
 * points at). Both were about to parse `pgTable('x', { … })` with their own regex,
 * which is exactly the duplication that lets two guards disagree about what the
 * schema says. One parser, two consumers.
 *
 * Deliberately lexical — no TypeScript compilation, no imports of the app — because
 * these guards run in CI before anything is built.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/** Every .ts file under `dir` — pgTable() declarations are NOT confined to schema.ts:
 *  finopsTables.ts, devexSurveys.ts and recommendationsEngine.ts each declare their
 *  own domain tables. Scanning only schema.ts made those tables invisible. */
export function collectSourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/**
 * Drizzle column builder → the Postgres type it emits, canonicalised the same way
 * `check-migrations.mjs` canonicalises SQL types so the two are directly comparable.
 * Only the builders that can carry a foreign key need to be exact; anything unknown
 * maps to `null`, which every consumer treats as "cannot judge" rather than a
 * mismatch — a guard that guesses wrong blocks deploys.
 */
const BUILDER_TYPES = {
  integer: 'integer',
  serial: 'integer',
  bigint: 'bigint',
  bigserial: 'bigint',
  smallint: 'smallint',
  varchar: 'varchar',
  char: 'varchar',
  text: 'text',
  uuid: 'uuid',
  boolean: 'boolean',
  real: 'real',
  doublePrecision: 'double precision',
  numeric: 'numeric',
  decimal: 'numeric',
  timestamp: 'timestamp',
  date: 'date',
  time: 'time',
  json: 'json',
  jsonb: 'jsonb',
};

/**
 * Parse every `pgTable('name', { … })` in `srcDir`.
 *
 * @returns Map<tableName, Map<columnName, { type: string|null, builder: string }>>
 *          — insertion-ordered, one entry per SQL column.
 */
export function parseDrizzleTables(srcDir) {
  const schemaText = collectSourceFiles(srcDir)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');

  // The column object closes with a `}` at column 0 (start of line). A table with no
  // second argument closes the pgTable() call immediately: `\n})`. A table that passes
  // a constraints/indexes callback closes the object with a comma first: `\n}, (t) =>
  // [ … ])`. Match either form so the non-greedy capture stops at THIS table's object
  // and does not bleed into the next declaration. (Nested inline config objects are
  // always indented, so their closing braces never sit at column 0.)
  const tableRe = /pgTable\(\s*'([^']+)'\s*,\s*\{([\s\S]*?)\n\}\s*[,)]/g;
  // The SQL column name is always the first string literal inside the builder call:
  // `varchar('foo_bar', …)`. The trailing `\w*Enum` alternative matches NAMED pgEnum
  // builders (`taskStatusEnum('status')`), which were otherwise invisible.
  const colRe = /(integer|varchar|text|boolean|timestamp|serial|bigserial|bigint|smallint|uuid|json|jsonb|real|doublePrecision|numeric|decimal|date|time|char|customType|pgEnum|\w*Enum)\s*\(\s*'([^']+)'/g;

  const tables = new Map();
  for (const match of schemaText.matchAll(tableRe)) {
    const table = match[1];
    const cols = tables.get(table) ?? new Map();
    for (const col of match[2].matchAll(colRe)) {
      const builder = col[1];
      const name = col[2];
      if (!cols.has(name)) cols.set(name, { type: BUILDER_TYPES[builder] ?? null, builder });
    }
    tables.set(table, cols);
  }
  return tables;
}
