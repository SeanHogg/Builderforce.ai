/**
 * callScan.ts — the line-level scans of the symbol relations (`symbolRelations.ts`): masking, brace and paren
 * counts, the calls of a line (`f(`, `a.b.c(`, `f<T>(`, `new X(…).m(`) and its JSX component renders (`<Comp`).
 * Hand scans over masked lines (comments, strings and regex literals blanked, columns kept): each `(` and `<` is read
 * once, so a line costs linear time. Lines longer than {@link MAX_SCANNED_LINE} (minified bundles, data) are not scanned.
 * Pure.
 */

import { maskSource } from "./knowledge/codeMask.js";

export const ID = "[A-Za-z_$][\\w$]*";

/** A line longer than this is never scanned for calls, renders or callback owners (a minified bundle, a data blob). */
export const MAX_SCANNED_LINE = 2048;

export const isIdChar = (c: number): boolean =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36;
export const isSpace = (c: number): boolean => c === 32 || c === 9;

/**
 * The file's lines with comments, strings and regex literals blanked (columns and line breaks kept): the code pack's
 * ONE masker (`maskSource(…, 'js').bare`), so a regex literal holding `(` or `{` is no call and no brace.
 */
export function maskLines(content: string): string[] {
  return maskSource(content, "js").bare.split(/\r?\n/);
}

/** The `{` minus `}` of a (masked) line, and whether it opens one. */
export function braces(line: string): { delta: number; opens: boolean } {
  let delta = 0, opens = false;
  for (let i = line.indexOf("{"); i >= 0; i = line.indexOf("{", i + 1)) { delta += 1; opens = true; }
  for (let i = line.indexOf("}"); i >= 0; i = line.indexOf("}", i + 1)) delta -= 1;
  return { delta, opens };
}

/** The `(` minus `)` of a (masked) line. */
export function parens(line: string): number {
  let delta = 0;
  for (let i = line.indexOf("("); i >= 0; i = line.indexOf("(", i + 1)) delta += 1;
  for (let i = line.indexOf(")"); i >= 0; i = line.indexOf(")", i + 1)) delta -= 1;
  return delta;
}

export interface CallAt {
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

/** What never appears between a generic call's `<` and `>`: comparison and arithmetic operators, a call. */
const NOT_TYPE_ARGS = /&&|\|\||[=!]=|[<>]=|[+\-*/%()]|^\s|\s$/;

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

/**
 * `new X(` / `new ns.X(` / `new X<T>(` ending just before the `(` at `open`: the class name and where `new` starts.
 * A backward hand scan from `open` (constant work per call, not a regex over the line's prefix).
 */
function constructedAt(line: string, open: number): { ctor: string; start: number } | undefined {
  let j = open - 1;
  while (j >= 0 && isSpace(line.charCodeAt(j))) j -= 1;
  if (line[j] === ">") {
    let depth = 0;
    for (; j >= 0; j -= 1) {
      const c = line[j];
      if (c === ">") depth += 1;
      else if (c === "<" && --depth === 0) { j -= 1; break; }
      else if (c === "(" || c === ")") return undefined;
    }
    while (j >= 0 && isSpace(line.charCodeAt(j))) j -= 1;
  }
  const end = j + 1;
  while (j >= 0 && (isIdChar(line.charCodeAt(j)) || line[j] === ".")) j -= 1;
  const name = line.slice(j + 1, end);
  if (!name || !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?$/.test(name)) return undefined;
  let k = j;
  if (k < 0 || !isSpace(line.charCodeAt(k))) return undefined;
  while (k >= 0 && isSpace(line.charCodeAt(k))) k -= 1;
  if (k < 2 || line.slice(k - 2, k + 1) !== "new" || (k >= 3 && isIdChar(line.charCodeAt(k - 3)))) return undefined;
  return { ctor: name, start: k - 2 };
}

/**
 * The calls in one masked line, left to right: every `(` preceded by a name (optionally `?.`, optionally `<…>` type
 * arguments), with that name's receiver chain read backwards. A hand scan, not a regex: it reads each `(` once.
 */
export function callsIn(line: string): CallAt[] {
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
          const made = open > 0 ? constructedAt(line, open) : undefined;
          if (made) { ctor = made.ctor; start = made.start; }
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

/** Files whose `<Name` is JSX (a `.ts` file's `<T>x` is a type assertion). */
export const JSX_FILE = /\.(?:tsx|jsx|js|mjs|cjs)$/i;
/** A JSX element's tag that names a component (capitalised; `<div` is an intrinsic element and names nothing). */
const JSX_TAG = new RegExp(`<(\\/?)([A-Z][\\w$]*(?:\\.${ID})*)(?=[\\s/>]|$)`, "g");

/**
 * The component elements of one masked line: `<Comp` and `<ns.Comp`, where the `<` follows no name, `)`, `]` or `.`
 * (`Array<Foo>`, `useState<Row>(` are type arguments). A generic arrow's type parameters are no element either:
 * `<T extends X>`, `<T,>` and `<T>(` (a `<Name>` directly followed by `(`). `closing` marks a `</Comp>`.
 */
export function jsxTagsIn(line: string): Array<{ name: string; column: number; start: number; closing: boolean }> {
  const out: Array<{ name: string; column: number; start: number; closing: boolean }> = [];
  if (!line.includes("<")) return out;
  for (const m of line.matchAll(JSX_TAG)) {
    const at = m.index!;
    let p = at - 1;
    while (p >= 0 && isSpace(line.charCodeAt(p))) p -= 1;
    if (p >= 0 && (isIdChar(line.charCodeAt(p)) || line[p] === ")" || line[p] === "]" || line[p] === ".")) continue;
    const start = at + 1 + m[1]!.length;
    const after = line.slice(start + m[2]!.length);
    if (/^\s*(?:extends\b|,)/.test(after) || /^>\s*\(/.test(after)) continue;
    out.push({ name: m[2]!, column: start, start, closing: m[1] === "/" });
  }
  return out;
}

/** The renders of one masked line as calls: `<Comp` → `Comp`, `<ns.Comp` → `Comp` on receiver `ns`. Closing tags are none. */
export function jsxCallsIn(line: string): CallAt[] {
  return jsxTagsIn(line).filter((t) => !t.closing).map((t) => {
    const dot = t.name.lastIndexOf(".");
    return dot < 0
      ? { name: t.name, parts: [], column: t.column, start: t.start, jsx: true }
      : { name: t.name.slice(dot + 1), parts: t.name.slice(0, dot).split("."), column: t.column + dot + 1, start: t.start, jsx: true };
  });
}

/** The line with its JSX component tags blanked (columns kept), so a render is not also read as a type `uses`. */
export function withoutJsxTags(line: string): string {
  let out = line;
  for (const t of jsxTagsIn(line)) out = out.slice(0, t.start) + " ".repeat(t.name.length) + out.slice(t.start + t.name.length);
  return out;
}
