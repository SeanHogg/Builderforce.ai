/** Analysis and training evidence — notebooks, training runs, run comparison, label sampling, forecasting. */
import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { evaluateDatasetUse, normalizeClassifications, normalizeUsePolicy } from '@/lib/canvasDataGovernance';
import type { DataUsePolicy } from '@builderforce/creation-canvas-contract';
import { TABULAR_TIME_GRAINS, tabularFromObject, type TabularTimeGrain } from '@/lib/canvasTabularData';
import { runNotebook } from '@/lib/canvasNotebook';
import { canvasEvidencePatch, sanitizeCreationObjectPatch } from '../creationObjectRegistry';
import { rowBasis } from '@/lib/canvasDatasetVersion';
import { canvasProjectId } from '@/lib/canvasProjectRef';
import { fetchTrainingJob, fetchTrainingLogs, listTrainingJobs } from '@/lib/api';
import { trainingRunFields } from '@/lib/canvasTrainingRun';
import { compareRuns } from '@/lib/canvasRunComparison';
import { sampleRows } from '@/lib/canvasLabelSet';
import { forecastSeries, seriesFromDataset } from '@/lib/canvasForecast';
import type { CanvasActionContext } from './context';

export function canvasDataScienceActions(ctx: CanvasActionContext): BrainAction[] {
  const { canEdit, fmt, stage } = ctx;
  return [  {
    /**
     * The CELL. Real execution, in a worker, over rows already on this board.
     *
     * Its outputs land as first-class `table`/`chart` objects rather than as a
     * scrollback buffer, which is what makes an analysis something the next turn can
     * reason over instead of prose someone has to re-read.
     */
    name: 'canvas_run_notebook',
    description: 'Execute analysis code against a dataset on this canvas and put the results on the board. Each cell is JavaScript whose LAST EXPRESSION is its result. Inside a cell you have `df` (the bound rows: df.rows, df.columns, df.nums(column), df.where(fn), df.groupBy(column)), `stats` (median, percentile, stddev, variance, correlation, summarize, histogram, linearFit, zScores, mode) and `infer` (proportionInterval, meanInterval, twoProportionTest). Return {columns, rows} to build a table, {labels, values} to build a chart, or any value to print it. Use this for anything canvas_query_dataset cannot express — a distribution, a correlation matrix, a hypothesis test, a custom cohort.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['cells'],
      properties: {
        datasetId: { type: 'string', description: 'Dataset, table or spreadsheet object to bind as `df`. Omit when the canvas has exactly one.' },
        cells: {
          type: 'array', description: 'Cells to run, in order.',
          items: { type: 'object', required: ['source'], additionalProperties: false, properties: { source: { type: 'string', description: 'JavaScript. The last expression is the result.' } } },
        },
        title: { type: 'string', description: 'Title for the notebook object.' },
        materialize: { type: 'boolean', description: 'Also promote each table/chart output to its own canvas object. Default true.' },
      },
    },
    mutates: () => true,
    run: async (raw: unknown) => {
      const args = raw as { datasetId?: string; cells?: Array<{ source?: string }>; title?: string; materialize?: boolean };
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const cells = (args.cells ?? []).flatMap((cell, index) => {
        const source = typeof cell?.source === 'string' ? cell.source.trim() : '';
        return source ? [{ id: `c${index + 1}`, source }] : [];
      });
      if (!cells.length) return { error: 'Pass at least one cell with a non-empty `source`.' };

      const all = stage.nodes();
      const candidates = all.filter((node) => ['dataset', 'table', 'spreadsheet'].includes(node.data.kind) && Array.isArray(node.data.rows) && node.data.rows.length > 0);
      const target = args.datasetId ? candidates.find((node) => node.id === args.datasetId) : candidates.length === 1 ? candidates[0] : undefined;
      if (!target) {
        return { error: candidates.length
          ? `Specify which dataset to bind as \`df\`. Tabular objects on this canvas: ${candidates.map((node) => `${node.id} (${node.data.title})`).join(', ')}`
          : 'No dataset with imported rows is on this canvas. Attach a CSV or import one first — a notebook with no data can only compute constants.' };
      }

      // The data-use gate reads the dataset's declared policy. Analysis of rows
      // already in front of the user is the permissive case, so this refuses only a
      // dataset whose owner explicitly excluded it.
      const analysisGate = evaluateDatasetUse(
        'analysis',
        normalizeClassifications((target.data as { classifications?: unknown }).classifications),
        normalizeUsePolicy((target.data as { dataUse?: DataUsePolicy }).dataUse),
      );
      if (!analysisGate.allowed) return { error: analysisGate.reason };

      const source = tabularFromObject(target.data as Record<string, unknown>);
      const outputs = await runNotebook(cells, source, 'js');

      const title = args.title?.trim() || `Analysis of ${String(target.data.title)}`;
      const failures = outputs.filter((output) => output.kind === 'error');
      const fields = canvasEvidencePatch('notebook', {
        title,
        language: 'js',
        sourceObjectId: target.id,
        cells,
        status: failures.length ? `${failures.length} of ${cells.length} failed` : `${cells.length} cell${cells.length === 1 ? '' : 's'} ran`,
        summary: failures.length
          ? `${failures.length} of ${cells.length} cells failed: ${failures.map((output) => output.error).join(' · ').slice(0, 300)}`
          : `Ran ${cells.length} cell${cells.length === 1 ? '' : 's'} over ${fmt.number(source.rows.length)} rows of ${String(target.data.title)}.`,
      }, {
        // What the kernel actually returned — evidence, so it is not model-authorable.
        outputs: outputs.map((output) => ({ cellId: output.cellId, kind: output.kind, preview: output.preview, runtimeMs: output.runtimeMs })),
        lastRunAt: new Date().toISOString(),
      });
      const node = stage.createObject('notebook');
      node.data = { ...node.data, ...fields };
      stage.addObject('Run notebook', node);

      // A table or chart output becomes a real object, carrying the same provenance
      // every other derived artifact carries — so a notebook result is as traceable as
      // a query result and can go stale the same way.
      const promoted: Array<{ id: string; kind: string; cellId: string }> = [];
      if (args.materialize !== false) {
        const basis = rowBasis(source, Number((target.data as { rowCount?: number }).rowCount) || null);
        for (const output of outputs) {
          const kind = output.table ? 'chart' : output.chart ? 'chart' : null;
          if (!kind) continue;
          const derived = output.table
            ? { chartType: 'bar', chartLabels: output.table.rows.map((row) => String(row[output.table!.columns[0]] ?? '')), chartValues: output.table.rows.map((row) => Number(row[output.table!.columns[1]] ?? 0)) }
            : { chartType: 'bar', chartLabels: output.chart!.labels, chartValues: output.chart!.values };
          const childFields = sanitizeCreationObjectPatch('chart', {
            title: `${title} · ${output.cellId}`,
            ...derived,
            sourceDatasetId: target.id,
            basis,
            producedAt: new Date().toISOString(),
            summary: `Computed by notebook cell ${output.cellId}.`,
          });
          const child = stage.createObject('chart');
          child.data = { ...child.data, ...childFields };
          stage.addObject(`Chart from ${output.cellId}`, child);
          promoted.push({ id: child.id, kind: 'chart', cellId: output.cellId });
        }
      }

      return {
        ok: true, proposed: true,
        object: { id: node.id, kind: 'notebook', title, created: true },
        outputs: outputs.map((output) => ({ cellId: output.cellId, kind: output.kind, preview: output.preview, error: output.error, runtimeMs: output.runtimeMs })),
        promoted,
        rowsBound: source.rows.length,
      };
    },
  },   {
    /**
     * The half of the fine-tune loop the board never had.
     *
     * A `build` object of modality `finetune` already LAUNCHES a run; this is what
     * brings the loss curve and the four-axis scorecard back, so the result can be
     * connected to the dataset that produced it and the decision that used it.
     */
    name: 'canvas_read_training_run',
    description: 'Read fine-tuning runs from this workspace and put one on the canvas with its hyperparameters, loss curve and evaluation scorecard. Call with no jobId to LIST the runs for a project; call with a jobId to place that run on the board. The runs come from Builder workspaces of type "finetune" — this is how a training result gets onto the canvas beside the dataset it learned from.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        projectId: { type: 'string', description: 'IDE project whose runs to list. Omit to use the project this canvas is bound to.' },
        jobId: { type: 'string', description: 'Place this run on the canvas. Omit to list.' },
        datasetObjectId: { type: 'string', description: 'Canvas id of the dataset object this run trained on, so the board records the link.' },
      },
    },
    mutates: (raw: unknown) => typeof (raw as { jobId?: unknown })?.jobId === 'string',
    run: async (raw: unknown) => {
      const args = raw as { projectId?: string; jobId?: string; datasetObjectId?: string };
      // The canvas has no single "bound project"; a project OBJECT on the board is what
      // binds one, which is the same resolution `canvasProjectId` already performs for
      // the Builder and Evermind paths.
      const boardProject = stage.nodes()
        .flatMap((node) => { const id = canvasProjectId(node.data); return id == null ? [] : [id]; })[0];
      const projectId = args.projectId ?? (boardProject != null ? String(boardProject) : undefined);
      if (!args.jobId) {
        if (!projectId) return { error: 'No project is bound to this canvas, so there are no training runs to list. Open this canvas from a project, or pass projectId.' };
        const jobs = await listTrainingJobs(projectId).catch(() => null);
        if (!jobs) return { error: 'Could not read the training runs for this project.' };
        if (!jobs.length) return { runs: [], error: 'This project has no training runs yet. Add a Builder object, choose the "finetune" type, and start a run.' };
        return { runs: jobs.map((job) => ({ jobId: job.id, baseModel: job.base_model, status: job.status, epochs: job.epochs, evalScore: job.eval_score ?? null, createdAt: job.created_at })) };
      }
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const job = await fetchTrainingJob(args.jobId).catch(() => null);
      if (!job) return { error: `No training run with id ${args.jobId} is readable from this workspace.` };
      // Logs are the loss CURVE; a run without them still places, with the single
      // current-loss point, rather than rendering an empty chart that reads as broken.
      const logs = await fetchTrainingLogs(args.jobId).catch(() => []);
      const lowered = trainingRunFields(job, logs);

      const all = stage.nodes();
      const title = `${job.base_model} · run ${job.id.slice(0, 8)}`;
      // `lowered` was READ from the job, so its measured fields go in as evidence; the
      // model-facing sanitizer alone dropped every one of them (and the `jobId` the
      // refresh match below depends on).
      const fields = canvasEvidencePatch('trainingRun', {
        title, ...lowered,
        ...(args.datasetObjectId ? { datasetObjectId: args.datasetObjectId } : {}),
      }, { ...lowered });
      const existing = all.find((node) => node.data.kind === 'trainingRun' && node.data.jobId === job.id);
      if (existing) {
        stage.updateObject('Refresh training run', existing.id, fields);
        return { ok: true, proposed: true, object: { id: existing.id, kind: 'trainingRun', title, updated: true }, run: lowered };
      }
      const node = stage.createObject('trainingRun');
      node.data = { ...node.data, ...fields };
      stage.addObject('Add training run', node);
      return { ok: true, proposed: true, object: { id: node.id, kind: 'trainingRun', title, created: true }, run: lowered };
    },
  },   {
    name: 'canvas_compare_runs',
    description: 'Rank the training runs on this canvas against a baseline on one metric, and put the comparison on the board. Shows each run\'s score, its delta from the baseline, and ONLY the hyperparameters that differ — which is the actual explanation of why one run beat another. Use this before promoting a model: a table of scores with no baseline is a list, not a comparison.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        rankBy: { type: 'string', description: 'Axis to rank on: evalScore, codeCorrectness, reasoningQuality or hallucinationRate. Defaults to evalScore. hallucinationRate is ranked ascending because lower is better.' },
        baselineObjectId: { type: 'string', description: 'Canvas id of the trainingRun everything is measured against. Defaults to the first run on the board.' },
        title: { type: 'string' },
      },
    },
    mutates: () => true,
    run: (raw: unknown) => {
      const args = raw as { rankBy?: string; baselineObjectId?: string; title?: string };
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const all = stage.nodes();
      const runs = all.filter((node) => node.data.kind === 'trainingRun');
      if (runs.length < 2) {
        return { error: `A comparison needs at least two training runs on the canvas; there ${runs.length === 1 ? 'is 1' : 'are none'}. Add them with canvas_read_training_run first.` };
      }
      const comparison = compareRuns(
        runs.map((node) => ({
          objectId: node.id,
          label: String(node.data.title),
          scorecard: (node.data as { scorecard?: Array<{ axis: string; score: number }> }).scorecard ?? [],
          hyperparameters: (node.data as { hyperparameters?: Array<{ name: string; value: string | number }> }).hyperparameters ?? [],
        })),
        args.rankBy || 'evalScore',
        args.baselineObjectId,
      );
      const title = args.title?.trim() || `Run comparison · ${comparison.rankBy}`;
      const scored = comparison.rows.filter((row) => row.score != null).length;
      const fields = canvasEvidencePatch('runComparison', {
        title,
        rankBy: comparison.rankBy,
        baselineRunId: comparison.baselineObjectId,
        status: `${scored} of ${comparison.rows.length} scored`,
        summary: `${comparison.rows.length} runs ranked on ${comparison.rankBy}. ${scored < comparison.rows.length ? `${comparison.rows.length - scored} have not been evaluated.` : 'All runs evaluated.'}`,
      }, { runs: comparison.rows, verdict: comparison.verdict });
      const node = stage.createObject('runComparison');
      node.data = { ...node.data, ...fields };
      stage.addObject('Compare runs', node);
      return { ok: true, proposed: true, object: { id: node.id, kind: 'runComparison', title, created: true }, comparison };
    },
  },   {
    name: 'canvas_sample_for_labels',
    description: 'Build a label set: take a reproducible, evenly-spread sample of a dataset and put it on the board with the question reviewers must answer. This is where an evaluation set legitimately comes from — the alternative is a model writing its own test cases and grading itself, which measures nothing. The sample is a stride, not the first N rows, because the head of an export is usually its oldest data.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['question'],
      properties: {
        datasetId: { type: 'string', description: 'Dataset to sample. Omit when the canvas has exactly one.' },
        question: { type: 'string', description: 'The ONE question every reviewer answers about every sample. If it needs an "and", it is two label sets.' },
        options: { type: 'array', items: { type: 'string' }, description: 'The allowed answers. A closed set, so agreement is computable.' },
        guidelines: { type: 'string', description: 'How to decide the hard cases, with a worked example of each option.' },
        size: { type: 'number', description: 'How many rows to sample. Defaults to 50.' },
        textColumn: { type: 'string', description: 'Column a reviewer reads. Omit to show the whole row.' },
        title: { type: 'string' },
      },
    },
    mutates: () => true,
    run: (raw: unknown) => {
      const args = raw as { datasetId?: string; question?: string; options?: string[]; guidelines?: string; size?: number; textColumn?: string; title?: string };
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const question = args.question?.trim();
      if (!question) return { error: 'A label set needs the question reviewers answer.' };
      const all = stage.nodes();
      const candidates = all.filter((node) => ['dataset', 'table', 'spreadsheet'].includes(node.data.kind) && Array.isArray(node.data.rows) && node.data.rows.length > 0);
      const target = args.datasetId ? candidates.find((node) => node.id === args.datasetId) : candidates.length === 1 ? candidates[0] : undefined;
      if (!target) {
        return { error: candidates.length
          ? `Specify which dataset to sample. Tabular objects on this canvas: ${candidates.map((node) => `${node.id} (${node.data.title})`).join(', ')}`
          : 'No dataset with imported rows is on this canvas.' };
      }
      const source = tabularFromObject(target.data as Record<string, unknown>);
      const samples = sampleRows(source, Number(args.size) || 50, args.textColumn);
      if (!samples.length) return { error: `${String(target.data.title)} has no rows to sample.` };

      const title = args.title?.trim() || `Labels · ${String(target.data.title)}`;
      const fields = canvasEvidencePatch('labelSet', {
        title,
        sourceDatasetId: target.id,
        question,
        options: Array.isArray(args.options) ? args.options.map(String) : [],
        ...(args.guidelines?.trim() ? { guidelines: args.guidelines.trim() } : {}),
        status: `0 of ${samples.length} labelled`,
        summary: `${samples.length} rows sampled from ${fmt.number(source.rows.length)} for review. Nothing is labelled yet, so this set cannot score anything.`,
      }, { samples, labels: [] });
      const node = stage.createObject('labelSet');
      node.data = { ...node.data, ...fields };
      stage.addObject('Sample for labels', node);
      return { ok: true, proposed: true, object: { id: node.id, kind: 'labelSet', title, created: true }, sampled: samples.length, of: source.rows.length };
    },
  },   {
    name: 'canvas_forecast_series',
    description: 'Project a series on this canvas forward and flag its outliers. Point it at a dataset with a date column and a value column, and it buckets by period, fits a least-squares trend, projects the next periods and flags points that are unusual GIVEN the trend (not merely far from the average). Returns the slope with its R², because a trend without a fit quality is the most misleading number a dashboard can show. Empty periods are filled with zero rather than skipped, so the trend is not steepened by a compressed axis.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['dateColumn', 'valueColumn'],
      properties: {
        datasetId: { type: 'string', description: 'Dataset holding the series. Omit when the canvas has exactly one.' },
        dateColumn: { type: 'string', description: 'Date column to bucket by.' },
        valueColumn: { type: 'string', description: 'Numeric column to total per period.' },
        grain: { type: 'string', enum: [...TABULAR_TIME_GRAINS], description: 'Period size. Defaults to month.' },
        horizon: { type: 'number', description: 'How many periods to project. Defaults to 6.' },
        materialize: { type: 'boolean', description: 'Put a chart of history plus projection on the board. Default true.' },
        title: { type: 'string' },
      },
    },
    mutates: (raw: unknown) => (raw as { materialize?: unknown })?.materialize !== false,
    run: (raw: unknown) => {
      const args = raw as { datasetId?: string; dateColumn?: string; valueColumn?: string; grain?: TabularTimeGrain; horizon?: number; materialize?: boolean; title?: string };
      const all = stage.nodes();
      const candidates = all.filter((node) => ['dataset', 'table', 'spreadsheet'].includes(node.data.kind) && Array.isArray(node.data.rows) && node.data.rows.length > 0);
      const target = args.datasetId ? candidates.find((node) => node.id === args.datasetId) : candidates.length === 1 ? candidates[0] : undefined;
      if (!target) {
        return { error: candidates.length
          ? `Specify which dataset holds the series. Tabular objects on this canvas: ${candidates.map((node) => `${node.id} (${node.data.title})`).join(', ')}`
          : 'No dataset with imported rows is on this canvas.' };
      }
      const source = tabularFromObject(target.data as Record<string, unknown>);
      for (const column of [args.dateColumn, args.valueColumn]) {
        if (column && !source.columns.includes(column)) {
          return { error: `Unknown column "${column}". Available columns: ${source.columns.join(', ')}` };
        }
      }
      const history = seriesFromDataset(source, String(args.dateColumn), String(args.valueColumn), args.grain ?? 'month');
      if (history.length < 2) {
        return { error: `"${args.dateColumn}" produced ${history.length} period${history.length === 1 ? '' : 's'}, which cannot define a trend. Check that it holds real dates — a bare number column is not read as a date.` };
      }
      const result = forecastSeries(history, Number(args.horizon) || 6);
      if (args.materialize === false) return { ok: true, ...result };

      if (!canEdit) return { ok: true, ...result, error: 'The current session role cannot edit this canvas' };
      const title = args.title?.trim() || `${String(args.valueColumn)} forecast`;
      const fields = sanitizeCreationObjectPatch('chart', {
        title,
        chartType: 'line',
        chartLabels: [...result.history.map((point) => point.label), ...result.forecast.map((point) => point.label)],
        chartValues: [...result.history.map((point) => point.value), ...result.forecast.map((point) => point.value)],
        sourceDatasetId: target.id,
        basis: rowBasis(source, Number((target.data as { rowCount?: number }).rowCount) || null),
        producedAt: new Date().toISOString(),
        sampleSize: result.history.length,
        status: `R² ${result.r2}`,
        // The fit quality leads the summary on purpose: a projection quoted without it
        // is the number people repeat, and a slope through noise looks identical to a
        // slope through a trend.
        summary: `Projected ${result.forecast.length} periods at ${result.slope >= 0 ? '+' : ''}${result.slope} per period, R² ${result.r2}${result.r2 < 0.5 ? ' — a weak fit, so treat the projection as a direction rather than a number' : ''}. ${result.anomalies.length} anomal${result.anomalies.length === 1 ? 'y' : 'ies'} against the trend.`,
      });
      const node = stage.createObject('chart');
      node.data = { ...node.data, ...fields };
      stage.addObject('Forecast series', node);
      return { ok: true, proposed: true, object: { id: node.id, kind: 'chart', title, created: true }, ...result };
    },
  }];
}
