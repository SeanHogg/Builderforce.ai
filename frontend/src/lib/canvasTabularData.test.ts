import { describe, expect, it } from 'vitest';
import {
  MAX_TABULAR_COLUMNS, highlightToneFor, isTabularFile, parseTabularText, profileTabular, queryTabular, tabularFromObject, toNumber,
} from './canvasTabularData';

/** Mirrors the shape of an operational shipment export: an id column plus
 * several 0/1 status counters, which is the case that previously produced
 * invented "placeholder" analytics. */
const SHIPMENTS = [
  'Shipment ID,Count Arrival Status,Count Pickup,Count Delivery,Carrier',
  'SHP-1,1,1,1,Acme',
  'SHP-2,0,0,0,Acme',
  'SHP-3,1,0,0,Globex',
  'SHP-4,0,0,0,Globex',
  'SHP-5,0,1,0,Acme',
].join('\n');

describe('parseTabularText', () => {
  it('parses CSV with quoted fields and embedded delimiters', () => {
    const source = parseTabularText('orders.csv', 'Name,Note\n"Smith, Ada","said ""ship it"""\nGrace,plain');
    expect(source.columns).toEqual(['Name', 'Note']);
    expect(source.rows).toEqual([
      { Name: 'Smith, Ada', Note: 'said "ship it"' },
      { Name: 'Grace', Note: 'plain' },
    ]);
  });

  it('parses TSV through the same quote-aware parser', () => {
    const source = parseTabularText('export.tsv', 'Region\tRevenue\nNorth\t120\nSouth\t90');
    expect(source.columns).toEqual(['Region', 'Revenue']);
    expect(source.rows[1]).toEqual({ Region: 'South', Revenue: '90' });
  });

  it('parses a JSON array and JSONL, unioning keys across records', () => {
    expect(parseTabularText('rows.json', '[{"a":1},{"a":2,"b":"x"}]').columns).toEqual(['a', 'b']);
    expect(parseTabularText('rows.jsonl', '{"a":1}\n{"a":2}').rows).toHaveLength(2);
  });

  it('keeps wide exports intact instead of truncating to a handful of columns', () => {
    const headers = Array.from({ length: 40 }, (_, index) => `Column ${index + 1}`);
    const source = parseTabularText('wide.csv', `${headers.join(',')}\n${headers.map(() => '1').join(',')}`);
    expect(source.columns).toHaveLength(40);
    expect(MAX_TABULAR_COLUMNS).toBeGreaterThanOrEqual(40);
  });

  it('recognizes tabular uploads by extension and mime type', () => {
    expect(isTabularFile('07_30_2026.csv')).toBe(true);
    expect(isTabularFile('report', 'text/csv')).toBe(true);
    expect(isTabularFile('logo.png', 'image/png')).toBe(false);
  });
});

describe('toNumber', () => {
  it('reads operational formats without manual cleaning', () => {
    expect(toNumber('1')).toBe(1);
    expect(toNumber('$1,234.50')).toBe(1234.5);
    expect(toNumber('45%')).toBe(45);
    expect(toNumber('')).toBeNull();
    expect(toNumber('SHP-1')).toBeNull();
  });
});

describe('profileTabular', () => {
  it('reports type, coverage, distinct values, and numeric range per column', () => {
    const profile = profileTabular(parseTabularText('s.csv', SHIPMENTS));
    const arrival = profile.find((column) => column.name === 'Count Arrival Status')!;
    expect(arrival.type).toBe('number');
    expect(arrival.filled).toBe(5);
    expect(arrival.distinct).toBe(2);
    expect(arrival.sum).toBe(2);
    const carrier = profile.find((column) => column.name === 'Carrier')!;
    expect(carrier.type).toBe('text');
    expect(carrier.topValues[0]).toEqual({ value: 'Acme', count: 3 });
  });
});

describe('queryTabular', () => {
  const source = parseTabularText('shipments.csv', SHIPMENTS);

  it('derives a success classification and groups it with real counts', () => {
    const result = queryTabular(source, {
      derive: [{
        name: 'Status', match: 'any', then: 'Success', otherwise: 'Failure',
        when: [
          { column: 'Count Arrival Status', op: 'eq', value: 1 },
          { column: 'Count Pickup', op: 'eq', value: 1 },
          { column: 'Count Delivery', op: 'eq', value: 1 },
        ],
      }],
      groupBy: 'Status',
    });
    expect(result.groups).toEqual([
      { key: 'Success', count: 3 },
      { key: 'Failure', count: 2 },
    ]);
    expect(result.totalRows).toBe(5);
    expect(result.matchedRows).toBe(5);
  });

  it('filters rows before grouping and aggregating', () => {
    const result = queryTabular(source, {
      filter: [{ column: 'Carrier', op: 'eq', value: 'Acme' }],
      aggregate: [{ op: 'sum', column: 'Count Delivery', label: 'delivered' }, { op: 'count', label: 'shipments' }],
    });
    expect(result.matchedRows).toBe(3);
    expect(result.aggregates).toEqual({ delivered: 1, shipments: 3 });
  });

  it('reports unknown columns instead of silently returning nothing', () => {
    expect(queryTabular(source, { groupBy: 'Delivery Status' }).unknownColumns).toEqual(['Delivery Status']);
  });

  it('sorts and limits without losing the true row totals', () => {
    const result = queryTabular(source, { select: ['Shipment ID'], sort: { column: 'Shipment ID', direction: 'desc' }, limit: 2 });
    expect(result.rows).toEqual([{ 'Shipment ID': 'SHP-5' }, { 'Shipment ID': 'SHP-4' }]);
    expect(result.matchedRows).toBe(5);
    expect(result.truncated).toBe(true);
  });

  it('supports contains, in, and emptiness comparisons', () => {
    expect(queryTabular(source, { filter: [{ column: 'Shipment ID', op: 'contains', value: 'SHP-1' }] }).matchedRows).toBe(1);
    expect(queryTabular(source, { filter: [{ column: 'Carrier', op: 'in', value: ['Globex'] }] }).matchedRows).toBe(2);
    expect(queryTabular(source, { filter: [{ column: 'Carrier', op: 'notEmpty' }] }).matchedRows).toBe(5);
  });
});

describe('highlightToneFor', () => {
  it('applies the first matching rule to a row', () => {
    const rules = [
      { column: 'Status', op: 'eq' as const, value: 'Failure', tone: 'danger' as const },
      { column: 'Status', op: 'eq' as const, value: 'Success', tone: 'success' as const },
    ];
    expect(highlightToneFor({ Status: 'Failure' }, rules)).toBe('danger');
    expect(highlightToneFor({ Status: 'Success' }, rules)).toBe('success');
    expect(highlightToneFor({ Status: 'Unknown' }, rules)).toBeNull();
  });
});

describe('tabularFromObject', () => {
  it('reads a canvas object that stores rows as records or arrays', () => {
    expect(tabularFromObject({ columns: ['a', 'b'], rows: [{ a: '1', b: '2' }] }).rows).toEqual([{ a: '1', b: '2' }]);
    expect(tabularFromObject({ columns: ['a', 'b'], rows: [['1', '2']] }).rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('falls back to the stored sample when full rows are absent', () => {
    expect(tabularFromObject({ columns: ['a'], sampleRows: [{ a: '9' }] }).rows).toEqual([{ a: '9' }]);
  });
});
