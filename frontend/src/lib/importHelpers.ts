/**
 * Helper utilities for import input modes (guided + bulk).
 * File parsing, validation, error handling, and transformation logic.
 */

import { isRecordValid } from './import-input-schema';

/**
 * Supported file types for bulk imports.
 */
export type ImportFileType = 'csv' | 'json' | 'xlsx';

/**
 * File parsing result with rows extracted from uploaded file.
 */
export interface ParsedFileResult {
  fileType: ImportFileType;
  headers: string[];
  rows: Record<string, string | number | null | boolean>[];
  error?: string;
}

/**
 * Parse CSV file string into row objects.
 * Simple parser that handles quoted fields with commas inside.
 */
export function parseCSV(content: string): ParsedFileResult {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) {
    return { fileType: 'csv', headers: [], rows: [] };
  }

  // Parse header
  const headers = parseCSVLine(lines[0]).map((h) => h.trim());

  const rows: Record<string, string | number | null | boolean>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    const row: Record<string, string | number | null | boolean> = {};
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      const value = values[j] ?? null;
      // Try number conversion, keep string otherwise
      const num = Number(value);
      row[header] = isNaN(num) ? value : num;
    }
    if (Object.keys(row).length > 0) {
      rows.push(row);
    }
  }

  return { fileType: 'csv', headers, rows };
}

/**
 * Parse a single CSV line, handling quoted fields.
 * Example: "value1","value with, comma","value3"
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote: ""
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    i += 1;
  }
  result.push(current.trim());
  return result;
}

/**
 * Parse JSON file content.
 */
export function parseJSON(content: string): ParsedFileResult {
  try {
    const data = JSON.parse(content);
    if (!Array.isArray(data)) {
      throw new Error('Expected an array of objects');
    }

    const firstRow = data[0] || {};
    const headers = Object.keys(firstRow);

    const rows: Record<string, string | number | null | boolean>[] = data.map((row) => {
      const parsedRow: Record<string, string | number | null | boolean> = {};
      for (const header of headers) {
        const value = (row as Record<string, unknown>)[header];
        if (value === null || value === undefined) {
          parsedRow[header] = null;
        } else if (typeof value === 'string') {
          const num = Number(value);
          parsedRow[header] = isNaN(num) ? value : num;
        } else {
          parsedRow[header] = value;
        }
      }
      return parsedRow;
    });

    return { fileType: 'json', headers, rows };
  } catch (e) {
    return {
      fileType: 'json',
      headers: [],
      rows: [],
      error: e instanceof Error ? e.message : 'Failed to parse JSON',
    };
  }
}

/**
 * Parse uploaded file content based on file extension.
 */
export function parseFile(file: File): Promise<ParsedFileResult> {
  return new Promise((resolve) => {
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const reader = new FileReader();

    const errorsAllowed = {
      csv: 'Unsupported file type: CSV files are required.',
      json: 'Unsupported file type: JSON files are required.',
      xlsx: 'XLSX is temporarily unsupported. Use CSV or JSON until a later release.',
    };

    const readerError = !errorsAllowed[(extension as keyof typeof errorsAllowed) as ImportFileType];

    if (readerError) {
      reader.readAsText(file);
    } else {
      reader.readAsText(file);
    }

    reader.onload = (event) => {
      const content = event.target?.result as string;

      switch (extension) {
        case 'csv':
          resolve(parseCSV(content));
          break;
        case 'json':
          resolve(parseJSON(content));
          break;
        case 'xlsx':
          resolve({
            fileType: 'xlsx',
            headers: [],
            rows: [],
            error: 'XLSX support requires a parser dependency (planned for v1.1)',
          });
          break;
        default:
          resolve({
            fileType: extension,
            headers: [],
            rows: [],
            error: `Unsupported file format: ${extension}`,
          });
      }
    };

    reader.onerror = () => {
      resolve({
        fileType: extension,
        headers: [],
        rows: [],
        error: 'Failed to read file',
      });
    };
  });
}

/**
 * Convert mapped import header to canonical field key.
 */
export function mapHeaderToField(header: string, mappings: Record<string, string | null>): string {
  // Check exact match first
  if (mappings[header] !== null && mappings[header] !== undefined) {
    return mappings[header]!;
  }

  // Try case-insensitive match
  const lowerHeader = header.toLowerCase();
  for (const [mapKey, targetField] of Object.entries(mappings)) {
    if (targetField !== null && targetField !== undefined) {
      if (targetField.toLowerCase() === lowerHeader) {
        return targetField;
      }
    }
  }

  // Fallback: try to infer field
  if (lowerHeader.includes('name')) return 'name';
  if (lowerHeader.includes('desc') || lowerHeader.includes('description')) return 'description';
  if (lowerHeader.includes('ref') || lowerHeader.includes('reference')) return 'referenceId';
  if (lowerHeader.includes('enabled') || lowerHeader.includes('active')) return 'enabled';
  if (lowerHeader.includes('priority')) return 'priority';
  if (lowerHeader.includes('note') || lowerHeader.includes('remark')) return 'notes';

  // Unknown field - keep as-is
  return header;
}

/**
 * Convert canonical record to a mapped import row.
 */
export function recordToImportRow(
  record: Record<string, string | number | null | boolean>,
  fieldMappings: Record<string, string | null>
): Record<string, string | number | null> {
  const result: Record<string, string | number | null> = {};

  // Map all base fields and kind-specific fields
  for (const field of Object.keys(fieldMappings)) {
    const targetField = fieldMappings[field];
    if (targetField && record[targetField] !== undefined) {
      result[field] = record[targetField] ?? null;
    } else if (targetField) {
      result[field] = null;
    }
  }

  return result;
}

/**
 * Validate a single row against the canonical schema.
 */
export function validateRow(
  row: Record<string, string | number | boolean>,
  fieldMappings: Record<string, string | null>,
  rowNumber: number
): { valid: boolean; errors: Array<{ column: string; reason: string }> } {
  const errors: Array<{ column: string; reason: string }> = [];

  const record: Record<string, string | null> = {};
  for (const header of Object.keys(fieldMappings)) {
    const targetField = mapHeaderToField(header, fieldMappings);
    const value = String(row[header] ?? '').trim();
    record[targetField] = value || null;
  }

  if (!isRecordValid(record)) {
    // Find which required field is missing
    // TODO: This is a simplified check; the actual validation from import-input-schema.ts checks all fields
    // For now, check the common required fields
    if (!record.name || String(record.name).trim() === '') {
      errors.push({ column: 'Name', reason: 'Name is required' });
    }
    if (!record.description && record.description !== 0) {
      errors.push({ column: 'Description', reason: 'Description is required if Name is provided' });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Generate CSV template with headers and one example row.
 */
export function generateCSVTemplate(
  headers: string[],
  exampleData: Record<string, string | number | string[]>
): string {
  if (!exampleData) {
    exampleData = {
      name: 'Example Record',
      description: 'An example record for testing',
      referenceId: 'GHI-2024-001',
      enabled: true,
      priority: 'Medium',
      notes: 'Additional notes here',
    };
  }

  const rowValues = headers.map((header) => {
    const value = exampleData[header as keyof typeof exampleData];
    if (Array.isArray(value)) {
      return `"${Array.isArray(value) ? value.join(', ') : value}"`;
    }
    return String(value ?? '');
  });

  return [headers.join(','), ...rowValues.map((v) => `"${v}"`)].join('\n');
}

/**
 * Generate CSV error report.
 */
export function generateCSVErrorReport(errors: Array<{ rowNumber: number; column: string; reason: string }>): string {
  if (!errors.length) {
    return 'No errors to report';
  }

  const headers = ['Row Number', 'Column', 'Reason'];
  const rows = errors.map((e) => [e.rowNumber, e.column, e.reason]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

/**
 * Generate import summary report.
 */
export function generateImportSummaryReport(
  totalRows: number,
  validRowsCount: number,
  erroredRowsCount: number
): string {
  const headers = ['Total Rows', 'Valid Rows', 'Errored Rows', 'Skipped Rows'];
  const rows = [[totalRows, validRowsCount, erroredRowsCount, '0']];

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

/**
 * Determine import batch size threshold for async processing.
 */
export const IMPORT_ASYNC_THRESHOLD_ROWS = 500;

/**
 * Type for dry-run validation result.
 */
export interface DryRunValidation {
  totalRows: number;
  validCount: number;
  errorCount: number;
  errors: Array<{ rowNumber: number; column: string; reason: string }>;
  summary: string;
}

/**
 * Execute dry-run validation on a file.
 */
export async function executeDryRun(
  parsedResult: ParsedFileResult,
  fieldMappings: Record<string, string | null>
): Promise<DryRunValidation> {
  const errors: Array<{ rowNumber: number; column: string; reason: string }> = [];

  for (let i = 0; i < parsedResult.rows.length; i++) {
    const rowNumber = i + 2; // +2 for header row
    const row = parsedResult.rows[i];
    const validation = validateRow(row, fieldMappings, rowNumber);
    if (!validation.valid) {
      errors.push(...validation.errors);
    }
  }

  const errorCount = errors.length;

  return {
    totalRows: parsedResult.rows.length,
    validCount: parsedResult.rows.length - errorCount,
    errorCount,
    errors,
    summary: `${parsedResult.rows.length} total rows detected. ${errorCount} errored, ${parsedResult.rows.length - errorCount} valid.`,
  };
}