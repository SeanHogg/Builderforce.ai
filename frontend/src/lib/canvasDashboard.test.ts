import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_CHART_DEFINITIONS,
  DASHBOARD_CHART_KINDS,
  DASHBOARD_MAX_CATEGORIES,
  createDashboardWidget,
  dashboardChartDefinition,
  dashboardWidgetsPatch,
  deriveLegacyDashboardWidgets,
  parseLabelList,
  parseValueList,
  readDashboardWidgets,
  type DashboardWidget,
} from './canvasDashboard';

const seed = { id: 'w1', title: 'Signups', categories: ['A', 'B', 'C'], seriesName: 'Value' };

describe('the chart registry', () => {
  it('declares exactly one definition per chart kind', () => {
    expect(DASHBOARD_CHART_DEFINITIONS.map((d) => d.chart).sort()).toEqual([...DASHBOARD_CHART_KINDS].sort());
  });

  it('gives a metric widget no series and a category widget no metric', () => {
    for (const definition of DASHBOARD_CHART_DEFINITIONS) {
      if (definition.metric) expect(definition.series).toBe('none');
      if (definition.series === 'none' && !definition.metric) throw new Error(`${definition.chart} draws nothing`);
    }
  });
});

describe('readDashboardWidgets', () => {
  it('returns nothing for an unauthored dashboard — it never invents placeholder KPIs', () => {
    expect(readDashboardWidgets({ kind: 'dashboard', title: 'Performance dashboard' })).toEqual([]);
  });

  it('folds the legacy flat fields into widgets', () => {
    const widgets = readDashboardWidgets({
      kpis: [{ label: 'Reach', value: '212K', trend: '↑ 18.4%' }],
      chartTitle: 'Tasks by status',
      chartLabels: ['Done', 'Doing'],
      chartValues: [12, 5],
    });
    expect(widgets.map((w) => w.chart)).toEqual(['kpi', 'bar', 'donut']);
    expect(widgets[0]).toMatchObject({ chart: 'kpi', title: 'Reach', value: '212K', trend: '↑ 18.4%' });
    expect(widgets[1]).toMatchObject({ title: 'Tasks by status', labels: ['Done', 'Doing'] });
    expect(widgets[1]?.series[0]?.values).toEqual([12, 5]);
  });

  it('prefers stored widgets over the legacy fields', () => {
    const widgets = readDashboardWidgets({
      widgets: [{ id: 'a', chart: 'column', title: 'Mine', labels: ['x'], series: [{ id: 's', name: 'n', values: [3] }] }],
      chartLabels: ['x'],
      chartValues: [3],
    });
    expect(widgets[0]).toMatchObject({ id: 'a', chart: 'column', title: 'Mine' });
  });

  it('appends legacy content a stored widget does not already carry, so a later AI patch is never dropped', () => {
    const widgets = readDashboardWidgets({
      widgets: [{ id: 'a', chart: 'column', title: 'Mine', labels: ['x'], series: [{ id: 's', name: '', values: [3] }] }],
      chartLabels: ['Done', 'Doing'],
      chartValues: [12, 5],
    });
    expect(widgets).toHaveLength(3);
    expect(widgets.slice(1).map((w) => w.chart)).toEqual(['bar', 'donut']);
  });

  it('does not duplicate legacy content that is already stored verbatim', () => {
    const stored = deriveLegacyDashboardWidgets({ chartLabels: ['Done'], chartValues: [12] });
    const widgets = readDashboardWidgets({ widgets: stored, chartLabels: ['Done'], chartValues: [12] });
    expect(widgets).toHaveLength(stored.length);
  });

  it('accepts a bare `values` array as one unnamed series', () => {
    const widgets = readDashboardWidgets({ widgets: [{ id: 'a', chart: 'bar', labels: ['x', 'y'], values: [1, 2] }] });
    expect(widgets[0]?.series[0]?.values).toEqual([1, 2]);
  });

  it('survives malformed input instead of throwing', () => {
    expect(readDashboardWidgets({ widgets: 'nope' })).toEqual([]);
    expect(readDashboardWidgets({ widgets: [null, 7, { id: 'ok', chart: 'bar' }] })).toHaveLength(1);
    expect(readDashboardWidgets({ widgets: [{ chart: 'no-such-chart' }] })[0]?.chart).toBe('bar');
  });

  it('caps a category axis at the palette width', () => {
    const many = Array.from({ length: 30 }, (_, i) => `c${i}`);
    const widgets = readDashboardWidgets({ chartLabels: many, chartValues: many.map((_, i) => i) });
    expect(widgets[0]?.labels).toHaveLength(DASHBOARD_MAX_CATEGORIES);
  });
});

describe('dashboardWidgetsPatch', () => {
  it('clears the legacy fields so one dashboard holds one representation', () => {
    const patch = dashboardWidgetsPatch([createDashboardWidget('bar', seed)]);
    expect(patch.kpis).toBeUndefined();
    expect(patch.chartLabels).toBeUndefined();
    expect(patch.chartValues).toBeUndefined();
    expect(Array.isArray(patch.widgets)).toBe(true);
  });

  it('writes only the fields the chart kind actually reads', () => {
    const [kpi] = dashboardWidgetsPatch([createDashboardWidget('kpi', seed)]).widgets as Record<string, unknown>[];
    expect(kpi).toHaveProperty('value');
    expect(kpi).not.toHaveProperty('labels');
    const [gauge] = dashboardWidgetsPatch([createDashboardWidget('gauge', seed)]).widgets as Record<string, unknown>[];
    expect(gauge).toHaveProperty('target');
    expect(gauge).toHaveProperty('series');
  });

  it('round-trips through readDashboardWidgets unchanged', () => {
    const widgets = DASHBOARD_CHART_KINDS.map((chart, index) => createDashboardWidget(chart, { ...seed, id: `w${index}` }));
    const restored = readDashboardWidgets(dashboardWidgetsPatch(widgets));
    expect(restored.map((w) => w.chart)).toEqual(widgets.map((w) => w.chart));
    expect(restored.map((w) => w.id)).toEqual(widgets.map((w) => w.id));
  });
});

describe('createDashboardWidget', () => {
  it('seeds every kind with something drawable rather than an empty frame', () => {
    for (const chart of DASHBOARD_CHART_KINDS) {
      const widget: DashboardWidget = createDashboardWidget(chart, seed);
      const definition = dashboardChartDefinition(chart);
      if (definition.metric) expect(widget.value).not.toBe('');
      else expect(widget.series[0]?.values.length).toBeGreaterThan(0);
      if (definition.categories) expect(widget.labels.length).toBeGreaterThan(0);
      if (definition.target) expect(widget.target).not.toBeNull();
      if (definition.series === 'single') expect(widget.series).toHaveLength(1);
    }
  });
});

describe('author input parsing', () => {
  it('splits on newlines and commas and drops blanks', () => {
    expect(parseLabelList('Done\n Doing ,, Blocked\n')).toEqual(['Done', 'Doing', 'Blocked']);
  });

  it('reads a half-typed number as zero rather than NaN', () => {
    expect(parseValueList('12\nabc\n8%')).toEqual([12, 0, 8]);
  });

  it('treats the comma as a separator, not a thousands mark', () => {
    expect(parseValueList('1,200')).toEqual([1, 200]);
  });
});
