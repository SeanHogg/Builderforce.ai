/**
 * The DATA-SCIENCE objects, declared once.
 *
 * Six kinds covering the four stages the canvas had no object for — analysis that
 * computes, the model, the evaluation an eval set is legitimately built from, and the
 * versioned prompt that ships. The argument for the SET is in the contract
 * (`packages/creation-canvas-contract/src/dataScience.ts`); this module is the one
 * declaration the node body, the model-facing field contract, the registry's
 * mutable/context lists and the empty-shell rule all read.
 *
 * ── WHY SO MUCH OF THIS IS `derived` ─────────────────────────────────────────────
 * More than any other vocabulary, what these objects hold is EVIDENCE: a loss curve
 * read from a training job, a label a human actually chose, the score a run produced,
 * the agreement between two reviewers. A model that could author evidence could report
 * a result nobody measured — so every one of those fields is readable and none is
 * authorable. It is the same argument `practice.attempts` and the academic `marks`
 * field already make, applied to the place where the temptation is strongest, because
 * "the eval says 94%" is the single most load-bearing sentence in an LLM project.
 */

import { registerSpecObjectSet, SOURCES_FIELD, SUMMARY_FIELD, type SpecObjectSpec } from './specObjects';

/** English fallbacks the palette shows before `creationCanvas.dataScience.label.*`
 *  resolves, matching how every other vocabulary declares its pair. */
export const DATA_SCIENCE_LABELS: Record<string, string> = {
  notebook: 'Notebook',
  model: 'Model',
  trainingRun: 'Training run',
  runComparison: 'Run comparison',
  labelSet: 'Label set',
  prompt: 'Prompt',
};

/** Blank-object statuses. Never a state that claims work that has not happened — an
 *  empty card reading as a configured one is the defect the registry's own comments
 *  record, and it is worse here, where the card would be asserting a measurement. */
export const DATA_SCIENCE_STATUSES: Record<string, string> = {
  noCells: 'No cells yet',
  draft: 'Draft',
  notLinked: 'Not linked to a run',
  needsRuns: 'Add two runs',
  notSampled: 'Not sampled',
  unversioned: 'Not saved to the library',
};

export const DATA_SCIENCE_OBJECT_SPECS: readonly SpecObjectSpec[] = [
  // ── ANALYSIS ────────────────────────────────────────────────────────────────
  {
    kind: 'notebook',
    icon: '⌗',
    group: 'Data',
    defaultStatus: 'noCells',
    actions: ['run', 'clear', 'export'],
    seed: { language: 'js', cells: [], outputs: [] },
    fields: [
      {
        name: 'language',
        render: 'stat',
        label: 'language',
        hint: 'One of "js", "python" or "sql". Only "js" executes in the browser; a python or sql cell is authored here and run in a Builder workspace, and the kernel refuses it rather than pretending to have run it. Prefer "js" for anything you want a result from on this board.',
      },
      {
        name: 'sourceObjectId',
        render: 'stat',
        label: 'sourceObjectId',
        hint: 'Canvas id of the `dataset`, `table` or `datasource` object whose rows this notebook analyses. The kernel exposes those rows as `df` — without this the notebook has no data and every cell has to invent its own.',
      },
      {
        name: 'cells',
        render: 'rows',
        label: 'cells',
        columns: ['id', 'source'],
        hint: 'Ordered analysis cells: {id, source}. `source` is real code the kernel executes — the LAST EXPRESSION is the cell result, exactly like a REPL. Inside a cell you have `df` (the bound rows), `stats` (median, percentile, stddev, variance, correlation, summarize, histogram, linearFit, zScores), `infer` (proportionInterval, meanInterval, twoProportionTest) and `query(spec)` for the declarative engine. Return a `{columns, rows}` object for a table, a `{labels, values}` object for a chart, or any value to print it.',
      },
      {
        name: 'outputs',
        render: 'rows',
        label: 'outputs',
        columns: ['cellId', 'kind', 'preview'],
        hint: 'What each cell actually returned, with its runtime.',
        derived: true,
      },
      { name: 'lastRunAt', render: 'stat', label: 'lastRunAt', hint: 'When the notebook last executed.', derived: true },
      SUMMARY_FIELD,
    ],
  },

  // ── MODEL ───────────────────────────────────────────────────────────────────
  {
    kind: 'model',
    icon: '◈',
    group: 'Models',
    defaultStatus: 'draft',
    actions: ['evaluate', 'compare', 'promote'],
    seed: { lifecycle: 'draft', hyperparameters: [], metrics: [] },
    fields: [
      {
        name: 'task',
        render: 'stat',
        label: 'task',
        hint: 'What the model is FOR: classification, regression, generation, embedding, ranking, clustering or forecasting. This decides which metrics mean anything on the scorecard — an accuracy on a regression model is a category error, not a low score.',
      },
      { name: 'baseModel', render: 'stat', label: 'baseModel', hint: 'The base checkpoint or architecture this was built from, e.g. "llama-3.1-8b", "gradient-boosted-trees". Name the exact version — "the small one" is not reproducible.' },
      {
        name: 'lifecycle',
        render: 'stat',
        label: 'lifecycle',
        hint: 'One of draft, training, evaluated, shadow, production, retired. `shadow` means it is seeing real traffic and is NOT yet responsible for the answer — never skip it to promote straight to production.',
      },
      {
        name: 'hyperparameters',
        render: 'rows',
        label: 'hyperparameters',
        columns: ['name', 'value'],
        hint: 'Every setting needed to reproduce this model: {name, value}. Include the seed. A model whose seed is missing cannot be rebuilt, and a model that cannot be rebuilt is a screenshot.',
      },
      {
        name: 'trainingDatasetId',
        render: 'stat',
        label: 'trainingDatasetId',
        hint: 'Canvas id of the `dataset` this learned from. This is what makes the lineage edge real and what the data-use gate reads before allowing a training run.',
      },
      {
        name: 'metrics',
        render: 'rows',
        label: 'metrics',
        columns: ['name', 'value', 'split'],
        hint: 'Measured performance: {name, value, split}. `split` must be one of train/validation/test — a metric with no split is unreadable, because a 0.99 on train and a 0.99 on test are opposite findings. Only record what a run or an evaluation actually produced.',
      },
      {
        name: 'intendedUse',
        render: 'text',
        label: 'intendedUse',
        hint: 'What this model is for and, specifically, who it is for. The first half of a model card.',
      },
      {
        name: 'limitations',
        render: 'list',
        label: 'limitations',
        hint: 'Where this model is known to be weak or unsafe, and the populations it was not validated on. The second half of a model card, and the half people skip — a model with no stated limitations is a model nobody probed.',
      },
      SUMMARY_FIELD,
      SOURCES_FIELD,
    ],
  },

  {
    kind: 'trainingRun',
    icon: '◐',
    group: 'Models',
    defaultStatus: 'notLinked',
    actions: ['refresh', 'compare'],
    seed: { hyperparameters: [], lossCurve: [], scorecard: [] },
    fields: [
      {
        name: 'jobId',
        render: 'stat',
        label: 'jobId',
        hint: 'Id of the training job on the server. Set by `canvas_read_training_run`, never typed — a run that names a job it did not read is a run reporting numbers it does not have.',
        derived: true,
      },
      {
        name: 'datasetObjectId',
        render: 'stat',
        label: 'datasetObjectId',
        hint: 'Canvas id of the `dataset` object this run trained on, so the loss curve and the rows that produced it are connected on the board.',
      },
      { name: 'baseModel', render: 'stat', label: 'baseModel', hint: 'Base checkpoint the job fine-tuned.', derived: true },
      {
        name: 'hyperparameters',
        render: 'rows',
        label: 'hyperparameters',
        columns: ['name', 'value'],
        hint: 'LoRA rank, epochs, batch size and learning rate as the JOB recorded them.',
        derived: true,
      },
      { name: 'runStatus', render: 'stat', label: 'runStatus', hint: 'Job status: pending, running, complete or failed.', derived: true },
      {
        name: 'lossCurve',
        render: 'bars',
        label: 'lossCurve',
        hint: 'Per-step training loss, read from the job log.',
        derived: true,
      },
      {
        name: 'scorecard',
        render: 'rows',
        label: 'scorecard',
        columns: ['axis', 'score'],
        hint: 'The evaluation the job recorded: overall score, code correctness, reasoning quality and hallucination rate.',
        derived: true,
      },
      { name: 'evaluatedAt', render: 'stat', label: 'evaluatedAt', hint: 'When the scorecard was produced.', derived: true },
      SUMMARY_FIELD,
    ],
  },

  {
    kind: 'runComparison',
    icon: '≡',
    group: 'Models',
    defaultStatus: 'needsRuns',
    actions: ['refresh', 'rank'],
    seed: { runs: [], rankBy: 'evalScore' },
    fields: [
      {
        name: 'rankBy',
        render: 'stat',
        label: 'rankBy',
        hint: 'The metric that decides the ranking, e.g. "evalScore" or "hallucinationRate". Say it explicitly — a comparison whose criterion is implicit is a comparison the reader will assume favours whichever run you already preferred.',
      },
      {
        name: 'baselineRunId',
        render: 'stat',
        label: 'baselineRunId',
        hint: 'Canvas id of the `trainingRun` every other run is measured AGAINST. Without a baseline a table of scores is not a comparison, it is a list.',
      },
      {
        name: 'runs',
        render: 'matrix',
        label: 'runs',
        columns: ['run', 'score', 'delta', 'hyperparameters'],
        hint: 'One row per run, with its delta against the baseline.',
        derived: true,
      },
      {
        name: 'verdict',
        render: 'verdict',
        label: 'verdict',
        hint: 'Which run won and by how much — computed from the ranked runs, never asserted.',
        derived: true,
      },
      {
        name: 'recommendations',
        render: 'list',
        label: 'recommendations',
        hint: 'What to try next, given what the deltas actually show. A recommendation that ignores the size of the difference between runs is guessing.',
      },
      SUMMARY_FIELD,
    ],
  },

  // ── EVALUATION ──────────────────────────────────────────────────────────────
  {
    kind: 'labelSet',
    icon: '⊞',
    group: 'Data',
    defaultStatus: 'notSampled',
    actions: ['sample', 'label', 'promote'],
    seed: { samples: [], labels: [], options: [] },
    fields: [
      {
        name: 'sourceDatasetId',
        render: 'stat',
        label: 'sourceDatasetId',
        hint: 'Canvas id of the `dataset` rows are sampled from.',
      },
      {
        name: 'question',
        render: 'text',
        label: 'question',
        hint: 'The ONE question every reviewer answers about every sample. If it needs an "and", it is two label sets — a compound question is how two reviewers come to disagree about which half they were answering.',
      },
      {
        name: 'options',
        render: 'chips',
        label: 'options',
        hint: 'The allowed answers. A closed set, so agreement is computable; free text belongs in a `note` on the sample, not in the label.',
      },
      {
        name: 'guidelines',
        render: 'text',
        label: 'guidelines',
        hint: 'How to decide the hard cases, with a worked example of each option. This is what makes two reviewers agree, and its absence is the usual reason they do not.',
      },
      {
        name: 'samples',
        render: 'rows',
        label: 'samples',
        columns: ['id', 'text'],
        hint: 'The sampled rows awaiting a label: {id, text}. Written by the sample action so the selection is reproducible rather than hand-picked — hand-picked examples are how an eval set comes to flatter the model.',
        derived: true,
      },
      {
        name: 'labels',
        render: 'rows',
        label: 'labels',
        columns: ['sampleId', 'reviewer', 'answer'],
        hint: 'What each reviewer actually chose.',
        derived: true,
      },
      {
        name: 'agreement',
        render: 'meter',
        label: 'agreement',
        hint: 'Share of multiply-labelled samples where reviewers chose the same answer. Low agreement invalidates the set rather than the reviewers.',
        derived: true,
      },
      SUMMARY_FIELD,
    ],
  },

  // ── SHIP ────────────────────────────────────────────────────────────────────
  {
    kind: 'prompt',
    icon: '❝',
    group: 'Models',
    defaultStatus: 'unversioned',
    actions: ['save', 'diff', 'evaluate'],
    seed: { versions: [], variables: [] },
    fields: [
      {
        name: 'body',
        render: 'text',
        label: 'body',
        hint: 'The prompt itself. Write the whole thing — a prompt stored as a description of a prompt cannot be diffed, evaluated or shipped.',
      },
      {
        name: 'variables',
        render: 'chips',
        label: 'variables',
        hint: 'Placeholder names the body interpolates, e.g. "customer_name". Declaring them is what lets an evaluation fill them from a dataset column instead of running the prompt with its placeholders still in it.',
      },
      {
        name: 'entryId',
        render: 'stat',
        label: 'entryId',
        hint: 'Prompt-library entry this is bound to. Set by the save action.',
        derived: true,
      },
      {
        name: 'versions',
        render: 'rows',
        label: 'versions',
        columns: ['version', 'savedAt', 'evalScore'],
        hint: 'Every saved version with the score its evaluation produced.',
        derived: true,
      },
      {
        name: 'activeVersion',
        render: 'stat',
        label: 'activeVersion',
        hint: 'The version currently in use. Changing it is a deliberate act — which is the entire reason a prompt is versioned rather than edited in place.',
      },
      {
        name: 'evaluationId',
        render: 'stat',
        label: 'evaluationId',
        hint: 'Canvas id of the `evaluation` object that scores this prompt. A prompt with no evaluation attached is a prompt whose changes are being judged by how they read.',
      },
      SUMMARY_FIELD,
    ],
  },
];

registerSpecObjectSet({
  id: 'dataScience',
  namespace: 'creationCanvas.dataScience',
  specs: DATA_SCIENCE_OBJECT_SPECS,
});
