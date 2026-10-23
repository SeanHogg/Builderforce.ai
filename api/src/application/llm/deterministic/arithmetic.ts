/**
 * Arithmetic without a model (cost lever D7): "what is 12 * (3 + 4)", "2^10",
 * "15% of 80".
 *
 * A small recursive-descent parser — never `eval`/`Function` — over numbers,
 * + − × ÷ (also * / x), ^ / ** and parentheses. The WHOLE message must be the
 * expression (optionally behind "what is" / "calculate" / "compute" / "evaluate" and
 * before "=" or "?"), with at least one operator. Declines anything that merely looks
 * like arithmetic: dates (2026-10-22, 10/22/2026), phone-style digit runs (555-1234),
 * a bare "%" (modulo or percent?), division by zero, a non-finite result, or an
 * expression too long to be a question.
 */

import { formatNumber, normalizeQuestion, type DeterministicAnswer, type DeterministicHandler } from './types';

const MAX_EXPRESSION_CHARS = 160;
const MAX_TOKENS = 64;
const MAX_EXPONENT = 1_000;

type Op = '+' | '-' | '*' | '/' | '^' | '(' | ')';
type Token = { kind: 'num'; value: number } | { kind: 'op'; value: Op };

/** Operator spellings. `x` is multiplication only between spaces ("3 x 4"), so a hex
 *  literal ("0x10") never reads as 0 × 10. */
const OPS: Readonly<Record<string, Op>> = { '+': '+', '-': '-', '*': '*', '×': '*', '/': '/', '÷': '/', '^': '^', '(': '(', ')': ')' };

const PREFIX = /^(?:what(?:'s| is)|whats|calculate|compute|evaluate)\s+/;
const SUFFIX = /\s*=\s*$/;
const ALLOWED = /^[\d\s.,+\-*/×÷x^()]+$/;
/** Shapes that are digits and separators but not arithmetic anyone asked for. */
const NOT_ARITHMETIC = [
  /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/, // a date
  /^\d+(?:-\d+){2,}$/,                  // 555-123-4567, 2026-10-22
  /^\d{3}-\d{4}$/,                      // 555-1234
];

function tokenize(expr: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i]!;
    if (ch === ' ') { i += 1; continue; }
    const num = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|^\.\d+/.exec(expr.slice(i));
    if (num) {
      // Two numbers in a row ("1.2.3", "12 34") is not an expression.
      if (tokens.at(-1)?.kind === 'num') return null;
      tokens.push({ kind: 'num', value: Number(num[0].replace(/,/g, '')) });
      i += num[0].length;
      continue;
    }
    if (expr.startsWith('**', i)) { tokens.push({ kind: 'op', value: '^' }); i += 2; continue; }
    const op: Op | undefined = ch === 'x' ? (expr[i - 1] === ' ' && expr[i + 1] === ' ' ? '*' : undefined) : OPS[ch];
    if (!op) return null;
    tokens.push({ kind: 'op', value: op });
    i += 1;
  }
  return tokens.length <= MAX_TOKENS ? tokens : null;
}

/** expr := term (('+'|'-') term)* ; term := unary (('*'|'/') unary)* ;
 *  unary := ('+'|'-') unary | power ; power := primary ('^' unary)? ; primary := num | '(' expr ')' */
function evaluate(tokens: readonly Token[]): number | null {
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const isOp = (v: string): boolean => { const t = peek(); return t?.kind === 'op' && t.value === v; };
  const fail = (): never => { throw new SyntaxError('not an expression'); };

  const primary = (): number => {
    const t = peek();
    if (t?.kind === 'num') { pos += 1; return t.value; }
    if (isOp('(')) {
      pos += 1;
      const v = expr();
      if (!isOp(')')) fail();
      pos += 1;
      return v;
    }
    return fail();
  };
  const power = (): number => {
    const base = primary();
    if (!isOp('^')) return base;
    pos += 1;
    const exponent = unary();
    if (Math.abs(exponent) > MAX_EXPONENT) fail();
    return base ** exponent;
  };
  const unary = (): number => {
    if (isOp('-')) { pos += 1; return -unary(); }
    if (isOp('+')) { pos += 1; return unary(); }
    return power();
  };
  const term = (): number => {
    let v = unary();
    while (isOp('*') || isOp('/')) {
      const op = (peek() as { value: string }).value;
      pos += 1;
      const rhs = unary();
      if (op === '/' && rhs === 0) fail();
      v = op === '*' ? v * rhs : v / rhs;
    }
    return v;
  };
  const expr = (): number => {
    let v = term();
    while (isOp('+') || isOp('-')) {
      const op = (peek() as { value: string }).value;
      pos += 1;
      const rhs = term();
      v = op === '+' ? v + rhs : v - rhs;
    }
    return v;
  };

  try {
    const value = expr();
    return pos === tokens.length && Number.isFinite(value) ? value : null;
  } catch {
    // A SyntaxError from `fail()` is the parser declining — the request goes to a model.
    return null;
  }
}

/** Evaluate an arithmetic expression, or null when it is not one this parser is sure of. */
export function evaluateExpression(raw: string): number | null {
  const expr = raw.trim();
  if (!expr || expr.length > MAX_EXPRESSION_CHARS || !ALLOWED.test(expr)) return null;
  // Tested as written: spacing is the signal — "2026-10-22" is a date, "10 - 4 - 3" is arithmetic.
  if (NOT_ARITHMETIC.some((re) => re.test(expr))) return null;
  const tokens = tokenize(expr);
  if (!tokens) return null;
  // At least one BINARY operator: "-5" or "(3)" is a number, not a question.
  const binary = tokens.some((t, i) => t.kind === 'op' && ['+', '-', '*', '/', '^'].includes(t.value) && i > 0
    && (tokens[i - 1]!.kind === 'num' || (tokens[i - 1] as { value: string }).value === ')'));
  if (!binary) return null;
  return evaluate(tokens);
}

const PERCENT_OF = /^(?:what(?:'s| is)\s+|whats\s+)?(\d+(?:\.\d+)?)\s*%\s+of\s+(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)$/;

function answerArithmetic(question: string): DeterministicAnswer | null {
  const q = normalizeQuestion(question);
  const percent = PERCENT_OF.exec(q);
  if (percent) {
    const pct = Number(percent[1]);
    const of = Number(percent[2]!.replace(/,/g, ''));
    const shown = formatNumber((pct / 100) * of);
    return shown === null ? null : { handler: 'arithmetic', content: `${percent[1]}% of ${percent[2]} = ${shown}` };
  }
  const expr = q.replace(PREFIX, '').replace(SUFFIX, '');
  const value = evaluateExpression(expr);
  if (value === null) return null;
  const shown = formatNumber(value);
  return shown === null ? null : { handler: 'arithmetic', content: `${expr.trim()} = ${shown}` };
}

export const arithmeticHandler: DeterministicHandler = {
  id: 'arithmetic',
  answer: (question) => answerArithmetic(question),
};
