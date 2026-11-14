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
import { CallbackOwnerScan } from "./callbackOwners.js";
/** The kinds a caller may filter on — every {@link SymbolKind}, as a list for schemas. */
export const SYMBOL_KINDS = [
    "function", "method", "class", "interface", "type", "enum", "const",
    "struct", "trait", "module", "table", "heading",
];
/** Definitions returned per file — a generated or data file must not flood a map. */
export const MAX_SYMBOLS_PER_FILE = 400;
const LANGUAGE_BY_EXT = {
    ts: "js", tsx: "js", js: "js", jsx: "js", mjs: "js", cjs: "js", mts: "js", cts: "js",
    py: "python",
    go: "go",
    rs: "rust",
    java: "oo", kt: "oo", kts: "oo", cs: "oo", swift: "oo", php: "oo", scala: "oo",
    rb: "ruby",
    sql: "sql",
    md: "markdown", mdx: "markdown",
};
function extensionOf(path) {
    const base = path.slice(path.lastIndexOf("/") + 1);
    const dot = base.lastIndexOf(".");
    return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}
function languageOf(path) {
    return LANGUAGE_BY_EXT[extensionOf(path.replace(/\\/g, "/"))];
}
export function symbolLanguageOf(path) {
    return languageOf(path);
}
/** True when {@link extractSymbols} understands this file's language. */
export function isSymbolIndexable(path) {
    return languageOf(path) !== undefined;
}
/** A capture group as a string — an unmatched optional group reads as "". */
function group(m, n) {
    return m[n] ?? "";
}
/**
 * Walk a file's lines, handing each to `visit` with its 1-based number, until the file
 * ends or the per-file cap is reached. The one loop every extractor shares.
 */
let symbolCap = MAX_SYMBOLS_PER_FILE;
function eachLine(lines, out, visit) {
    for (let i = 0; i < lines.length && out.length < symbolCap; i += 1) {
        visit(lines[i] ?? "", i + 1);
    }
}
const ID = "[A-Za-z_$][\\w$]*";
// JS/TS. Top-level declarations must start at column 0 (a nested helper is not part of
// the file's map); an `export` may be indented (inside a `declare module` / namespace).
const JS_RULES = [
    { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s*\\*?\\s*(${ID})`), kind: "function" },
    { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?(?:default\\s+)?(?:abstract\\s+)?class\\s+(${ID})`), kind: "class" },
    { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?interface\\s+(${ID})`), kind: "interface" },
    { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?type\\s+(${ID})\\s*[<=]`), kind: "type" },
    { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?(?:const\\s+)?enum\\s+(${ID})`), kind: "enum" },
    { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?(?:const|let|var)\\s+(${ID})`), kind: "const" },
    // `namespace A.B {`, `declare module "x" {` — the module's name, its quotes dropped.
    { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?(?:namespace|module)\\s+(${ID}(?:\\.${ID})*|"[^"]+"|'[^']+')\\s*\\{`), kind: "module" },
];
/** A class-body member: one indent level, a name, a parameter list, a body brace. */
const JS_METHOD = new RegExp(`^(?:\\t|  |    )(?:(?:public|private|protected|static|readonly|override|abstract|async|get|set)\\s+)*\\*?\\s*(${ID})\\s*(?:<[^>]*>)?\\s*\\(.*\\)?[^;]*\\{\\s*$`);
/** An abstract member SIGNATURE — it has no body brace, so {@link JS_METHOD} never sees it. */
const JS_ABSTRACT_METHOD = new RegExp(`^(?:\\t|  |    )(?:(?:public|private|protected|static|readonly|override)\\s+)*abstract\\s+(?:(?:public|private|protected|static|readonly|override|async)\\s+)*(${ID})\\s*\\??\\s*(?:<[^>]*>)?\\s*\\(`);
/** A member whose parameter list opens a multi-line signature: `  async find(` with the parameters on the lines below. */
const JS_METHOD_OPEN = new RegExp(`^(?:\\t|  |    )(?:(?:public|private|protected|static|readonly|override|async|get|set)\\s+)*\\*?\\s*(${ID})\\s*(?:<[^>]*>)?\\s*\\(\\s*$`);
/** The line closing such a signature with a body brace: `)`, `): Promise<Row> {`. A call statement closes with `);`. */
const JS_SIGNATURE_CLOSE = /^\s*\)\s*(?::[^;=]*)?\{\s*$/;
/** How far below its first line a multi-line signature is looked for its close. */
const MAX_SIGNATURE_LINES = 40;
const JS_KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "function", "with", "do", "else", "try"]);
/** Whether the multi-line signature opened on line `at` (0-based) closes with a body brace: its first `)`-led line. */
function closesWithBody(lines, at) {
    for (let i = at + 1; i < Math.min(lines.length, at + MAX_SIGNATURE_LINES); i += 1) {
        const line = lines[i] ?? "";
        if (/^\s*\)/.test(line))
            return JS_SIGNATURE_CLOSE.test(line);
    }
    return false;
}
function extractJs(lines, out, path = "") {
    // The class whose body we are in (its closing brace sits at column 0).
    let cls;
    // The callback owners (callbackOwners.ts): a route handler or a listener owns its callback's body.
    const owners = new CallbackOwnerScan(path);
    eachLine(lines, out, (line, lineNo) => {
        if (/^\}/.test(line))
            cls = undefined;
        if (owners.inBody(line))
            return;
        owners.track(line);
        for (const rule of JS_RULES) {
            const m = rule.re.exec(line);
            if (!m)
                continue;
            const exported = !!m[1];
            // A non-exported declaration only counts at column 0 (top level).
            if (!exported && /^\s/.test(line))
                continue;
            const name = group(m, 2).replace(/^["']|["']$/g, "");
            out.push({ name, kind: rule.kind, line: lineNo, exported });
            if (rule.kind === "class")
                cls = name;
            return;
        }
        if (cls === undefined) {
            const owner = owners.ownerAt(line, lineNo);
            if (owner)
                out.push(owner);
            return;
        }
        const open = JS_METHOD_OPEN.exec(line);
        const method = JS_METHOD.exec(line) ?? JS_ABSTRACT_METHOD.exec(line) ?? (open && closesWithBody(lines, lineNo - 1) ? open : null);
        const name = method ? group(method, 1) : "";
        if (name && !JS_KEYWORDS.has(name))
            out.push({ name, kind: "method", line: lineNo, exported: false, container: cls });
    });
}
function extractPython(lines, out) {
    // The top-level class we are in, and the indent its members use (the first member fixes it).
    let cls;
    let memberIndent;
    eachLine(lines, out, (line, lineNo) => {
        const m = /^(\s*)(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/.exec(line);
        const indent = m ? group(m, 1) : (/^(\s*)\S/.exec(line)?.[1] ?? "");
        // A statement at column 0 other than a decorator or a comment ends the class body.
        if (indent === "" && /^[^\s@#)\]}]/.test(line) && !(m && group(m, 2) === "class")) {
            cls = undefined;
            memberIndent = undefined;
        }
        if (!m)
            return;
        const name = group(m, 3);
        if (group(m, 2) === "class") {
            if (indent === "") {
                cls = name;
                memberIndent = undefined;
                out.push({ name, kind: "class", line: lineNo, exported: !name.startsWith("_") });
                return;
            }
            // A class one level inside a class.
            if (cls !== undefined && (memberIndent === undefined || indent === memberIndent)) {
                memberIndent ??= indent;
                out.push({ name, kind: "class", line: lineNo, exported: !name.startsWith("_"), container: cls });
            }
            return;
        }
        if (indent === "") {
            out.push({ name, kind: "function", line: lineNo, exported: !name.startsWith("_") });
            return;
        }
        // An indented def is a method only directly in a top-level class; a closure (in a function, or in a method) is not part of the map.
        if (cls === undefined)
            return;
        memberIndent ??= indent;
        if (indent === memberIndent)
            out.push({ name, kind: "method", line: lineNo, exported: !name.startsWith("_"), container: cls });
    });
}
/** The type name of a Go receiver: `(r *Repo[T])` → `Repo`. */
const goReceiver = (receiver) => /\(\s*(?:[A-Za-z_]\w*\s+)?\*?\s*([A-Za-z_]\w*)/.exec(receiver)?.[1];
function extractGo(lines, out) {
    eachLine(lines, out, (line, lineNo) => {
        const fn = /^func\s+(\([^)]*\)\s*)?([A-Za-z_]\w*)/.exec(line);
        if (fn) {
            const name = group(fn, 2);
            const container = fn[1] ? goReceiver(fn[1]) : undefined;
            out.push({ name, kind: fn[1] ? "method" : "function", line: lineNo, exported: /^[A-Z]/.test(name), ...(container ? { container } : {}) });
            return;
        }
        const ty = /^type\s+([A-Za-z_]\w*)\s+(struct|interface)?/.exec(line);
        if (!ty)
            return;
        const name = group(ty, 1);
        const word = group(ty, 2);
        const kind = word === "struct" ? "struct" : word === "interface" ? "interface" : "type";
        out.push({ name, kind, line: lineNo, exported: /^[A-Z]/.test(name) });
    });
}
/** The type an `impl` block is for: `impl<T> Trait for Foo<T> {` and `impl Foo {` are both `Foo`. */
function rustImplTarget(line) {
    const m = /^\s*(?:unsafe\s+)?impl\b(?:\s*<[^>]*>)?\s+([^{]*)/.exec(line);
    if (!m)
        return undefined;
    const text = group(m, 1).replace(/\bwhere\b.*$/, "");
    const target = text.includes(" for ") ? text.slice(text.indexOf(" for ") + 5) : text;
    return /(?:[A-Za-z_]\w*::)*([A-Za-z_]\w*)/.exec(target.replace(/^[\s&]+(?:mut\s+|dyn\s+)?/, ""))?.[1];
}
function extractRust(lines, out) {
    // The impl (or trait) block we are in; its closing brace sits at column 0.
    let block;
    eachLine(lines, out, (line, lineNo) => {
        if (/^\}/.test(line))
            block = undefined;
        const target = rustImplTarget(line);
        if (target) {
            block = target;
            return;
        }
        const m = /^(\s*)(pub(?:\([^)]*\))?\s+)?(?:(?:async|unsafe|const|extern(?:\s+"[^"]*")?)\s+)*(fn|struct|enum|trait|mod|type)\s+([A-Za-z_]\w*)/.exec(line);
        if (!m)
            return;
        const word = group(m, 3);
        const indented = group(m, 1).length > 0;
        const kind = word === "fn" ? (indented ? "method" : "function")
            : word === "mod" ? "module"
                : word;
        const name = group(m, 4);
        const container = kind === "method" ? block : undefined;
        out.push({ name, kind, line: lineNo, exported: !!m[2], ...(container ? { container } : {}) });
        if (word === "trait" && !indented)
            block = name;
    });
}
const OO_TYPE = /^\s*(?:(?:public|private|protected|internal|static|final|abstract|sealed|open|data|partial|export|inline|value)\s+)*(class|interface|enum|record|object|struct|protocol|trait)\s+([A-Za-z_]\w*)/;
const OO_FUNC = /^\s*(?:(?:public|private|protected|internal|static|final|override|open|suspend|inline|abstract)\s+)*(?:fun|func|function)\s+([A-Za-z_]\w*)/;
function extractOo(lines, out) {
    eachLine(lines, out, (line, lineNo) => {
        const exported = !/\bprivate\b/.test(line);
        const ty = OO_TYPE.exec(line);
        if (ty) {
            const word = group(ty, 1);
            const kind = word === "interface" || word === "protocol" ? "interface"
                : word === "enum" ? "enum"
                    : word === "struct" ? "struct"
                        : word === "trait" ? "trait"
                            : "class";
            out.push({ name: group(ty, 2), kind, line: lineNo, exported });
            return;
        }
        const fn = OO_FUNC.exec(line);
        if (fn)
            out.push({ name: group(fn, 1), kind: /^\s/.test(line) ? "method" : "function", line: lineNo, exported });
    });
}
function extractRuby(lines, out) {
    eachLine(lines, out, (line, lineNo) => {
        const ty = /^\s*(class|module)\s+([A-Z]\w*(?:::\w+)*)/.exec(line);
        if (ty) {
            out.push({ name: group(ty, 2), kind: group(ty, 1) === "module" ? "module" : "class", line: lineNo, exported: true });
            return;
        }
        const fn = /^(\s*)def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)/.exec(line);
        if (fn)
            out.push({ name: group(fn, 2), kind: group(fn, 1).length > 0 ? "method" : "function", line: lineNo, exported: true });
    });
}
const SQL_CREATE = /^\s*create\s+(?:or\s+replace\s+)?(?:unique\s+)?(table|view|materialized\s+view|function|procedure|index|type|trigger)\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([\w."]+)/i;
function extractSql(lines, out) {
    eachLine(lines, out, (line, lineNo) => {
        const m = SQL_CREATE.exec(line);
        if (!m)
            return;
        const word = group(m, 1).toLowerCase();
        const kind = word === "function" || word === "procedure" || word === "trigger" ? "function"
            : word === "index" || word === "type" ? "type"
                : "table";
        out.push({ name: group(m, 2).replace(/"/g, ""), kind, line: lineNo, exported: true });
    });
}
function extractMarkdown(lines, out) {
    let fenced = false;
    eachLine(lines, out, (line, lineNo) => {
        if (/^\s*(```|~~~)/.test(line)) {
            fenced = !fenced;
            return;
        }
        if (fenced)
            return;
        const m = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
        // The heading level stays in the name ("## Gap Register"): an outline has to show
        // the document's shape, and a substring query still finds it.
        if (m)
            out.push({ name: `${group(m, 1)} ${group(m, 2).slice(0, 120)}`, kind: "heading", line: lineNo, exported: true });
    });
}
const EXTRACTORS = {
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
 * understand (see {@link isSymbolIndexable}). Capped at {@link MAX_SYMBOLS_PER_FILE} unless a larger `cap` is given.
 */
export function extractSymbols(path, content, cap = MAX_SYMBOLS_PER_FILE) {
    const language = languageOf(path);
    if (!language)
        return [];
    const out = [];
    // The cap bounds the symbol INDEX; a caller that needs the true count (the god-module badges) passes a larger one. Synchronous, so the swap cannot interleave.
    const outer = symbolCap;
    symbolCap = cap;
    try {
        EXTRACTORS[language](content.split(/\r?\n/), out, path.replace(/\\/g, "/"));
    }
    finally {
        symbolCap = outer;
    }
    return out;
}
const JS_SOURCE = /\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$/i;
/**
 * The exported names of a JS/TS module — the part of a file another file needs to know
 * about. Empty for anything else. `default` is included when the module has a default
 * export. Capped at 25 names: this feeds one-line-per-file workspace maps.
 */
export function exportedSymbols(path, content) {
    if (!JS_SOURCE.test(path))
        return [];
    const found = new Set();
    for (const symbol of extractSymbols(path, content)) {
        if (symbol.exported)
            found.add(symbol.name);
    }
    if (/\bexport\s+default\b/.test(content))
        found.add("default");
    return [...found].slice(0, 25);
}
/** One symbol as a compact, model-readable line: `L123 function name (export)`. */
export function formatSymbol(symbol) {
    return `L${symbol.line} ${symbol.kind} ${symbol.name}${symbol.exported && symbol.kind !== "heading" ? " (export)" : ""}`;
}
//# sourceMappingURL=symbols.js.map