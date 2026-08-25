/**
 * Split a SQL script into individual statements on top-level semicolons.
 *
 * Quote-, comment- and dollar-quote-aware, so a semicolon inside a string, a
 * comment or a $$ ... $$ body does not split the statement around it.
 *
 * Shared by migrate.mjs and bootstrap-db.mjs: the Neon HTTP transport is
 * non-interactive and takes one statement per call, so both have to do this.
 */
export function splitSqlStatements(input) {
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
