/**
 * Symbol relations — "what does each definition of this file extend, implement, hold, name and call" —
 * the symbol-level edges of the knowledge view's class and method bands (PRD 43 P0b, B1a rules 9–10).
 *
 * It reads the definitions the ONE symbol extractor ({@link extractSymbols}) found in the same file, so
 * "what is a symbol" keeps one answer; this adds only the relations between them. Same contract as
 * that extractor: heuristic and line-anchored — NOT a parser — zero dependencies, runs in the Worker,
 * the browser and Node, pure. A missed relation costs one missing line in a diagram, never a wrong edit.
 *
 * Kinds (memory's `SYMBOL_EDGE_KINDS`):
 *   extends     class → its base class; interface → each interface it extends
 *   implements  class → each interface it implements
 *   composes    class → the class of a field / property / constructor parameter property, or of a field's `new X()`
 *   uses        symbol → a type it names (a local type or an imported name), when none of the above already links them
 *   calls       function/method → a function/method it calls: `f()`, `this.m()`, `this.field.m()`, `X.m()`, `ns.f()`;
 *               with every call site (line, column) and its `order` among ALL calls in the caller's body
 *
 * A target is a definition of THIS file (an index into the symbols given) or a name imported from a module;
 * turning that into a ref (and an outside-the-root target into a `missing` placeholder ref) is the host's job,
 * since only it sees the other files. A call whose callee cannot be named (`obj.run()` on an untyped local, a
 * global) is counted in `order` but emits no relation.
 *
 * Coverage: JS/TS (`.ts .tsx .js .jsx .mjs .cjs .mts .cts`). Other languages return [] (see {@link relationsSupported}).
 * Not seen: calls inside template-literal interpolations, `require()` bindings, tsconfig path aliases (a bare
 * specifier is a package), inherited methods (`this.m()` defined in a base class), and receivers typed only by inference.
 *
 * Bounded: one relation per (from, target, kind) — a repeated call is another site — at most
 * {@link MAX_SYMBOL_EDGES_PER_SYMBOL} per symbol, {@link MAX_CALL_SITES_PER_EDGE} sites per relation and
 * {@link MAX_RELATIONS_PER_FILE} per file (the per-file budget, as {@link extractSymbols} has one for definitions).
 */

import {
  MAX_CALL_SITES_PER_EDGE,
  MAX_SYMBOL_EDGES_PER_SYMBOL,
  type CallSite,
  type SymbolEdgeKind,
} from "@seanhogg/builderforce-memory/knowledge";
import { isCallbackOwnerName, symbolLanguageOf, type CodeSymbol } from "./symbols.js";

// The kinds, the call-site shape and the caps are memory's (PRD 43 P0b): one definition, re-exported for the hosts.
export {
  SYMBOL_EDGE_KINDS,
  MAX_SYMBOL_EDGES_PER_SYMBOL,
  MAX_CALL_SITES_PER_EDGE,
  isSymbolEdgeKind,
  type SymbolEdgeKind,
  type CallSite,
} from "@seanhogg/builderforce-memory/knowledge";

/** A definition of this file (index into the symbols given), or `name` (`member` of it) imported from `module`. */
export type RelationTarget =
  | { symbol: number }
  | { module: string; name: string; member?: string };

export interface SymbolRelation {
  /** Index into the symbols given. */
  from: number;
  kind: SymbolEdgeKind;
  to: RelationTarget;
  /** `calls` only: the call sites, in `order` — the first {@link MAX_CALL_SITES_PER_EDGE} of them. */
  sites?: CallSite[];
  /** `calls` only: how many calls there are in all (`sites` keeps at most {@link MAX_CALL_SITES_PER_EDGE}). */
  count?: number;
}

export const MAX_RELATIONS_PER_FILE = 4000;

/** True when {@link extractSymbolRelations} reads this file's language. */
export function relationsSupported(path: string): boolean {
  return symbolLanguageOf(path) === "js";
}

const ID = "[A-Za-z_$][\\w$]*";
const TYPE_KINDS = new Set(["class", "interface", "type", "enum", "struct", "trait"]);
const CALLABLE_KINDS = new Set(["function", "const"]);
const NOT_CALLS = new Set([
  "if", "for", "while", "switch", "catch", "return", "function", "with", "do", "else", "try", "typeof", "await", "yield",
  "new", "super", "import", "void", "delete", "in", "of", "instanceof", "case", "throw", "constructor", "get", "set", "async",
]);

const QUOTE_OR_COMMENT = /["'`/]/;

/** The `{` minus `}` of a (masked) line, and whether it opens one. */
function braces(line: string): { delta: number; opens: boolean } {
  let delta = 0, opens = false;
  for (let i = line.indexOf("{"); i >= 0; i = line.indexOf("{", i + 1)) { delta += 1; opens = true; }
  for (let i = line.indexOf("}"); i >= 0; i = line.indexOf("}", i + 1)) delta -= 1;
  return { delta, opens };
}

/** The `(` minus `)` of a (masked) line. */
function parens(line: string): number {
  let delta = 0;
  for (let i = line.indexOf("("); i >= 0; i = line.indexOf("(", i + 1)) delta += 1;
  for (let i = line.indexOf(")"); i >= 0; i = line.indexOf(")", i + 1)) delta -= 1;
  return delta;
}

/** The lines with comments and string/template contents blanked to spaces, so columns stay where they were. */
function maskCode(lines: readonly string[]): string[] {
  let block = false, template = false;
  return lines.map((line) => {
    // Most lines hold no comment, quote or template: nothing to blank.
    if (!block && !template && !QUOTE_OR_COMMENT.test(line)) return line;
    let out = "";
    let i = 0;
    while (i < line.length) {
      const c = line[i]!, n = line[i + 1];
      if (block) {
        if (c === "*" && n === "/") { block = false; out += "  "; i += 2; } else { out += " "; i += 1; }
        continue;
      }
      if (template) {
        if (c === "\\" && i + 1 < line.length) { out += "  "; i += 2; continue; }
        if (c === "`") { template = false; out += "`"; i += 1; continue; }
        out += " "; i += 1;
        continue;
      }
      if (c === "/" && n === "/") { out += " ".repeat(line.length - i); break; }
      if (c === "/" && n === "*") { block = true; out += "  "; i += 2; continue; }
      if (c === "\"" || c === "'") {
        out += c; i += 1;
        while (i < line.length && line[i] !== c) {
          if (line[i] === "\\" && i + 1 < line.length) { out += "  "; i += 2; continue; }
          out += " "; i += 1;
        }
        if (i < line.length) { out += c; i += 1; }
        continue;
      }
      if (c === "`") { template = true; out += "`"; i += 1; continue; }
      out += c; i += 1;
    }
    return out;
  });
}

interface Import { module: string; name: string; namespace: boolean }

/** `local name → what it imports`, from the file's `import … from "…"` statements (type-only ones included). */
function importsOf(lines: readonly string[], masked: readonly string[]): Map<string, Import> {
  const out = new Map<string, Import>();
  for (let l = 0; l < lines.length; l += 1) {
    // Decided on the MASKED line, so an `import … from` inside a string, template or comment is no import; read from the raw one.
    if (!IMPORT_START.test(masked[l]!)) continue;
    // The statement: this line and the next ones until its `from "…"` (a long named list spans lines).
    let statement = lines[l]!;
    for (let k = l + 1; k < Math.min(lines.length, l + 60) && !FROM_SPEC.test(statement) && !statement.includes(";"); k += 1) statement += ` ${lines[k]}`;
    const m = IMPORT_STATEMENT.exec(statement);
    if (!m) continue;
    const clause = m[1] ?? "", module = m[2] ?? "";
    const named = /\{([^}]*)\}/.exec(clause);
    for (const part of (named?.[1] ?? "").split(",")) {
      const p = IMPORT_NAMED.exec(part);
      if (p) out.set(p[2] ?? p[1]!, { module, name: p[1]!, namespace: false });
    }
    const rest = clause.replace(/\{[^}]*\}/, "");
    const ns = IMPORT_NAMESPACE.exec(rest);
    if (ns) out.set(ns[1]!, { module, name: "*", namespace: true });
    const def = IMPORT_DEFAULT.exec(rest);
    if (def && def[1] !== "type") out.set(def[1]!, { module, name: "default", namespace: false });
  }
  return out;
}

const IMPORT_START = /^[ \t]*import[\s{*]/;
const FROM_SPEC = /\bfrom\s*["'][^"']+["']/;
const IMPORT_STATEMENT = /^[ \t]*import\s+(?:type\s+)?([^;'"]*?)\s*from\s*["']([^"']+)["']/;
const IMPORT_NAMED = new RegExp(`^\\s*(?:type\\s+)?(${ID})(?:\\s+as\\s+(${ID}))?\\s*$`);
const IMPORT_NAMESPACE = new RegExp(`\\*\\s*as\\s+(${ID})`);
const IMPORT_DEFAULT = new RegExp(`^\\s*(${ID})\\s*(?:,|$)`);
const LEADING_TYPE = new RegExp(`^\\s*(${ID}(?:\\s*\\.\\s*${ID})?)`);
const FIELD = new RegExp(`^\\s*(?:(?:public|private|protected|readonly|static|declare|override|abstract|accessor)\\s+)*#?(${ID})\\s*[?!]?\\s*:\\s*([^=;]+)`);
const FIELD_INIT = new RegExp(`^\\s*(?:(?:public|private|protected|readonly|static|override)\\s+)*#?(${ID})\\s*=`);
const NEW = new RegExp(`(?:^|[^\\w$])new\\s+(${ID}(?:\\.${ID})?)`);
const PARAM_PROP = new RegExp(`\\b(?:public|private|protected|readonly)\\s+(?:readonly\\s+)?(${ID})\\s*\\??\\s*:\\s*(${ID}(?:\\.${ID})?)`, "g");
const LOCAL_DECL = new RegExp(`\\b(?:const|let|var|function\\s*\\*?|class|catch\\s*\\()\\s*(${ID})`, "g");
const DESTRUCTURE = /\b(?:const|let|var)\s*[{[]([^=]*)[}\]]\s*=/g;
const LAST_ID = new RegExp(`(${ID})\\s*(?:=[^,]*)?\\s*$`);
/** A callback's parameters at the end of its line: `(a, b) => {`, `a => {`, `function (a) {`. */
const CALLBACK_PARAMS = new RegExp(`(?:\\(([^()]*)\\)(?:\\s*:\\s*[^=()]+)?\\s*=>|(${ID})\\s*=>|\\bfunction\\b[^(]*\\(([^()]*)\\))\\s*\\{\\s*$`);
const PARAM_NAME = new RegExp(`^\\s*(?:\\.\\.\\.)?(?:(?:public|private|protected|readonly)\\s+)*(${ID})`);
const isIdChar = (c: number): boolean =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36;
const isSpace = (c: number): boolean => c === 32 || c === 9;
/** What never appears between a generic call's `<` and `>`: comparison and arithmetic operators, a call. */
const NOT_TYPE_ARGS = /&&|\|\||[=!]=|[<>]=|[+\-*/%()]|^\s|\s$/;

interface CallAt {
  /** The callee's name. */
  name: string;
  /** Receiver names before it (`this.repo.get(` → ["this", "repo"]); [] for a bare call; null when a receiver is no name (`f().g(`). */
  parts: string[] | null;
  /** 0-based column of `name`; `start` of the whole callee expression. */
  column: number;
  start: number;
  /** `new X(…).name(`: the class constructed (`X`, or `ns.X`); `parts` is null then. */
  ctor?: string;
  /** A JSX element `<Name` (a render: an invocation of the component). */
  jsx?: boolean;
}

/** `new X(` (or `new ns.X<T>(`) ending just before the `(` at `open`: the class name, else undefined. */
const NEW_BEFORE = new RegExp(`\\bnew\\s+(${ID}(?:\\.${ID})?)\\s*(?:<[^<>()]*>)?\\s*$`);

/** The index of the `(` that the `)` at `close` balances, scanning left; -1 when none on the line. */
function openOf(line: string, close: number): number {
  let depth = 0;
  for (let i = close; i >= 0; i -= 1) {
    const c = line[i];
    if (c === ")") depth += 1;
    else if (c === "(" && --depth === 0) return i;
  }
  return -1;
}

/** Files whose `<Name` is JSX (a `.ts` file's `<T>x` is a type assertion). */
const JSX_FILE = /\.(?:tsx|jsx|js|mjs|cjs)$/i;
/** A JSX element's tag that names a component (capitalised; `<div` is an intrinsic element and names nothing). */
const JSX_TAG = new RegExp(`<(\\/?)([A-Z][\\w$]*(?:\\.${ID})*)(?=[\\s/>]|$)`, "g");

/**
 * The component elements of one masked line: `<Comp` and `<ns.Comp`, where the `<` follows no name, `)`, `]` or `.`
 * (`Array<Foo>`, `useState<Row>(` are type arguments). `closing` marks a `</Comp>`.
 */
function jsxTagsIn(line: string): Array<{ name: string; column: number; start: number; closing: boolean }> {
  const out: Array<{ name: string; column: number; start: number; closing: boolean }> = [];
  if (!line.includes("<")) return out;
  for (const m of line.matchAll(JSX_TAG)) {
    const at = m.index!;
    let p = at - 1;
    while (p >= 0 && isSpace(line.charCodeAt(p))) p -= 1;
    if (p >= 0 && (isIdChar(line.charCodeAt(p)) || line[p] === ")" || line[p] === "]" || line[p] === ".")) continue;
    const start = at + 1 + m[1]!.length;
    out.push({ name: m[2]!, column: start, start, closing: m[1] === "/" });
  }
  return out;
}

/** The renders of one masked line as calls: `<Comp` → `Comp`, `<ns.Comp` → `Comp` on receiver `ns`. Closing tags are none. */
function jsxCallsIn(line: string): CallAt[] {
  return jsxTagsIn(line).filter((t) => !t.closing).map((t) => {
    const dot = t.name.lastIndexOf(".");
    return dot < 0
      ? { name: t.name, parts: [], column: t.column, start: t.start, jsx: true }
      : { name: t.name.slice(dot + 1), parts: t.name.slice(0, dot).split("."), column: t.column + dot + 1, start: t.start, jsx: true };
  });
}

/** The line with its JSX component tags blanked (columns kept), so a render is not also read as a type `uses`. */
function withoutJsxTags(line: string): string {
  let out = line;
  for (const t of jsxTagsIn(line)) out = out.slice(0, t.start) + " ".repeat(t.name.length) + out.slice(t.start + t.name.length);
  return out;
}

/**
 * The calls in one masked line, left to right: every `(` preceded by a name (optionally `?.`, optionally `<…>` type
 * arguments), with that name's receiver chain read backwards. A hand scan, not a regex: it reads each `(` once.
 */
function callsIn(line: string): CallAt[] {
  const out: CallAt[] = [];
  for (let p = line.indexOf("("); p >= 0; p = line.indexOf("(", p + 1)) {
    let j = p - 1;
    while (j >= 0 && isSpace(line.charCodeAt(j))) j -= 1;
    if (j >= 1 && line[j] === "." && line[j - 1] === "?") { j -= 2; while (j >= 0 && isSpace(line.charCodeAt(j))) j -= 1; }
    if (line[j] === ">") {
      let k = j - 1, depth = 1;
      for (; k >= 0 && depth > 0; k -= 1) {
        const c = line[k];
        if (c === ">") depth += 1; else if (c === "<") depth -= 1; else if (c === "(" || c === ")" || c === ";") break;
      }
      if (depth !== 0) continue;
      // Type arguments sit right after the name (`f<T>(`) and hold types only: `a < b && c > (d)` is two comparisons.
      if (k < 0 || !isIdChar(line.charCodeAt(k)) || NOT_TYPE_ARGS.test(line.slice(k + 2, j))) continue;
      j = k;
    }
    const end = j + 1;
    while (j >= 0 && isIdChar(line.charCodeAt(j))) j -= 1;
    const name = line.slice(j + 1, end);
    if (!name || (name.charCodeAt(0) >= 48 && name.charCodeAt(0) <= 57)) continue;
    const column = j + 1;
    const parts: string[] = [];
    let chained = true, start = column, k = j, ctor: string | undefined;
    for (;;) {
      let d = k;
      while (d >= 0 && isSpace(line.charCodeAt(d))) d -= 1;
      if (d < 0 || line[d] !== ".") break;
      d -= 1;
      if (d >= 0 && line[d] === "?") d -= 1;
      while (d >= 0 && isSpace(line.charCodeAt(d))) d -= 1;
      const e = d + 1;
      while (d >= 0 && isIdChar(line.charCodeAt(d))) d -= 1;
      if (d + 1 === e) {
        chained = false;
        // `new X(…).name(`: the receiver is a fresh X.
        if (parts.length === 0 && line[e - 1] === ")") {
          const open = openOf(line, e - 1);
          const m = open > 0 ? NEW_BEFORE.exec(line.slice(0, open)) : null;
          if (m) { ctor = m[1]!.replace(/\s+/g, ""); start = m.index + (m[0].length - m[0].trimStart().length); }
        }
        break;
      }
      parts.unshift(line.slice(d + 1, e));
      start = d + 1;
      k = d;
    }
    out.push({ name, parts: chained ? parts : null, column, start, ...(ctor ? { ctor } : {}) });
  }
  return out;
}

/** The leading `A` or `A.B` of a type text (generics and arrays dropped). */
const leadingType = (text: string): string | undefined => LEADING_TYPE.exec(text)?.[1]?.replace(/\s+/g, "");

/**
 * The heritage part of a class/interface declaration: the text after `name` and its own type-parameter list (`<T extends B>`,
 * whose `extends` is a constraint, not a base) up to the body's `{`. `text` is the masked declaration line and a few after it.
 */
function headerOf(text: string, name: string): string {
  const at = new RegExp(`\\b(?:class|interface)\\s+${name.replace(/\$/g, "\\$")}(?![\\w$])`).exec(text);
  let i = at ? at.index + at[0].length : 0;
  while (i < text.length && /\s/.test(text[i]!)) i += 1;
  if (text[i] === "<") {
    let depth = 0;
    for (; i < text.length; i += 1) {
      const c = text[i];
      if (c === "<") depth += 1;
      else if (c === ">" && text[i - 1] !== "=") { depth -= 1; if (depth === 0) { i += 1; break; } }
    }
  }
  const rest = text.slice(i);
  const brace = rest.indexOf("{");
  return brace >= 0 ? rest.slice(0, brace) : rest;
}

/** A top-level comma-separated list, commas inside `<…>` / `(…)` / `{…}` kept. */
function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "<" || c === "(" || c === "{" || c === "[") depth += 1;
    else if (c === ">" || c === ")" || c === "}" || c === "]") depth -= 1;
    else if (c === "," && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

const targetKey = (t: RelationTarget): string => ("symbol" in t ? `#${t.symbol}` : `${t.module}\u0000${t.name}\u0000${t.member ?? ""}`);

/**
 * The relations of one file's definitions. `symbols` are what {@link extractSymbols} returned for the same
 * `path` and `content` (relations point into it by index). Empty for a language this does not read.
 */
export function extractSymbolRelations(path: string, content: string, symbols: readonly CodeSymbol[]): SymbolRelation[] {
  if (!relationsSupported(path) || symbols.length === 0) return [];
  const raw = content.split(/\r?\n/);
  const code = maskCode(raw);
  const brace = code.map(braces);
  const imports = importsOf(raw, code);
  const n = code.length;

  // ── Who owns each line: the innermost definition whose body it is in (-1: none) ─────────────────────────
  const owner = new Int32Array(n).fill(-1);
  const topLevel = symbols.map((s, i) => [s, i] as const).filter(([s]) => !s.container);
  const spanEnd = new Map<number, number>();
  topLevel.forEach(([s, i], k) => {
    // Up to the next definition at most, and only to the end of this one's body: the line where its braces close,
    // or (a braceless `const f = (a) => g(a);`) the line that ends the statement. Top-level code after it owns nothing.
    const limit = Math.min(n, k + 1 < topLevel.length ? topLevel[k + 1]![0].line - 1 : n);
    let depth = 0, opened = false, end = limit;
    for (let l = s.line - 1; l < limit; l += 1) {
      owner[l] = i;
      depth += brace[l]!.delta; opened ||= brace[l]!.opens;
      if ((opened && depth <= 0) || (!opened && depth <= 0 && /;\s*$/.test(code[l]!))) { end = l + 1; break; }
    }
    spanEnd.set(i, end);
  });
  const classOf = new Map<string, number>(); // class name → its top-level symbol
  const typeByName = new Map<string, number>();
  const callableByName = new Map<string, number>();
  for (const [s, i] of topLevel) {
    if (s.kind === "class") classOf.set(s.name, i);
    if (TYPE_KINDS.has(s.kind)) typeByName.set(s.name, i);
    if (CALLABLE_KINDS.has(s.kind)) callableByName.set(s.name, i);
  }
  const methodOf = new Map<string, number>(); // `Class.method` → its symbol
  symbols.forEach((s, i) => { if (s.container && s.kind === "method" && !methodOf.has(`${s.container}.${s.name}`)) methodOf.set(`${s.container}.${s.name}`, i); });
  const symbolAtLine = new Map<number, number[]>();
  symbols.forEach((s, i) => (symbolAtLine.get(s.line - 1) ?? symbolAtLine.set(s.line - 1, []).get(s.line - 1)!).push(i));

  // Class bodies: brace depth 1 is a member line; a method owns the lines of its body. `paren` is the open `(` of
  // the member-level lines: a line inside a multi-line parameter list (`async find(\n  id: string,\n): … {`) is a
  // parameter, never a field, and a method's signature ends only once its list is closed (a `{ … }` type-literal
  // parameter must not end it).
  const fieldLines = new Map<number, number[]>(); // class symbol → its depth-1 lines (not a method's)
  for (const [s, ci] of topLevel) {
    if (s.kind !== "class") continue;
    const end = spanEnd.get(ci)!;
    let depth = 0, method = -1, opened = false, paren = 0;
    const fields: number[] = [];
    for (let l = s.line - 1; l < end && l < n; l += 1) {
      const startDepth = depth;
      const line = code[l]!;
      if (method < 0 && startDepth === 1) {
        const m = (symbolAtLine.get(l) ?? []).find((i) => symbols[i]!.container === s.name);
        if (m !== undefined) { method = m; opened = false; paren = 0; } else if (l !== s.line - 1 && paren <= 0) fields.push(l);
      }
      if (startDepth === 1) paren += parens(line);
      depth += brace[l]!.delta; opened ||= brace[l]!.opens;
      if (method >= 0) {
        owner[l] = method;
        // A body ends when the depth is back at the member level; a signature without a body ends on its line.
        if (paren <= 0 && ((opened && depth <= 1) || (!opened && /;\s*$/.test(line)))) { method = -1; paren = 0; }
      }
      if (depth <= 0 && l > s.line - 1 && opened) break;
    }
    fieldLines.set(ci, fields);
  }

  // ── Resolution of a name as written ──────────────────────────────────────────────────────────────────
  const resolveType = (name: string): RelationTarget | undefined => {
    const dot = name.indexOf(".");
    if (dot > 0) {
      const ns = imports.get(name.slice(0, dot));
      return ns?.namespace ? { module: ns.module, name: name.slice(dot + 1) } : undefined;
    }
    const local = typeByName.get(name);
    if (local !== undefined) return { symbol: local };
    const imp = imports.get(name);
    return imp && !imp.namespace ? { module: imp.module, name: imp.name } : undefined;
  };
  /** `Type.member` where Type is local (its method) or imported (the member of the imported name). */
  const resolveMember = (type: string, member: string): RelationTarget | undefined => {
    const method = methodOf.get(`${type}.${member}`);
    if (method !== undefined) return { symbol: method };
    if (classOf.has(type)) return undefined; // a local class without that method: inherited or dynamic
    const imp = imports.get(type);
    if (!imp) return undefined;
    return imp.namespace ? { module: imp.module, name: member } : { module: imp.module, name: imp.name, member };
  };

  /** `new X(…).m(`: X's method `m` (local or imported), or the local class X itself when it has no own `m`. */
  const constructedCall = (type: string, member: string): RelationTarget | undefined => {
    const dot = type.indexOf(".");
    if (dot > 0) {
      const ns = imports.get(type.slice(0, dot));
      return ns?.namespace ? { module: ns.module, name: type.slice(dot + 1), member } : undefined;
    }
    const hit = resolveMember(type, member);
    if (hit) return hit;
    const cls = classOf.get(type);
    return cls !== undefined ? { symbol: cls } : undefined;
  };
  const jsxFile = JSX_FILE.test(path);

  // ── Collect, one relation per (from, target, kind) ───────────────────────────────────────────────────
  const byKey = new Map<string, SymbolRelation>();
  const perSymbol = new Map<number, number>();
  const order: SymbolRelation[] = [];
  const add = (from: number, kind: SymbolEdgeKind, to: RelationTarget | undefined, site?: CallSite): void => {
    if (!to || ("symbol" in to && to.symbol === from)) return;
    const key = `${from}\u0000${kind}\u0000${targetKey(to)}`;
    const prior = byKey.get(key);
    if (prior) { if (site) prior.sites!.push(site); return; }
    const count = perSymbol.get(from) ?? 0;
    if (count >= MAX_SYMBOL_EDGES_PER_SYMBOL || order.length >= MAX_RELATIONS_PER_FILE) return;
    perSymbol.set(from, count + 1);
    const rel: SymbolRelation = { from, kind, to, ...(site ? { sites: [site] } : {}) };
    byKey.set(key, rel);
    order.push(rel);
  };

  /** The type names in `text`: a local type, or a Capitalised imported name (`ns.Type` too). A value import is not a type. */
  // The names that CAN be a type here; a line's names are read once (a hand scan) and looked up.
  const typeNames = new Set([...typeByName.keys(), ...[...imports].filter(([local, imp]) => !imp.namespace && /^[A-Z]/.test(local)).map(([local]) => local)]);
  const namespaces = new Set([...imports].filter(([, imp]) => imp.namespace).map(([local]) => local));
  const typesIn = (text: string): string[] => {
    const out: string[] = [];
    if (typeNames.size === 0 && namespaces.size === 0) return out;
    for (let i = 0; i < text.length;) {
      if (!isIdChar(text.charCodeAt(i))) { i += 1; continue; }
      const startsName = i === 0 || (text[i - 1] !== "." && !isIdChar(text.charCodeAt(i - 1)));
      let e = i;
      while (e < text.length && isIdChar(text.charCodeAt(e))) e += 1;
      if (startsName) {
        const name = text.slice(i, e);
        if (typeNames.has(name)) out.push(name);
        else if (namespaces.has(name) && text[e] === ".") {
          let m = e + 1;
          while (m < text.length && isIdChar(text.charCodeAt(m))) m += 1;
          const member = text.slice(e + 1, m);
          if (/^[A-Z]/.test(member)) out.push(`${name}.${member}`);
        }
      }
      i = e;
    }
    return out;
  };

  // Headers: extends / implements.
  for (const [s, i] of topLevel) {
    if (s.kind !== "class" && s.kind !== "interface") continue;
    const header = headerOf(code.slice(s.line - 1, Math.min(n, s.line + 5)).join(" "), s.name);
    if (s.kind === "class") {
      const ext = /\bextends\s+(.+?)(?:\bimplements\b|$)/.exec(header)?.[1];
      const base = ext ? leadingType(ext) : undefined;
      if (base) add(i, "extends", resolveType(base));
      const impl = /\bimplements\s+(.+)$/.exec(header)?.[1];
      for (const t of impl ? splitTopLevel(impl) : []) { const name = leadingType(t); if (name) add(i, "implements", resolveType(name)); }
    } else {
      const ext = /\bextends\s+(.+)$/.exec(header)?.[1];
      for (const t of ext ? splitTopLevel(ext) : []) { const name = leadingType(t); if (name) add(i, "extends", resolveType(name)); }
    }
  }

  // Composition: field types, field `new X()`, constructor parameter properties. Field → type, for `this.field.m()`.
  const fieldType = new Map<number, Map<string, string>>();
  for (const [s, ci] of topLevel) {
    if (s.kind !== "class") continue;
    const types = new Map<string, string>();
    for (const l of fieldLines.get(ci) ?? []) {
      const line = code[l]!;
      const f = FIELD.exec(line);
      if (f) {
        for (const t of typesIn(f[2]!)) add(ci, "composes", resolveType(t));
        const lead = leadingType(f[2]!);
        if (lead) types.set(f[1]!, lead);
      }
      const nw = NEW.exec(line);
      if (nw) {
        add(ci, "composes", resolveType(nw[1]!));
        const name = FIELD_INIT.exec(line)?.[1];
        if (name && !types.has(name)) types.set(name, nw[1]!);
      }
    }
    const ctor = methodOf.get(`${s.name}.constructor`);
    const ctorLine = ctor !== undefined ? symbols[ctor]!.line - 1 : -1;
    const end = spanEnd.get(ci)!;
    const start = ctorLine >= 0 ? ctorLine : code.slice(s.line - 1, end).findIndex((x) => /^\s+constructor\s*\(/.test(x)) + s.line - 1;
    if (start >= s.line - 1 && start < n) {
      let sig = "";
      for (let l = start; l < Math.min(end, start + 20); l += 1) { sig += ` ${code[l]}`; if (code[l]!.includes("{")) break; }
      for (const m of sig.matchAll(PARAM_PROP)) { add(ci, "composes", resolveType(m[2]!)); types.set(m[1]!, m[2]!); }
    }
    fieldType.set(ci, types);
  }

  // Locals: the names a body binds itself (its parameters, const/let/var, nested function/class, catch). A call of one
  // is a call of the local, never of the file's or an import's same-named definition (counted in `order`, no edge).
  const locals = new Map<number, Set<string>>();
  for (let l = 0; l < n; l += 1) {
    const from = owner[l]!;
    if (from < 0) continue;
    const line = code[l]!;
    const own = symbols[from]!;
    let set = locals.get(from);
    if (!set) locals.set(from, (set = new Set()));
    for (const m of line.matchAll(LOCAL_DECL)) if (!(l === own.line - 1 && m[1] === own.name)) set.add(m[1]!);
    for (const m of line.matchAll(DESTRUCTURE)) for (const p of m[1]!.split(",")) { const id = LAST_ID.exec(p)?.[1]; if (id) set.add(id); }
    if (l === own.line - 1 && own.kind === "function" && isCallbackOwnerName(own.name)) {
      // A callback owner (symbols.ts): its parameters are the callback's, the last list before its body's `{`.
      const m = CALLBACK_PARAMS.exec(line);
      for (const p of (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").split(",")) {
        const id = PARAM_NAME.exec(p)?.[1];
        if (id) set.add(id);
      }
    } else if (l === own.line - 1 && (own.kind === "function" || own.kind === "method" || own.kind === "const")) {
      const open = line.indexOf("(", line.indexOf(own.name) + own.name.length);
      const close = open >= 0 ? line.indexOf(")", open) : -1;
      for (const p of open >= 0 ? line.slice(open + 1, close >= 0 ? close : undefined).split(",") : []) {
        const id = PARAM_NAME.exec(p)?.[1];
        if (id) set.add(id);
      }
    }
  }

  // Bodies: calls (with sites and order) and type uses.
  const calls = new Map<number, number>(); // caller → calls counted so far
  for (let l = 0; l < n; l += 1) {
    const from = owner[l]!;
    if (from < 0) continue;
    const line = code[l]!;
    if (!/[A-Za-z_$]/.test(line)) continue;
    const declared = new Set((symbolAtLine.get(l) ?? []).map((i) => symbols[i]!.name));
    const fromSym = symbols[from]!;
    const cls = fromSym.container ?? (fromSym.kind === "class" ? fromSym.name : undefined);
    const clsIndex = cls !== undefined ? classOf.get(cls) : undefined;
    const jsx = jsxFile && line.includes("<") ? jsxCallsIn(line) : [];
    const lineCalls = jsx.length ? [...callsIn(line), ...jsx].sort((a, b) => a.start - b.start || a.column - b.column) : callsIn(line);
    for (const call of lineCalls) {
      const { parts, name } = call;
      const before = line.slice(0, call.start);
      if (!call.jsx) {
        if (/\bnew\s+$/.test(before)) continue; // construction: a use of the type, below
        if (parts?.length === 0 && (NOT_CALLS.has(name) || declared.has(name) || /\bfunction\s*\*?\s*$/.test(before))) continue;
      }
      const k = calls.get(from) ?? 0;
      calls.set(from, k + 1);
      const site: CallSite = { path, line: l + 1, column: call.column + 1, order: k };
      let to: RelationTarget | undefined;
      const shadowed = locals.get(from)!;
      if (!parts && call.ctor) {
        // `new X(…).m(`: X's `m`, or X itself when X is local and `m` is not its own (inherited, dynamic).
        to = shadowed.has(call.ctor.split(".")[0]!) ? undefined : constructedCall(call.ctor, name);
      } else if (!parts) {
        to = undefined; // `f().g()`, `a[0].g()`: a receiver no name types
      } else if (call.jsx && parts.length === 0) {
        // `<Comp`: the component the file defines (a function, a const, a class) or imports; a local binding is none.
        const local = shadowed.has(name) ? undefined : callableByName.get(name) ?? classOf.get(name);
        const imp = shadowed.has(name) ? undefined : imports.get(name);
        to = local !== undefined ? { symbol: local } : imp && !imp.namespace ? { module: imp.module, name: imp.name } : undefined;
      } else if ((parts.length === 0 && shadowed.has(name)) || (parts.length > 0 && parts[0] !== "this" && shadowed.has(parts[0]!))) {
        to = undefined; // a local of the same name: not the file's definition nor the import
      } else if (parts.length === 0) {
        const local = callableByName.get(name);
        const imp = imports.get(name);
        to = local !== undefined ? { symbol: local } : imp && !imp.namespace ? { module: imp.module, name: imp.name } : undefined;
      } else if (parts.length === 1 && parts[0] === "this") {
        const method = cls !== undefined ? methodOf.get(`${cls}.${name}`) : undefined;
        to = method !== undefined ? { symbol: method } : undefined;
      } else if (parts.length === 2 && parts[0] === "this" && clsIndex !== undefined) {
        const type = fieldType.get(clsIndex)?.get(parts[1]!);
        to = type ? resolveMember(type, name) : undefined;
      } else if (parts.length === 1 && parts[0] !== "super") {
        to = resolveMember(parts[0]!, name);
      }
      add(from, "calls", to, site);
    }
    for (const t of typesIn(jsxFile && line.includes("<") ? withoutJsxTags(line) : line)) {
      if (t === fromSym.name || t === cls) continue;
      add(from, "uses", resolveType(t));
    }
  }

  // `uses` only where no stronger relation links the same pair; sites in source order, capped.
  const strong = new Set(order.filter((r) => r.kind !== "uses" && r.kind !== "calls").map((r) => `${r.from}\u0000${targetKey(r.to)}`));
  const out = order.filter((r) => r.kind !== "uses" || !strong.has(`${r.from}\u0000${targetKey(r.to)}`));
  for (const r of out) {
    if (!r.sites) continue;
    r.count = r.sites.length;
    r.sites = r.sites.sort((a, b) => a.order - b.order).slice(0, MAX_CALL_SITES_PER_EDGE);
  }
  return out;
}
