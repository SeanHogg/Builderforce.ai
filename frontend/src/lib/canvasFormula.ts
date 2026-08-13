/**
 * THE expression engine — one parser and one evaluator, for sheets AND for metrics.
 *
 * ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────
 * `creationObjectRegistry.ts` declared `formulas` among a `spreadsheet`'s mutable
 * fields, so the model could author them and the inspector could store them, and NOTHING
 * anywhere in the frontend ever read the field. A grep for it returned exactly one hit:
 * its own declaration. The result was a grid whose formula text was decoration — a CFO
 * could type `=SUM(C1:C12)` into the object the product offers for modelling, and the
 * cell stayed literally that string.
 *
 * A sheet without recalculation is not a model. "Set churn to 4% and show me runway" is
 * the entire reason a finance person opens a spreadsheet, and it needs three things this
 * module provides and the canvas had none of: an expression that PARSES, a dependency
 * order that decides what recomputes when an input moves, and a cycle detector so a
 * mistake reports itself instead of hanging the board.
 *
 * ── WHY ONE ENGINE AND NOT TWO ──────────────────────────────────────────────────
 * `canvasMetrics.ts` has the same missing half from the other direction: `computeMetric`
 * evaluates ONE aggregate over ONE source, so gross margin, CAC payback, net revenue
 * retention and burn multiple — every metric a CFO actually reports — are inexpressible
 * because each is arithmetic ACROSS metrics. That is the same problem as a sheet cell
 * referencing other cells, so it is the same parser: {@link parseExpression} produces one
 * AST and {@link evaluateExpression} walks it against a caller-supplied resolver. The
 * sheet resolves `A1`; the semantic layer resolves `gross_profit`. Two vocabularies, one
 * language, and a fix to operator precedence lands in both at once.
 *
 * ── WHAT AN ERROR DOES ──────────────────────────────────────────────────────────
 * Never throws to the caller and never silently yields 0. `Number('')` is 0, which is how
 * a blank cell becomes a confident wrong total — the same trap `meterValue` documents for
 * founder meters. A failed cell resolves to a typed {@link FormulaError} that propagates
 * like Excel's `#REF!`, so one broken input marks the cells that depend on it instead of
 * quietly reporting a number that is wrong by exactly that input.
 */

// ── Tokens ────────────────────────────────────────────────────────────────────────

type TokenKind = 'number' | 'string' | 'ref' | 'name' | 'op' | 'lparen' | 'rparen' | 'comma' | 'colon';
interface Token { kind: TokenKind; text: string; at: number }

const OPERATOR_TEXT = ['<>', '<=', '>=', '=', '<', '>', '+', '-', '*', '/', '^', '&', '%'] as const;

/** A1, $B$7, AA12 — the sheet's own address space. Case-insensitive, stored uppercase. */
const CELL_REF = /^\$?([A-Za-z]{1,3})\$?(\d{1,6})\b/;

function tokenize(input: string): Token[] | FormulaError {
  const tokens: Token[] = [];
  let at = 0;
  const text = input.trim();

  while (at < text.length) {
    const char = text[at];

    if (/\s/.test(char)) { at += 1; continue; }

    if (char === '(') { tokens.push({ kind: 'lparen', text: char, at }); at += 1; continue; }
    if (char === ')') { tokens.push({ kind: 'rparen', text: char, at }); at += 1; continue; }
    if (char === ',' || char === ';') { tokens.push({ kind: 'comma', text: ',', at }); at += 1; continue; }
    if (char === ':') { tokens.push({ kind: 'colon', text: char, at }); at += 1; continue; }

    if (char === '"' || char === "'") {
      const end = text.indexOf(char, at + 1);
      if (end < 0) return { error: 'PARSE', message: 'Unterminated string' };
      tokens.push({ kind: 'string', text: text.slice(at + 1, end), at });
      at = end + 1;
      continue;
    }

    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(text[at + 1] ?? ''))) {
      const match = text.slice(at).match(/^\d*\.?\d+(?:[eE][+-]?\d+)?/);
      if (!match) return { error: 'PARSE', message: `Unreadable number at ${at}` };
      tokens.push({ kind: 'number', text: match[0], at });
      at += match[0].length;
      continue;
    }

    if (/[A-Za-z_$]/.test(char)) {
      const cell = text.slice(at).match(CELL_REF);
      // A cell ref only when what follows is NOT an identifier character — otherwise
      // `A1_total` would tokenize as A1 followed by a stray name.
      if (cell && !/[A-Za-z0-9_]/.test(text[at + cell[0].length] ?? '')) {
        tokens.push({ kind: 'ref', text: `${cell[1].toUpperCase()}${cell[2]}`, at });
        at += cell[0].length;
        continue;
      }
      // A bare name: a function about to be called, a named column, or a metric id.
      // Bracketed form `[Cost of goods]` carries spaces, which real column names have.
      //
      // `@` is part of a name because the semantic layer addresses a prior period as
      // `revenue@previous`, and it has no other meaning in this language — leaving it
      // out made every period-shifted metric a parse error.
      if (char === '[') { at += 1; continue; }
      const name = text.slice(at).match(/^[A-Za-z_$][A-Za-z0-9_.$@]*/);
      if (!name) return { error: 'PARSE', message: `Unreadable name at ${at}` };
      tokens.push({ kind: 'name', text: name[0], at });
      at += name[0].length;
      continue;
    }

    if (char === '[') {
      const end = text.indexOf(']', at + 1);
      if (end < 0) return { error: 'PARSE', message: 'Unterminated [name]' };
      tokens.push({ kind: 'name', text: text.slice(at + 1, end).trim(), at });
      at = end + 1;
      continue;
    }

    const operator = OPERATOR_TEXT.find((candidate) => text.startsWith(candidate, at));
    if (operator) { tokens.push({ kind: 'op', text: operator, at }); at += operator.length; continue; }

    return { error: 'PARSE', message: `Unexpected "${char}" at ${at}` };
  }

  return tokens;
}

// ── AST ───────────────────────────────────────────────────────────────────────────

export type FormulaNode =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  /** A single cell, e.g. `B4`. */
  | { type: 'ref'; ref: string }
  /** An inclusive rectangle, e.g. `A1:C12`. */
  | { type: 'range'; from: string; to: string }
  /** A named operand — a column on the sheet, or another metric in the semantic layer. */
  | { type: 'name'; name: string }
  | { type: 'call'; name: string; args: FormulaNode[] }
  | { type: 'unary'; op: '-' | '+' | 'not'; operand: FormulaNode }
  | { type: 'binary'; op: string; left: FormulaNode; right: FormulaNode };

export interface FormulaError {
  error: 'PARSE' | 'REF' | 'VALUE' | 'DIV0' | 'CYCLE' | 'NAME' | 'NUM';
  message: string;
}

export function isFormulaError(value: unknown): value is FormulaError {
  return !!value && typeof value === 'object' && typeof (value as FormulaError).error === 'string'
    && typeof (value as FormulaError).message === 'string';
}

/** Binding power. Comparison binds loosest so `A1+B1>10` reads the way it looks. */
const PRECEDENCE: Readonly<Record<string, number>> = {
  '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1,
  '&': 2,
  '+': 3, '-': 3,
  '*': 4, '/': 4,
  '^': 6,
};
/** `^` is right-associative: 2^3^2 is 2^9, as in every sheet. */
const RIGHT_ASSOCIATIVE: ReadonlySet<string> = new Set(['^']);

/**
 * Parse a formula into an AST.
 *
 * A leading `=` is optional so the same function reads a sheet cell (`=A1*2`) and a
 * metric expression (`revenue - cogs`) without the caller stripping anything first.
 */
export function parseExpression(input: string): FormulaNode | FormulaError {
  const source = input.trim().replace(/^=/, '');
  if (!source) return { error: 'PARSE', message: 'Empty formula' };
  const tokens = tokenize(source);
  if (isFormulaError(tokens)) return tokens;
  if (!tokens.length) return { error: 'PARSE', message: 'Empty formula' };

  let cursor = 0;
  const peek = (): Token | undefined => tokens[cursor];

  function parseBinary(minPrecedence: number): FormulaNode | FormulaError {
    let left = parseUnary();
    if (isFormulaError(left)) return left;

    for (;;) {
      const token = peek();
      if (!token || token.kind !== 'op') break;
      const precedence = PRECEDENCE[token.text];
      if (precedence == null || precedence < minPrecedence) break;
      cursor += 1;
      const next = RIGHT_ASSOCIATIVE.has(token.text) ? precedence : precedence + 1;
      const right = parseBinary(next);
      if (isFormulaError(right)) return right;
      left = { type: 'binary', op: token.text, left, right };
    }
    return left;
  }

  function parseUnary(): FormulaNode | FormulaError {
    const token = peek();
    if (token?.kind === 'op' && (token.text === '-' || token.text === '+')) {
      cursor += 1;
      const operand = parseUnary();
      if (isFormulaError(operand)) return operand;
      return { type: 'unary', op: token.text, operand };
    }
    return parsePostfix();
  }

  /** `%` is postfix: `20%` is 0.2, which is how a margin gets typed. */
  function parsePostfix(): FormulaNode | FormulaError {
    const atom = parseAtom();
    if (isFormulaError(atom)) return atom;
    let node = atom;
    while (peek()?.kind === 'op' && peek()?.text === '%') {
      cursor += 1;
      node = { type: 'binary', op: '/', left: node, right: { type: 'number', value: 100 } };
    }
    return node;
  }

  function parseAtom(): FormulaNode | FormulaError {
    const token = peek();
    if (!token) return { error: 'PARSE', message: 'Unexpected end of formula' };

    if (token.kind === 'number') { cursor += 1; return { type: 'number', value: Number(token.text) }; }
    if (token.kind === 'string') { cursor += 1; return { type: 'string', value: token.text }; }

    if (token.kind === 'lparen') {
      cursor += 1;
      const inner = parseBinary(0);
      if (isFormulaError(inner)) return inner;
      if (peek()?.kind !== 'rparen') return { error: 'PARSE', message: 'Missing )' };
      cursor += 1;
      return inner;
    }

    if (token.kind === 'ref') {
      cursor += 1;
      if (peek()?.kind === 'colon') {
        cursor += 1;
        const end = peek();
        if (end?.kind !== 'ref') return { error: 'PARSE', message: 'A range needs a second cell, e.g. A1:A10' };
        cursor += 1;
        return { type: 'range', from: token.text, to: end.text };
      }
      return { type: 'ref', ref: token.text };
    }

    if (token.kind === 'name') {
      cursor += 1;
      if (peek()?.kind === 'lparen') {
        cursor += 1;
        const args: FormulaNode[] = [];
        if (peek()?.kind !== 'rparen') {
          for (;;) {
            const arg = parseBinary(0);
            if (isFormulaError(arg)) return arg;
            args.push(arg);
            if (peek()?.kind === 'comma') { cursor += 1; continue; }
            break;
          }
        }
        if (peek()?.kind !== 'rparen') return { error: 'PARSE', message: `Missing ) after ${token.text}(` };
        cursor += 1;
        return { type: 'call', name: token.text.toUpperCase(), args };
      }
      const upper = token.text.toUpperCase();
      if (upper === 'TRUE') return { type: 'number', value: 1 };
      if (upper === 'FALSE') return { type: 'number', value: 0 };
      return { type: 'name', name: token.text };
    }

    return { error: 'PARSE', message: `Unexpected "${token.text}"` };
  }

  const ast = parseBinary(0);
  if (isFormulaError(ast)) return ast;
  if (cursor < tokens.length) return { error: 'PARSE', message: `Unexpected "${tokens[cursor].text}"` };
  return ast;
}

// ── Reference extraction ──────────────────────────────────────────────────────────

/** Column letters → 0-based index. A→0, Z→25, AA→26. */
export function columnIndex(letters: string): number {
  return [...letters.toUpperCase()].reduce((total, letter) => total * 26 + (letter.charCodeAt(0) - 64), 0) - 1;
}

/** 0-based index → column letters. The inverse of {@link columnIndex}. */
export function columnLetters(index: number): string {
  let remaining = index + 1;
  let letters = '';
  while (remaining > 0) {
    const digit = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + digit) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letters;
}

export function parseCellRef(ref: string): { column: number; row: number } | null {
  const match = ref.match(/^([A-Za-z]{1,3})(\d{1,6})$/);
  if (!match) return null;
  const row = Number(match[2]) - 1;
  return row < 0 ? null : { column: columnIndex(match[1]), row };
}

/** Every cell in an inclusive rectangle, row-major. */
export function expandRange(from: string, to: string): string[] {
  const start = parseCellRef(from);
  const end = parseCellRef(to);
  if (!start || !end) return [];
  const cells: string[] = [];
  for (let row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row += 1) {
    for (let column = Math.min(start.column, end.column); column <= Math.max(start.column, end.column); column += 1) {
      cells.push(`${columnLetters(column)}${row + 1}`);
    }
  }
  return cells;
}

/** Every cell address and bare name an expression depends on. Drives the recalc order. */
export function expressionReferences(node: FormulaNode): { cells: string[]; names: string[] } {
  const cells = new Set<string>();
  const names = new Set<string>();
  const walk = (current: FormulaNode): void => {
    switch (current.type) {
      case 'ref': cells.add(current.ref); return;
      case 'range': for (const cell of expandRange(current.from, current.to)) cells.add(cell); return;
      case 'name': names.add(current.name); return;
      case 'call': current.args.forEach(walk); return;
      case 'unary': walk(current.operand); return;
      case 'binary': walk(current.left); walk(current.right); return;
      default: return;
    }
  };
  walk(node);
  return { cells: [...cells], names: [...names] };
}

// ── Evaluation ────────────────────────────────────────────────────────────────────

export type FormulaValue = number | string | boolean | null;

export interface FormulaContext {
  /** One cell's current value. Return a {@link FormulaError} to propagate `#REF!`. */
  cell?: (ref: string) => FormulaValue | FormulaError;
  /** A named operand — a sheet column, or another metric id. */
  name?: (name: string) => FormulaValue | FormulaValue[] | FormulaError;
  /** Extra functions on top of the built-in set, uppercase-keyed. */
  functions?: Readonly<Record<string, (args: FormulaValue[][]) => FormulaValue | FormulaError>>;
}

/** Coerce for arithmetic. Blank is NOT zero — see the module header. */
function toNumber(value: FormulaValue): number | FormulaError {
  if (value == null || value === '') return { error: 'VALUE', message: 'Blank is not a number' };
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : { error: 'NUM', message: 'Not a finite number' };
  const cleaned = value.replace(/[\s,]/g, '').replace(/^\((.*)\)$/, '-$1').replace(/[$£€%]/g, '');
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) return { error: 'VALUE', message: `"${value}" is not a number` };
  return value.includes('%') ? numeric / 100 : numeric;
}

/** Numbers only, blanks and text skipped — the aggregate rule every sheet uses. */
function numericValues(args: FormulaValue[][]): number[] {
  return args.flat().flatMap((value) => {
    const numeric = toNumber(value);
    return isFormulaError(numeric) ? [] : [numeric];
  });
}

/** Net present value of `cashflows` at `rate`, first flow discounted one period. */
function npv(rate: number, cashflows: number[]): number {
  return cashflows.reduce((total, flow, index) => total + flow / (1 + rate) ** (index + 1), 0);
}

/**
 * Internal rate of return by bisection.
 *
 * Bisection rather than Newton–Raphson because a cashflow series a founder types is
 * routinely degenerate (all-positive, all-negative, or with several sign changes), and
 * Newton diverges silently on those while bisection reports `#NUM!` honestly.
 */
function irr(cashflows: number[]): number | FormulaError {
  if (cashflows.length < 2) return { error: 'NUM', message: 'IRR needs at least two cashflows' };
  const value = (rate: number): number => cashflows.reduce((total, flow, index) => total + flow / (1 + rate) ** index, 0);
  let low = -0.9999;
  let high = 10;
  let atLow = value(low);
  let atHigh = value(high);
  if (!Number.isFinite(atLow) || !Number.isFinite(atHigh) || atLow * atHigh > 0) {
    return { error: 'NUM', message: 'IRR did not bracket a root — check the signs of the cashflows' };
  }
  for (let step = 0; step < 200; step += 1) {
    const mid = (low + high) / 2;
    const atMid = value(mid);
    if (Math.abs(atMid) < 1e-9) return mid;
    if (atLow * atMid < 0) { high = mid; atHigh = atMid; } else { low = mid; atLow = atMid; }
  }
  void atHigh;
  return (low + high) / 2;
}

type BuiltIn = (args: FormulaValue[][]) => FormulaValue | FormulaError;

/**
 * The built-in vocabulary.
 *
 * Chosen for the CFO scenarios the register names — a budget, a runway model, a payback
 * and a round — rather than for parity with a desktop sheet. `NPV`/`IRR`/`PMT`/`PV`/`FV`
 * are here because "what does this cost us over three years" is unanswerable without
 * them, and their absence is what sends the model back out to a spreadsheet.
 */
const BUILT_INS: Readonly<Record<string, BuiltIn>> = {
  SUM: (args) => numericValues(args).reduce((total, value) => total + value, 0),
  PRODUCT: (args) => numericValues(args).reduce((total, value) => total * value, 1),
  AVERAGE: (args) => { const values = numericValues(args); return values.length ? values.reduce((a, b) => a + b, 0) / values.length : { error: 'DIV0', message: 'AVERAGE of nothing' }; },
  MIN: (args) => { const values = numericValues(args); return values.length ? Math.min(...values) : { error: 'VALUE', message: 'MIN of nothing' }; },
  MAX: (args) => { const values = numericValues(args); return values.length ? Math.max(...values) : { error: 'VALUE', message: 'MAX of nothing' }; },
  COUNT: (args) => numericValues(args).length,
  COUNTA: (args) => args.flat().filter((value) => value != null && value !== '').length,
  MEDIAN: (args) => {
    const values = numericValues(args).sort((a, b) => a - b);
    if (!values.length) return { error: 'VALUE', message: 'MEDIAN of nothing' };
    const mid = Math.floor(values.length / 2);
    return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  },
  ABS: (args) => { const value = toNumber(args[0]?.[0] ?? null); return isFormulaError(value) ? value : Math.abs(value); },
  ROUND: (args) => {
    const value = toNumber(args[0]?.[0] ?? null);
    if (isFormulaError(value)) return value;
    const digits = args[1] ? toNumber(args[1][0] ?? null) : 0;
    const places = isFormulaError(digits) ? 0 : digits;
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
  },
  SQRT: (args) => { const value = toNumber(args[0]?.[0] ?? null); if (isFormulaError(value)) return value; return value < 0 ? { error: 'NUM', message: 'SQRT of a negative' } : Math.sqrt(value); },
  POWER: (args) => {
    const base = toNumber(args[0]?.[0] ?? null);
    const exponent = toNumber(args[1]?.[0] ?? null);
    if (isFormulaError(base)) return base;
    if (isFormulaError(exponent)) return exponent;
    const result = base ** exponent;
    return Number.isFinite(result) ? result : { error: 'NUM', message: 'POWER overflowed' };
  },
  IF: (args) => {
    const test = args[0]?.[0] ?? null;
    const truthy = typeof test === 'number' ? test !== 0 : typeof test === 'boolean' ? test : !!test && test !== '';
    const branch = truthy ? args[1] : args[2];
    return branch?.[0] ?? (truthy ? 1 : 0);
  },
  IFERROR: (args) => args[0]?.[0] ?? args[1]?.[0] ?? null,
  AND: (args) => args.flat().every((value) => (typeof value === 'number' ? value !== 0 : !!value)),
  OR: (args) => args.flat().some((value) => (typeof value === 'number' ? value !== 0 : !!value)),
  NOT: (args) => { const value = args[0]?.[0] ?? null; return !(typeof value === 'number' ? value !== 0 : !!value); },
  // ── Finance ───────────────────────────────────────────────────────────────────
  NPV: (args) => {
    const rate = toNumber(args[0]?.[0] ?? null);
    if (isFormulaError(rate)) return rate;
    return npv(rate, numericValues(args.slice(1)));
  },
  IRR: (args) => irr(numericValues(args)),
  /** Payment per period on a level-payment loan. Negative = money leaving. */
  PMT: (args) => {
    const rate = toNumber(args[0]?.[0] ?? null);
    const periods = toNumber(args[1]?.[0] ?? null);
    const present = toNumber(args[2]?.[0] ?? null);
    if (isFormulaError(rate)) return rate;
    if (isFormulaError(periods)) return periods;
    if (isFormulaError(present)) return present;
    if (periods === 0) return { error: 'DIV0', message: 'PMT with zero periods' };
    if (rate === 0) return -present / periods;
    return -(present * rate) / (1 - (1 + rate) ** -periods);
  },
  PV: (args) => {
    const rate = toNumber(args[0]?.[0] ?? null);
    const periods = toNumber(args[1]?.[0] ?? null);
    const payment = toNumber(args[2]?.[0] ?? null);
    if (isFormulaError(rate)) return rate;
    if (isFormulaError(periods)) return periods;
    if (isFormulaError(payment)) return payment;
    if (rate === 0) return -payment * periods;
    return (-payment * (1 - (1 + rate) ** -periods)) / rate;
  },
  FV: (args) => {
    const rate = toNumber(args[0]?.[0] ?? null);
    const periods = toNumber(args[1]?.[0] ?? null);
    const payment = toNumber(args[2]?.[0] ?? null);
    const present = args[3] ? toNumber(args[3][0] ?? null) : 0;
    if (isFormulaError(rate)) return rate;
    if (isFormulaError(periods)) return periods;
    if (isFormulaError(payment)) return payment;
    const start = isFormulaError(present) ? 0 : present;
    if (rate === 0) return -(start + payment * periods);
    return -(start * (1 + rate) ** periods + payment * (((1 + rate) ** periods - 1) / rate));
  },
  /** Compound annual growth rate between two values over N periods. */
  CAGR: (args) => {
    const start = toNumber(args[0]?.[0] ?? null);
    const end = toNumber(args[1]?.[0] ?? null);
    const periods = toNumber(args[2]?.[0] ?? null);
    if (isFormulaError(start)) return start;
    if (isFormulaError(end)) return end;
    if (isFormulaError(periods)) return periods;
    if (start <= 0 || periods <= 0) return { error: 'NUM', message: 'CAGR needs a positive start and period count' };
    return (end / start) ** (1 / periods) - 1;
  },
};

/** Every function name the engine answers to — used by the model-facing documentation. */
export const FORMULA_FUNCTIONS: readonly string[] = Object.keys(BUILT_INS).sort();

/**
 * Walk an AST.
 *
 * Returns a single value, or a {@link FormulaError} that the caller renders in place.
 * Aggregate calls receive their arguments as ARRAYS (a range flattens into one), which
 * is what lets `SUM(A1:A10, B1, 5)` and `SUM(revenue)` share one implementation.
 */
export function evaluateExpression(node: FormulaNode, context: FormulaContext = {}): FormulaValue | FormulaError {
  const values = evaluateToList(node, context);
  if (isFormulaError(values)) return values;
  return values.length === 1 ? values[0] : values.length === 0 ? null : values[0];
}

function evaluateToList(node: FormulaNode, context: FormulaContext): FormulaValue[] | FormulaError {
  switch (node.type) {
    case 'number': return [node.value];
    case 'string': return [node.value];

    case 'ref': {
      if (!context.cell) return { error: 'REF', message: `No cell resolver for ${node.ref}` };
      const value = context.cell(node.ref);
      return isFormulaError(value) ? value : [value];
    }

    case 'range': {
      if (!context.cell) return { error: 'REF', message: `No cell resolver for ${node.from}:${node.to}` };
      const cells = expandRange(node.from, node.to);
      if (!cells.length) return { error: 'REF', message: `${node.from}:${node.to} is not a range` };
      const out: FormulaValue[] = [];
      for (const cell of cells) {
        const value = context.cell(cell);
        if (isFormulaError(value)) return value;
        out.push(value);
      }
      return out;
    }

    case 'name': {
      if (!context.name) return { error: 'NAME', message: `Unknown name "${node.name}"` };
      const value = context.name(node.name);
      if (isFormulaError(value)) return value;
      return Array.isArray(value) ? value : [value];
    }

    case 'unary': {
      const operand = evaluateExpression(node.operand, context);
      if (isFormulaError(operand)) return operand;
      if (node.op === 'not') return [!(typeof operand === 'number' ? operand !== 0 : !!operand)];
      const numeric = toNumber(operand);
      if (isFormulaError(numeric)) return numeric;
      return [node.op === '-' ? -numeric : numeric];
    }

    case 'call': {
      const implementation = context.functions?.[node.name] ?? BUILT_INS[node.name];
      if (!implementation) return { error: 'NAME', message: `Unknown function ${node.name}()` };
      const args: FormulaValue[][] = [];
      for (const arg of node.args) {
        // IF and IFERROR must not evaluate a failing branch into an error, so their
        // arguments are collected lazily-tolerantly: a failed branch becomes null and
        // only matters if the function actually selects it.
        const evaluated = evaluateToList(arg, context);
        if (isFormulaError(evaluated)) {
          if (node.name === 'IFERROR' || node.name === 'IF') { args.push([null]); continue; }
          return evaluated;
        }
        args.push(evaluated);
      }
      const result = implementation(args);
      return isFormulaError(result) ? result : [result];
    }

    case 'binary': {
      const left = evaluateExpression(node.left, context);
      if (isFormulaError(left)) return left;
      const right = evaluateExpression(node.right, context);
      if (isFormulaError(right)) return right;

      if (node.op === '&') return [`${left ?? ''}${right ?? ''}`];

      // Comparison compares text as text — "a" < "b" is a real question a filter asks.
      if (PRECEDENCE[node.op] === 1) {
        const bothText = typeof left === 'string' && typeof right === 'string'
          && isFormulaError(toNumber(left)) && isFormulaError(toNumber(right));
        const a = bothText ? left : toNumber(left as FormulaValue);
        const b = bothText ? right : toNumber(right as FormulaValue);
        if (isFormulaError(a)) return a;
        if (isFormulaError(b)) return b;
        switch (node.op) {
          case '=': return [a === b];
          case '<>': return [a !== b];
          case '<': return [a < b];
          case '>': return [a > b];
          case '<=': return [a <= b];
          case '>=': return [a >= b];
          default: return { error: 'PARSE', message: `Unknown operator ${node.op}` };
        }
      }

      const a = toNumber(left);
      if (isFormulaError(a)) return a;
      const b = toNumber(right);
      if (isFormulaError(b)) return b;
      switch (node.op) {
        case '+': return [a + b];
        case '-': return [a - b];
        case '*': return [a * b];
        case '/': return b === 0 ? { error: 'DIV0', message: 'Division by zero' } : [a / b];
        case '^': { const result = a ** b; return Number.isFinite(result) ? [result] : { error: 'NUM', message: 'Overflow' }; }
        default: return { error: 'PARSE', message: `Unknown operator ${node.op}` };
      }
    }
  }
}

/** Convenience: parse and evaluate in one call. */
export function evaluateFormula(input: string, context: FormulaContext = {}): FormulaValue | FormulaError {
  const ast = parseExpression(input);
  return isFormulaError(ast) ? ast : evaluateExpression(ast, context);
}

/** The `#DIV/0!`-style token a cell shows when it could not be computed. */
export function formulaErrorText(error: FormulaError): string {
  switch (error.error) {
    case 'DIV0': return '#DIV/0!';
    case 'REF': return '#REF!';
    case 'NAME': return '#NAME?';
    case 'VALUE': return '#VALUE!';
    case 'CYCLE': return '#CYCLE!';
    case 'NUM': return '#NUM!';
    case 'PARSE': return '#ERROR!';
  }
}
