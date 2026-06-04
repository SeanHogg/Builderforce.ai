/**
 * Safe, dependency-free evaluators for the builder's ETL nodes
 * (transform / filter / branch).
 *
 * No `eval`/`Function` — a tiny predicate grammar is tokenised and walked, so a
 * user-authored expression can never execute arbitrary code. The evaluable
 * context is a flat string→primitive map (the node sees `input` = the upstream
 * payload plus `length`), which is all the ETL nodes need.
 */

export type EvalContext = Record<string, string | number | boolean>;

type Cmp = '==' | '!=' | '>=' | '<=' | '>' | '<' | 'contains' | 'matches';
const CMPS: Cmp[] = ['==', '!=', '>=', '<=', '>', '<', 'contains', 'matches'];

/** Resolve a token to a concrete value: quoted string, number, boolean, or a
 *  context variable. Unknown bare words resolve to the empty string. */
function resolve(token: string, ctx: EvalContext): string | number | boolean {
  const t = token.trim();
  if (t === '') return '';
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (Object.prototype.hasOwnProperty.call(ctx, t)) return ctx[t]!;
  return '';
}

/** Evaluate a single `lhs <op> rhs` comparison. */
function evalComparison(expr: string, ctx: EvalContext): boolean {
  for (const op of CMPS) {
    // Pad word operators so we don't split inside identifiers.
    const needle = op === 'contains' || op === 'matches' ? ` ${op} ` : op;
    const idx = expr.indexOf(needle);
    if (idx === -1) continue;
    const lhs = resolve(expr.slice(0, idx), ctx);
    const rhs = resolve(expr.slice(idx + needle.length), ctx);
    switch (op) {
      case '==': return lhs === rhs;
      case '!=': return lhs !== rhs;
      case '>=': return Number(lhs) >= Number(rhs);
      case '<=': return Number(lhs) <= Number(rhs);
      case '>':  return Number(lhs) > Number(rhs);
      case '<':  return Number(lhs) < Number(rhs);
      case 'contains': return String(lhs).includes(String(rhs));
      case 'matches':  { try { return new RegExp(String(rhs)).test(String(lhs)); } catch { return false; } }
    }
  }
  // No operator → truthiness of the single resolved term.
  const v = resolve(expr, ctx);
  return v !== '' && v !== false && v !== 0;
}

/**
 * Evaluate a predicate: comparisons joined by `&&` / `||` (left-to-right, `&&`
 * binds tighter via the standard precedence below). Empty predicate → true
 * (an unconfigured filter passes everything).
 */
export function evalPredicate(predicate: string, ctx: EvalContext): boolean {
  const expr = predicate.trim();
  if (!expr) return true;
  // OR of ANDs.
  return expr
    .split('||')
    .some((clause) => clause.split('&&').every((c) => evalComparison(c.trim(), ctx)));
}

/**
 * Render a transform expression: `{{var}}` placeholders are substituted from the
 * context. A bare expression with no placeholders is returned verbatim, and an
 * empty expression passes the input through unchanged.
 */
export function applyTransform(expression: string, ctx: EvalContext): string {
  const expr = expression?.trim() ?? '';
  if (!expr) return String(ctx.input ?? '');
  return expr.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, name: string) =>
    Object.prototype.hasOwnProperty.call(ctx, name) ? String(ctx[name]) : '',
  );
}

/** Build the evaluation context an ETL node sees from its upstream payload. */
export function etlContext(input: string, config: Record<string, unknown>): EvalContext {
  const ctx: EvalContext = { input, length: input.length };
  for (const [k, v] of Object.entries(config)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') ctx[k] = v;
  }
  return ctx;
}
