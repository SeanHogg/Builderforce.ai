/**
 * Quality checks earn their place only if a green suite means something.
 *
 * So: a check that could not run must say SKIPPED rather than pass, a contract
 * must yield its checks rather than being restated, and the score must not be
 * flattered by checks that never ran.
 */
import { describe, expect, it } from 'vitest';
import {
  checksFromContract,
  dataQualityVerdict,
  normalizeDataQualityChecks,
  referenceSources,
  runDataQualityChecks,
  suggestDataQualityChecks,
} from './canvasDataQuality';
import { normalizeDataContract } from './canvasDataGovernance';
import { tabularFromObject, type TabularSource } from './canvasTabularData';

const ORDERS: TabularSource = {
  columns: ['id', 'customer_id', 'total', 'state'],
  rows: [
    { id: 'o1', customer_id: 'c1', total: 10, state: 'paid' },
    { id: 'o2', customer_id: 'c2', total: -5, state: 'paid' },
    { id: 'o2', customer_id: 'c9', total: 20, state: 'archived' },
    { id: 'o4', customer_id: '', total: 30, state: 'paid' },
  ],
};

describe('checksFromContract', () => {
  it('derives the checks rather than asking anyone to restate the rules', () => {
    const contract = normalizeDataContract({
      columns: [
        { name: 'id', type: 'text', required: true, unique: true },
        { name: 'total', type: 'number', min: 0 },
        { name: 'state', type: 'text', allowedValues: ['paid', 'refunded'] },
      ],
      primaryKey: ['id'],
      rowCountMin: 1,
      freshnessHours: 12,
    })!;
    const kinds = checksFromContract(contract).map((check) => check.kind);
    expect(kinds).toEqual(expect.arrayContaining(['notNull', 'unique', 'range', 'allowedValues', 'rowCount', 'freshness']));
    // The primary key does not add a SECOND uniqueness check for the same column.
    expect(checksFromContract(contract).filter((check) => check.kind === 'unique')).toHaveLength(1);
  });
});

describe('runDataQualityChecks', () => {
  it('counts failures exactly and samples the offenders', () => {
    const results = runDataQualityChecks(ORDERS, [
      { id: 'unique:id', kind: 'unique', column: 'id' },
      { id: 'notNull:customer_id', kind: 'notNull', column: 'customer_id' },
      { id: 'range:total', kind: 'range', column: 'total', min: 0 },
      { id: 'allowedValues:state', kind: 'allowedValues', column: 'state', values: ['paid', 'refunded'] },
    ]);
    expect(results.find((result) => result.id === 'unique:id')).toMatchObject({ status: 'fail', samples: ['o2'] });
    expect(results.find((result) => result.id === 'notNull:customer_id')!.detail.failures).toBe(1);
    expect(results.find((result) => result.id === 'range:total')!.samples).toEqual(['-5']);
    expect(results.find((result) => result.id === 'allowedValues:state')!.samples).toEqual(['archived']);
  });

  it('skips — never passes — a check whose column is absent', () => {
    const [result] = runDataQualityChecks(ORDERS, [{ id: 'x', kind: 'notNull', column: 'nope' }]);
    expect(result).toMatchObject({ status: 'skipped', detail: { reason: 'missing-column', column: 'nope' } });
  });

  it('skips a freshness check with no timestamp instead of claiming the data is fresh', () => {
    const [result] = runDataQualityChecks(ORDERS, [{ id: 'f', kind: 'freshness', hours: 1 }], { fetchedAt: null });
    expect(result!.status).toBe('skipped');
  });

  it('warns when data is past its freshness SLA', () => {
    const [result] = runDataQualityChecks(ORDERS, [{ id: 'f', kind: 'freshness', hours: 6 }], {
      fetchedAt: '2020-01-01T00:00:00.000Z',
      now: Date.parse('2020-01-02T00:00:00.000Z'),
    });
    expect(result).toMatchObject({ status: 'warn', detail: { ageHours: 24, slaHours: 6 } });
  });

  it('finds orphans across two objects', () => {
    const customers = { id: 'ds-customers', data: { columns: ['id'], rows: [{ id: 'c1' }, { id: 'c2' }] } };
    const references = referenceSources([customers], (data) => tabularFromObject(data));
    const [result] = runDataQualityChecks(ORDERS, [
      { id: 'ri', kind: 'referentialIntegrity', column: 'customer_id', referenceObjectId: 'ds-customers', referenceColumn: 'id' },
    ], { references });
    expect(result).toMatchObject({ status: 'fail', samples: ['c9'] });
    expect(result!.detail.failures).toBe(1);
  });

  it('honours a tolerance rather than failing on a single stray row', () => {
    const [strict] = runDataQualityChecks(ORDERS, [{ id: 'n', kind: 'notNull', column: 'customer_id' }]);
    const [lenient] = runDataQualityChecks(ORDERS, [{ id: 'n', kind: 'notNull', column: 'customer_id', tolerance: 0.5 }]);
    expect(strict!.status).toBe('fail');
    expect(lenient!.status).toBe('pass');
  });

  it('downgrades a warning-severity check instead of failing the suite', () => {
    const [result] = runDataQualityChecks(ORDERS, [{ id: 'n', kind: 'notNull', column: 'customer_id', severity: 'warning' }]);
    expect(result!.status).toBe('warn');
  });

  it('reports an unusable regex as skipped, not as a failure of the data', () => {
    const [result] = runDataQualityChecks(ORDERS, [{ id: 'r', kind: 'regex', column: 'id', pattern: '([' }]);
    expect(result).toMatchObject({ status: 'skipped', detail: { reason: 'bad-pattern' } });
  });
});

describe('dataQualityVerdict', () => {
  it('scores over the checks that RAN, so skipped ones cannot flatter it', () => {
    const verdict = dataQualityVerdict([
      { id: 'a', kind: 'notNull', status: 'pass', detail: {} },
      { id: 'b', kind: 'unique', status: 'fail', detail: {} },
      { id: 'c', kind: 'range', status: 'skipped', detail: {} },
    ]);
    expect(verdict).toMatchObject({ status: 'fail', passed: 1, failed: 1, skipped: 1, score: 50 });
  });

  it('is skipped overall when nothing could run', () => {
    expect(dataQualityVerdict([{ id: 'a', kind: 'notNull', status: 'skipped', detail: {} }]).status).toBe('skipped');
  });
});

describe('suggestDataQualityChecks', () => {
  it('asserts only what is obviously true today, so the first run is green', () => {
    const clean: TabularSource = {
      columns: ['id', 'note'],
      rows: [{ id: 'a', note: 'x' }, { id: 'b', note: 'y' }],
    };
    const checks = suggestDataQualityChecks(clean);
    const results = runDataQualityChecks(clean, checks);
    expect(results.every((result) => result.status === 'pass')).toBe(true);
    expect(checks.some((check) => check.kind === 'unique' && check.column === 'id')).toBe(true);
  });

  it('returns nothing for an empty source rather than asserting a row count of zero', () => {
    expect(suggestDataQualityChecks({ columns: ['a'], rows: [] })).toEqual([]);
  });
});

describe('normalizeDataQualityChecks', () => {
  it('drops unknown kinds and de-duplicates by id', () => {
    expect(normalizeDataQualityChecks([
      { kind: 'notNull', column: 'a' },
      { kind: 'notNull', column: 'a' },
      { kind: 'invented', column: 'b' },
    ])).toEqual([{ id: 'notNull:a', kind: 'notNull', column: 'a' }]);
  });
});
