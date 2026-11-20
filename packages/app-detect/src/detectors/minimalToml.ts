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

import { escapeRegExp } from '../pathGlob';

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

/** A basic string's escapes (`\"`, `\\`, `\n`, `\t`); any other escaped character as itself. */
const BASIC_ESCAPES: Readonly<Record<string, string>> = { n: '\n', t: '\t', r: '\r' };
const unescapeBasic = (text: string): string => text.replace(/\\(.)/g, (_, ch: string) => BASIC_ESCAPES[ch] ?? ch);

/** A quoted value's string: `"a \"b\"" # c` → `a "b"`, `'lit'` → `lit`; anything else (or unterminated) → undefined. */
export function tomlString(value: string | undefined): string | undefined {
  const match = value === undefined ? null : /^\s*(?:"((?:[^"\\\n]|\\.)*)"|'([^'\n]*)')/.exec(value);
  if (!match) return undefined;
  return match[1] !== undefined ? unescapeBasic(match[1]) : match[2];
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
 * The strings of the array starting at `from`: basic strings honour `\` escapes, literal
 * strings do not; `#` outside a string starts a comment; a string still open at the end
 * of its line is unterminated and dropped.
 */
function readStringArray(text: string, from: number): string[] {
  const out: string[] = [];
  let quote: string | null = null;
  let current = '';
  for (let i = from; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\n' || ch === '\r') { quote = null; current = ''; }
      // A `\` escapes the next character, never the line break: the string still ends unterminated there.
      else if (ch === '\\' && quote === '"' && i + 1 < text.length && text[i + 1] !== '\n' && text[i + 1] !== '\r') current += unescapeBasic(text.slice(i, ++i + 1));
      else if (ch === quote) { out.push(current); current = ''; quote = null; }
      else current += ch;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#') { const eol = text.indexOf('\n', i); i = eol === -1 ? text.length : eol; }
    else if (ch === ']') break;
  }
  return out;
}

/**
 * The quoted strings of every `key = [ … ]` array — in `table` only, when given — read
 * across lines. Lines split on `\n` alone, so each offset is exact (a CRLF line keeps its `\r`).
 */
export function tomlStringArrays(text: string, key: string, table?: string): string[] {
  const lines = text.split('\n');
  const tables = tableAtLines(lines);
  const start = new RegExp(`^\\s*["']?${escapeRegExp(key)}["']?\\s*=\\s*\\[`);
  const out: string[] = [];
  let offset = 0;
  lines.forEach((line, index) => {
    const match = start.exec(line);
    if (match && (table === undefined || tables[index] === table)) out.push(...readStringArray(text, offset + match[0].length));
    offset += line.length + 1;
  });
  return out;
}
