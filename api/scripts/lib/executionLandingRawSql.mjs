/**
 * The RAW-SQL half of the execution-landing scan (`executionLandingScan.mjs`): `UPDATE [ONLY] [schema.]<table> [AS alias] SET ...`
 * and `INSERT INTO <table> ... ON CONFLICT ... DO UPDATE SET ...` (plain strings and `sql``` templates) that assign the `status`
 * column, and SET lists whose assignment targets are interpolated holes that are not provably another column.
 */

// The status column as a SQL assignment target: plain, quoted, or interpolated (`${executions.status}`, `${sql.identifier('status')}`).
const SQL_STATUS = '(?:\\bstatus"?|"status"|\\$\\{[^}]*\\bstatus\\b[^}]*\\})';

/**
 * The raw-SQL shapes for the table names in play: `UPDATE [ONLY] [schema.]<table> [AS alias] SET ... status =` (also
 * `SET (status, ...) =`) and `INSERT INTO <table> ... ON CONFLICT ... DO UPDATE SET ... status =`.
 */
function rawSqlTable(names) {
  return `(?:"?\\w+"?\\.)?(?:"?(?:${names})"?|\\$\\{\\s*(?:[\\w$]+\\.)*(?:${names})\\s*\\})`;
}

function rawSqlPatterns(names) {
  const table = rawSqlTable(names);
  const assign = `(?:[^;]*${SQL_STATUS}\\s*=|\\s*\\((?=[^;]*?${SQL_STATUS}[^;]*?\\)\\s*=))`;
  return [
    new RegExp(`UPDATE\\s+(?:ONLY\\s+)?${table}(?:\\s+(?:AS\\s+)?"?\\w+"?)?\\s+SET${assign}`, 'gi'),
    new RegExp(`INSERT\\s+INTO\\s+${table}[^;]*?ON\\s+CONFLICT[^;]*?DO\\s+UPDATE\\s+SET${assign}`, 'gi'),
  ];
}

/** The same two statements up to and including `SET`: where the assignment list begins. */
function rawSetHeads(names) {
  const table = rawSqlTable(names);
  return [
    new RegExp(`UPDATE\\s+(?:ONLY\\s+)?${table}(?:\\s+(?:AS\\s+)?"?\\w+"?)?\\s+SET\\b`, 'gi'),
    new RegExp(`INSERT\\s+INTO\\s+${table}[^;]*?ON\\s+CONFLICT[^;]*?DO\\s+UPDATE\\s+SET\\b`, 'gi'),
  ];
}

/** The items of a SQL assignment list: split at the commas outside parentheses, `${}` holes and SQL string literals. */
function splitAssignments(list) {
  const items = [];
  let depth = 0;
  let quote = '';
  let from = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === "'") quote = c;
    else if (c === '(' || c === '{') depth += 1;
    else if (c === ')' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) { items.push(list.slice(from, i)); from = i + 1; }
  }
  items.push(list.slice(from));
  return items;
}

/**
 * Is one `${...}` hole, standing where a column name goes, PROVABLY a column other than `status`? Only `${executions.<col>}` (any
 * name the table goes by) and `${sql.identifier('<col>')}` / `${sql.raw('<col>')}` with a string-literal column qualify; `status`
 * itself is the status column (the status pattern flags it), and everything else (`${sql.identifier(col)}`, `${sql.raw(x)}`,
 * `${setClause}`) could be either, so it is opaque.
 */
function provablyOtherColumn(hole, names) {
  const member = new RegExp(`^\\$\\{\\s*(?:[\\w$]+\\.)*(?:${names})\\.([\\w$]+)\\s*\\}$`).exec(hole);
  if (member) return member[1] !== 'status';
  const literal = /^\$\{\s*sql\.(?:identifier|raw)\(\s*(['"`])([^'"`\\$]*)\1\s*\)\s*\}$/.exec(hole);
  return literal ? literal[2] !== 'status' : false;
}

/** Index just past the `${...}` hole whose `{` is at `open` (nested braces, strings and templates inside it included), or the end of `t`. */
function pastHole(t, open) {
  let depth = 0;
  for (let j = open; j < t.length; j++) {
    const c = t[j];
    if (c === '`') { j = pastTemplate(t, j) - 1; continue; }
    if (c === "'" || c === '"') { while (j + 1 < t.length && t[j + 1] !== c) j += t[j + 1] === '\\' ? 2 : 1; j += 1; continue; }
    if (c === '{') depth += 1;
    else if (c === '}' && --depth === 0) return j + 1;
  }
  return t.length;
}

/** Index just past the template literal opening at `i` (its own holes skipped), or the end of `t`. */
function pastTemplate(t, i) {
  for (let j = i + 1; j < t.length; j++) {
    if (t[j] === '\\') j += 1;
    else if (t[j] === '$' && t[j + 1] === '{') j = pastHole(t, j + 1) - 1;
    else if (t[j] === '`') return j + 1;
  }
  return t.length;
}

/**
 * Where a SET list ends: the first `WHERE` / `FROM` / `RETURNING` / `;` / closing backtick OUTSIDE a `${...}` hole. A `WHERE` inside
 * a hole (`${cond ? sql`WHERE x` : sql``}`) belongs to that fragment, not to the statement, and must not cut the list short.
 */
function setListEnd(rest) {
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '$' && rest[i + 1] === '{') { i = pastHole(rest, i + 1) - 1; continue; }
    if (rest[i] === '`' || rest[i] === ';') return i;
    if (!/[\w$]/.test(rest[i - 1] ?? '') && /^(?:WHERE|FROM|RETURNING)\b/i.test(rest.slice(i, i + 10))) return i;
  }
  return rest.length;
}

/**
 * The raw-SQL assignment targets that are interpolated and not provably another column: `SET ${sql.identifier(col)} = ...`,
 * `SET ${sql.raw(x)} = ...`, `SET ${setClause}`, `SET (${a}, b) = ...`. They can be the status column, so they are writes to it as
 * far as this scan can tell. Returns the offending list items.
 */
function opaqueSetTargets(text, names) {
  const found = [];
  for (const head of rawSetHeads(names)) {
    for (const m of text.matchAll(head)) {
      const rest = text.slice(m.index + m[0].length);
      const list = rest.slice(0, setListEnd(rest));
      for (const item of splitAssignments(list)) {
        const eq = item.indexOf('=');
        const target = (eq < 0 ? item : item.slice(0, eq)).trim();
        if (!target.includes('${')) continue;
        const close = target.lastIndexOf(')');
        const holes = target.startsWith('(') ? splitAssignments(target.slice(1, close < 0 ? undefined : close)) : [target];
        if (holes.some((hole) => hole.includes('${') && !provablyOtherColumn(hole.trim(), names))) {
          found.push({ kind: 'raw SQL: opaque interpolated assignment target', snippet: `${m[0]} ${item}`.replace(/\s+/g, ' ').trim().slice(0, 120) });
        }
      }
    }
  }
  return found;
}

/** Every raw-SQL write to `executions.status` in `text` (comments already blanked), for the table `names` (a regex alternation). */
export function scanRawSql(text, names) {
  const found = [];
  for (const re of rawSqlPatterns(names)) for (const raw of text.matchAll(re)) found.push({ kind: 'raw SQL: executions status assignment', snippet: raw[0].replace(/\s+/g, ' ').slice(0, 120) });
  found.push(...opaqueSetTargets(text, names));
  return found;
}
