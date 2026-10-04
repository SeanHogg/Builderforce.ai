/** Data governance — contracts, quality runs, metric definitions and lineage. */
import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { classifyTabular, contractVerdict, DATA_CLASSIFICATIONS, evaluateDataContract, inferDataContract, normalizeClassifications, normalizeDataContract, PII_CATEGORIES } from '@/lib/canvasDataGovernance';
import { profileTabular, TABULAR_AGGREGATE_OPERATORS, TABULAR_FILTER_OPERATORS, TABULAR_TIME_GRAINS, tabularFromObject } from '@/lib/canvasTabularData';
import { sanitizeCreationObjectPatch } from '../creationObjectRegistry';
import { checksFromContract, DATA_QUALITY_CHECK_KINDS, dataQualityVerdict, normalizeDataQualityChecks, referenceSources, runDataQualityChecks, suggestDataQualityChecks } from '@/lib/canvasDataQuality';
import { computeMetric, computeMetricSeries, formatMetricValue, METRIC_DIRECTIONS, METRIC_FORMATS, normalizeMetricDefinition } from '@/lib/canvasMetrics';
import { buildLineageGraph, columnImpact, impactOf, lineagePatch, staleDerivatives, upstreamOf } from '@/lib/canvasLineage';
import type { CanvasActionContext } from './context';

export function canvasDataGovernanceActions(ctx: CanvasActionContext): BrainAction[] {
  const { canEdit, fmt, resolveTabularTarget, stage } = ctx;
  return [  {
    name: 'canvas_set_data_contract',
    description: 'Declare what a dataset is ALLOWED to be — required columns, types, uniqueness, units, allowed values, ranges, a primary key, row-count bounds and a freshness SLA — and evaluate the current rows against it. Use this to lock a dataset\'s shape so a later re-import that drifts is caught instead of quietly changing every chart built on it. Omit `contract` to infer one from what the data currently is.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'The dataset/table object. Omit when the canvas holds exactly one with rows.' },
        materialize: { type: 'boolean', description: 'Also put the contract on the board as its own object. Defaults to true.' },
        contract: {
          type: 'object', required: ['columns'], additionalProperties: false,
          properties: {
            columns: {
              type: 'array',
              items: { type: 'object', required: ['name', 'type'], additionalProperties: false, properties: {
                name: { type: 'string' },
                type: { type: 'string', enum: ['number', 'boolean', 'date', 'text', 'empty'] },
                required: { type: 'boolean' }, unique: { type: 'boolean' },
                description: { type: 'string' },
                unit: { type: 'string', description: 'Physical unit. Two charts cannot be compared without it.' },
                allowedValues: { type: 'array', items: { type: 'string' } },
                min: { type: 'number' }, max: { type: 'number' },
                classification: { type: 'string', enum: [...DATA_CLASSIFICATIONS] },
                pii: { type: 'string', enum: [...PII_CATEGORIES] },
              } },
            },
            primaryKey: { type: 'array', items: { type: 'string' } },
            rowCountMin: { type: 'number' }, rowCountMax: { type: 'number' },
            freshnessHours: { type: 'number', description: 'Maximum age before the data is stale.' },
          },
        },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; contract?: unknown; materialize?: boolean };
      const target = resolveTabularTarget(args.objectId);
      if ('error' in target) return target;
      const { node: dataset, source } = target;

      const classifications = normalizeClassifications(dataset.data.classifications);
      const contract = normalizeDataContract(args.contract)
        ?? inferDataContract(source, profileTabular(source), classifications.length ? classifications : classifyTabular(source, profileTabular(source)));
      const fetchedAt = typeof dataset.data.fetchedAt === 'string' ? dataset.data.fetchedAt : null;
      const violations = evaluateDataContract(source, contract, { fetchedAt });
      const verdict = contractVerdict(violations);
      const declaredAt = new Date().toISOString();
      const stored = { ...contract, declaredAt };

      stage.updateObject(`Declare contract for ${dataset.data.title}`, dataset.id, sanitizeCreationObjectPatch(dataset.data.kind, { dataContract: stored, violations }));

      const payload = {
        ok: true, proposed: true, objectId: dataset.id,
        inferred: !args.contract, verdict, violations,
        contract: { columns: contract.columns.length, primaryKey: contract.primaryKey ?? [], freshnessHours: contract.freshnessHours ?? null },
      };
      if (args.materialize === false) return payload;

      const all = stage.nodes();
      const title = `${dataset.data.title} contract`;
      const existing = all.find((node) => node.data.kind === 'dataContract' && node.data.sourceDatasetId === dataset.id);
      const fields = sanitizeCreationObjectPatch('dataContract', {
        title, dataContract: stored, violations, verdict, sourceDatasetId: dataset.id,
        status: verdict === 'pass' ? 'Honoured' : verdict === 'fail' ? `${violations.filter((violation) => violation.severity === 'error').length} breaches` : `${violations.length} warnings`,
        summary: `${contract.columns.length} declared columns over ${fmt.number(source.rows.length)} rows.`,
        ...(fetchedAt ? { fetchedAt } : {}),
      });
      if (existing) {
        stage.updateObject(`Update contract “${title}”`, existing.id, fields);
        return { ...payload, object: { id: existing.id, kind: 'dataContract', title, updated: true } };
      }
      const node = stage.createObject('dataContract', { x: dataset.position.x + 460, y: dataset.position.y + 300 });
      node.data = { ...node.data, ...fields };
      stage.addObject(`Add contract “${title}”`, node);
      stage.addConnection(
        `Governs ${dataset.data.title}`,
        { id: crypto.randomUUID(), source: node.id, target: dataset.id, type: 'smoothstep', label: 'governs', data: { connectionKind: 'reference' } },
      );
      return { ...payload, object: { id: node.id, kind: 'dataContract', title, created: true } };
    },
  },   {
    /** A contract IS a set of checks — `checksFromContract` derives them rather than
     *  asking anyone to restate "customer_id must be unique" in a second place. */
    name: 'canvas_run_data_quality',
    description: 'Build and run data quality checks against a dataset on the canvas — not-null, uniqueness, row-count bounds, numeric ranges, allowed values, regex, freshness, and referential integrity across two objects. Use this to assert that data is fit to use before building on it, or to explain WHY a dataset looks wrong. If the dataset already has a declared contract, its rules are included automatically.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'The dataset/table object. Omit when the canvas holds exactly one with rows.' },
        materialize: { type: 'boolean', description: 'Put the suite and its results on the board. Defaults to true.' },
        checks: {
          type: 'array',
          description: 'Checks to run IN ADDITION to any derived from the dataset\'s contract. Omit entirely to run the contract\'s checks plus a conservative suggested suite.',
          items: { type: 'object', required: ['kind'], additionalProperties: false, properties: {
            kind: { type: 'string', enum: [...DATA_QUALITY_CHECK_KINDS] },
            column: { type: 'string' },
            min: { type: 'number' }, max: { type: 'number' },
            values: { type: 'array', items: { type: 'string' } },
            pattern: { type: 'string' },
            hours: { type: 'number', description: 'Freshness SLA in hours.' },
            referenceObjectId: { type: 'string', description: 'For referentialIntegrity: the canvas object holding the parent rows.' },
            referenceColumn: { type: 'string', description: 'For referentialIntegrity: the parent column values must exist in.' },
            tolerance: { type: 'number', description: 'Share of rows (0–1) allowed to fail before the check does.' },
            severity: { type: 'string', enum: ['error', 'warning'] },
          } },
        },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; checks?: unknown; materialize?: boolean };
      const target = resolveTabularTarget(args.objectId);
      if ('error' in target) return target;
      const { node: dataset, source } = target;

      const contract = normalizeDataContract(dataset.data.dataContract);
      const authored = normalizeDataQualityChecks(args.checks);
      const derived = contract ? checksFromContract(contract) : [];
      // Deduplicated by id so a rule declared in a contract and repeated by the
      // model is one check, not two identical rows in the report.
      const byId = new Map([...derived, ...(authored.length ? authored : derived.length ? [] : suggestDataQualityChecks(source))].map((check) => [check.id, check]));
      const checks = [...byId.values()];
      if (!checks.length) return { error: `${dataset.data.title} has nothing to check yet. Declare a contract with canvas_set_data_contract, or pass checks explicitly.` };

      const all = stage.nodes();
      const references = referenceSources(
        all.filter((node) => ['dataset', 'table', 'spreadsheet', 'datasource'].includes(node.data.kind)).map((node) => ({ id: node.id, data: node.data as Record<string, unknown> })),
        (data) => tabularFromObject(data),
      );
      const results = runDataQualityChecks(source, checks, {
        fetchedAt: typeof dataset.data.fetchedAt === 'string' ? dataset.data.fetchedAt : null,
        references,
      });
      const verdict = dataQualityVerdict(results);
      const lastRunAt = new Date().toISOString();

      const payload = { ok: true, proposed: true, objectId: dataset.id, verdict, results };
      if (args.materialize === false) return payload;

      const title = `${dataset.data.title} quality`;
      const existing = all.find((node) => node.data.kind === 'dataQuality' && node.data.sourceDatasetId === dataset.id);
      const fields = sanitizeCreationObjectPatch('dataQuality', {
        title, checks, results, verdict: verdict.status, score: verdict.score, sourceDatasetId: dataset.id, lastRunAt,
        status: verdict.status === 'pass' ? `${verdict.passed} passing` : `${verdict.failed} failing`,
        summary: `${verdict.passed} passed, ${verdict.warned} warned, ${verdict.failed} failed, ${verdict.skipped} skipped over ${fmt.number(source.rows.length)} rows.`,
      });
      if (existing) {
        stage.updateObject(`Re-run quality on ${dataset.data.title}`, existing.id, fields);
        return { ...payload, object: { id: existing.id, kind: 'dataQuality', title, updated: true } };
      }
      const node = stage.createObject('dataQuality', { x: dataset.position.x + 920, y: dataset.position.y + 300 });
      node.data = { ...node.data, ...fields };
      stage.addObject(`Add quality checks “${title}”`, node);
      stage.addConnection(
        `Checks ${dataset.data.title}`,
        { id: crypto.randomUUID(), source: node.id, target: dataset.id, type: 'smoothstep', label: 'checks', data: { connectionKind: 'reference' } },
      );
      return { ...payload, object: { id: node.id, kind: 'dataQuality', title, created: true } };
    },
  },   {
    /** The semantic layer. Two tiles labelled "MRR" that disagree is the defect;
     *  ONE definition that both evaluate is the fix. */
    name: 'canvas_define_metric',
    description: 'Define a metric ONCE — its source, formula, filters, breakdown, unit, format and target — so every KPI, chart and report that quotes it computes the same number. Use this whenever a number will be referred to by name ("MRR", "win rate", "average handling time") rather than asked for once. Optionally materialize the current value as a KPI or the breakdown as a chart, both bound to this definition.',
    parameters: {
      type: 'object', required: ['name', 'aggregate'], additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'The metric\'s name, as people say it: "Monthly recurring revenue".' },
        description: { type: 'string', description: 'What it counts and, importantly, what it excludes.' },
        sourceObjectId: { type: 'string', description: 'The dataset/table it is computed from. Omit when the canvas holds exactly one with rows.' },
        aggregate: {
          type: 'object', required: ['op'], additionalProperties: false,
          properties: { op: { type: 'string', enum: [...TABULAR_AGGREGATE_OPERATORS] }, column: { type: 'string' }, label: { type: 'string' } },
        },
        filter: {
          type: 'array', description: 'Rows the metric counts. THIS is the part that makes two definitions of the same word disagree, so state it.',
          items: { type: 'object', required: ['column'], additionalProperties: false, properties: { column: { type: 'string' }, op: { type: 'string', enum: [...TABULAR_FILTER_OPERATORS] }, value: {} } },
        },
        dimension: { type: 'string', description: 'Breakdown column for the series form.' },
        timeGrain: { type: 'object', required: ['column', 'grain'], additionalProperties: false, properties: { column: { type: 'string' }, grain: { type: 'string', enum: [...TABULAR_TIME_GRAINS] } } },
        unit: { type: 'string', description: 'Currency code for format "currency" (e.g. USD), otherwise a free unit.' },
        format: { type: 'string', enum: [...METRIC_FORMATS] },
        decimals: { type: 'number' },
        target: { type: 'number' },
        direction: { type: 'string', enum: [...METRIC_DIRECTIONS], description: 'Which way is good. "down" for churn or cost — it inverts how attainment is read.' },
        materializeAs: { type: 'string', enum: ['none', 'kpi', 'chart'], description: 'Also put the current value on the board, bound to this definition.' },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as Record<string, unknown> & { sourceObjectId?: string; materializeAs?: string };
      const target = resolveTabularTarget(args.sourceObjectId);
      if ('error' in target) return target;
      const { node: dataset, source } = target;

      const definition = normalizeMetricDefinition({ ...args, sourceObjectId: dataset.id });
      if (!definition) return { error: 'A metric needs a name and an aggregate.' };
      const unknown = [definition.aggregate.column, definition.dimension, definition.timeGrain?.column, ...(definition.filter ?? []).map((filter) => filter.column)]
        .filter((column): column is string => !!column)
        .filter((column) => !source.columns.includes(column));
      if (unknown.length) {
        return { error: `Unknown column(s): ${[...new Set(unknown)].join(', ')}. ${dataset.data.title} has: ${source.columns.join(', ')}` };
      }

      const value = computeMetric(source, definition);
      const series = computeMetricSeries(source, definition);
      const producedAt = new Date().toISOString();
      const all = stage.nodes();

      const metricFields = sanitizeCreationObjectPatch('metric', {
        title: definition.name, definition, sourceObjectId: dataset.id,
        value: value.value, ...(series ? { series: series.labels.map((label, index) => ({ at: label, value: series.values[index] ?? 0 })) } : {}),
        status: formatMetricValue(value.value, definition),
        summary: `${definition.aggregate.op}${definition.aggregate.column ? ` of ${definition.aggregate.column}` : ''} over ${fmt.number(value.matchedRows)} of ${fmt.number(value.totalRows)} rows in ${dataset.data.title}.`,
        ...lineagePatch([dataset.id], { engine: 'metric', query: { aggregate: [definition.aggregate], ...(definition.filter ? { filter: definition.filter } : {}) }, rowsIn: value.totalRows, rowsOut: 1 }, { producedAt }),
      });
      const existing = all.find((node) => node.data.kind === 'metric' && normalizeMetricDefinition(node.data.definition)?.id === definition.id);
      let metricId: string;
      if (existing) {
        metricId = existing.id;
        stage.updateObject(`Update metric “${definition.name}”`, existing.id, metricFields);
      } else {
        const node = stage.createObject('metric', { x: dataset.position.x + 460, y: dataset.position.y - 260 });
        node.data = { ...node.data, ...metricFields };
        metricId = node.id;
        stage.addObject(`Define metric “${definition.name}”`, node);
        stage.addConnection(
          `Computed from ${dataset.data.title}`,
          { id: crypto.randomUUID(), source: dataset.id, target: node.id, type: 'smoothstep', animated: true, label: 'defines', data: { connectionKind: 'data' } },
        );
      }

      const payload = {
        ok: true, proposed: true,
        metric: { id: definition.id, objectId: metricId, name: definition.name },
        value: value.value, formatted: formatMetricValue(value.value, definition),
        matchedRows: value.matchedRows, totalRows: value.totalRows,
        ...(value.attainment != null ? { target: value.target, attainment: value.attainment, status: value.status } : {}),
        ...(series ? { series } : {}),
        computedFromEveryRow: true,
      };
      const materializeAs = args.materializeAs === 'kpi' || args.materializeAs === 'chart' ? args.materializeAs : null;
      if (!materializeAs) return payload;
      if (materializeAs === 'chart' && !series) {
        return { ...payload, error: 'A chart needs a breakdown. Set `dimension` or `timeGrain` on the metric first.' };
      }

      // The artifact stores `metricId`, not a literal — which is what makes the
      // definition load-bearing rather than decorative.
      const artifact = stage.createObject(materializeAs, { x: dataset.position.x + 920, y: dataset.position.y - 260 });
      artifact.data = { ...artifact.data, ...sanitizeCreationObjectPatch(materializeAs, materializeAs === 'kpi'
        ? {
          title: definition.name, value: formatMetricValue(value.value, definition),
          ...(definition.target != null ? { target: formatMetricValue(definition.target, definition) } : {}),
          ...(definition.unit ? { unit: definition.unit } : {}),
          metricId: definition.id, sourceDatasetId: dataset.id, status: 'Live',
          summary: `Defined by “${definition.name}” · computed from ${fmt.number(value.totalRows)} rows.`,
          ...lineagePatch([dataset.id], { engine: 'metric' }, { producedAt }),
        }
        : {
          title: definition.name, chartTitle: definition.name, status: 'Live',
          xAxisLabel: series!.dimension, yAxisLabel: definition.aggregate.column ?? definition.aggregate.op,
          chartLabels: series!.labels, chartValues: series!.values,
          metricId: definition.id, sourceDatasetId: dataset.id,
          summary: `Defined by “${definition.name}” · computed from ${fmt.number(value.totalRows)} rows.`,
          ...lineagePatch([dataset.id], { engine: 'metric' }, { producedAt }),
        }) };
      stage.addObject(`Add ${materializeAs} “${definition.name}”`, artifact);
      stage.addConnection(
        `Quotes ${definition.name}`,
        { id: crypto.randomUUID(), source: metricId, target: artifact.id, type: 'smoothstep', animated: true, label: 'quotes', data: { connectionKind: 'data' } },
      );
      return { ...payload, materialized: { id: artifact.id, kind: materializeAs, title: definition.name } };
    },
  },   {
    name: 'canvas_trace_lineage',
    description: 'Map where the numbers on this canvas came from: which artifact was computed from which source, by what transform, and which artifacts are now STALE because their source was re-read after they were built. Pass `column` with `objectId` to answer "what breaks if I change this column". Use this before renaming or dropping a column, or when a chart and its dataset disagree.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'Focus on one object: its upstream sources and everything computed from it.' },
        column: { type: 'string', description: 'With objectId: report only the artifacts that read this column.' },
        materialize: { type: 'boolean', description: 'Put the lineage map on the board as its own object.' },
      },
    },
    mutates: (raw: unknown) => (raw as { materialize?: unknown })?.materialize === true,
    run: (raw: unknown) => {
      const args = raw as { objectId?: string; column?: string; materialize?: boolean };
      const all = stage.nodes();
      const objects = all.map((node) => ({ id: node.id, kind: node.data.kind, title: String(node.data.title), data: node.data as Record<string, unknown> }));
      const graph = buildLineageGraph(objects);
      const stale = staleDerivatives(objects);

      if (args.objectId && args.column) {
        const impacts = columnImpact(objects, args.objectId, args.column);
        return {
          ok: true, objectId: args.objectId, column: args.column,
          impacted: impacts,
          // An empty result is a real, useful answer here — it means the column can
          // be changed without breaking anything on this board.
          safeToChange: impacts.length === 0,
        };
      }

      const focused = args.objectId
        ? { downstream: impactOf(graph, args.objectId), upstream: upstreamOf(graph, args.objectId) }
        : null;
      const payload = {
        ok: true,
        objects: graph.nodes,
        links: graph.edges,
        stale,
        ...(focused ? { focus: { objectId: args.objectId, ...focused } } : {}),
      };
      if (!args.materialize) return payload;
      if (!canEdit) return { ...payload, error: 'The current session role cannot edit this canvas' };
      if (!graph.nodes.length) return { ...payload, error: 'Nothing on this canvas records where it came from yet. Build a chart or table from a dataset first.' };

      const title = 'Data lineage';
      const existing = all.find((node) => node.data.kind === 'lineage');
      const fields = sanitizeCreationObjectPatch('lineage', {
        title, lineageNodes: graph.nodes, lineageEdges: graph.edges, staleDerivatives: stale,
        ...(args.objectId ? { focusObjectId: args.objectId } : {}),
        status: stale.length ? `${stale.length} stale` : `${graph.nodes.length} tracked`,
        summary: `${graph.nodes.length} objects linked by ${graph.edges.length} transforms. ${stale.length} artifact${stale.length === 1 ? '' : 's'} predate their source.`,
      });
      if (existing) {
        stage.updateObject('Refresh lineage', existing.id, fields);
        return { ...payload, proposed: true, object: { id: existing.id, kind: 'lineage', title, updated: true } };
      }
      const node = stage.createObject('lineage');
      node.data = { ...node.data, ...fields };
      stage.addObject('Trace lineage', node);
      return { ...payload, proposed: true, object: { id: node.id, kind: 'lineage', title, created: true } };
    },
  }];
}
