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

/**
 * Parse every foreign key `.references(() => otherTable.id, { onDelete: … })`.
 *
 * Drizzle names the TARGET by its JavaScript binding (`creationSessions`), not by
 * its SQL name (`creation_sessions`), so this also builds the binding → SQL-name
 * map from the `export const X = pgTable('y'` declarations and resolves through it.
 * A reference whose target is not a parsed table resolves to `null`, which every
 * consumer must treat as "cannot judge" — a guard that guesses a parent wrong is
 * worse than one that admits it does not know.
 *
 * `notNull` and `onDelete` are captured because together they are what makes a
 * child row unable to outlive or escape its parent: a NULLable parent id means the
 * row can exist orphaned, and anything other than CASCADE means it can be left
 * behind when the parent goes.
 *
 * @returns Map<tableName, Array<{column, target, notNull, onDelete}>>
 */
export function parseDrizzleReferences(srcDir) {
  const text = collectSourceFiles(srcDir)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');

  const bindingToTable = new Map();
  for (const m of text.matchAll(/export const (\w+)\s*=\s*pgTable\(\s*'([^']+)'/g)) {
    bindingToTable.set(m[1], m[2]);
  }

  const tableRe = /pgTable\(\s*'([^']+)'\s*,\s*\{([\s\S]*?)\n\}\s*[,)]/g;
  const refs = new Map();
  for (const match of text.matchAll(tableRe)) {
    const table = match[1];
    const found = refs.get(table) ?? [];
    // One column per line in this schema, so the line IS the unit: take the column
    // name, whether `.notNull()` appears on it, and the onDelete of its reference.
    for (const line of match[2].split('\n')) {
      const ref = line.match(/references\(\(\)\s*=>\s*(\w+)\.\w+/);
      if (!ref) continue;
      const col = line.match(/^\s*\w+:\s*\w+\(\s*'([^']+)'/);
      if (!col) continue;
      found.push({
        column: col[1],
        target: bindingToTable.get(ref[1]) ?? null,
        notNull: /\.notNull\(\)/.test(line),
        onDelete: line.match(/onDelete:\s*'([a-z ]+)'/)?.[1] ?? null,
      });
    }
    refs.set(table, found);
  }
  return refs;
}
