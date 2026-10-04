/** Querying tabular objects — query, join and classify datasets. */
import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { MAX_MATERIALIZED_ROWS, profileTabular, queryTabular, TABULAR_AGGREGATE_OPERATORS, TABULAR_FILTER_OPERATORS, TABULAR_TIME_GRAINS, TABULAR_WINDOW_OPERATORS, tabularFromObject, type TabularHighlightRule, type TabularQuery } from '@/lib/canvasTabularData';
import { detectGeoColumns, mapObjectFields, mapPointsFromRows } from '@/lib/canvasGeo';
import type { CreationObjectKind } from '../types';
import { lineagePatch } from '@/lib/canvasLineage';
import { sanitizeCreationObjectPatch } from '../creationObjectRegistry';
import { joinTabular, normalizeJoinSpec, suggestJoinKeys, TABULAR_JOIN_TYPES, type TabularJoinKey } from '@/lib/canvasTabularJoin';
import { classificationSummary, classifyTabular, DATA_CLASSIFICATIONS, normalizeClassifications, PII_CATEGORIES } from '@/lib/canvasDataGovernance';
import type { CanvasActionContext } from './context';

export function canvasDataQueryActions(ctx: CanvasActionContext): BrainAction[] {
  const { canEdit, fmt, resolveTabularTarget, stage } = ctx;
  return [  {
    name: 'canvas_query_dataset',
    description: 'Compute real values from a Dataset, Table, or Spreadsheet object on this canvas, and optionally build the resulting Table, Chart, Dashboard, or KPI. This runs over every imported row, not the sample in the snapshot. Use it for any counting, totalling, ranking, comparison, success/failure split, or visualization of uploaded data. Never estimate, sample, or invent numbers when this tool can compute them.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        datasetId: { type: 'string', description: 'Object id of the dataset. Omit when the canvas holds exactly one tabular object.' },
        select: { type: 'array', items: { type: 'string' }, description: 'Columns to return. Omit for every column.' },
        filter: {
          type: 'array', description: 'Row conditions applied before grouping.',
          items: { type: 'object', required: ['column'], additionalProperties: false, properties: { column: { type: 'string' }, op: { type: 'string', enum: [...TABULAR_FILTER_OPERATORS] }, value: { description: 'Comparison value, or an array for in/notIn.' } } },
        },
        filterMatch: { type: 'string', enum: ['all', 'any'], description: 'Whether every filter must match, or any one of them. Defaults to all.' },
        derive: {
          type: 'array',
          description: 'Computed columns evaluated before filtering and grouping. Use this to classify rows, for example a Status column that is "Success" when a count column equals 1 and "Failure" otherwise.',
          items: { type: 'object', required: ['name', 'when', 'then'], additionalProperties: false, properties: {
            name: { type: 'string' },
            when: { type: 'array', items: { type: 'object', required: ['column'], additionalProperties: false, properties: { column: { type: 'string' }, op: { type: 'string', enum: [...TABULAR_FILTER_OPERATORS] }, value: {} } } },
            match: { type: 'string', enum: ['all', 'any'] },
            then: { type: 'string' }, otherwise: { type: 'string' },
          } },
        },
        timeGrain: {
          type: 'object', required: ['column', 'grain'], additionalProperties: false,
          description: 'Bucket a date column to a calendar grain BEFORE grouping. This is how "by month" / "by week" questions are answered — never bucket dates by hand.',
          properties: { column: { type: 'string' }, grain: { type: 'string', enum: [...TABULAR_TIME_GRAINS] }, as: { type: 'string', description: 'Output column name. Defaults to <column>_<grain>.' } },
        },
        groupBy: {
          description: 'Column(s) to group by — a string, or an array of up to 4 for a composite breakdown such as ["month","region"]. Returns one row per combination with real counts.',
          anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' }, maxItems: 4 }],
        },
        aggregate: { type: 'array', items: { type: 'object', required: ['op'], additionalProperties: false, properties: { op: { type: 'string', enum: [...TABULAR_AGGREGATE_OPERATORS] }, column: { type: 'string' }, label: { type: 'string' } } } },
        having: {
          type: 'array', description: 'Conditions applied to the GROUPED rows after aggregation, e.g. keep only groups whose count exceeds 10. Filter the rows with `filter`; filter the groups with this.',
          items: { type: 'object', required: ['column'], additionalProperties: false, properties: { column: { type: 'string' }, op: { type: 'string', enum: [...TABULAR_FILTER_OPERATORS] }, value: {} } },
        },
        window: {
          type: 'array',
          description: 'Row-relative calculations over the sorted result: running totals, rank within a segment, share of the whole, and period-over-period movement. Use these instead of computing a trend by hand.',
          items: { type: 'object', required: ['op'], additionalProperties: false, properties: {
            op: { type: 'string', enum: [...TABULAR_WINDOW_OPERATORS] },
            column: { type: 'string', description: 'Numeric column the calculation reads. Defaults to the first aggregate.' },
            partitionBy: { description: 'Restart per distinct value of these columns.', anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
            as: { type: 'string' },
            periods: { type: 'number', description: 'Look-back length for movingAverage, lag, delta and percentChange. Defaults to 3 for movingAverage and 1 otherwise.' },
          } },
        },
        sort: { type: 'object', additionalProperties: false, properties: { column: { type: 'string' }, direction: { type: 'string', enum: ['asc', 'desc'] } } },
        limit: { type: 'number' },
        materializeAs: { type: 'string', enum: ['none', 'table', 'chart', 'dashboard', 'kpi', 'map'], description: 'Build a canvas object populated with the real query result. Use "table" for a row-level breakdown, "chart" or "dashboard" for a grouped visualization, and "map" to plot rows geographically — "map" requires latitude and longitude columns, which builtin_geo_geocode can add to a dataset of place names.' },
        title: { type: 'string', description: 'Title for the materialized object.' },
        mapValueColumn: { type: 'string', description: 'For materializeAs "map": the numeric column that sizes each marker.' },
        mapRegionName: { type: 'string', description: 'For materializeAs "map": the enclosing region shown on the card, e.g. "Michigan".' },
        mapRegion: { type: 'array', items: { type: 'number' }, description: 'For materializeAs "map": [south, north, west, east] to fit the viewport to, exactly as builtin_geo_geocode returns in boundingBox. Omit to fit the plotted points.' },
        mapOutline: { description: 'For materializeAs "map": a boundary to draw behind the points — pass builtin_geo_geocode\'s outline value for the enclosing region straight through.' },
        mapAttribution: { type: 'string', description: 'For materializeAs "map": the geocoder attribution string to print under the map.' },
        highlight: {
          type: 'array', description: 'Row colouring for a materialized table. The first matching rule wins.',
          items: { type: 'object', required: ['column', 'tone'], additionalProperties: false, properties: { column: { type: 'string' }, op: { type: 'string', enum: [...TABULAR_FILTER_OPERATORS] }, value: {}, tone: { type: 'string', enum: ['success', 'warning', 'danger', 'info'] } } },
        },
      },
    },
    mutates: (raw: unknown) => (raw as { materializeAs?: unknown })?.materializeAs != null && (raw as { materializeAs?: unknown }).materializeAs !== 'none',
    run: (raw: unknown) => {
      const args = raw as TabularQuery & {
        datasetId?: string; materializeAs?: string; title?: string; highlight?: TabularHighlightRule[];
        mapValueColumn?: string; mapRegionName?: string; mapRegion?: unknown; mapOutline?: unknown; mapAttribution?: string;
      };
      const candidates = stage.nodes().filter((node) => ['dataset', 'table', 'spreadsheet'].includes(node.data.kind) && Array.isArray(node.data.rows) && node.data.rows.length > 0);
      const target = args.datasetId ? candidates.find((node) => node.id === args.datasetId) : candidates.length === 1 ? candidates[0] : undefined;
      if (!target) {
        return { error: candidates.length
          ? `Specify which dataset to query. Tabular objects on this canvas: ${candidates.map((node) => `${node.id} (${node.data.title})`).join(', ')}`
          : 'No dataset with imported rows is on this canvas. Ask the user to attach a CSV, TSV, or JSON file, or import one from the Dataset inspector.' };
      }
      const source = tabularFromObject(target.data as Record<string, unknown>);
      if (!source.rows.length) return { error: `${target.data.title} has no imported rows yet` };
      const result = queryTabular(source, args);
      if (result.unknownColumns.length) {
        return { error: `Unknown column(s): ${result.unknownColumns.join(', ')}. Available columns: ${source.columns.join(', ')}` };
      }
      const materializeAs = ['table', 'chart', 'dashboard', 'kpi', 'map'].includes(String(args.materializeAs)) ? String(args.materializeAs) as 'table' | 'chart' | 'dashboard' | 'kpi' | 'map' : null;
      // Resolve geography BEFORE anything is proposed, so a plot with no coordinates
      // fails with the columns it actually looked at rather than staging an empty map.
      const geoColumns = materializeAs === 'map' ? detectGeoColumns({ columns: result.columns, rows: result.rows }, args.mapValueColumn) : null;
      const mapPoints = geoColumns ? mapPointsFromRows({ columns: result.columns, rows: result.rows }, geoColumns, MAX_MATERIALIZED_ROWS) : [];
      if (materializeAs === 'map' && !mapPoints.length) {
        return {
          error: geoColumns?.latitude && geoColumns.longitude
            ? `No row in this result has a usable coordinate pair in ${geoColumns.latitude}/${geoColumns.longitude}.`
            : `This result has no latitude/longitude columns, so it cannot be plotted. Available columns: ${result.columns.join(', ')}. Resolve the place names with builtin_geo_geocode, write the returned lat/lng back onto the dataset rows with canvas_update_object, then plot it.`,
        };
      }
      const payload = {
        datasetId: target.id, datasetTitle: target.data.title,
        columns: result.columns, rows: result.rows.slice(0, 20),
        totalRows: result.totalRows, matchedRows: result.matchedRows, returnedRows: result.returnedRows, truncated: result.truncated,
        ...(result.groups ? { groups: result.groups } : {}),
        ...(result.aggregates ? { aggregates: result.aggregates } : {}),
        computedFromEveryRow: true,
      };
      if (!materializeAs) return payload;
      if (!canEdit) return { ...payload, error: 'The current session role cannot edit this canvas' };
      const kind: CreationObjectKind = materializeAs;
      const existing = stage.nodes().find((node) => node.data.kind === kind && node.data.sourceDatasetId === target.id);
      const title = typeof args.title === 'string' && args.title.trim()
        ? args.title.trim().slice(0, 160)
        : `${target.data.title} ${materializeAs === 'kpi' ? 'metric' : materializeAs}`;
      const highlightRules = Array.isArray(args.highlight)
        ? args.highlight.filter((rule) => rule?.column && rule.tone).slice(0, 20)
        : [];
      // `groupBy` is one column OR several (a composite "by month by region" breakdown).
      // Normalized once here because three places below read it, and each of them was
      // written against the single-column shape: `column !== args.groupBy` is never true
      // for an array, so the value column resolved to the FIRST grouping key and every
      // composite breakdown charted its own labels as its values.
      const groupByColumns = (Array.isArray(args.groupBy) ? args.groupBy : args.groupBy ? [args.groupBy] : []).filter((column): column is string => typeof column === 'string');
      const groupByLabel = groupByColumns.join(' · ');
      const valueKey = result.columns.find((column) => !groupByColumns.includes(column)) ?? 'count';
      // The TRANSFORM travels with the artifact. Recording only WHICH dataset a
      // chart came from — and not HOW — is why a chart could never be recomputed
      // when its source moved, why nothing knew it had gone stale, and why "what
      // breaks if I drop this column" had no answer. See lib/canvasLineage.
      const provenance = lineagePatch([target.id], {
        engine: 'tabular',
        query: args as TabularQuery,
        rowsIn: result.totalRows,
        rowsOut: result.returnedRows,
      }, { columns: result.columns });
      const fields: Record<string, unknown> = materializeAs === 'table'
        ? {
          title, columns: result.columns, rows: result.rows.slice(0, MAX_MATERIALIZED_ROWS), rowCount: result.matchedRows,
          sampleRows: result.rows.slice(0, 8), ...(highlightRules.length ? { highlightRules } : {}),
          status: `${fmt.number(result.matchedRows)} of ${fmt.number(result.totalRows)} rows`,
          summary: `${fmt.number(result.matchedRows)} matching rows of ${fmt.number(result.totalRows)} in ${target.data.title}.`,
          sourceDatasetId: target.id,
        }
        : materializeAs === 'kpi'
          ? {
            title, value: String(Object.values(result.aggregates ?? { count: result.matchedRows })[0] ?? result.matchedRows),
            status: 'Live', summary: `Computed from ${fmt.number(result.totalRows)} rows in ${target.data.title}.`, sourceDatasetId: target.id,
          }
          : materializeAs === 'map'
            // Same builder the Dataset inspector's "Plot on a map" uses — see
            // `mapObjectFields`. Only the copy differs (model-facing here, localized
            // there); the field assembly, region/outline sanitization and the
            // MultiPolygon flattening are shared so the two paths cannot drift.
            ? mapObjectFields({
              title,
              status: `${fmt.number(mapPoints.length)} plotted`,
              summary: `${fmt.number(mapPoints.length)} of ${fmt.number(result.matchedRows)} matching rows in ${target.data.title} have coordinates and are plotted.`,
              points: mapPoints,
              columns: geoColumns ?? { latitude: null, longitude: null, label: null, value: null },
              sourceDatasetId: target.id,
              region: args.mapRegion,
              regionName: args.mapRegionName,
              outline: args.mapOutline,
              attribution: args.mapAttribution,
            })
            : {
            title, status: 'Live',
            chartTitle: title,
            ...(groupByLabel ? { xAxisLabel: groupByLabel } : {}),
            yAxisLabel: valueKey,
            // A composite breakdown has no single label column, so the label is every
            // grouping key joined — which is also what `result.groups[].key` already
            // holds when the query grouped, hence the preference order.
            chartLabels: (result.groups ?? result.rows).map((row, index) => {
              const record = row as Record<string, unknown>;
              if (record.key != null) return String(record.key);
              const composite = groupByColumns.map((column) => record[column]).filter((value) => value != null).join(' · ');
              return composite || `Row ${index + 1}`;
            }),
            chartValues: (result.groups ?? result.rows).map((row) => Number((row as Record<string, unknown>)[valueKey] ?? (row as { count?: number }).count ?? 0)),
            // A null aggregate means "not computable over these rows" — a median
            // of an empty column. Dropping the chip is right; printing "null"
            // beside three real numbers reads as a value that was measured.
            kpis: Object.entries(result.aggregates ?? {})
              .flatMap(([label, value]) => value == null ? [] : [{ label, value: fmt.number(value) }])
              .slice(0, 4),
            summary: `Computed from ${fmt.number(result.totalRows)} rows in ${target.data.title}.`,
            sourceDatasetId: target.id,
          };
      // Spread AFTER the branch so every materialized kind carries it — the map
      // builder is shared with the inspector and must not have to know about it.
      const patch = sanitizeCreationObjectPatch(kind, { ...fields, ...provenance });
      if (existing) {
        stage.updateObject(`Update ${kind} “${title}”`, existing.id, patch);
        return { ...payload, proposed: true, materialized: { id: existing.id, kind, title, updated: true } };
      }
      const node = stage.createObject(kind, { x: target.position.x + 460, y: target.position.y });
      node.data = { ...node.data, ...patch };
      if (kind === 'table') node.style = { width: 720, height: 460 };
      if (kind === 'map') node.style = { width: 420, height: 380 };
      stage.addObject(`Add ${kind} “${title}”`, node);
      stage.addConnection(
        `Connect ${target.data.title} to ${title}`,
        { id: crypto.randomUUID(), source: target.id, target: node.id, type: 'smoothstep', animated: true, label: 'computed from', data: { connectionKind: 'data' } },
      );
      return { ...payload, proposed: true, materialized: { id: node.id, kind, title, created: true } };
    },
  },   {
    /**
     * The `data` edge, finally given meaning.
     *
     * Two datasets sharing a key could sit side by side with a line drawn between
     * them and still not be relatable, because the query engine took exactly one
     * source. A join is what makes a board of datasets a data model rather than a
     * pile of spreadsheets — and the fan-out and unmatched counts are returned
     * because a join that silently multiplied its rows is how a confidently wrong
     * total gets charted.
     */
    name: 'canvas_join_datasets',
    description: 'Relate TWO tabular objects on the canvas on a shared key, producing a Table with the combined columns. Use this whenever a question spans two datasets ("which customers from the CRM export have open tickets"). Omit `on` to have the join keys detected from matching column names and overlapping values. Reports unmatched rows and row fan-out, which are what decide whether the join is trustworthy.',
    parameters: {
      type: 'object', required: ['leftId', 'rightId'], additionalProperties: false,
      properties: {
        leftId: { type: 'string', description: 'Object id of the left (driving) dataset.' },
        rightId: { type: 'string', description: 'Object id of the right (looked-up) dataset.' },
        type: { type: 'string', enum: [...TABULAR_JOIN_TYPES], description: 'inner keeps only matched rows; left keeps every left row. Defaults to inner.' },
        on: {
          type: 'array', description: 'Join keys. Omit to detect them.',
          items: { type: 'object', required: ['left', 'right'], additionalProperties: false, properties: { left: { type: 'string' }, right: { type: 'string' } } },
        },
        select: { type: 'array', items: { type: 'string' }, description: 'Columns to keep. Omit for every column of both sides.' },
        rightAlias: { type: 'string', description: 'Prefix for right-hand columns whose names collide. Defaults to "right".' },
        title: { type: 'string' },
        limit: { type: 'number' },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { leftId?: string; rightId?: string; type?: string; on?: TabularJoinKey[]; select?: string[]; rightAlias?: string; title?: string; limit?: number };
      const all = stage.nodes();
      const left = all.find((node) => node.id === args.leftId);
      const right = all.find((node) => node.id === args.rightId);
      if (!left || !right) return { error: 'Both leftId and rightId must be objects on this canvas.' };
      if (left.id === right.id) return { error: 'A dataset cannot be joined to itself here.' };
      const leftSource = tabularFromObject(left.data as Record<string, unknown>);
      const rightSource = tabularFromObject(right.data as Record<string, unknown>);
      if (!leftSource.rows.length || !rightSource.rows.length) return { error: 'Both objects need imported rows before they can be joined.' };

      const keys = args.on?.length ? args.on : suggestJoinKeys(leftSource, rightSource);
      if (!keys.length) {
        return { error: `No shared key was found between ${left.data.title} (${leftSource.columns.join(', ')}) and ${right.data.title} (${rightSource.columns.join(', ')}). Name the columns explicitly with \`on\`.` };
      }
      const spec = normalizeJoinSpec({ on: keys, type: args.type, rightAlias: args.rightAlias, select: args.select, limit: args.limit });
      if (!spec) return { error: 'Each join key needs a non-empty `left` and `right` column name.' };
      const result = joinTabular(leftSource, rightSource, spec);
      if (result.unknownColumns.length) {
        return { error: `Unknown join column(s): ${result.unknownColumns.join(', ')}. Left has ${leftSource.columns.join(', ')}; right has ${rightSource.columns.join(', ')}.` };
      }
      if (!result.rows.length) {
        return { error: `No rows matched on ${spec.on.map((key) => `${key.left} = ${key.right}`).join(' and ')}. ${leftSource.rows.length} left rows and ${rightSource.rows.length} right rows were compared. Check the key, or use type "left" to keep unmatched rows.` };
      }

      const title = (args.title || `${left.data.title} × ${right.data.title}`).trim().slice(0, 160);
      const node = stage.createObject('table', { x: Math.max(left.position.x, right.position.x) + 460, y: left.position.y });
      node.data = { ...node.data, ...sanitizeCreationObjectPatch('table', {
        title, columns: result.columns, rows: result.rows.slice(0, MAX_MATERIALIZED_ROWS), rowCount: result.rowCount,
        sampleRows: result.rows.slice(0, 8),
        status: `${fmt.number(result.rowCount)} joined rows`,
        summary: `${result.type} join on ${spec.on.map((key) => `${key.left} = ${key.right}`).join(', ')}. ${fmt.number(result.matchedLeft)} of ${fmt.number(leftSource.rows.length)} left rows matched; ${fmt.number(result.unmatchedLeft)} did not.`,
        ...lineagePatch([left.id, right.id], { engine: 'join', join: spec, rowsIn: leftSource.rows.length + rightSource.rows.length, rowsOut: result.rowCount }, { columns: result.columns }),
      }) };
      node.style = { width: 720, height: 460 };
      stage.addObject(`Join “${title}”`, node);
      for (const parent of [left, right]) {
        stage.addConnection(
          `Join input ${parent.data.title}`,
          { id: crypto.randomUUID(), source: parent.id, target: node.id, type: 'smoothstep', animated: true, label: 'joined', data: { connectionKind: 'data' } },
        );
      }
      return {
        ok: true, proposed: true,
        object: { id: node.id, kind: 'table', title },
        joinedOn: spec.on, type: result.type, keysDetected: !args.on?.length,
        rows: result.rowCount, columns: result.columns,
        matchedLeft: result.matchedLeft, unmatchedLeft: result.unmatchedLeft, unmatchedRight: result.unmatchedRight,
        // Surfaced deliberately: a one-to-many join inflates row counts, and any
        // SUM taken over the result afterwards will be wrong by that factor.
        fanOut: result.fanOut, renamedColumns: result.collisions, truncated: result.truncated,
        sample: result.rows.slice(0, 10),
      };
    },
  },   {
    name: 'canvas_classify_dataset',
    description: 'Scan a dataset on the canvas for personal and sensitive data, tagging each column with a PII category and a sensitivity classification. Use this before sharing a board, before building anything from an uploaded customer file, or whenever asked what personal data a dataset holds. Detection reads names AND values; columns tagged as credentials, financial, government id or health are masked wherever they render and export.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'The dataset/table object. Omit when the canvas holds exactly one with rows.' },
        overrides: {
          type: 'array', description: 'Confirm or correct the detection for specific columns. Use this to record a human decision rather than re-running detection.',
          items: { type: 'object', required: ['column'], additionalProperties: false, properties: {
            column: { type: 'string' },
            pii: { type: 'string', enum: [...PII_CATEGORIES] },
            classification: { type: 'string', enum: [...DATA_CLASSIFICATIONS] },
            masked: { type: 'boolean' },
          } },
        },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; overrides?: Array<{ column: string; pii?: string; classification?: string; masked?: boolean }> };
      const target = resolveTabularTarget(args.objectId);
      if ('error' in target) return target;
      const { node: dataset, source } = target;

      const detected = classifyTabular(source, profileTabular(source));
      const overrides = normalizeClassifications(args.overrides ?? []);
      const byColumn = new Map(detected.map((item) => [item.column, item]));
      for (const override of overrides) {
        const base = byColumn.get(override.column);
        if (base) byColumn.set(override.column, { ...base, ...override, confidence: 'high', reason: 'value-match' });
      }
      const classifications = [...byColumn.values()];
      const summary = classificationSummary(classifications);
      const patch = sanitizeCreationObjectPatch(dataset.data.kind, {
        classifications,
        status: summary.piiColumns ? `${summary.piiColumns} personal columns` : 'No personal data found',
        summary: summary.piiColumns
          ? `${summary.piiColumns} of ${summary.total} columns hold personal data (${summary.categories.join(', ')}); ${summary.maskedColumns} are masked on render and export.`
          : `No personal data detected across ${summary.total} columns.`,
      });
      stage.updateObject(`Classify ${dataset.data.title}`, dataset.id, patch);
      return {
        ok: true, proposed: true, objectId: dataset.id,
        classifications: classifications.filter((item) => item.pii !== 'none'),
        summary,
        // Stated so the model does not then quote a masked value as if it were real.
        maskedColumns: classifications.filter((item) => item.masked).map((item) => item.column),
      };
    },
  }];
}
