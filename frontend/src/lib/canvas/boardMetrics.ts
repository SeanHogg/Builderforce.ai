import {
  computeMetricSeries,
  computeMetricSet,
  readMetricDefinitions,
  type DerivedMetricValue,
  type MetricDefinition,
  type MetricValue,
} from '@/lib/canvasMetrics';
import { tabularFromObject, type TabularSource } from '@/lib/canvasTabularData';

/**
 * THE SESSION'S METRIC SET — every metric defined anywhere on a board, evaluated
 * once, the way `canvasMetrics.computeMetricSet` promises.
 *
 * ── WHY THIS IS NOT IN `canvasMetrics.ts` ────────────────────────────────────
 * The metric engine evaluates definitions against sources it is HANDED. Which
 * definitions a board carries, and which of its objects are the rows, are board
 * questions — and the engine is also called from tool results and server-rendered
 * surfaces that have no board. So this is the join, beside the other room readers.
 *
 * ── WHERE A DEFINITION LIVES ─────────────────────────────────────────────────
 * The metric tool writes a `metric` card whose definition is under `definition`;
 * everything else that carries one uses `metric`/`metrics`, which is what
 * `readMetricDefinitions` reads. Both are read here, and the first object to declare
 * an id wins — two cards titled "MRR" with one id are ONE metric, which is the
 * property the semantic layer exists for.
 */

export interface MetricBoardObject {
  id: string;
  data: Record<string, unknown>;
}

/** The most tiles one board can show before the set stops being a set and becomes a table. */
export const BOARD_METRIC_LIMIT = 40;

export function boardMetricDefinitions(objects: readonly MetricBoardObject[]): MetricDefinition[] {
  const seen = new Set<string>();
  const out: MetricDefinition[] = [];
  for (const object of objects) {
    const data = object.data;
    const read = data.kind === 'metric' && data.definition && !data.metric ? { ...data, metric: data.definition } : data;
    for (const definition of readMetricDefinitions(read)) {
      if (seen.has(definition.id)) continue;
      seen.add(definition.id);
      out.push(definition);
      if (out.length >= BOARD_METRIC_LIMIT) return out;
    }
  }
  return out;
}

/** Every object that carries rows, keyed by object id — what a definition's
 *  `sourceObjectId` points at. Objects with no rows are skipped before they are read. */
export function boardTabularSources(objects: readonly MetricBoardObject[]): Map<string, TabularSource> {
  const sources = new Map<string, TabularSource>();
  for (const object of objects) {
    if (!Array.isArray(object.data.rows) && !Array.isArray(object.data.sampleRows)) continue;
    const source = tabularFromObject(object.data);
    if (source.columns.length && source.rows.length) sources.set(object.id, source);
  }
  return sources;
}

export interface BoardMetricReading {
  definition: MetricDefinition;
  value: MetricValue | DerivedMetricValue;
  /** Why it could not be computed. Rendered instead of a zero — a margin of 0% on a
   *  missing COGS is the most dangerous wrong answer this layer can give. */
  error: string | null;
  derived: boolean;
  /** The latest buckets of a grained metric, oldest first, for the trend line. */
  series: number[] | null;
}

export function boardMetricReadings(objects: readonly MetricBoardObject[]): BoardMetricReading[] {
  const definitions = boardMetricDefinitions(objects);
  if (!definitions.length) return [];
  const sources = boardTabularSources(objects);
  const values = computeMetricSet(definitions, sources);
  return definitions.map((definition, index) => {
    const value = values[index]!;
    const error = 'error' in value && typeof value.error === 'string' ? value.error : null;
    const source = sources.get(definition.id) ?? (definition.sourceObjectId ? sources.get(definition.sourceObjectId) : undefined);
    const series = !error && !definition.expression && source && definition.timeGrain
      ? computeMetricSeries(source, definition)?.values.slice(-24) ?? null
      : null;
    return { definition, value, error, derived: Boolean(definition.expression), series: series && series.length > 1 ? series : null };
  });
}

export interface MetricSetSummary {
  total: number;
  withTarget: number;
  ahead: number;
  onTrack: number;
  behind: number;
  errored: number;
}

export function summarizeMetricReadings(readings: readonly BoardMetricReading[]): MetricSetSummary {
  const summary: MetricSetSummary = { total: readings.length, withTarget: 0, ahead: 0, onTrack: 0, behind: 0, errored: 0 };
  for (const reading of readings) {
    if (reading.error) { summary.errored += 1; continue; }
    if (!reading.value.status) continue;
    summary.withTarget += 1;
    if (reading.value.status === 'ahead') summary.ahead += 1;
    else if (reading.value.status === 'on-track') summary.onTrack += 1;
    else summary.behind += 1;
  }
  return summary;
}

const STATUS_RANK: Record<string, number> = { behind: 0, 'on-track': 1, ahead: 2 };

/**
 * The reading order: what needs attention first. Behind target leads — that is the
 * insight the board is for — then on track, ahead, metrics with no target, and the
 * ones that could not be computed last, where they still say why.
 */
export function orderMetricReadings(readings: readonly BoardMetricReading[]): BoardMetricReading[] {
  const rank = (reading: BoardMetricReading) => (reading.error ? 4 : reading.value.status ? STATUS_RANK[reading.value.status] ?? 3 : 3);
  return readings
    .map((reading, index) => ({ reading, index }))
    .sort((a, b) => rank(a.reading) - rank(b.reading) || a.index - b.index)
    .map(({ reading }) => reading);
}
