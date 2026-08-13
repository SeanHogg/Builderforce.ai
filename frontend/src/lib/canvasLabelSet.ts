/**
 * The human labelling loop — where an evaluation set legitimately comes from.
 *
 * ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────
 * There was no `annotation`, `label` or `sample` kind and no review queue, so the only
 * path to test cases was a model writing its own and grading itself. Every eval set in
 * real work comes from humans labelling examples and DISAGREEING about them, and the
 * disagreement is the signal: a set two reviewers cannot agree on does not measure the
 * model, it measures the question.
 *
 * `course`/`practice` already proved the product knows how to model "questions plus the
 * record of every attempt" — this is that shape, pointed at rows instead of learners,
 * which is why `labels` is `derived` for the same reason `practice.attempts` is.
 *
 * ── WHY REPRODUCIBLE SAMPLING ───────────────────────────────────────────────────
 * `sampleRows` takes a deterministic stride rather than a random draw. Hand-picked
 * examples are how an eval set comes to flatter the model, and an unseeded random draw
 * is worse than either: it cannot be reproduced, so two people who sampled "the same"
 * 50 rows scored different sets and could not tell.
 */

import type { TabularRow, TabularSource } from './canvasTabularData';

export interface LabelSample {
  id: string;
  text: string;
}

export interface LabelRecord {
  sampleId: string;
  reviewer: string;
  answer: string;
}

export interface LabelAgreement {
  /** Samples answered by two or more reviewers. */
  multiplyLabelled: number;
  /** Of those, how many drew a unanimous answer. */
  unanimous: number;
  /** Share in 0–100, or null when nothing was double-labelled. */
  agreement: number | null;
  /** Samples where reviewers disagreed — the rows worth reading. */
  contested: string[];
  /** Samples with no label at all yet. */
  unlabelled: number;
}

/**
 * Deterministically sample rows for review.
 *
 * A stride, not a random draw, and not the first N: taking the head of a file samples
 * whatever the export happened to sort by, which for most real exports is time — so an
 * eval set built from the first 50 rows measures the model on the oldest data it will
 * ever see.
 */
export function sampleRows(source: TabularSource, size: number, textColumn?: string): LabelSample[] {
  const rows = source.rows;
  if (!rows.length || size <= 0) return [];
  const wanted = Math.min(Math.floor(size), rows.length);
  const stride = rows.length / wanted;
  const column = textColumn && source.columns.includes(textColumn) ? textColumn : null;
  return Array.from({ length: wanted }, (_, index) => {
    const position = Math.min(rows.length - 1, Math.floor(index * stride));
    return { id: `r${position}`, text: describeRow(rows[position], source.columns, column) };
  });
}

/** One row as the sentence a reviewer reads. */
function describeRow(row: TabularRow, columns: readonly string[], textColumn: string | null): string {
  if (textColumn) return String(row[textColumn] ?? '').slice(0, 500);
  return columns
    .map((column) => `${column}: ${row[column] ?? ''}`)
    .join(' · ')
    .slice(0, 500);
}

/**
 * Inter-reviewer agreement over the labels collected so far.
 *
 * Raw percent agreement rather than Cohen's κ, deliberately: κ needs a fixed pair of
 * reviewers and a known answer distribution, and a canvas label set has neither — it
 * has whoever showed up. Percent agreement over the multiply-labelled subset is the
 * statistic this data can actually support, and reporting the honest simple one beats
 * reporting a sophisticated one computed on assumptions that do not hold.
 *
 * `contested` matters more than the number: it is the list of rows to go read, and
 * reading them is what fixes the guidelines.
 */
export function labelAgreement(samples: readonly LabelSample[], labels: readonly LabelRecord[]): LabelAgreement {
  const bySample = new Map<string, string[]>();
  for (const label of labels) {
    const answer = (label.answer ?? '').trim();
    if (!answer) continue;
    const list = bySample.get(label.sampleId);
    if (list) list.push(answer); else bySample.set(label.sampleId, [answer]);
  }

  let multiplyLabelled = 0;
  let unanimous = 0;
  const contested: string[] = [];
  for (const [sampleId, answers] of bySample) {
    if (answers.length < 2) continue;
    multiplyLabelled += 1;
    if (new Set(answers).size === 1) unanimous += 1;
    else contested.push(sampleId);
  }

  return {
    multiplyLabelled,
    unanimous,
    agreement: multiplyLabelled ? Number((unanimous / multiplyLabelled * 100).toFixed(2)) : null,
    contested,
    unlabelled: samples.filter((sample) => !bySample.has(sample.id)).length,
  };
}

/**
 * The agreed answer per sample — the eval set a `labelSet` promotes into.
 *
 * A contested sample is EXCLUDED rather than resolved by majority. A majority vote on
 * two-versus-one manufactures a ground truth from a genuine ambiguity, and an eval set
 * containing manufactured truths reports a model's failure to guess which reviewer won.
 */
export function promoteToGoldenSet(
  samples: readonly LabelSample[],
  labels: readonly LabelRecord[],
): Array<{ id: string; text: string; answer: string }> {
  const bySample = new Map<string, string[]>();
  for (const label of labels) {
    const answer = (label.answer ?? '').trim();
    if (!answer) continue;
    const list = bySample.get(label.sampleId);
    if (list) list.push(answer); else bySample.set(label.sampleId, [answer]);
  }
  return samples.flatMap((sample) => {
    const answers = bySample.get(sample.id);
    if (!answers?.length || new Set(answers).size !== 1) return [];
    return [{ id: sample.id, text: sample.text, answer: answers[0] }];
  });
}
