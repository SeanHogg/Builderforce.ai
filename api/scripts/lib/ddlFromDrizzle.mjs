/**
 * Emit `CREATE TABLE` SQL from a Drizzle module, so the schema and its migration
 * cannot drift apart.
 *
 * PRD 20 §5 step 2 adds 248 tables — the 25-table kernel plus the 222 domain
 * targets the coverage map still lists as unwritten. `check-schema-drift.mjs`
 * requires a `CREATE TABLE` for every one of them, and hand-typing that DDL twice
 * (once as Drizzle, once as SQL) is exactly the two-sources-of-truth problem this
 * whole document is about, one layer down. So the SQL is DERIVED from the Drizzle
 * declaration and the migration is generated, not transcribed.
 *
 * Deliberately lexical, like `drizzleSchema.mjs` beside it: these run in CI before
 * anything is compiled, so importing the app is not an option. The parser handles
 * the subset of Drizzle this repo actually writes — a builder call, a chain of
 * modifiers, and a constraints callback returning an array of index builders. It
 * throws on anything it does not understand rather than emitting silently-wrong
 * DDL, which is the only safe failure mode for a generator whose output is a
 * migration.
 */
import { readFileSync } from 'node:fs';

/** Drizzle column builder → the Postgres type it emits. */
const TYPES = {
  serial: () => 'SERIAL',
  bigserial: () => 'BIGSERIAL',
  integer: () => 'INTEGER',
  bigint: () => 'BIGINT',
  smallint: () => 'SMALLINT',
  boolean: () => 'BOOLEAN',
  text: () => 'TEXT',
  uuid: () => 'UUID',
  date: () => 'DATE',
  time: () => 'TIME',
  real: () => 'REAL',
  doublePrecision: () => 'DOUBLE PRECISION',
  jsonb: () => 'JSONB',
  json: () => 'JSON',
  timestamp: () => 'TIMESTAMP',
  varchar: (opts) => `VARCHAR(${readNumber(opts, 'length') ?? 255})`,
  char: (opts) => `CHAR(${readNumber(opts, 'length') ?? 1})`,
  numeric: (opts) => {
    const p = readNumber(opts, 'precision');
    const s = readNumber(opts, 'scale');
    return p == null ? 'NUMERIC' : `NUMERIC(${p}, ${s ?? 0})`;
  },
};

function readNumber(opts, key) {
  if (!opts) return null;
  const m = opts.match(new RegExp(`${key}\\s*:\\s*(\\d+)`));
  return m ? Number(m[1]) : null;
}

/** camelCase → snake_case, for the table variable → SQL name fallback. */
const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

/**
 * Split a balanced region starting at `open` (the index OF the opening bracket).
 * Returns [inner, indexAfterClosingBracket]. String literals are skipped so a
 * brace inside `default('{}')` does not unbalance the scan.
 */
function balanced(text, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const close = pairs[text[open]];
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (c === text[open]) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return [text.slice(open + 1, i), i + 1];
    }
  }
  throw new Error(`Unbalanced ${text[open]} at ${open}`);
}

/** Split on top-level commas — nested calls, objects and arrays stay intact. */
function splitTop(src) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      out.push(src.slice(start, i));
      start = i + 1;
    }
  }
  out.push(src.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Strip `//` and `/* *​/` comments without touching string literals. */
function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      let j = i + 1;
      while (j < src.length && src[j] !== quote) {
        if (src[j] === '\\') j++;
        j++;
      }
      out += src.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    out += c;
  }
  return out;
}

/** One column declaration → its SQL fragment. */
function column(decl, tableName) {
  const m = decl.match(/^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)\s*\(/);
  if (!m) throw new Error(`${tableName}: cannot parse column \`${decl.slice(0, 60)}\``);
  const builder = m[2];
  const argsOpen = decl.indexOf('(', m[0].length - 1);
  const [args, after] = balanced(decl, argsOpen);
  const parts = splitTop(args);
  const nameLit = parts[0]?.match(/^'([^']+)'$/);
  if (!nameLit) throw new Error(`${tableName}: column \`${m[1]}\` has no SQL name literal`);
  const name = nameLit[1];

  const emit = TYPES[builder];
  // A named pgEnum builder (`taskStatusEnum('status')`) renders as its own type;
  // the enum's SQL name is not recoverable lexically, so refuse rather than guess.
  if (!emit) throw new Error(`${tableName}.${name}: unsupported builder \`${builder}\` — add it to ddlFromDrizzle or write this table's DDL by hand`);
  let sql = `${name} ${emit(parts[1])}`;

  const chain = decl.slice(after);
  if (/\.primaryKey\(\)/.test(chain)) sql += ' PRIMARY KEY';
  if (/\.notNull\(\)/.test(chain)) sql += ' NOT NULL';
  if (/\.unique\(\)/.test(chain)) sql += ' UNIQUE';
  if (/\.defaultNow\(\)/.test(chain)) sql += ' DEFAULT NOW()';
  if (/\.defaultRandom\(\)/.test(chain)) sql += ' DEFAULT gen_random_uuid()';
  const def = chain.match(/\.default\(([^)]*)\)/);
  if (def) {
    const raw = def[1].trim();
    sql += ` DEFAULT ${raw.startsWith("'") ? raw : raw}`;
  }
  const ref = chain.match(/\.references\(\s*\(\)\s*=>\s*([\w$]+)\.(\w+)\s*(?:,\s*\{([^}]*)\})?\s*\)/);
  const fk = ref
    ? { table: ref[1], col: ref[2], onDelete: (ref[3] ?? '').match(/onDelete\s*:\s*'([^']+)'/)?.[1] ?? null }
    : null;

  return { prop: m[1], name, sql, fk };
}

/** The constraints callback → CREATE INDEX statements. */
function indexes(body, table, columns) {
  const sqlNameByProperty = new Map(columns.map((c) => [c.prop, c.name]));
  const out = [];
  const re = /\b(uniqueIndex|index)\(\s*'([^']+)'\s*\)\s*\.on\(([^)]*)\)/g;
  for (const m of body.matchAll(re)) {
    const cols = m[3]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const c = s.match(/^t\.([\w$]+)$/);
        if (!c) throw new Error(`${table}: index ${m[2]} has an expression column \`${s}\` — write this index by hand`);
        const sqlName = sqlNameByProperty.get(c[1]);
        if (!sqlName) throw new Error(`${table}: index ${m[2]} refers to unknown column property \`${c[1]}\``);
        return sqlName;
      });
    out.push({ name: m[2], unique: m[1] === 'uniqueIndex', cols });
  }
  return out;
}

/**
 * Parse every `pgTable()` in a Drizzle module.
 *
 * @returns Array<{ table, varName, columns, indexes, error }>
 */
export function parseModule(path) {
  const raw = readFileSync(path, 'utf8');
  const src = stripComments(raw);
  const out = [];
  const declRe = /export\s+const\s+([\w$]+)\s*=\s*pgTable\(/g;
  for (const m of src.matchAll(declRe)) {
    const varName = m[1];
    const open = src.indexOf('(', m.index + m[0].length - 1);
    const [args] = balanced(src, open);
    const parts = splitTop(args);
    const nameLit = parts[0].match(/^'([^']+)'$/);
    const table = nameLit ? nameLit[1] : snake(varName);
    const objOpen = parts[1].indexOf('{');
    const [colsSrc] = balanced(parts[1], objOpen);
    // A table this parser cannot read is recorded, not thrown on. Most modules
    // already contain pre-existing tables using builders it does not model
    // (a named `pgEnum`, an expression index); those have had their DDL for
    // years and are never regenerated. The generator refuses only when a table
    // it is actually about to emit is the unreadable one — which is the case
    // where guessing would put wrong SQL in a migration.
    let columns; let idx; let error = null;
    try {
      columns = splitTop(colsSrc).map((d) => column(d, table));
      idx = parts[2] ? indexes(parts[2], table, columns) : [];
    } catch (e) {
      columns = []; idx = []; error = e instanceof Error ? e.message : String(e);
    }
    out.push({ table, varName, columns, indexes: idx, error });
  }
  return out;
}

/**
 * Render one parsed table as `CREATE TABLE IF NOT EXISTS` plus its indexes.
 *
 * `IF NOT EXISTS` throughout: `migrate.mjs` replays the whole directory against
 * environments at different points in the sequence, and a consolidation migration
 * that cannot be re-run is a consolidation migration that gets run by hand.
 *
 * @param {object} t                parsed table
 * @param {(v: string) => string|null} resolveRef  variable name → SQL table name,
 *        or null to omit the FK (the target lives on another migration track).
 */
export function renderTable(t, resolveRef) {
  const lines = t.columns.map((c) => {
    let s = `  ${c.sql}`;
    if (c.fk) {
      const target = resolveRef(c.fk.table);
      if (target) {
        s += ` REFERENCES ${target}(${snake(c.fk.col)})`;
        if (c.fk.onDelete) s += ` ON DELETE ${c.fk.onDelete.toUpperCase().replace('-', ' ')}`;
      }
    }
    return s;
  });
  const sql = [`CREATE TABLE IF NOT EXISTS ${t.table} (\n${lines.join(',\n')}\n);`];
  for (const i of t.indexes) {
    sql.push(
      `CREATE ${i.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${i.name} ON ${t.table} (${i.cols.join(', ')});`,
    );
  }
  return sql.join('\n');
}
