/**
 * Safe evaluation primitives for the ETL workflow nodes (transform / filter /
 * branch) executed by the cloud workflow runtime (`cloudExecutor.ts`).
 *
 * Dependency-free and WITHOUT `eval`/`Function`: a tiny hand-written tokenizer +
 * recursive evaluator over a JSON context derived from the upstream node's
 * output text. This is what turns those ETL kinds from "payload pass-through"
 * into real shape/predicate logic, while staying sandbox-safe (no host access,
 * no arbitrary code execution).
 *
 * Grammar (intentionally small — matches the builder's field hints, e.g.
 * `status == "ready"`):
 *
 *   predicate := or
 *   or        := and ( '||' and )*
 *   and       := cmp ( '&&' cmp )*
 *   cmp       := operand ( ('=='|'!='|'>'|'>='|'<'|'<='|'contains') operand )?
 *   operand   := string | number | boolean | null | path
 *   path      := ident ( '.' ident | '[' number ']' )*
 *
 * A bare operand (no comparison) is truthy by JS truthiness of its resolved
 * value. The context exposes the upstream payload's top-level fields directly
 * (when it is a JSON object), plus `input` (the raw text) and `$` (the parsed
 * value) so a scalar/array payload is still addressable.
 */

export type ExprContext = Record<string, unknown>;

/**
 * Build an evaluation context from an upstream node's output text.
 * - JSON object  → its fields, plus `input` (raw text) and `$` (the object).
 * - JSON scalar/array → `{ input: <value>, $: <value> }`.
 * - non-JSON text → `{ input: <text>, $: <text> }`.
 */
export function contextFromInput(inputText: string): ExprContext {
  const text = inputText ?? '';
  try {
    const v = JSON.parse(text) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return { ...(v as Record<string, unknown>), input: text, $: v };
    }
    return { input: v, $: v };
  } catch {
    return { input: text, $: text };
  }
}

/** Resolve a dotted/bracketed path (`a.b[0].c`) against the context. */
function resolvePath(ctx: ExprContext, path: string): unknown {
  // Normalize `a[0].b` → `a.0.b`, then walk.
  const parts = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((p) => p.length > 0);
  let cur: unknown = ctx;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

// --- tokenizer -------------------------------------------------------------

type Token =
  | { t: 'str'; v: string }
  | { t: 'num'; v: number }
  | { t: 'bool'; v: boolean }
  | { t: 'null' }
  | { t: 'path'; v: string }
  | { t: 'op'; v: '==' | '!=' | '>=' | '<=' | '>' | '<' | 'contains' }
  | { t: 'and' }
  | { t: 'or' };

const OPERATORS = ['==', '!=', '>=', '<=', '>', '<'] as const;

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = src;
  while (i < s.length) {
    const c = s[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    // String literal (single or double quoted).
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let out = '';
      while (j < s.length && s[j] !== quote) {
        if (s[j] === '\\' && j + 1 < s.length) {
          out += s[j + 1];
          j += 2;
        } else {
          out += s[j];
          j++;
        }
      }
      tokens.push({ t: 'str', v: out });
      i = j + 1;
      continue;
    }
    // Logical operators.
    if (s.startsWith('&&', i)) {
      tokens.push({ t: 'and' });
      i += 2;
      continue;
    }
    if (s.startsWith('||', i)) {
      tokens.push({ t: 'or' });
      i += 2;
      continue;
    }
    // Comparison operators (longest first).
    const op = OPERATORS.find((o) => s.startsWith(o, i));
    if (op) {
      tokens.push({ t: 'op', v: op });
      i += op.length;
      continue;
    }
    // Number.
    if ((c >= '0' && c <= '9') || (c === '-' && /[0-9]/.test(s[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < s.length && /[0-9.]/.test(s[j]!)) j++;
      tokens.push({ t: 'num', v: Number(s.slice(i, j)) });
      i = j;
      continue;
    }
    // Identifier / path / keyword.
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_$.[\]]/.test(s[j]!)) j++;
      const word = s.slice(i, j);
      i = j;
      if (word === 'true' || word === 'false') tokens.push({ t: 'bool', v: word === 'true' });
      else if (word === 'null') tokens.push({ t: 'null' });
      else if (word === 'contains') tokens.push({ t: 'op', v: 'contains' });
      else if (word === 'and') tokens.push({ t: 'and' });
      else if (word === 'or') tokens.push({ t: 'or' });
      else tokens.push({ t: 'path', v: word });
      continue;
    }
    // Unknown char — skip it (defensive; never throw on author input).
    i++;
  }
  return tokens;
}

function operandValue(tok: Token, ctx: ExprContext): unknown {
  switch (tok.t) {
    case 'str':
      return tok.v;
    case 'num':
      return tok.v;
    case 'bool':
      return tok.v;
    case 'null':
      return null;
    case 'path':
      return resolvePath(ctx, tok.v);
    default:
      return undefined;
  }
}

function compare(op: string, a: unknown, b: unknown): boolean {
  switch (op) {
    case '==':
      // Loose, string-normalized equality so `1 == "1"` and `"ready" == ready` hold.
      return String(a) === String(b) || a === b;
    case '!=':
      return !(String(a) === String(b) || a === b);
    case '>':
      return Number(a) > Number(b);
    case '>=':
      return Number(a) >= Number(b);
    case '<':
      return Number(a) < Number(b);
    case '<=':
      return Number(a) <= Number(b);
    case 'contains':
      if (Array.isArray(a)) return a.map(String).includes(String(b));
      return String(a ?? '').includes(String(b ?? ''));
    default:
      return false;
  }
}

/**
 * Evaluate a boolean predicate string against a context.
 * Empty / whitespace-only predicate → `true` (no filtering).
 * Any parse ambiguity resolves conservatively (a bare unknown path is falsy).
 */
export function evaluateBool(predicate: string, ctx: ExprContext): boolean {
  const expr = (predicate ?? '').trim();
  if (!expr) return true;
  const tokens = tokenize(expr);
  if (tokens.length === 0) return true;

  // Split on `||` (lowest precedence), then on `&&`.
  const orGroups: Token[][] = [[]];
  for (const tk of tokens) {
    if (tk.t === 'or') orGroups.push([]);
    else orGroups[orGroups.length - 1]!.push(tk);
  }

  const evalAndGroup = (group: Token[]): boolean => {
    const andGroups: Token[][] = [[]];
    for (const tk of group) {
      if (tk.t === 'and') andGroups.push([]);
      else andGroups[andGroups.length - 1]!.push(tk);
    }
    return andGroups.every((cmp) => {
      const left = cmp[0];
      if (!left) return true;
      const opTok = cmp[1];
      const right = cmp[2];
      if (cmp.length >= 3 && opTok && opTok.t === 'op' && right) {
        return compare(opTok.v, operandValue(left, ctx), operandValue(right, ctx));
      }
      // Bare operand → JS truthiness of its resolved value.
      return Boolean(operandValue(left, ctx));
    });
  };

  return orGroups.some((g) => evalAndGroup(g));
}

/** Stringify a resolved value for emission as a node's text output. */
function emit(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

/**
 * Render a `transform` expression against a context.
 * - empty expression           → pass the raw input text through unchanged.
 * - contains `{{ path }}` spans → template substitution of each span.
 * - otherwise (a bare path)     → the resolved value, stringified ('' if absent).
 */
export function renderTransform(expression: string, inputText: string, ctx: ExprContext): string {
  const expr = (expression ?? '').trim();
  if (!expr) return inputText;
  if (expr.includes('{{')) {
    return expr.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, path: string) => emit(resolvePath(ctx, path.trim())));
  }
  const resolved = resolvePath(ctx, expr);
  return resolved === undefined ? '' : emit(resolved);
}
