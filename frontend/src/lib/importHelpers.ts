/**
 * Shared helpers and types for the Import feature.
 *
 * Covers:
 *  - File parsing (CSV, TSV, JSON)
 *  - Header → column auto-mapping and the mapped-row projection
 *  - Template generation from the kind's fields
 *  - Dry-run validation engine (client side; the server runs its own)
 *  - Batch planning + result aggregation for the bulk POST loop
 *  - Error / summary report generation
 */

import { IMPORT_BATCH_SIZE, type ImportResult } from './importApi';
import { validateCell, type CellErrorCode, type FieldDirective } from './import-input-schema';

// ── Types ─────────────────────────────────────────────────────

/** Supported import file types. XLSX is not one of them: reading it needs a
 *  parser this bundle does not carry, and a dropzone that advertises a format
 *  it then rejects is worse than one that does not. */
export type ImportFileType = 'csv' | 'tsv' | 'json';

export const ACCEPTED_EXTENSIONS: readonly ImportFileType[] = ['csv', 'tsv', 'json'];

/** Parsed flat file result */
export interface ParsedFileResult {
  headers: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  filename: string;
  fileType: ImportFileType | null;
  error?: string;
  /** The parser threw: the raw rejection, for the surface to word in the reader's language. */
  parseFailure?: { cause: unknown };
}

/** A single row-level validation error */
export interface RowValidationError {
  rowNumber: number;
  column: string;
  code: CellErrorCode;
  /** The canonical field the column was mapped to, as the message's argument. */
  field: string;
}

/**
 * Result of a dry-run validation pass.
 *
 * No `summary` sentence: the three counts ARE the summary, and the one place it
 * is shown composes it from them through the catalog.
 */
export interface DryRunValidation {
  totalRows: number;
  validCount: number;
  errorCount: number;
  errors: RowValidationError[];
  /** 1-based row numbers with no error — the rows worth posting. */
  validRowNumbers: number[];
}

// ── File-type detection ───────────────────────────────────────

export function detectFileType(filename: string): ImportFileType | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(ext) ? (ext as ImportFileType) : null;
}

// ── CSV parsing ───────────────────────────────────────────────

/**
 * Parse delimiter-separated text. `delimiter` defaults to a comma; pass "\t"
 * for TSV so quoted fields, escaped quotes, and ragged rows are handled by the
 * same parser rather than an ad-hoc split.
 */
export function parseCSV(text: string, delimiter = ','): { headers: string[]; rows: Record<string, unknown>[] } {
  // Split lines, handle CRLF
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const headerLine = lines[0];
  if (headerLine === undefined) {
    return { headers: [], rows: [] };
  }

  const headers = parseCSVLine(headerLine, delimiter);
  const rows: Record<string, unknown>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i] ?? '', delimiter);
    const row: Record<string, unknown> = {};

    for (let j = 0; j < headers.length; j++) {
      const key = headers[j];
      if (key === undefined) continue;
      row[key] = j < values.length ? values[j] : '';
    }
    rows.push(row);
  }

  return { headers, rows };
}

function parseCSVLine(line: string, delimiter = ','): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // Handle escaped quotes: "" inside quoted field
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // skip the escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// ── JSON parsing ──────────────────────────────────────────────

function parseJSON(text: string): { headers: string[]; rows: Record<string, unknown>[] } {
  const parsed: unknown = JSON.parse(text);

  // Support both array of objects and { rows: [...] }
  let records: Record<string, unknown>[];
  if (Array.isArray(parsed)) {
    records = parsed as Record<string, unknown>[];
  } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { rows?: unknown }).rows)) {
    records = (parsed as { rows: Record<string, unknown>[] }).rows;
  } else {
    throw new Error('JSON must be an array of objects or contain a "rows" array');
  }

  const first = records[0];
  if (!first) {
    return { headers: [], rows: [] };
  }

  // Derive headers from first row keys
  const headers = Object.keys(first);
  const rows = records.map((r) => {
    const row: Record<string, unknown> = {};
    for (const h of headers) {
      row[h] = r[h] ?? '';
    }
    return row;
  });

  return { headers, rows };
}

// ── Unified file parser ───────────────────────────────────────

/**
 * Parse an uploaded file and return a ParsedFileResult.
 * Handles CSV, TSV and JSON.
 */
export async function parseFile(file: File): Promise<ParsedFileResult> {
  const fileType = detectFileType(file.name);
  const base = { filename: file.name, fileType };
  if (fileType === null) {
    return { ...base, headers: [], rows: [], totalRows: 0, error: `Unsupported file type: ${file.name}` };
  }

  try {
    const text = await file.text();
    const { headers, rows } = fileType === 'json'
      ? parseJSON(text)
      : parseCSV(text, fileType === 'tsv' ? '\t' : ',');

    return { ...base, headers, rows, totalRows: rows.length };
  } catch (err: unknown) {
    return { ...base, headers: [], rows: [], totalRows: 0, parseFailure: { cause: err } };
  }
}

// ── Mapping ───────────────────────────────────────────────────

/** `Member Name` / `member_name` / `memberName` all → `membername`. */
const normalizeHeader = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Guess which column each file header is, by name. A header that matches no
 * column maps to '' (ignored) and the mapper lets the reader fix it.
 */
export function autoMapHeaders(headers: readonly string[], fields: readonly FieldDirective[]): Record<string, string> {
  const byNormalized = new Map(fields.map((f) => [normalizeHeader(f.key), f.key]));
  const claimed = new Set<string>();
  const result: Record<string, string> = {};
  for (const h of headers) {
    const target = byNormalized.get(normalizeHeader(h));
    if (target && !claimed.has(target)) {
      result[h] = target;
      claimed.add(target);
    } else {
      result[h] = '';
    }
  }
  return result;
}

/** Required columns no header maps to — a mapping-level error the dry run
 *  cannot see, because a column nobody mapped has no cells to check. */
export function unmappedRequiredFields(
  mappings: Record<string, string>,
  fields: readonly FieldDirective[],
): FieldDirective[] {
  const mapped = new Set(Object.values(mappings));
  return fields.filter((f) => f.required && !mapped.has(f.key));
}

/** The wizard's record as a row to post: empty fields are omitted rather than
 *  sent blank, so an optional column stays NULL instead of ''. */
export function toImportRow(record: Record<string, string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value.trim() !== ''));
}

/** Project file rows onto the kind's columns: `{ [column]: cell }` for every
 *  mapped header. Unmapped headers do not travel. */
export function mapRows(
  rows: readonly Record<string, unknown>[],
  mappings: Record<string, string>,
): Array<Record<string, unknown>> {
  const pairs = Object.entries(mappings).filter(([, target]) => target !== '');
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [header, target] of pairs) out[target] = row[header];
    return out;
  });
}

// ── Template generation ───────────────────────────────────────

/**
 * A CSV template for a kind: its columns as the header line and the registry's
 * examples as the one example row.
 */
export function generateCSVTemplate(fields: readonly FieldDirective[]): string {
  const headerLine = fields.map((f) => escapeCSVField(f.key)).join(',');
  const exampleLine = fields.map((f) => escapeCSVField(f.example ?? '')).join(',');
  return `${headerLine}\n${exampleLine}\n`;
}

function escapeCSVField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ── Dry-run validation ────────────────────────────────────────

/**
 * Execute a pre-import dry-run: validate every row against the kind's fields
 * through the mapping, with the same per-cell rule the wizard uses.
 */
export function executeDryRun(
  parsed: ParsedFileResult,
  mappings: Record<string, string>,
  fields: readonly FieldDirective[],
): DryRunValidation {
  const errors: RowValidationError[] = [];
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const mapped = Object.entries(mappings)
    .map(([header, target]) => ({ header, field: byKey.get(target) }))
    .filter((m): m is { header: string; field: FieldDirective } => m.field !== undefined);

  parsed.rows.forEach((row, i) => {
    const rowNumber = i + 1; // 1-based for user display
    for (const { header, field } of mapped) {
      const code = validateCell(field, row[header]);
      if (code) errors.push({ rowNumber, column: header, code, field: field.key });
    }
  });

  const erroredRows = new Set(errors.map((e) => e.rowNumber));
  const validRowNumbers: number[] = [];
  for (let n = 1; n <= parsed.rows.length; n++) if (!erroredRows.has(n)) validRowNumbers.push(n);

  return {
    totalRows: parsed.rows.length,
    validCount: validRowNumbers.length,
    errorCount: erroredRows.size,
    errors,
    validRowNumbers,
  };
}

// ── Batching + aggregation ────────────────────────────────────

/** Contiguous slices of ≤ `size` rows, each with the offset the server numbers
 *  its errors from. */
export function planBatches<T>(rows: readonly T[], size = IMPORT_BATCH_SIZE): Array<{ offset: number; rows: T[] }> {
  const batches: Array<{ offset: number; rows: T[] }> = [];
  for (let offset = 0; offset < rows.length; offset += size) {
    batches.push({ offset, rows: rows.slice(offset, offset + size) });
  }
  return batches;
}

export const EMPTY_IMPORT_RESULT: ImportResult = { inserted: 0, skipped: 0, errors: [], dryRun: false };

/** Sum two batch results into one file-level result. */
export function mergeImportResults(a: ImportResult, b: ImportResult): ImportResult {
  return {
    inserted: a.inserted + b.inserted,
    skipped: a.skipped + b.skipped,
    errors: [...a.errors, ...b.errors],
    dryRun: a.dryRun && b.dryRun,
  };
}

// ── Report generation ─────────────────────────────────────────

/**
 * Generate a CSV error report for download.
 *
 * A downloaded file is UI too, so its column headings and its reasons are the
 * caller's translated strings: the caller already renders the same reason into
 * the on-screen table, and passing it in is what keeps the two identical.
 */
export function generateCSVErrorReport(
  errors: Array<{ rowNumber: number; column: string; reason: string }>,
  headings: { rowNumber: string; column: string; reason: string },
): string {
  const header = [headings.rowNumber, headings.column, headings.reason].map(escapeCSVField).join(',');
  const lines = errors.map((e) =>
    `${e.rowNumber},${escapeCSVField(e.column)},${escapeCSVField(e.reason)}`,
  );
  return [header, ...lines].join('\n');
}

/**
 * Generate a CSV import summary report for download.
 *
 * `labels` for the same reason as above. The timestamp is ISO-8601 rather than a
 * formatted date on purpose — it is a machine field in a spreadsheet, and one
 * unambiguous instant beats five locale renderings of it.
 */
export function generateImportSummaryReport(
  totalRows: number,
  imported: number,
  skipped: number,
  labels: { metric: string; value: string; totalRows: string; imported: string; skipped: string; timestamp: string },
): string {
  return [
    `${escapeCSVField(labels.metric)},${escapeCSVField(labels.value)}`,
    `${escapeCSVField(labels.totalRows)},${totalRows}`,
    `${escapeCSVField(labels.imported)},${imported}`,
    `${escapeCSVField(labels.skipped)},${skipped}`,
    `${escapeCSVField(labels.timestamp)},${new Date().toISOString()}`,
  ].join('\n');
}
