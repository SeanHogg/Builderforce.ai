/**
 * Symbol extraction — "what does this file DEFINE, and on which line" — for every
 * surface that needs a code map without reading whole files.
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────────────
 * An agent that wants one function out of a 5,000-line service file had exactly two
 * moves: `search_code` for the name (a list of every line that MENTIONS it — calls,
 * imports and comments included) or `read_file` in 2,000-line windows. Measured on a
 * VS Code Brain run: one 153 KB service read twelve times and searched six more, 31%
 * of the run's calls revisiting ground it had already covered. A definition index —
 * name → file:line — answers "where is X defined" in one call, and a file OUTLINE
 * turns "page through the file" into "jump to line N".
 *
 * Three copies of this idea had grown apart: the creation canvas's `exportedSymbols`
 * (JS/TS exports only), the on-prem semantic searcher's `ssExtractSymbols` (names only,
 * no lines), and nothing at all in the editor. This is the one extractor all of them
 * read, so "what counts as a symbol" has one answer.
 *
 * Heuristic, line-anchored regexes — deliberately NOT a parser: it must run in the
 * Worker, the browser and Node with zero dependencies, over any language, and a
 * missed or spurious symbol costs one extra read, never a wrong edit. Pure: no I/O.
 */

/** What a definition is. `heading` is a Markdown section, `table` a SQL object. */
export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "const"
  | "struct"
  | "trait"
  | "module"
  | "table"
  | "heading";

/** The kinds a caller may filter on — every {@link SymbolKind}, as a list for schemas. */
export const SYMBOL_KINDS: readonly SymbolKind[] = [
  "function", "method", "class", "interface", "type", "enum", "const",
  "struct", "trait", "module", "table", "heading",
];

/** One definition found in a file. `line` is 1-based. */
export interface CodeSymbol {
  name: string;
  kind: SymbolKind;
  line: number;
  /** Visible outside its file/module (an `export`, a capitalised Go name, a `pub` item…). */
  exported: boolean;
}

/** Definitions returned per file — a generated or data file must not flood a map. */
export const MAX_SYMBOLS_PER_FILE = 400;

type Language = "js" | "python" | "go" | "rust" | "oo" | "ruby" | "sql" | "markdown";

const LANGUAGE_BY_EXT: Record<string, Language> = {
  ts: "js", tsx: "js", js: "js", jsx: "js", mjs: "js", cjs: "js", mts: "js", cts: "js",
  py: "python",
  go: "go",
  rs: "rust",
  java: "oo", kt: "oo", kts: "oo", cs: "oo", swift: "oo", php: "oo", scala: "oo",
  rb: "ruby",
  sql: "sql",
  md: "markdown", mdx: "markdown",
};

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function languageOf(path: string): Language | undefined {
  return LANGUAGE_BY_EXT[extensionOf(path.replace(/\\/g, "/"))];
}

/** True when {@link extractSymbols} understands this file's language. */
export function isSymbolIndexable(path: string): boolean {
  return languageOf(path) !== undefined;
}

/** A capture group as a string — an unmatched optional group reads as "". */
function group(m: RegExpExecArray, n: number): string {
  return m[n] ?? "";
}

/**
 * Walk a file's lines, handing each to `visit` with its 1-based number, until the file
 * ends or the per-file cap is reached. The one loop every extractor shares.
 */
function eachLine(lines: readonly string[], out: CodeSymbol[], visit: (line: string, lineNo: number) => void): void {
  for (let i = 0; i < lines.length && out.length < MAX_SYMBOLS_PER_FILE; i += 1) {
    visit(lines[i] ?? "", i + 1);
  }
}

const ID = "[A-Za-z_$][\\w$]*";

// JS/TS. Top-level declarations must start at column 0 (a nested helper is not part of
// the file's map); an `export` may be indented (inside a `declare module` / namespace).
const JS_RULES: Array<{ re: RegExp; kind: SymbolKind }> = [
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s*\\*?\\s*(${ID})`), kind: "function" },
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?(?:default\\s+)?(?:abstract\\s+)?class\\s+(${ID})`), kind: "class" },
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?interface\\s+(${ID})`), kind: "interface" },
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?type\\s+(${ID})\\s*[<=]`), kind: "type" },
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?(?:const\\s+)?enum\\s+(${ID})`), kind: "enum" },
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?(?:const|let|var)\\s+(${ID})`), kind: "const" },
];
/** A class-body member: one indent level, a name, a parameter list, a body brace. */
const JS_METHOD = new RegExp(
  `^(?:\\t|  |    )(?:(?:public|private|protected|static|readonly|override|abstract|async|get|set)\\s+)*\\*?\\s*(${ID})\\s*(?:<[^>]*>)?\\s*\\(.*\\)?[^;]*\\{\\s*$`,
);
const JS_KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "function", "with", "do", "else", "try"]);

function extractJs(lines: string[], out: CodeSymbol[]): void {
  let inClass = false;
  eachLine(lines, out, (line, lineNo) => {
    if (/^\}/.test(line)) inClass = false;
    for (const rule of JS_RULES) {
      const m = rule.re.exec(line);
      if (!m) continue;
      const exported = !!m[1];
      // A non-exported declaration only counts at column 0 (top level).
      if (!exported && /^\s/.test(line)) continue;
      out.push({ name: group(m, 2), kind: rule.kind, line: lineNo, exported });
      if (rule.kind === "class") inClass = true;
      return;
    }
    if (!inClass) return;
    const method = JS_METHOD.exec(line);
    const name = method ? group(method, 1) : "";
    if (name && !JS_KEYWORDS.has(name)) out.push({ name, kind: "method", line: lineNo, exported: false });
  });
}

function extractPython(lines: string[], out: CodeSymbol[]): void {
  eachLine(lines, out, (line, lineNo) => {
    const m = /^(\s*)(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/.exec(line);
    if (!m) return;
    const indent = group(m, 1);
    // Only the top level and one class level deep — a closure is not part of the map.
    if (indent.length > 4 && !indent.startsWith("\t")) return;
    const name = group(m, 3);
    const kind: SymbolKind = group(m, 2) === "class" ? "class" : indent.length > 0 ? "method" : "function";
    out.push({ name, kind, line: lineNo, exported: !name.startsWith("_") });
  });
}

function extractGo(lines: string[], out: CodeSymbol[]): void {
  eachLine(lines, out, (line, lineNo) => {
    const fn = /^func\s+(\([^)]*\)\s*)?([A-Za-z_]\w*)/.exec(line);
    if (fn) {
      const name = group(fn, 2);
      out.push({ name, kind: fn[1] ? "method" : "function", line: lineNo, exported: /^[A-Z]/.test(name) });
      return;
    }
    const ty = /^type\s+([A-Za-z_]\w*)\s+(struct|interface)?/.exec(line);
    if (!ty) return;
    const name = group(ty, 1);
    const word = group(ty, 2);
    const kind: SymbolKind = word === "struct" ? "struct" : word === "interface" ? "interface" : "type";
    out.push({ name, kind, line: lineNo, exported: /^[A-Z]/.test(name) });
  });
}

function extractRust(lines: string[], out: CodeSymbol[]): void {
  eachLine(lines, out, (line, lineNo) => {
    const m = /^(\s*)(pub(?:\([^)]*\))?\s+)?(?:(?:async|unsafe|const|extern(?:\s+"[^"]*")?)\s+)*(fn|struct|enum|trait|mod|type)\s+([A-Za-z_]\w*)/.exec(line);
    if (!m) return;
    const word = group(m, 3);
    const kind: SymbolKind =
      word === "fn" ? (group(m, 1).length > 0 ? "method" : "function")
        : word === "mod" ? "module"
          : (word as SymbolKind);
    out.push({ name: group(m, 4), kind, line: lineNo, exported: !!m[2] });
  });
}

const OO_TYPE = /^\s*(?:(?:public|private|protected|internal|static|final|abstract|sealed|open|data|partial|export|inline|value)\s+)*(class|interface|enum|record|object|struct|protocol|trait)\s+([A-Za-z_]\w*)/;
const OO_FUNC = /^\s*(?:(?:public|private|protected|internal|static|final|override|open|suspend|inline|abstract)\s+)*(?:fun|func|function)\s+([A-Za-z_]\w*)/;

function extractOo(lines: string[], out: CodeSymbol[]): void {
  eachLine(lines, out, (line, lineNo) => {
    const exported = !/\bprivate\b/.test(line);
    const ty = OO_TYPE.exec(line);
    if (ty) {
      const word = group(ty, 1);
      const kind: SymbolKind =
        word === "interface" || word === "protocol" ? "interface"
          : word === "enum" ? "enum"
            : word === "struct" ? "struct"
              : word === "trait" ? "trait"
                : "class";
      out.push({ name: group(ty, 2), kind, line: lineNo, exported });
      return;
    }
    const fn = OO_FUNC.exec(line);
    if (fn) out.push({ name: group(fn, 1), kind: /^\s/.test(line) ? "method" : "function", line: lineNo, exported });
  });
}

function extractRuby(lines: string[], out: CodeSymbol[]): void {
  eachLine(lines, out, (line, lineNo) => {
    const ty = /^\s*(class|module)\s+([A-Z]\w*(?:::\w+)*)/.exec(line);
    if (ty) {
      out.push({ name: group(ty, 2), kind: group(ty, 1) === "module" ? "module" : "class", line: lineNo, exported: true });
      return;
    }
    const fn = /^(\s*)def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)/.exec(line);
    if (fn) out.push({ name: group(fn, 2), kind: group(fn, 1).length > 0 ? "method" : "function", line: lineNo, exported: true });
  });
}

const SQL_CREATE = /^\s*create\s+(?:or\s+replace\s+)?(?:unique\s+)?(table|view|materialized\s+view|function|procedure|index|type|trigger)\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([\w."]+)/i;

function extractSql(lines: string[], out: CodeSymbol[]): void {
  eachLine(lines, out, (line, lineNo) => {
    const m = SQL_CREATE.exec(line);
    if (!m) return;
    const word = group(m, 1).toLowerCase();
    const kind: SymbolKind =
      word === "function" || word === "procedure" || word === "trigger" ? "function"
        : word === "index" || word === "type" ? "type"
          : "table";
    out.push({ name: group(m, 2).replace(/"/g, ""), kind, line: lineNo, exported: true });
  });
}

function extractMarkdown(lines: string[], out: CodeSymbol[]): void {
  let fenced = false;
  eachLine(lines, out, (line, lineNo) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const m = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    // The heading level stays in the name ("## Gap Register"): an outline has to show
    // the document's shape, and a substring query still finds it.
    if (m) out.push({ name: `${group(m, 1)} ${group(m, 2).slice(0, 120)}`, kind: "heading", line: lineNo, exported: true });
  });
}

const EXTRACTORS: Record<Language, (lines: string[], out: CodeSymbol[]) => void> = {
  js: extractJs,
  python: extractPython,
  go: extractGo,
  rust: extractRust,
  oo: extractOo,
  ruby: extractRuby,
  sql: extractSql,
  markdown: extractMarkdown,
};

/**
 * The definitions in one file, in line order. Empty for a language this does not
 * understand (see {@link isSymbolIndexable}). Capped at {@link MAX_SYMBOLS_PER_FILE}.
 */
export function extractSymbols(path: string, content: string): CodeSymbol[] {
  const language = languageOf(path);
  if (!language) return [];
  const out: CodeSymbol[] = [];
  EXTRACTORS[language](content.split(/\r?\n/), out);
  return out;
}

const JS_SOURCE = /\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$/i;

/**
 * The exported names of a JS/TS module — the part of a file another file needs to know
 * about. Empty for anything else. `default` is included when the module has a default
 * export. Capped at 25 names: this feeds one-line-per-file workspace maps.
 */
export function exportedSymbols(path: string, content: string): string[] {
  if (!JS_SOURCE.test(path)) return [];
  const found = new Set<string>();
  for (const symbol of extractSymbols(path, content)) {
    if (symbol.exported) found.add(symbol.name);
  }
  if (/\bexport\s+default\b/.test(content)) found.add("default");
  return [...found].slice(0, 25);
}

/** One symbol as a compact, model-readable line: `L123 function name (export)`. */
export function formatSymbol(symbol: CodeSymbol): string {
  return `L${symbol.line} ${symbol.kind} ${symbol.name}${symbol.exported && symbol.kind !== "heading" ? " (export)" : ""}`;
}
