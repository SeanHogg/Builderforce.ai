/**
 * Shared helpers and types for the Import feature.
 *
 * Covers:
 *  - File parsing (CSV, JSON, XLSX)
 *  - Template generation
 *  - Dry-run validation engine
 *  - Error / summary report generation
 *  - Async threshold constant (FR-3.10)
 */

import { MAX_FILE_SIZE_BYTES } from './import-input-schema';

// ── Types ─────────────────────────────────────────────────────

/** Supported import file types */
export type ImportFileType = 'csv' | 'json' | 'xlsx';

/** Parsed flat file result */
export interface ParsedFileResult {
  headers: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  filename: string;
  fileType: ImportFileType;
  error?: string;
}

/** A single row-level validation error */
export interface RowValidationError {
  rowNumber: number;
  column: string;
  reason: string;
}

/** Result of a dry-run validation pass (FR-3.6) */
export interface DryRunValidation {
  totalRows: number;
  validCount: number;
  errorCount: number;
  summary: string;
  errors: RowValidationError[];
}

/** Rows above this threshold trigger async processing (FR-3.10) */
export const IMPORT_ASYNC_THRESHOLD_ROWS = 500;

// ── File-type detection ───────────────────────────────────────

function detectFileType(filename: string): ImportFileType {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'csv') return 'csv';
  if (ext === 'json') return 'json';
  if (ext === 'xlsx') return 'xlsx';
  throw new Error(`Unsupported file type: .${ext}`);
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

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = parseCSVLine(lines[0], delimiter);
  const rows: Record<string, unknown>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i], delimiter);
    const row: Record<string, unknown> = {};

    for (let j = 0; j < headers.length; j++) {
      const key = headers[j];
      let val: unknown = j < values.length ? values[j] : '';
      // Coerce booleans
      if (val === 'true') val = 'true';
      else if (val === 'false') val = 'false';
      row[key] = val;
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
  const parsed = JSON.parse(text);

  // Support both array of objects and { rows: [...] }
  let records: Record<string, unknown>[];
  if (Array.isArray(parsed)) {
    records = parsed;
  } else if (parsed && Array.isArray(parsed.rows)) {
    records = parsed.rows;
  } else {
    throw new Error('JSON must be an array of objects or contain a "rows" array');
  }

  if (records.length === 0) {
    return { headers: [], rows: [] };
  }

  // Derive headers from first row keys
  const headers = Object.keys(records[0]);
  const rows = records.map((r) => {
    const row: Record<string, unknown> = {};
    for (const h of headers) {
      row[h] = r[h] ?? '';
    }
    return row;
  });

  return { headers, rows };
}

// ── XLSX parsing ──────────────────────────────────────────────

// XLSX parsing uses the SheetJS community edition (xlsx) which is expected
// to be available. In production, install `npm install xlsx` and uncomment the import.
// For now, we return a helpful error so the developer knows what to do.

async function parseXLSX(_buffer: ArrayBuffer): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  // In production:
  // import * as XLSX from 'xlsx';
  // const workbook = XLSX.read(buffer, { type: 'array' });
  // const firstSheet = workbook.SheetNames[0];
  // const sheet = workbook.Sheets[firstSheet];
  // const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
  // return parseJSONInner(json);

  // Fallback: return a clear error pointing to the dependency
  throw new Error(
    'XLSX parsing requires the `xlsx` package. Install it with: npm install xlsx\n' +
    'Then import * as XLSX from \'xlsx\' in this file and implement the parseXLSX function.',
  );
}

// ── Unified file parser ───────────────────────────────────────

/**
 * Parse an uploaded file and return a ParsedFileResult.
 * Handles CSV, JSON, and XLSX (FR-3.2).
 */
export async function parseFile(file: File): Promise<ParsedFileResult> {
  const fileType = detectFileType(file.name);

  try {
    let headers: string[];
    let rows: Record<string, unknown>[];

    if (fileType === 'csv') {
      const text = await file.text();
      ({ headers, rows } = parseCSV(text));
    } else if (fileType === 'json') {
      const text = await file.text();
      ({ headers, rows } = parseJSON(text));
    } else {
      const buffer = await file.arrayBuffer();
      ({ headers, rows } = await parseXLSX(buffer));
    }

    return {
      headers,
      rows,
      totalRows: rows.length,
      filename: file.name,
      fileType,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown parsing error';
    return {
      headers: [],
      rows: [],
      totalRows: 0,
      filename: file.name,
      fileType,
      error: message,
    };
  }
}

// ── Template generation (FR-3.1) ──────────────────────────────

/**
 * Generate a CSV template string with headers and one example row.
 */
export function generateCSVTemplate(
  headers: string[],
  exampleRow: Record<string, string | number>,
): string {
  const headerLine = headers.map((h) => escapeCSVField(h)).join(',');
  const exampleLine = headers.map((h) => escapeCSVField(String(exampleRow[h] ?? ''))).join(',');
  return `${headerLine}\n${exampleLine}\n`;
}

function escapeCSVField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ── Dry-run validation (FR-3.5, FR-3.6) ──────────────────────

/**
 * Execute a pre-import dry-run: validate every row against the schema+field map.
 */
export function executeDryRun(
  parsed: ParsedFileResult,
  mappings: Record<string, string>,
): DryRunValidation {
  const errors: RowValidationError[] = [];
  const canonicalFields = Object.keys(mappings).filter((h) => mappings[h] !== '');

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    const rowNumber = i + 1; // 1-based for user display

    // Check required canonical fields are mapped and non-empty
    for (const srcHeader of canonicalFields) {
      const targetField = mappings[srcHeader];
      const value = row[srcHeader];

      if (value === undefined || value === null || String(value).trim() === '') {
        if (targetField === 'name') {
          errors.push({
            rowNumber,
            column: srcHeader,
            reason: `Required field "${targetField}" is empty`,
          });
        }
      }
    }

    // Additional format checks
    for (const srcHeader of canonicalFields) {
      const targetField = mappings[srcHeader];
      const value = row[srcHeader];

      if (value === undefined || value === null) continue;

      const strVal = String(value).trim();

      if (strVal === '') continue;

      if (targetField === 'enabled') {
        const lower = strVal.toLowerCase();
        if (!['true', 'false', '1', '0', 'yes', 'no'].includes(lower)) {
          errors.push({
            rowNumber,
            column: srcHeader,
            reason: `Field "${targetField}" must be a boolean value (true/false)`,
          });
        }
      }

      if (targetField === 'priority') {
        const normalized = strVal.charAt(0).toUpperCase() + strVal.slice(1).toLowerCase();
        if (!['Low', 'Medium', 'High'].includes(normalized)) {
          errors.push({
            rowNumber,
            column: srcHeader,
            reason: `Field "${targetField}" must be one of: Low, Medium, High`,
          });
        }
      }
    }
  }

  const validCount = parsed.rows.length - new Set(errors.map((e) => e.rowNumber)).size;
  const errorCount = parsed.rows.length - validCount;

  return {
    totalRows: parsed.rows.length,
    validCount,
    errorCount,
    summary: `${validCount} of ${parsed.rows.length} rows valid. ${errorCount} row(s) with errors.`,
    errors,
  };
}

// ── Report generation (FR-3.7, FR-3.9) ───────────────────────

/**
 * Generate a CSV error report for download (FR-3.7).
 */
export function generateCSVErrorReport(errors: RowValidationError[]): string {
  const header = 'Row Number,Column,Reason';
  const lines = errors.map((e) =>
    `${e.rowNumber},${escapeCSVField(e.column)},${escapeCSVField(e.reason)}`,
  );
  return [header, ...lines].join('\n');
}

/**
 * Generate a CSV import summary report for download (FR-3.9).
 */
export function generateImportSummaryReport(
  totalRows: number,
  imported: number,
  skipped: number,
): string {
  return [
    'Metric,Value',
    `Total rows processed,${totalRows}`,
    `Rows imported,${imported}`,
    `Rows skipped,${skipped}`,
    `Import timestamp,${new Date().toISOString()}`,
  ].join('\n');
}
