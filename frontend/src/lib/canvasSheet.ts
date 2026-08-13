/**
 * The `spreadsheet` object, recalculated.
 *
 * ── WHAT WAS BROKEN ──────────────────────────────────────────────────────────────
 * `spreadsheet` declared a `formulas` field that nothing read, so the object the product
 * offers for modelling could store `=SUM(C1:C12)` and render it as that literal string.
 * This module is the reader: it binds {@link parseExpression} to the `{columns, rows}`
 * shape every tabular canvas object already uses, orders the recalculation by dependency,
 * and refuses a cycle instead of hanging the board.
 *
 * ── THE ADDRESS SPACE ────────────────────────────────────────────────────────────
 * `columns` are the header row and are NOT addressable as cells — they are the names. A
 * cell is `<letter><1-based data row>`, so `A1` is the first column of the first data row.
 * That keeps the sheet's addresses stable when a column is renamed, and it means a
 * formula can say either `A1*B1` or the far more readable `[Unit price]*[Quantity]`.
 *
 * ── THE TWO FORMULA FORMS, AND WHY BOTH ─────────────────────────────────────────
 * `{"D4": "=B4*C4"}` is one cell. `{"D": "=B*C"}` is the whole COLUMN — every data row,
 * with bare letters resolving to that row. The column form exists because the finance
 * shape is almost always "this column is derived from those columns for every line", and
 * writing it per-row would put the same expression in 200 places and let 200 rows drift.
 *
 * ── SCENARIOS ARE WHY ANY OF THIS MATTERS ───────────────────────────────────────
 * {@link recalculateSheet} takes `overrides`, so "set churn to 4% and show me runway" is
 * one recalculation against a changed input rather than a second sheet that has to be
 * kept in step with the first. `forecast` and `budget` objects drive their scenarios
 * through exactly this parameter, which is what makes them models rather than tables
 * somebody typed twice.
 */

import {
  columnLetters,
  evaluateExpression,
  expressionReferences,
  formulaErrorText,
  isFormulaError,
  parseCellRef,
  parseExpression,
  type FormulaError,
  type FormulaNode,
  type FormulaValue,
} from './canvasFormula';
import type { TabularCell, TabularRow } from './canvasTabularData';

/** Cell address → formula text. Accepts the array form a model may author instead. */
export type SheetFormulas = Record<string, string>;

/** A whole-column formula key is bare letters with no row number. */
const COLUMN_KEY = /^[A-Za-z]{1,3}$/;

export function normalizeFormulas(value: unknown): SheetFormulas {
  if (!value) return {};
  const entries: Array<[string, string]> = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const raw = item as Record<string, unknown>;
      const cell = String(raw.cell ?? raw.ref ?? raw.target ?? '').trim().toUpperCase();
      const formula = String(raw.formula ?? raw.expression ?? raw.value ?? '').trim();
      if (cell && formula) entries.push([cell, formula]);
    }
  } else if (typeof value === 'object') {
    for (const [cell, formula] of Object.entries(value as Record<string, unknown>)) {
      if (typeof formula === 'string' && formula.trim()) entries.push([cell.trim().toUpperCase(), formula.trim()]);
    }
  }
  // A key that is neither a cell nor a column is a typo, and silently ignoring it would
  // leave the author staring at a cell that never computes with nothing to explain it.
  // They are kept and reported as `#REF!` targets by `recalculateSheet`.
  return Object.fromEntries(entries.slice(0, 2_000));
}

export interface SheetCellResult {
  ref: string;
  /** The computed value, or null when the formula failed. */
  value: FormulaValue;
  /** Present when this cell could not be computed. */
  error?: FormulaError;
  /** The formula that produced it, for the inspector and the export. */
  formula: string;
}

export interface SheetRecalcResult {
  /** `rows` with every computed cell substituted — what the table body renders. */
  rows: TabularRow[];
  /** Every formula cell, keyed by address. */
  cells: Record<string, SheetCellResult>;
  /** Cells that failed, in evaluation order. Rendered as a banner on the object. */
  errors: Array<{ ref: string; text: string; message: string }>;
  /** The dependency order actually used. Exposed so a test can pin it. */
  order: string[];
  /** Addresses that take part in a dependency cycle. */
  cycles: string[];
}

interface SheetShape {
  columns: readonly string[];
  rows: readonly TabularRow[];
  formulas?: unknown;
  /** Cell values that replace whatever is stored — the scenario input. */
  overrides?: Readonly<Record<string, TabularCell>>;
}

/** Read a sheet's shape off a canvas object, tolerating what a model may have authored. */
export function readSheet(data: Record<string, unknown>): { columns: string[]; rows: TabularRow[]; formulas: SheetFormulas } {
  const columns = Array.isArray(data.columns) ? data.columns.map((column) => String(column)) : [];
  const rows = Array.isArray(data.rows)
    ? data.rows.filter((row): row is TabularRow => !!row && typeof row === 'object' && !Array.isArray(row))
    : [];
  return { columns, rows, formulas: normalizeFormulas(data.formulas) };
}

/**
 * Recalculate a sheet.
 *
 * Every formula cell is resolved in dependency order; a cell that depends on one that
 * failed inherits the failure rather than reading its stored literal, because a total
 * that silently used the pre-formula value is wrong in a way nobody can see.
 */
export function recalculateSheet(sheet: SheetShape): SheetRecalcResult {
  const columns = [...sheet.columns];
  const formulas = normalizeFormulas(sheet.formulas);
  const overrides = sheet.overrides ?? {};
  const rowCount = sheet.rows.length;

  const columnOf = (ref: string): string | null => {
    const parsed = parseCellRef(ref);
    return parsed && parsed.column < columns.length ? columns[parsed.column] : null;
  };

  /** Whatever is STORED at a cell, before any formula. */
  const storedAt = (ref: string): TabularCell | null => {
    if (ref in overrides) return overrides[ref];
    const parsed = parseCellRef(ref);
    if (!parsed || parsed.row >= rowCount) return null;
    const name = columns[parsed.column];
    if (name == null) return null;
    const cell = sheet.rows[parsed.row]?.[name];
    return cell == null ? null : cell;
  };

  // ── Expand column formulas into per-row cell formulas ───────────────────────────
  //
  // A column formula's bare letters mean "this row". Rewriting them here rather than at
  // evaluation time keeps the evaluator ignorant of rows entirely — it only ever sees
  // fully-qualified addresses, which is also what makes the dependency graph exact.
  const cellFormulas: Record<string, string> = {};
  const unaddressable: string[] = [];
  for (const [key, formula] of Object.entries(formulas)) {
    if (COLUMN_KEY.test(key)) {
      for (let row = 0; row < rowCount; row += 1) {
        cellFormulas[`${key.toUpperCase()}${row + 1}`] = qualifyBareLetters(formula, row + 1, columns.length);
      }
      continue;
    }
    if (parseCellRef(key)) { cellFormulas[key] = formula; continue; }
    unaddressable.push(key);
  }

  // ── Parse once, collect dependencies ───────────────────────────────────────────
  const parsed = new Map<string, FormulaNode | FormulaError>();
  const dependsOn = new Map<string, string[]>();
  for (const [ref, formula] of Object.entries(cellFormulas)) {
    const ast = parseExpression(formula);
    parsed.set(ref, ast);
    if (isFormulaError(ast)) { dependsOn.set(ref, []); continue; }
    const references = expressionReferences(ast);
    // A NAME operand pulls in the whole column, so every formula cell in that column is
    // a dependency — otherwise "SUM(Revenue)" could run before the Revenue column's own
    // derived cells were computed and quietly total the pre-formula literals.
    const nameCells = references.names.flatMap((name) => {
      const index = columns.indexOf(name);
      if (index < 0) return [];
      const letter = columnLetters(index);
      return Array.from({ length: rowCount }, (_, row) => `${letter}${row + 1}`);
    });
    dependsOn.set(ref, [...new Set([...references.cells, ...nameCells])].filter((cell) => cell in cellFormulas && cell !== ref));
  }

  // ── Topological order, with cycles isolated rather than fatal ──────────────────
  const order: string[] = [];
  const cycles = new Set<string>();
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (ref: string, stack: string[]): void => {
    const current = state.get(ref);
    if (current === 'done') return;
    if (current === 'visiting') {
      // Everything from where the cycle re-entered is part of it.
      const at = stack.indexOf(ref);
      for (const member of stack.slice(at < 0 ? 0 : at)) cycles.add(member);
      cycles.add(ref);
      return;
    }
    state.set(ref, 'visiting');
    for (const dependency of dependsOn.get(ref) ?? []) visit(dependency, [...stack, ref]);
    state.set(ref, 'done');
    order.push(ref);
  };
  for (const ref of Object.keys(cellFormulas)) visit(ref, []);

  // ── Evaluate ──────────────────────────────────────────────────────────────────
  const cells: Record<string, SheetCellResult> = {};
  const errors: SheetRecalcResult['errors'] = [];

  const valueAt = (ref: string): FormulaValue | FormulaError => {
    const computed = cells[ref];
    if (computed) return computed.error ?? computed.value;
    if (ref in cellFormulas) {
      // Referenced before it was evaluated: only reachable inside a cycle.
      return { error: 'CYCLE', message: `${ref} is part of a dependency cycle` };
    }
    return storedAt(ref);
  };

  const namedColumn = (name: string): FormulaValue[] | FormulaError => {
    const index = columns.indexOf(name);
    if (index < 0) {
      // Case-insensitive second pass: a model writes `[revenue]` for a `Revenue` column
      // far more often than it invents a column that does not exist.
      const loose = columns.findIndex((column) => column.toLowerCase() === name.toLowerCase());
      if (loose < 0) return { error: 'NAME', message: `No column named "${name}"` };
      return columnValues(loose);
    }
    return columnValues(index);
  };

  const columnValues = (index: number): FormulaValue[] => {
    const letter = columnLetters(index);
    return Array.from({ length: rowCount }, (_, row) => {
      const value = valueAt(`${letter}${row + 1}`);
      return isFormulaError(value) ? null : value;
    });
  };

  for (const ref of order) {
    const ast = parsed.get(ref);
    const formula = cellFormulas[ref];
    if (!ast || isFormulaError(ast)) {
      const error = (ast as FormulaError) ?? { error: 'PARSE' as const, message: 'Unparsed' };
      cells[ref] = { ref, value: null, error, formula };
      errors.push({ ref, text: formulaErrorText(error), message: error.message });
      continue;
    }
    if (cycles.has(ref)) {
      const error: FormulaError = { error: 'CYCLE', message: `${ref} is part of a dependency cycle` };
      cells[ref] = { ref, value: null, error, formula };
      errors.push({ ref, text: formulaErrorText(error), message: error.message });
      continue;
    }
    const result = evaluateExpression(ast, { cell: valueAt, name: namedColumn });
    if (isFormulaError(result)) {
      cells[ref] = { ref, value: null, error: result, formula };
      errors.push({ ref, text: formulaErrorText(result), message: result.message });
      continue;
    }
    cells[ref] = { ref, value: result, formula };
  }

  // Cycle members never entered `order`, so report them here.
  for (const ref of cycles) {
    if (cells[ref]) continue;
    const error: FormulaError = { error: 'CYCLE', message: `${ref} is part of a dependency cycle` };
    cells[ref] = { ref, value: null, error, formula: cellFormulas[ref] ?? '' };
    errors.push({ ref, text: formulaErrorText(error), message: error.message });
  }

  for (const key of unaddressable) {
    errors.push({ ref: key, text: '#REF!', message: `"${key}" is not a cell address or a column letter` });
  }

  // ── Materialize ───────────────────────────────────────────────────────────────
  const rows = sheet.rows.map((row, index) => {
    const next: TabularRow = { ...row };
    for (let column = 0; column < columns.length; column += 1) {
      const ref = `${columnLetters(column)}${index + 1}`;
      const computed = cells[ref];
      if (computed) {
        next[columns[column]] = computed.error
          ? formulaErrorText(computed.error)
          : (computed.value as TabularCell ?? '');
      } else if (ref in overrides) {
        next[columns[column]] = overrides[ref];
      }
    }
    return next;
  });

  return { rows, cells, errors, order, cycles: [...cycles].sort() };
}

/**
 * Rewrite the bare column letters in a whole-column formula to point at one row.
 *
 * `=B*C` on row 4 becomes `=B4*C4`. Only letters that are actually a column on this sheet
 * are qualified — `SUM(...)` must not become `SUM4(...)`, and a `[Named column]` operand
 * must be left alone, which is why the rewrite skips anything followed by `(` or a digit
 * and anything inside brackets or quotes.
 */
function qualifyBareLetters(formula: string, row: number, columnCount: number): string {
  const valid = new Set(Array.from({ length: columnCount }, (_, index) => columnLetters(index)));
  let out = '';
  let at = 0;
  while (at < formula.length) {
    const char = formula[at];
    if (char === '[' || char === '"' || char === "'") {
      const close = char === '[' ? ']' : char;
      const end = formula.indexOf(close, at + 1);
      if (end < 0) { out += formula.slice(at); break; }
      out += formula.slice(at, end + 1);
      at = end + 1;
      continue;
    }
    const letters = formula.slice(at).match(/^[A-Za-z]{1,3}/);
    if (letters) {
      const after = formula[at + letters[0].length] ?? '';
      const token = letters[0].toUpperCase();
      const isCall = after === '(';
      const alreadyQualified = /[0-9]/.test(after);
      const isIdentifier = /[A-Za-z_.]/.test(after);
      out += !isCall && !alreadyQualified && !isIdentifier && valid.has(token) ? `${token}${row}` : letters[0];
      at += letters[0].length;
      continue;
    }
    out += char;
    at += 1;
  }
  return out;
}

/**
 * Model-facing documentation for the `formulas` field.
 *
 * Lives beside the engine so the vocabulary the model is TOLD about is generated from
 * the vocabulary the engine actually implements — the same contract
 * `check-prompt-tool-names.mjs` enforces for tool names.
 */
export function sheetFormulaGuidance(functions: readonly string[]): string {
  return [
    'A map of cell address to formula, e.g. {"D2": "=B2*C2", "D9": "=SUM(D1:D8)"}.',
    'Addresses are <column letter><1-based DATA row>: A1 is the first column of the first row (headers are `columns`, and are not addressable).',
    'A bare column letter as the key applies the formula to EVERY row, with bare letters meaning that row: {"D": "=B*C"} fills the whole D column.',
    'Reference a column by name with brackets when it reads better: "=[Unit price]*[Quantity]", or aggregate a whole column: "=SUM([Revenue])".',
    `Functions: ${functions.join(', ')}. Operators: + - * / ^ % & and the comparisons = <> < > <= >=.`,
    'A failed cell renders as #REF!/#DIV/0!/#CYCLE! and marks everything that depends on it — never author a literal in place of a formula to make an error go away.',
  ].join(' ');
}
