/**
 * A training job, LOWERED onto a canvas object.
 *
 * ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────
 * This is the sharpest instance of a pattern the QA and CMO reviews both found: the
 * capability is BUILT and the board cannot reach it. `ide_training_jobs` stores base
 * model, LoRA rank, epochs, batch size, learning rate, current epoch, current loss, the
 * artifact key AND a four-axis eval scorecard; `ide_training_logs` streams per-step
 * loss; `/api/ide/training/*` serves both and `FinetuneStudioPanel` renders them inside
 * the IDE.
 *
 * A canvas `build` object can create a project of modality `finetune` — so the board
 * LAUNCHED the run and then lost it. Grepping the canvas and its contract for training
 * returned zero tools and zero kinds. The loss curve, the scorecard and the artifact
 * lived on another surface and could never be connected to the dataset that produced
 * them or the decision that used them.
 *
 * ── WHY A LOWERING MODULE RATHER THAN FIELDS IN THE TOOL HANDLER ─────────────────
 * Three callers need the identical mapping — the canvas tool, the object action, and
 * the comparison that ranks several runs — and a snake_case wire row turned into
 * canvas fields in three places is three chances to disagree about which axis
 * `eval_code_correctness` is. One function, and the scorecard a card draws is the
 * scorecard the comparison ranks.
 *
 * Everything this writes is `derived` in the spec: a model may READ a loss curve and
 * may never author one, because a model that could write evidence could report a
 * result nobody measured.
 */

import type { TrainingJob, TrainingLog } from './types';

/** The canvas-object shape a `trainingRun` carries. Mirrors the spec's field names. */
export interface TrainingRunFields {
  jobId: string;
  baseModel: string;
  runStatus: TrainingJob['status'];
  hyperparameters: Array<{ name: string; value: string | number }>;
  lossCurve: Array<{ label: string; value: number }>;
  scorecard: Array<{ axis: string; score: number }>;
  evaluatedAt?: string;
  status: string;
  summary: string;
}

/**
 * The four axes, named once.
 *
 * `hallucinationRate` is the one that is GOOD WHEN LOW, and it travels with that fact
 * because a comparison that ranks every axis descending would declare the most
 * hallucinatory run the winner. `higherIsBetter` is read by `canvasRunComparison`.
 */
export const TRAINING_SCORE_AXES = [
  { key: 'evalScore', field: 'eval_score', higherIsBetter: true },
  { key: 'codeCorrectness', field: 'eval_code_correctness', higherIsBetter: true },
  { key: 'reasoningQuality', field: 'eval_reasoning_quality', higherIsBetter: true },
  { key: 'hallucinationRate', field: 'eval_hallucination_rate', higherIsBetter: false },
] as const satisfies ReadonlyArray<{ key: string; field: keyof TrainingJob; higherIsBetter: boolean }>;

export type TrainingScoreAxis = typeof TRAINING_SCORE_AXES[number]['key'];

/** True when a higher number is a better result on this axis. */
export function axisHigherIsBetter(axis: string): boolean {
  return TRAINING_SCORE_AXES.find((entry) => entry.key === axis)?.higherIsBetter ?? true;
}

/**
 * A number, or null.
 *
 * The `== null` guard is load-bearing and is the reason this is not a one-liner:
 * `Number(null)` is 0 and `Number('')` is 0, both finite. Without it an unevaluated
 * job — every eval column null — lowered to a scorecard reading 0 on all four axes,
 * which is not "no score" but "the worst possible score", reported by a card that
 * looked exactly like a measured one.
 */
function numeric(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Turn a job row (and optionally its logs) into canvas fields.
 *
 * The loss curve comes from the LOGS when they are available and falls back to the
 * job's single `current_loss` when they are not — one point is a poor curve and it is
 * still the truth, where an empty curve on a running job reads as "no data" and
 * invites the reader to assume the run is broken.
 */
export function trainingRunFields(job: TrainingJob, logs: readonly TrainingLog[] = []): TrainingRunFields {
  const scorecard = TRAINING_SCORE_AXES.flatMap((axis) => {
    const score = numeric(job[axis.field]);
    return score == null ? [] : [{ axis: axis.key, score }];
  });

  const curve = logs
    .filter((log) => numeric(log.loss) != null)
    .map((log) => ({
      label: log.step != null ? `${log.epoch ?? 0}:${log.step}` : String(log.epoch ?? ''),
      value: numeric(log.loss)!,
    }));
  const currentLoss = numeric(job.current_loss);
  const lossCurve = curve.length ? curve : currentLoss != null ? [{ label: String(job.current_epoch ?? 0), value: currentLoss }] : [];

  return {
    jobId: job.id,
    baseModel: job.base_model,
    runStatus: job.status,
    hyperparameters: [
      { name: 'loraRank', value: job.lora_rank },
      { name: 'epochs', value: job.epochs },
      { name: 'batchSize', value: job.batch_size },
      { name: 'learningRate', value: job.learning_rate },
    ],
    lossCurve,
    scorecard,
    ...(job.evaluated_at ? { evaluatedAt: job.evaluated_at } : {}),
    status: describeStatus(job),
    summary: describeSummary(job, scorecard, lossCurve),
  };
}

/** The card's status line: what the run is doing, or what it produced. */
function describeStatus(job: TrainingJob): string {
  if (job.status === 'failed') return `Failed at epoch ${job.current_epoch}`;
  if (job.status === 'running') return `Epoch ${job.current_epoch} of ${job.epochs}`;
  if (job.status === 'pending') return 'Queued';
  return job.evaluated_at ? 'Evaluated' : 'Trained, not evaluated';
}

/**
 * The sentence a reader gets first.
 *
 * A completed run with NO scorecard says so explicitly rather than reporting the loss
 * alone: training loss is not a measure of whether the model is any good, and a card
 * that leads with it invites exactly that reading.
 */
function describeSummary(
  job: TrainingJob,
  scorecard: ReadonlyArray<{ axis: string; score: number }>,
  lossCurve: ReadonlyArray<{ value: number }>,
): string {
  if (job.status === 'failed') return job.error_message?.trim() || 'The run failed without recording a reason.';
  const overall = scorecard.find((entry) => entry.axis === 'evalScore');
  const finalLoss = lossCurve[lossCurve.length - 1]?.value;
  const lossText = finalLoss != null ? ` Final training loss ${finalLoss}.` : '';
  if (overall) return `Scored ${overall.score} overall across ${scorecard.length} axes.${lossText}`;
  if (job.status === 'completed') return `Training finished and this run has NOT been evaluated, so nothing here says whether the model is any good.${lossText}`;
  return `Running on ${job.base_model}.${lossText}`;
}
