import { describe, expect, it } from 'vitest';
import { normalizeFormulas, readSheet, recalculateSheet } from './canvasSheet';

const COLUMNS = ['Line', 'Units', 'Price', 'Revenue'];
const ROWS = [
  { Line: 'Pro', Units: 100, Price: 50, Revenue: '' },
  { Line: 'Team', Units: 40, Price: 200, Revenue: '' },
  { Line: 'Total', Units: '', Price: '', Revenue: '' },
];

describe('normalizeFormulas', () => {
  it('accepts the map form and the array form', () => {
    expect(normalizeFormulas({ d2: '=B2*C2' })).toEqual({ D2: '=B2*C2' });
    expect(normalizeFormulas([{ cell: 'D2', formula: '=B2*C2' }])).toEqual({ D2: '=B2*C2' });
  });

  it('is empty for junk rather than throwing', () => {
    expect(normalizeFormulas(null)).toEqual({});
    expect(normalizeFormulas(42)).toEqual({});
  });
});

describe('recalculateSheet', () => {
  it('computes a per-cell formula and writes it into the rendered rows', () => {
    const result = recalculateSheet({ columns: COLUMNS, rows: ROWS, formulas: { D1: '=B1*C1', D2: '=B2*C2' } });
    expect(result.cells.D1.value).toBe(5_000);
    expect(result.cells.D2.value).toBe(8_000);
    expect(result.rows[0].Revenue).toBe(5_000);
    expect(result.errors).toHaveLength(0);
  });

  it('fills a whole column from one column formula', () => {
    const result = recalculateSheet({ columns: COLUMNS, rows: ROWS.slice(0, 2), formulas: { D: '=B*C' } });
    expect(result.rows.map((row) => row.Revenue)).toEqual([5_000, 8_000]);
  });

  it('orders dependants after their inputs', () => {
    const result = recalculateSheet({
      columns: COLUMNS,
      rows: ROWS,
      formulas: { D1: '=B1*C1', D2: '=B2*C2', D3: '=SUM(D1:D2)' },
    });
    expect(result.cells.D3.value).toBe(13_000);
    expect(result.order.indexOf('D3')).toBeGreaterThan(result.order.indexOf('D2'));
  });

  it('resolves a column referenced by name, after that column computes', () => {
    const result = recalculateSheet({
      columns: COLUMNS,
      rows: ROWS,
      formulas: { D: '=B*C', A3: '=SUM([Revenue])' },
    });
    // Row 3 has blank units/price, so its own D is #VALUE! and is skipped by SUM.
    expect(result.cells.A3.value).toBe(13_000);
  });

  it('matches a column name case-insensitively', () => {
    const result = recalculateSheet({ columns: COLUMNS, rows: ROWS.slice(0, 2), formulas: { A1: '=SUM([units])' } });
    expect(result.cells.A1.value).toBe(140);
  });

  it('reports a cycle instead of hanging', () => {
    const result = recalculateSheet({ columns: COLUMNS, rows: ROWS, formulas: { D1: '=D2+1', D2: '=D1+1' } });
    expect(result.cycles).toEqual(['D1', 'D2']);
    expect(result.rows[0].Revenue).toBe('#CYCLE!');
    expect(result.errors.every((error) => error.text === '#CYCLE!')).toBe(true);
  });

  it('propagates a failure into the cells that depend on it', () => {
    const result = recalculateSheet({ columns: COLUMNS, rows: ROWS, formulas: { D1: '=1/0', D2: '=D1+1' } });
    expect(result.cells.D1.error?.error).toBe('DIV0');
    expect(result.cells.D2.error).toBeDefined();
    expect(result.rows[1].Revenue).toBe('#DIV/0!');
  });

  it('names a formula key that is not an address rather than dropping it', () => {
    const result = recalculateSheet({ columns: COLUMNS, rows: ROWS, formulas: { total: '=1+1' } });
    expect(result.errors).toEqual([{ ref: 'TOTAL', text: '#REF!', message: '"TOTAL" is not a cell address or a column letter' }]);
  });

  it('recomputes the whole model against a scenario override', () => {
    const base = recalculateSheet({ columns: COLUMNS, rows: ROWS, formulas: { D: '=B*C', A3: '=SUM([Revenue])' } });
    const scenario = recalculateSheet({
      columns: COLUMNS,
      rows: ROWS,
      formulas: { D: '=B*C', A3: '=SUM([Revenue])' },
      overrides: { B1: 200 },
    });
    expect(base.cells.A3.value).toBe(13_000);
    expect(scenario.cells.A3.value).toBe(18_000);
  });

  it('does not qualify a function name as a cell when filling a column', () => {
    const result = recalculateSheet({
      columns: ['Cost', 'Rounded'],
      rows: [{ Cost: 10.44, Rounded: '' }],
      formulas: { B: '=ROUND(A,1)' },
    });
    expect(result.cells.B1.value).toBe(10.4);
  });

  it('leaves stored values untouched where no formula applies', () => {
    const result = recalculateSheet({ columns: COLUMNS, rows: ROWS, formulas: {} });
    expect(result.rows).toEqual(ROWS);
  });
});

describe('readSheet', () => {
  it('reads the shape off a canvas object and tolerates junk', () => {
    expect(readSheet({ columns: ['A'], rows: [{ A: 1 }, null], formulas: { A1: '=1' } }))
      .toEqual({ columns: ['A'], rows: [{ A: 1 }], formulas: { A1: '=1' } });
    expect(readSheet({})).toEqual({ columns: [], rows: [], formulas: {} });
  });
});
