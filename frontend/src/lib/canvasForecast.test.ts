import { describe, expect, it } from 'vitest';
import { forecastSeries, seriesFromDataset } from './canvasForecast';

const point = (label: string, value: number) => ({ label, value });

describe('forecastSeries', () => {
  it('projects a clean trend and reports a perfect fit', () => {
    const result = forecastSeries([point('2026-01', 10), point('2026-02', 20), point('2026-03', 30)], 2);
    expect(result.slope).toBe(10);
    expect(result.r2).toBe(1);
    expect(result.projection).toBe(40);
    expect(result.forecast).toEqual([point('2026-04', 40), point('2026-05', 50)]);
  });

  it('extends year and day labels, and never fabricates a date it cannot derive', () => {
    expect(forecastSeries([point('2024', 1), point('2025', 2)], 1).forecast[0].label).toBe('2026');
    expect(forecastSeries([point('2026-01-30', 1), point('2026-01-31', 2)], 1).forecast[0].label).toBe('2026-02-01');
    expect(forecastSeries([point('Q1', 1), point('Q2', 2)], 1).forecast[0].label).toBe('+1');
  });

  it('rolls a December projection into the next year', () => {
    expect(forecastSeries([point('2026-11', 1), point('2026-12', 2)], 2).forecast.map((p) => p.label))
      .toEqual(['2027-01', '2027-02']);
  });

  it('degrades to a flat line rather than a NaN for a one-point series', () => {
    const result = forecastSeries([point('2026-01', 7)], 3);
    expect(result.slope).toBe(0);
    expect(result.projection).toBe(7);
    expect(result.forecast.every((p) => p.value === 7)).toBe(true);
  });

  it('flags an outlier against the TREND, not against the raw mean', () => {
    // On a growing series every early point is far below the raw average. Testing the
    // residual is what makes this "unusual given the trend" instead of "small".
    const result = forecastSeries([
      point('2026-01', 10), point('2026-02', 20), point('2026-03', 30),
      point('2026-04', 95), point('2026-05', 50), point('2026-06', 60),
    ], 0);
    expect(result.anomalies).toHaveLength(1);
    expect(result.anomalies[0].label).toBe('2026-04');
    expect(result.anomalies[0].z).toBeGreaterThan(2);
  });

  it('flags nothing on a perfectly linear series', () => {
    expect(forecastSeries([point('a', 1), point('b', 2), point('c', 3), point('d', 4)], 0).anomalies).toEqual([]);
  });
});

describe('seriesFromDataset', () => {
  const source = {
    columns: ['date', 'revenue'],
    rows: [
      { date: '2026-01-15', revenue: 100 },
      { date: '2026-01-20', revenue: 50 },
      { date: '2026-03-02', revenue: 400 },
    ],
  };

  it('buckets and totals by month', () => {
    const series = seriesFromDataset(source, 'date', 'revenue', 'month');
    expect(series[0]).toEqual(point('2026-01', 150));
    expect(series[series.length - 1]).toEqual(point('2026-03', 400));
  });

  it('fills the empty period instead of compressing the axis', () => {
    // Skipping February would steepen every trend drawn through the series.
    const series = seriesFromDataset(source, 'date', 'revenue', 'month');
    expect(series.map((p) => p.label)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(series[1]).toEqual(point('2026-02', 0));
  });

  it('returns nothing when the date column parses to nothing', () => {
    expect(seriesFromDataset(source, 'revenue', 'revenue', 'month')).toEqual([]);
  });
});
