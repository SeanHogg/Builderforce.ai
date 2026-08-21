/**
 * The three materialisations, asserted without mounting a canvas.
 *
 * PRD 22 §3.4 named this code as its worked example of the defect. The rule these
 * tests exercise hardest — WHICH column a chart groups by — was previously only
 * reachable through a full board render, which is why it had none.
 */

import { describe, expect, it, vi } from 'vitest';
import { chartGroupingColumns, plotDataset, profileDataset, visualizeDataset } from './MaterializeDataset';
import type { CanvasObjectFactory } from './MaterializeDataset';
import type { CanvasObject, CreationObjectKind } from '../domain/canvasObject';

/** Echoes the key and its values, so an assertion names the message that was
 *  chosen rather than the English that happened to be in the catalog. */
const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key}(${Object.entries(values).map(([name, value]) => `${name}=${value}`).join(',')})` : key;

const formatNumber = (value: number) => `#${value}`;

const createObject: CanvasObjectFactory = (kind, position) => ({
  id: `new-${kind}`,
  type: 'creation',
  position,
  data: { kind, title: kind },
});

const deps = { t, createObject };

function dataset(data: Record<string, unknown>, position = { x: 100, y: 50 }): CanvasObject {
  return { id: 'ds', type: 'creation', position, data: { kind: 'dataset' as CreationObjectKind, title: 'Sales', ...data } };
}

const SALES = dataset({
  columns: ['region', 'amount'],
  rows: [
    { region: 'North', amount: 10 },
    { region: 'North', amount: 5 },
    { region: 'South', amount: 20 },
  ],
});

describe('chartGroupingColumns', () => {
  it('groups by a low-cardinality non-numeric column and measures the numeric one', () => {
    const { category, measure } = chartGroupingColumns({
      columns: ['region', 'amount'],
      rows: [{ region: 'North', amount: 1 }, { region: 'South', amount: 2 }],
    });
    expect(category.name).toBe('region');
    expect(measure?.name).toBe('amount');
  });

  it('never measures the column it grouped by', () => {
    const { category, measure } = chartGroupingColumns({
      columns: ['score'],
      rows: [{ score: 1 }, { score: 2 }, { score: 3 }],
    });
    expect(measure?.name).not.toBe(category.name);
  });

  it('falls back past an all-unique id column, which would chart row indices', () => {
    const rows = Array.from({ length: 40 }, (_, index) => ({ id: `row-${index}`, tier: index % 3 === 0 ? 'gold' : 'silver' }));
    expect(chartGroupingColumns({ columns: ['id', 'tier'], rows }).category.name).toBe('tier');
  });

  it('falls back past a CONSTANT column, which would chart one bar', () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({ currency: 'USD', region: index % 2 ? 'North' : 'South' }));
    expect(chartGroupingColumns({ columns: ['currency', 'region'], rows }).category.name).toBe('region');
  });

  it('still returns a column when nothing is groupable, rather than nothing to chart', () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({ id: `only-${index}` }));
    expect(chartGroupingColumns({ columns: ['id'], rows }).category.name).toBe('id');
  });
});

describe('visualizeDataset', () => {
  it('refuses a dataset with no rows, and says why', () => {
    const result = visualizeDataset(dataset({ columns: [], rows: [] }), deps, formatNumber);
    expect(result).toEqual({ ok: false, notice: 'datasetImportBeforeVisualizing' });
  });

  it('builds a dashboard from the grouped totals, not from the raw rows', () => {
    const result = visualizeDataset(SALES, deps, formatNumber);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.object.data.chartLabels).toEqual(['South', 'North']);
    expect(result.object.data.chartValues).toEqual([20, 15]);
    expect(result.object.data.xAxisLabel).toBe('region');
    expect(result.object.data.yAxisLabel).toBe('amount');
  });

  it('lands the dashboard BESIDE its source, at the same height', () => {
    const result = visualizeDataset(SALES, deps, formatNumber);
    if (!result.ok) throw new Error('expected a dashboard');
    expect(result.object.position).toEqual({ x: 540, y: 50 });
  });

  it('connects the dashboard back to the dataset as a DATA edge', () => {
    const result = visualizeDataset(SALES, deps, formatNumber);
    if (!result.ok) throw new Error('expected a dashboard');
    expect(result.edge).toMatchObject({ source: 'ds', target: result.object.id, data: { connectionKind: 'data' } });
    expect(result.object.data.sourceDatasetId).toBe('ds');
  });

  it('counts rows when there is no numeric measure to total', () => {
    const result = visualizeDataset(dataset({ columns: ['tier'], rows: [{ tier: 'gold' }, { tier: 'gold' }, { tier: 'silver' }] }), deps, formatNumber);
    if (!result.ok) throw new Error('expected a dashboard');
    expect(result.object.data.chartValues).toEqual([2, 1]);
    expect(result.object.data.yAxisLabel).toBe('chartCountAxis');
  });

  it('formats the row-count KPI through the injected formatter, not String()', () => {
    const result = visualizeDataset(SALES, deps, formatNumber);
    if (!result.ok) throw new Error('expected a dashboard');
    expect(result.object.data.kpis).toContainEqual({ label: 'kpiTotalRows', value: '#3' });
  });
});

describe('plotDataset', () => {
  const GEO = dataset({
    columns: ['city', 'lat', 'lng'],
    rows: [{ city: 'Lisbon', lat: 38.7, lng: -9.1 }, { city: 'Oslo', lat: 59.9, lng: 10.7 }],
  });

  it('refuses a dataset with no rows', () => {
    expect(plotDataset(dataset({ columns: [], rows: [] }), deps)).toEqual({ ok: false, notice: 'datasetImportBeforePlotting' });
  });

  it('plots rows that already carry coordinates', () => {
    const result = plotDataset(GEO, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.object.style).toEqual({ width: 420, height: 380 });
    expect(result.edge).toMatchObject({ source: 'ds', data: { connectionKind: 'data' } });
  });

  it('NAMES the columns it looked at when no coordinate column is found', () => {
    const result = plotDataset(dataset({ columns: ['name', 'total'], rows: [{ name: 'a', total: 1 }] }), deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.notice).toContain('datasetPlotNoGeoColumns');
    expect(result.notice).toContain('name, total');
  });

  it('names the coordinate columns when they exist but hold nothing plottable', () => {
    const result = plotDataset(dataset({ columns: ['lat', 'lng'], rows: [{ lat: null, lng: null }] }), deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.notice).toContain('datasetPlotNoCoordinates');
    expect(result.notice).toContain('latitude=lat');
  });
});

describe('profileDataset', () => {
  it('refuses a dataset with no rows', () => {
    expect(profileDataset(dataset({ columns: [], rows: [] }), t, formatNumber)).toEqual({ ok: false, notice: 'datasetImportBeforeProfiling' });
  });

  it('returns a PATCH — a profile describes the dataset, it does not derive a new one', () => {
    const result = profileDataset(SALES, t, formatNumber);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patch.rowCount).toBe(3);
    expect(result.patch.columns).toEqual(['region', 'amount']);
    expect(Array.isArray(result.patch.profile)).toBe(true);
    expect(result).not.toHaveProperty('object');
  });

  it('reports how many columns were profiled', () => {
    const result = profileDataset(SALES, t, formatNumber);
    if (!result.ok) throw new Error('expected a profile');
    expect(result.notice).toBe('datasetProfiled(columns=2)');
  });
});

describe('the object factory is a PORT', () => {
  it('is the only way an object is built, so the registry is never reached from here', () => {
    const factory = vi.fn(createObject);
    visualizeDataset(SALES, { t, createObject: factory }, formatNumber);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith('dashboard', { x: 540, y: 50 });
  });
});
