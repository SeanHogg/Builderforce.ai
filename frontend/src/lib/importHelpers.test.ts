import { describe, expect, it } from 'vitest';
import {
  autoMapHeaders,
  detectFileType,
  executeDryRun,
  generateCSVTemplate,
  mapRows,
  mergeImportResults,
  parseCSV,
  planBatches,
  toImportRow,
  unmappedRequiredFields,
  type ParsedFileResult,
} from './importHelpers';
import type { FieldDirective } from './import-input-schema';

const FIELDS: FieldDirective[] = [
  { key: 'eventType', type: 'string', required: true, example: 'hire' },
  { key: 'effectiveOn', type: 'dateString', required: true, example: '2026-07-01' },
  { key: 'teamId', type: 'number', required: false, example: '12' },
  { key: 'isVoluntary', type: 'bool', required: false, example: 'false' },
  { key: 'reason', type: 'string', required: false, example: null },
];

const parsed = (headers: string[], rows: Record<string, unknown>[]): ParsedFileResult => ({
  headers, rows, totalRows: rows.length, filename: 'x.csv', fileType: 'csv',
});

describe('autoMapHeaders', () => {
  it('matches headers to columns across case, spaces and underscores', () => {
    expect(autoMapHeaders(['Event Type', 'effective_on', 'TEAMID', 'colour'], FIELDS)).toEqual({
      'Event Type': 'eventType',
      effective_on: 'effectiveOn',
      TEAMID: 'teamId',
      colour: '',
    });
  });

  it('never maps two headers onto one column', () => {
    const map = autoMapHeaders(['teamId', 'team_id'], FIELDS);
    expect(Object.values(map).filter((v) => v === 'teamId')).toHaveLength(1);
  });
});

describe('unmappedRequiredFields', () => {
  it('names the required columns no header reaches', () => {
    const missing = unmappedRequiredFields({ a: 'eventType', b: '' }, FIELDS);
    expect(missing.map((f) => f.key)).toEqual(['effectiveOn']);
  });
});

describe('mapRows', () => {
  it('projects file rows onto column names and drops ignored headers', () => {
    expect(mapRows([{ 'Event Type': 'hire', colour: 'red' }], { 'Event Type': 'eventType', colour: '' })).toEqual([{ eventType: 'hire' }]);
  });
});

describe('generateCSVTemplate', () => {
  it('writes the columns as the header and the registry examples as the one row', () => {
    expect(generateCSVTemplate(FIELDS)).toBe('eventType,effectiveOn,teamId,isVoluntary,reason\nhire,2026-07-01,12,false,\n');
  });
});

describe('executeDryRun', () => {
  it('reports per-cell errors through the mapping and lists the rows that passed', () => {
    const file = parsed(['type', 'on', 'team'], [
      { type: 'hire', on: '2026-07-01', team: '12' },
      { type: '', on: '2026-07-01', team: 'x' },
      { type: 'leave', on: 'not a date', team: '' },
    ]);
    const result = executeDryRun(file, { type: 'eventType', on: 'effectiveOn', team: 'teamId' }, FIELDS);
    expect(result.totalRows).toBe(3);
    expect(result.validCount).toBe(1);
    expect(result.errorCount).toBe(2);
    expect(result.validRowNumbers).toEqual([1]);
    expect(result.errors).toEqual([
      { rowNumber: 2, column: 'type', code: 'requiredEmpty', field: 'eventType' },
      { rowNumber: 2, column: 'team', code: 'notNumber', field: 'teamId' },
      { rowNumber: 3, column: 'on', code: 'notDate', field: 'effectiveOn' },
    ]);
  });
});

describe('batching', () => {
  it('slices rows into offsets the server numbers errors from', () => {
    const rows = Array.from({ length: 1201 }, (_, i) => ({ i }));
    const batches = planBatches(rows, 500);
    expect(batches.map((b) => [b.offset, b.rows.length])).toEqual([[0, 500], [500, 500], [1000, 201]]);
  });

  it('sums batch results into one file-level result', () => {
    const merged = mergeImportResults(
      { inserted: 3, skipped: 1, errors: ['row 2: x'], dryRun: false },
      { inserted: 2, skipped: 0, errors: [], dryRun: false },
    );
    expect(merged).toEqual({ inserted: 5, skipped: 1, errors: ['row 2: x'], dryRun: false });
  });
});

describe('files', () => {
  it('accepts csv, tsv and json and nothing else', () => {
    expect(detectFileType('a.CSV')).toBe('csv');
    expect(detectFileType('a.tsv')).toBe('tsv');
    expect(detectFileType('a.json')).toBe('json');
    expect(detectFileType('a.xlsx')).toBeNull();
  });

  it('parses quoted commas and CRLF', () => {
    const { headers, rows } = parseCSV('a,b\r\n"x, y",2\r\n');
    expect(headers).toEqual(['a', 'b']);
    expect(rows).toEqual([{ a: 'x, y', b: '2' }]);
  });
});

describe('toImportRow', () => {
  it('drops empty fields so optional columns are omitted rather than sent blank', () => {
    expect(toImportRow({ eventType: 'hire', reason: '  ', teamId: '' })).toEqual({ eventType: 'hire' });
  });
});
