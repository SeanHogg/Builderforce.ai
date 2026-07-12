/**
 * Dashboard library — the single import surface for reusable insight widgets and
 * visualizations. Every widget and every chart is a component here, so any
 * surface ("insights everywhere") composes trends/metrics from ONE place instead
 * of re-implementing "value → chart". The smart `DashboardWidget` renders a
 * resolved metric by its `viz`; `InsightStat` is the canonical metric card; the
 * chart primitives are re-exported so callers need only this module.
 */

// Widgets
export { InsightStat, type InsightStatProps, type InsightDelta } from './InsightStat';
export { DashboardWidget } from './DashboardWidget';
export { TrendArrow, type TrendArrowProps, type TrendClassification } from './TrendArrow';
export { classifyTrend, type TrendDirection, type MetricPolarity } from './trend';

// Shared metric helpers
export {
  formatMetricValue,
  formatRecency,
  seriesDelta,
  deltaTone,
  type SeriesDelta,
  type DeltaDirection,
  type DeltaTone,
} from './metricFormat';

// Visualization primitives (re-exported — the Dashboard library is their home surface)
export { BarChart, type BarDatum, type BarChartProps } from '@/components/charts/BarChart';
export { TrendChart, type TrendSeries, type TrendChartProps } from '@/components/charts/TrendChart';
export { Sparkline, type SparklineProps } from '@/components/charts/Sparkline';
export { DonutChart } from '@/components/charts/DonutChart';
export { GaugeChart, type GaugeChartProps } from '@/components/charts/GaugeChart';
export { BandedMetricBar } from '@/components/charts/BandedMetricBar';
export { colorAt, CHART_PALETTE } from '@/components/charts/chartColors';
