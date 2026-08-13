/**
 * Test data — the fixtures a suite needs, generated from a declared contract.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
 * A `dataset` on the canvas is an uploaded snapshot, `canvas_classify_dataset` finds
 * the PII in it and `canvas_run_data_quality` checks it — and nothing produced the
 * rows that actually break a system. The Agentic Tester's own fill value is the
 * literal string `qa-probe`, which exercises no validation rule any product has: it
 * is not empty, not over-length, not the wrong type, not a quote, not an emoji, and
 * not a boundary of anything.
 *
 * So this generates three populations from the SAME declared contract the quality
 * suite already evaluates against (`DataContract` in `canvasDataGovernance`):
 *
 *   valid     — rows the contract accepts. The control group.
 *   boundary  — the exact edges: min, max, one-character, maximum length, the first
 *               and last allowed value. Where off-by-one lives.
 *   invalid   — rows that must be REJECTED: empty required fields, out-of-range
 *               numbers, wrong types, disallowed values, duplicate keys, and the
 *               injection-shaped strings every form should survive.
 *
 * Each row carries the case it is, so a failing test can say WHICH edge broke rather
 * than "row 14".
 *
 * ── DETERMINISM IS THE POINT ─────────────────────────────────────────────────────
 * No `Math.random`: the same contract yields the same fixture every time, so a
 * regression is a real change rather than a different draw, and a generated fixture
 * can be committed beside the spec. The variation comes from an index-seeded
 * sequence.
 *
 * Masking a real extract is NOT reimplemented here — `maskTabular` already does it
 * from the classifications the board holds, and one masking rule is the only way the
 * mask on screen and the mask in a fixture can agree.
 */

import type { DataContract, DataContractColumn } from './canvasDataGovernance';
import { maskTabular, type ColumnClassification } from './canvasDataGovernance';
import type { TabularCell, TabularRow, TabularSource } from './canvasTabularData';

export type FixtureCaseKind = 'valid' | 'boundary' | 'invalid';

export interface FixtureRow {
  kind: FixtureCaseKind;
  /** Which rule this row exercises — a localized label key, never a sentence. */
  rule: string;
  /** The column the case is about, when it is about one. */
  column?: string;
  row: TabularRow;
}

export interface GeneratedFixture {
  columns: string[];
  rows: TabularRow[];
  cases: FixtureRow[];
  counts: Record<FixtureCaseKind, number>;
}

/** Strings every text input should survive. Not exploits — the SHAPES that break
 *  naive validation, quoting and encoding. */
const HOSTILE_STRINGS = [
  "O'Brien",
  '<script>alert(1)</script>',
  'Ünïcödé — 名前 — عربى',
  '   leading and trailing   ',
  'a'.repeat(512),
  '"; DROP TABLE users; --',
  '👩‍👩‍👧‍👦 family emoji',
  '../../etc/passwd',
];

/** Deterministic pseudo-variation. An LCG rather than `Math.random` so a fixture is
 *  reproducible and diffable — see the module note. */
function seeded(index: number, salt: number): number {
  return (Math.imul(index + salt + 1, 1103515245) + 12345 >>> 0) / 0xffffffff;
}

function validValue(column: DataContractColumn, index: number): TabularCell {
  if (column.allowedValues?.length) return column.allowedValues[index % column.allowedValues.length]!;
  switch (column.type) {
    case 'number': {
      const min = column.min ?? 1;
      const max = column.max ?? min + 1000;
      return Math.round(min + seeded(index, column.name.length) * (max - min));
    }
    // A cell is `string | number`, so a boolean travels as its literal text — the
    // same way it arrives from every CSV the canvas imports.
    case 'boolean': return index % 2 === 0 ? 'true' : 'false';
    case 'date': {
      // A fixed epoch so the fixture does not change with the clock.
      const day = new Date(Date.UTC(2026, 0, 1 + (index % 28)));
      return day.toISOString().slice(0, 10);
    }
    default: {
      if (/email/i.test(column.name)) return `qa.user${index}@example.com`;
      if (/phone|mobile/i.test(column.name)) return `+1555010${String(1000 + index).slice(-4)}`;
      if (/url|link|site/i.test(column.name)) return `https://example.com/qa/${index}`;
      if (/id$|^id/i.test(column.name)) return `qa-${String(index + 1).padStart(4, '0')}`;
      return `${column.name} sample ${index + 1}`;
    }
  }
}

function boundaryCases(column: DataContractColumn): Array<{ rule: string; value: TabularCell }> {
  const cases: Array<{ rule: string; value: TabularCell }> = [];
  if (column.type === 'number') {
    if (column.min != null) cases.push({ rule: 'atMin', value: column.min }, { rule: 'justAboveMin', value: column.min + 1 });
    if (column.max != null) cases.push({ rule: 'atMax', value: column.max }, { rule: 'justBelowMax', value: column.max - 1 });
    if (column.min == null && column.max == null) cases.push({ rule: 'zero', value: 0 }, { rule: 'largeNumber', value: 2_147_483_647 });
  } else if (column.type === 'text') {
    cases.push({ rule: 'singleCharacter', value: 'x' }, { rule: 'longText', value: 'a'.repeat(255) });
  } else if (column.type === 'date') {
    cases.push({ rule: 'leapDay', value: '2028-02-29' }, { rule: 'epochStart', value: '1970-01-01' });
  }
  if (column.allowedValues?.length) {
    cases.push({ rule: 'firstAllowed', value: column.allowedValues[0]! });
    if (column.allowedValues.length > 1) cases.push({ rule: 'lastAllowed', value: column.allowedValues[column.allowedValues.length - 1]! });
  }
  return cases;
}

function invalidCases(column: DataContractColumn): Array<{ rule: string; value: TabularCell }> {
  const cases: Array<{ rule: string; value: TabularCell }> = [];
  if (column.required) cases.push({ rule: 'requiredEmpty', value: '' });
  if (column.type === 'number') {
    if (column.min != null) cases.push({ rule: 'belowMin', value: column.min - 1 });
    if (column.max != null) cases.push({ rule: 'aboveMax', value: column.max + 1 });
    cases.push({ rule: 'wrongType', value: 'not-a-number' });
  }
  if (column.type === 'date') cases.push({ rule: 'impossibleDate', value: '2026-02-30' }, { rule: 'wrongType', value: 'yesterday' });
  if (column.type === 'boolean') cases.push({ rule: 'wrongType', value: 'maybe' });
  if (column.allowedValues?.length) cases.push({ rule: 'disallowedValue', value: '__not_allowed__' });
  return cases;
}

export interface FixtureOptions {
  /** Rows in the valid control group. */
  validRows?: number;
  includeBoundary?: boolean;
  includeInvalid?: boolean;
  /** Add the hostile-string population to every text column. */
  includeHostileStrings?: boolean;
}

const MAX_FIXTURE_ROWS = 500;

/**
 * Generate a fixture from a declared contract.
 *
 * Returns the rows AND the case each row is, because "which edge broke" is the only
 * thing that makes a failing fixture actionable.
 */
export function generateFixture(contract: DataContract, options: FixtureOptions = {}): GeneratedFixture {
  const columns = contract.columns.map((column) => column.name);
  const validRows = Math.max(1, Math.min(options.validRows ?? 5, 200));
  const cases: FixtureRow[] = [];

  const baseRow = (index: number): TabularRow =>
    Object.fromEntries(contract.columns.map((column) => [column.name, validValue(column, index)]));

  for (let index = 0; index < validRows; index += 1) {
    cases.push({ kind: 'valid', rule: 'contractValid', row: baseRow(index) });
  }

  if (options.includeBoundary !== false) {
    let index = validRows;
    for (const column of contract.columns) {
      for (const boundary of boundaryCases(column)) {
        if (cases.length >= MAX_FIXTURE_ROWS) break;
        cases.push({ kind: 'boundary', rule: boundary.rule, column: column.name, row: { ...baseRow(index), [column.name]: boundary.value } });
        index += 1;
      }
    }
  }

  if (options.includeInvalid !== false) {
    let index = validRows + 100;
    for (const column of contract.columns) {
      for (const invalid of invalidCases(column)) {
        if (cases.length >= MAX_FIXTURE_ROWS) break;
        cases.push({ kind: 'invalid', rule: invalid.rule, column: column.name, row: { ...baseRow(index), [column.name]: invalid.value } });
        index += 1;
      }
    }
    // A duplicate primary key is a whole-row case rather than a column one.
    if (contract.primaryKey?.length && cases.length < MAX_FIXTURE_ROWS) {
      const first = cases[0];
      if (first) cases.push({ kind: 'invalid', rule: 'duplicateKey', row: { ...first.row } });
    }
  }

  if (options.includeHostileStrings) {
    let index = validRows + 300;
    for (const column of contract.columns.filter((candidate) => candidate.type === 'text' && !candidate.allowedValues?.length)) {
      for (const hostile of HOSTILE_STRINGS) {
        if (cases.length >= MAX_FIXTURE_ROWS) break;
        cases.push({ kind: 'invalid', rule: 'hostileString', column: column.name, row: { ...baseRow(index), [column.name]: hostile } });
        index += 1;
      }
    }
  }

  const bounded = cases.slice(0, MAX_FIXTURE_ROWS);
  return {
    columns,
    rows: bounded.map((item) => item.row),
    cases: bounded,
    counts: {
      valid: bounded.filter((item) => item.kind === 'valid').length,
      boundary: bounded.filter((item) => item.kind === 'boundary').length,
      invalid: bounded.filter((item) => item.kind === 'invalid').length,
    },
  };
}

/**
 * A safe fixture from a REAL extract: the same rows with every classified column
 * masked by the one masking rule the board already renders through.
 *
 * The classifications come from `canvas_classify_dataset`, which is why this is a
 * two-line composition rather than a second implementation — the column that is
 * starred on screen is the column that is starred in the fixture, always.
 */
export function fixtureFromDataset(source: TabularSource, classifications: readonly ColumnClassification[], limit = 100): TabularSource {
  const masked = maskTabular(source, classifications);
  return { columns: masked.columns, rows: masked.rows.slice(0, Math.max(1, Math.min(limit, MAX_FIXTURE_ROWS))) };
}

/** Columns that would leave the board unmasked — the reason to refuse an export. */
export function unmaskedSensitiveColumns(classifications: readonly ColumnClassification[]): string[] {
  return classifications.filter((item) => item.pii !== 'none' && !item.masked).map((item) => item.column);
}
