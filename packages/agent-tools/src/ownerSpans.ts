/**
 * ownerSpans.ts — which definition owns each line of a JS/TS file, for the symbol relations (`symbolRelations.ts`):
 * a top-level definition owns its lines up to where its braces close (or its braceless statement ends), and inside a
 * class a method owns the lines of its body; the class's other member-level lines are its fields. Pure.
 */

import { braces, parens } from "./callScan.js";
import type { CodeSymbol } from "./symbols.js";

export interface OwnerSpans {
  /** Per line (0-based): the innermost definition whose body it is in, or -1. */
  owner: Int32Array;
  /** The definitions without a container, with their index. */
  topLevel: Array<readonly [CodeSymbol, number]>;
  /** Top-level definition → the line (0-based, exclusive) its span ends at. */
  spanEnd: Map<number, number>;
  /** Class definition → its member-level lines that no method owns (its fields). */
  fieldLines: Map<number, number[]>;
  /** Line (0-based) → the definitions declared on it. */
  symbolAtLine: Map<number, number[]>;
}

/** The owners of `code` (masked lines) for `symbols` (what `extractSymbols` returned for the same file). */
export function ownerSpans(code: readonly string[], symbols: readonly CodeSymbol[]): OwnerSpans {
  const n = code.length;
  const brace = code.map(braces);
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
  const symbolAtLine = new Map<number, number[]>();
  symbols.forEach((s, i) => (symbolAtLine.get(s.line - 1) ?? symbolAtLine.set(s.line - 1, []).get(s.line - 1)!).push(i));

  // Class bodies: brace depth 1 is a member line; a method owns the lines of its body. `paren` is the open `(` of
  // the member-level lines: a line inside a multi-line parameter list (`async find(\n  id: string,\n): … {`) is a
  // parameter, never a field, and a method's signature ends only once its list is closed (a `{ … }` type-literal
  // parameter must not end it).
  const fieldLines = new Map<number, number[]>();
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
  return { owner, topLevel, spanEnd, fieldLines, symbolAtLine };
}
