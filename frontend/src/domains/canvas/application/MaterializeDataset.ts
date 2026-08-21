/**
 * MATERIALIZE DATASET — turn rows already on the board into a chart, a map, or a
 * profile.
 *
 * ── WHY THIS IS THE FIRST APPLICATION USE CASE ───────────────────────────────
 * PRD 22 §3.4 uses this exact code as its worked example of the defect: a
 * presentation callback performing a complete domain query and materialisation,
 * with the React graph mutation in the same function. Three callbacks inside
 * `CanvasInner` read the selected object, profiled it, ran an aggregate query,
 * built a whole new object from the result, and called `setNodes` — so the rule
 * "which column do we group by" could only be exercised by mounting 940 KB of
 * canvas in jsdom.
 *
 * ── THE SHAPE, AND WHY IT IS THIS ONE ────────────────────────────────────────
 * Identical to `lib/canvasFileImport.ts`, which is already this layer's other use
 * case and predates the folder: take what you need, return a DESCRIPTION of the
 * change, mutate nothing. The caller applies it. That is what makes every rule
 * here testable in milliseconds and what stops a second copy of "how a dataset
 * becomes a chart" appearing behind a Brain tool.
 *
 * Two things are injected rather than imported, and both for the same reason —
 * importing them would point this module outward:
 *
 *  - the TRANSLATOR, because a use case is not a component and cannot call
 *    `useTranslations`; and
 *  - `createObject`, because the object factory reads the object REGISTRY, which
 *    lives in `components/`. A port keeps the dependency pointing inward and
 *    lets a test build objects without the registry at all.
 */

import type { Edge } from '@xyflow/react';
import {
  MAX_MATERIALIZED_ROWS,
  profileTabular,
  queryTabular,
  tabularFromObject,
  type TabularSource,
} from '@/lib/canvasTabularData';
import { detectGeoColumns, mapObjectFields, mapPointsFromRows } from '@/lib/canvasGeo';
import type { CanvasObject, CanvasObjectData, CreationObjectKind } from '../domain/canvasObject';
import type { CanvasNumberFormat, CanvasTextTranslator } from '../domain/canvasText';

/** Builds a default-shaped object of a kind at a position. Supplied by the
 *  surface because the defaults come from the object registry. */
export type CanvasObjectFactory = (kind: CreationObjectKind, position: { x: number; y: number }) => CanvasObject;

/** Horizontal offset for a derived object, so the result lands BESIDE its source
 *  rather than on top of it. One number, one place — the three materialisations
 *  disagreeing about this is how a board ends up looking hand-arranged. */
const DERIVED_OFFSET_X = 440;

/** What a materialisation produced, or why it produced nothing. Refusal is a
 *  first-class result and not an exception: "this dataset has no rows yet" is an
 *  ordinary state of an object somebody just dropped on the board. */
export type MaterializeResult =
  | { ok: true; object: CanvasObject; edge: Edge; notice: string }
  | { ok: false; notice: string };

/** A profile updates the object IN PLACE, so it returns a patch rather than a new
 *  object — the source is never replaced to satisfy a derivation. */
export type ProfileResult =
  | { ok: true; patch: Partial<CanvasObjectData>; notice: string }
  | { ok: false; notice: string };

interface MaterializeDeps {
  t: CanvasTextTranslator;
  createObject: CanvasObjectFactory;
}

function sourceRows(object: CanvasObject): TabularSource | null {
  const source = tabularFromObject(object.data as Record<string, unknown>);
  return source.columns.length && source.rows.length ? source : null;
}

function derivedEdge(from: CanvasObject, to: CanvasObject, label: string): Edge {
  return { id: crypto.randomUUID(), source: from.id, target: to.id, type: 'smoothstep', label, animated: true, data: { connectionKind: 'data' } };
}

/**
 * The column a chart groups by.
 *
 * Prefer a NON-numeric column with a readable number of distinct values, then any
 * column with one, then whatever is first. Charting the first six rows verbatim —
 * which is what "just plot it" degrades to — produces a bar chart of row indices,
 * which is a picture of nothing.
 *
 * Exported because it is the interesting judgement in this file and deserves its
 * own tests: the fallback chain is where a dataset of all-unique ids or a single
 * constant column decides whether the chart is useful or absurd.
 */
export function chartGroupingColumns(source: TabularSource) {
  const profile = profileTabular(source);
  const groupable = (column: { distinct: number }) => column.distinct >= 2 && column.distinct < 25;
  const category = profile.find((column) => column.type !== 'number' && groupable(column))
    ?? profile.find(groupable)
    ?? profile[0]!;
  const measure = profile.find((column) => column.type === 'number' && column.name !== category.name);
  return { category, measure };
}

/** A dataset becomes a dashboard: group by the most informative low-cardinality
 *  column and total the first numeric measure. */
export function visualizeDataset(
  dataset: CanvasObject,
  { t, createObject }: MaterializeDeps,
  formatNumber: CanvasNumberFormat,
): MaterializeResult {
  const source = sourceRows(dataset);
  if (!source) return { ok: false, notice: t('datasetImportBeforeVisualizing') };

  const { category, measure } = chartGroupingColumns(source);
  const result = queryTabular(source, {
    groupBy: category.name,
    aggregate: measure ? [{ op: 'sum', column: measure.name, label: measure.name }] : [{ op: 'count', label: 'count' }],
    sort: { column: measure ? measure.name : 'count', direction: 'desc' },
    limit: 8,
  });
  const valueKey = measure ? measure.name : 'count';
  const chartTitle = measure
    ? t('chartTitleMeasureBy', { measure: measure.name, category: category.name })
    : t('chartTitleCountBy', { category: category.name });

  const dashboard = createObject('dashboard' as CreationObjectKind, { x: dataset.position.x + DERIVED_OFFSET_X, y: dataset.position.y });
  dashboard.data = {
    ...dashboard.data,
    title: t('datasetVisualizationTitle', { name: String(dataset.data.title) }),
    status: t('statusLive'),
    chartTitle,
    xAxisLabel: category.name,
    yAxisLabel: measure ? measure.name : t('chartCountAxis'),
    chartLabels: (result.groups ?? []).map((group) => group.key),
    chartValues: (result.groups ?? []).map((group) => Number(group[valueKey] ?? group.count)),
    kpis: [
      { label: t('kpiTotalRows'), value: formatNumber(result.totalRows) },
      { label: t('kpiGroups', { category: category.name }), value: String(result.groups?.length ?? 0) },
    ],
    sourceDatasetId: dataset.id,
    subtitle: chartTitle,
  };

  return { ok: true, object: dashboard, edge: derivedEdge(dataset, dashboard, t('edgeVisualizes')), notice: t('datasetVisualizationAdded') };
}

/**
 * "Plot on a map" — the direct counterpart to {@link visualizeDataset}.
 *
 * A dataset whose rows ALREADY carry coordinates needed a Brain turn to become a
 * map, because the only path to `materializeAs: 'map'` was `canvas_query_dataset`.
 * The detection was already here, so the UI was withholding something it could
 * see. This spends no tokens and makes no network call.
 */
export function plotDataset(
  dataset: CanvasObject,
  { t, createObject }: MaterializeDeps,
): MaterializeResult {
  const source = sourceRows(dataset);
  if (!source) return { ok: false, notice: t('datasetImportBeforePlotting') };

  const geoColumns = detectGeoColumns(source);
  const points = mapPointsFromRows(source, geoColumns, MAX_MATERIALIZED_ROWS);
  if (!points.length) {
    // NAME the columns actually looked at. "Cannot plot" is not actionable, and
    // the usual cause is a coordinate column this dataset spells differently.
    return {
      ok: false,
      notice: geoColumns.latitude && geoColumns.longitude
        ? t('datasetPlotNoCoordinates', { latitude: geoColumns.latitude, longitude: geoColumns.longitude })
        : t('datasetPlotNoGeoColumns', { columns: source.columns.join(', ') }),
    };
  }

  const map = createObject('map' as CreationObjectKind, { x: dataset.position.x + DERIVED_OFFSET_X, y: dataset.position.y });
  map.style = { width: 420, height: 380 };
  map.data = {
    ...map.data,
    ...mapObjectFields({
      title: t('datasetMapTitle', { name: String(dataset.data.title) }),
      status: t('datasetPlottedCount', { count: points.length }),
      summary: t('datasetPlotSummary', { plotted: points.length, total: source.rows.length, name: String(dataset.data.title) }),
      points,
      columns: geoColumns,
      sourceDatasetId: dataset.id,
    }),
  };

  return { ok: true, object: map, edge: derivedEdge(dataset, map, t('edgePlots')), notice: t('datasetMapAdded') };
}

/** Profile a dataset onto itself. No new object — this is the dataset describing
 *  what it holds, which is a property of it rather than a derivation from it. */
export function profileDataset(
  dataset: CanvasObject,
  t: CanvasTextTranslator,
  formatNumber: CanvasNumberFormat,
): ProfileResult {
  const source = sourceRows(dataset);
  if (!source) return { ok: false, notice: t('datasetImportBeforeProfiling') };

  const profile = profileTabular(source);
  return {
    ok: true,
    patch: {
      profile,
      rowCount: source.rows.length,
      columns: source.columns,
      summary: t('datasetProfileSummary', {
        rows: formatNumber(source.rows.length),
        columns: source.columns.length,
        complete: profile.filter((column) => !column.empty).length,
      }),
    },
    notice: t('datasetProfiled', { columns: profile.length }),
  };
}
