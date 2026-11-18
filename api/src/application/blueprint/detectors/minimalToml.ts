/**
 * W2: Minimal TOML reading — the ONE reader the language detectors share for the
 * manifests they parse (pyproject.toml, Pipfile, Cargo.toml). It reads what those
 * manifests use and no more:
 *
 * - tables (`[project]`, `[target.'cfg(unix)'.dependencies]`, the first `[[bin]]`) as
 *   `key → raw value`, keys unquoted and kept dotted (`axum.workspace`);
 * - string arrays (`members = [ "api", # comment\n "crates/*" ]`), multi-line, with `#`
 *   inside a quoted string kept and outside one a comment;
 * - a quoted value's string.
 *
 * Not a TOML parser: inline tables stay raw text, multi-line strings are not read.
 */

/** Drop a `#` comment that is not inside a quoted string. */
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#') return line.slice(0, i);
  }
  return line;
}

/** `"a.b".c` / `a . 'b'` → `a.b.c` / `a.b`: each part unquoted, joined by dots. */
function unquoteKey(key: string): string {
  return (key.match(/"[^"]*"|'[^']*'|[^.\s]+/g) ?? []).map((part) => part.replace(/^["']|["']$/g, '')).join('.');
}

/** The header `[table]` / `[[table]]` names, or null for any other line. */
function headerOf(line: string): string | null {
  const header = /^\[\[?\s*(.+?)\s*\]\]?$/.exec(line);
  return header ? unquoteKey(header[1]!) : null;
}

export type TomlTables = Map<string, Map<string, string>>;

/** Every table of `text` (`''` = the top level) → its `key = value` entries (raw values; the first wins). */
export function tomlTables(text: string): TomlTables {
  const tables: TomlTables = new Map([['', new Map()]]);
  let current = tables.get('')!;
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw).trim();
    const header = headerOf(line);
    if (header !== null) {
      current = tables.get(header) ?? new Map();
      tables.set(header, current);
      continue;
    }
    const entry = /^((?:"[^"]*"|'[^']*'|[A-Za-z0-9_.\s-])+?)\s*=\s*(.*)$/.exec(line);
    if (!entry) continue;
    const key = unquoteKey(entry[1]!);
    if (!current.has(key)) current.set(key, entry[2]!);
  }
  return tables;
}

/** One table's entries (empty when absent). */
export function tomlTable(text: string, table: string): Map<string, string> {
  return tomlTables(text).get(table) ?? new Map();
}

/** A quoted value's string: `"x" # c` → `x`; anything else → undefined. */
export function tomlString(value: string | undefined): string | undefined {
  return value === undefined ? undefined : /^\s*(?:"([^"]*)"|'([^']*)')/.exec(value)?.slice(1).find((s) => s !== undefined);
}

/** The table each line of `text` sits in. */
function tableAtLines(lines: readonly string[]): string[] {
  let current = '';
  return lines.map((raw) => {
    const header = headerOf(stripComment(raw).trim());
    if (header !== null) current = header;
    return current;
  });
}

/**
 * The quoted strings of every `key = [ … ]` array — in `table` only, when given — read
 * across lines; `#` outside a string starts a comment.
 */
export function tomlStringArrays(text: string, key: string, table?: string): string[] {
  const out: string[] = [];
  const lines = text.split(/\r?\n/);
  const tables = tableAtLines(lines);
  const offsets: number[] = [];
  lines.reduce((offset, line) => (offsets.push(offset), offset + line.length + 1), 0);
  const start = new RegExp(`^\\s*["']?${key.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}["']?\\s*=\\s*\\[`);
  lines.forEach((line, index) => {
    const match = start.exec(line);
    if (!match || (table !== undefined && tables[index] !== table)) return;
    let quote: string | null = null;
    let current = '';
    for (let i = offsets[index]! + match[0].length; i < text.length; i++) {
      const ch = text[i]!;
      if (quote) {
        if (ch === quote) { out.push(current); current = ''; quote = null; } else current += ch;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '#') { const eol = text.indexOf('\n', i); i = eol === -1 ? text.length : eol; }
      else if (ch === ']') break;
    }
  });
  return out;
}
