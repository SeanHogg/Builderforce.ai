/**
 * Résumé AI — the VERIFICATION half of every model-assisted résumé capability.
 *
 * The deterministic pass (`planXyzRewrite`, `planBulletMerge`), the prompts and the
 * measurement helpers live in `@builderforce/resume-ai` — source shared with the web
 * client, which prompts the device's own model with exactly the same brief. What stays
 * here is step 3: re-measuring whatever came back (from a server model OR from the
 * client's `clientResult`) against the source and refusing anything it cannot support.
 *
 * The failure mode of an AI résumé tool is not bad writing — it is a number nobody
 * earned: "reduced latency by 40%" on a document that never mentioned latency or 40.
 * Instructing a model not to do it lowers the rate; measuring the output and rejecting
 * it makes the rate zero. {@link inventedNumbers} is that measurement, and every parser
 * below runs it. `missing` is likewise re-derived from the text actually written.
 *
 * Everything in this file is pure — no database, no network, no clock, no Worker env.
 */

import { extractJsonObject } from '../../domain/shared/json';
import {
  hasAccomplishment, hasMeasure, inventedNumbers, missingXyzParts, syntheticBullet,
  type BulletMergeBrief, type BulletMergeResult, type MergedBullet, type ResumeScore, type ScoreCategory,
  type XyzCandidate, type XyzPart, type XyzRewrite, type XyzRewriteBrief, type XyzRewriteResult,
} from '@builderforce/resume-ai';

// The plan + prompt half is the shared package's; re-exported so this module (and the
// `career` barrel) stays the API's one import path for the whole résumé-AI surface.
export {
  XYZ_PARTS, XYZ_PART_MEANING, XYZ_RESPONSE_SHAPE, MERGE_RESPONSE_SHAPE,
  buildBulletMergePrompt, buildXyzRewritePrompt, inventedNumbers, missingXyzParts, numericFingerprints,
  planBulletMerge, planXyzRewrite,
} from '@builderforce/resume-ai';
export type {
  BulletMergeBrief, BulletMergeResult, MergeGroup, MergedBullet, XyzCandidate, XyzPart, XyzRewrite, XyzRewriteBrief, XyzRewriteResult,
} from '@builderforce/resume-ai';

/**
 * Verify the model's rewrites and return the honest result.
 *
 * Four ways a rewrite is refused, and in every one of them the ORIGINAL stands: the id
 * is unknown, the line is empty, the line is unchanged, or the line asserts a number the
 * résumé never contained. Nothing here edits the model's wording to make it acceptable —
 * a half-corrected fabrication is harder to spot than a rejected one.
 */
export function parseXyzRewriteResponse(raw: string, brief: XyzRewriteBrief): XyzRewriteResult {
  const answers = new Map<number, { rewritten: string; ask: string }>();
  for (const entry of readArray(raw, 'rewrites')) {
    const id = Number(entry.id);
    if (!Number.isInteger(id)) continue;
    answers.set(id, { rewritten: readString(entry.rewritten).slice(0, 400), ask: readString(entry.ask).slice(0, 300) });
  }

  const documentNumbers = brief.evidence.join(' ');
  const rewrites: XyzRewrite[] = brief.candidates.map((candidate) => {
    const answer = answers.get(candidate.id);
    if (!answer) return refused(candidate, 'not_answered', '');
    if (!answer.rewritten) return refused(candidate, 'empty', answer.ask);
    if (answer.rewritten === candidate.original.trim()) return refused(candidate, 'unchanged', answer.ask);

    const invented = inventedNumbers(answer.rewritten, [candidate.original, documentNumbers]);
    if (invented.length) {
      return {
        ...refused(candidate, 'invented_metric', ''),
        inventedNumbers: invented,
        ask: `This rewrite claimed ${invented.join(', ')}, which appears nowhere in the résumé. Supply the real figure, or the line stays as it is.`,
      };
    }

    return {
      id: candidate.id,
      original: candidate.original,
      rewritten: answer.rewritten,
      // Re-measured, not believed.
      missing: missingXyzParts(answer.rewritten),
      accepted: true,
      ask: answer.ask,
    };
  });

  const refusedForInventedMetric = rewrites.filter((rewrite) => rewrite.refusedBecause === 'invented_metric').length;
  return {
    rewrites,
    accepted: rewrites.filter((rewrite) => rewrite.accepted).length,
    refusedForInventedMetric,
    instruction: refusedForInventedMetric > 0
      ? 'Some rewrites asserted figures this résumé does not contain and were discarded — their originals stand. Ask the person for those numbers before offering a replacement.'
      : 'Show each accepted rewrite beside its original and let the person approve it. Where `missing` still lists a part, ask the question in `ask` rather than filling the gap yourself.',
  };
}

function refused(candidate: XyzCandidate, why: NonNullable<XyzRewrite['refusedBecause']>, ask: string): XyzRewrite {
  return {
    id: candidate.id,
    original: candidate.original,
    rewritten: '',
    missing: candidate.missing,
    accepted: false,
    refusedBecause: why,
    ask: ask || askFor(candidate.missing),
  };
}

function askFor(missing: readonly XyzPart[]): string {
  if (missing.includes('Y')) return 'What was the size of this — how many, how much, or how long?';
  if (missing.includes('Z')) return 'How did you do it? The method is the part that proves it was you.';
  return 'What actually changed because you did this?';
}

export function parseBulletMergeResponse(raw: string, brief: BulletMergeBrief): BulletMergeResult {
  const answers = new Map<number, string>();
  for (const entry of readArray(raw, 'merged')) {
    const id = Number(entry.id);
    if (!Number.isInteger(id)) continue;
    answers.set(id, readString(entry.merged).slice(0, 400));
  }

  const merged: MergedBullet[] = brief.groups.map((group) => {
    const fallback = strongestVariant(group.variants);
    const answer = answers.get(group.id);
    if (answer === undefined) return { id: group.id, variants: group.variants, merged: '', accepted: false, refusedBecause: 'not_answered', fallback };
    if (!answer) return { id: group.id, variants: group.variants, merged: '', accepted: false, refusedBecause: 'empty', fallback };

    const invented = inventedNumbers(answer, group.variants);
    if (invented.length) {
      return { id: group.id, variants: group.variants, merged: '', accepted: false, refusedBecause: 'invented_metric', inventedNumbers: invented, fallback };
    }
    return { id: group.id, variants: group.variants, merged: answer, accepted: true, fallback };
  });

  return {
    merged,
    accepted: merged.filter((entry) => entry.accepted).length,
    refusedForInventedMetric: merged.filter((entry) => entry.refusedBecause === 'invented_metric').length,
    uniqueBullets: brief.consolidation.uniqueBullets,
    mergedSkills: brief.consolidation.mergedSkills,
    instruction: 'Build ONE master résumé from `merged` plus every line in `uniqueBullets` — the uniques exist in a single source and are exactly what a hand-merge silently drops. Where a merge was refused, its `fallback` is the strongest existing variant and stands unchanged.',
  };
}

/** The variant a person would keep: quantified first, then an ownership verb, then longest. */
function strongestVariant(variants: readonly string[]): string {
  const ranked = [...variants].sort((a, b) => {
    const quantified = Number(hasMeasure(b)) - Number(hasMeasure(a));
    if (quantified !== 0) return quantified;
    const owned = Number(hasAccomplishment(syntheticBullet(b))) - Number(hasAccomplishment(syntheticBullet(a)));
    if (owned !== 0) return owned;
    return b.length - a.length;
  });
  return ranked[0] ?? '';
}

// ---------------------------------------------------------------------------
// 3 — The graded read: a model score with NAMED gaps, on the same categories
// ---------------------------------------------------------------------------

/**
 * The point past which the two readings are reported as DISAGREEING rather than as
 * roughly agreeing. Fifteen points is roughly one grade band — below it the two answers
 * tell the same story; above it, a person shown both would rightly ask which to believe,
 * and the product owes them an answer rather than an average.
 */
export const GRADE_DISAGREEMENT_THRESHOLD = 15;

export interface GradeGap {
  /** The specific thing costing points, quoted or named. */
  gap: string;
  /** The model's estimate of the points it costs, when it gave one. */
  costsPoints: number | null;
  /** The exact résumé text this gap is about, when the model anchored it. */
  evidence: string;
}

export interface GradedCategory {
  key: ScoreCategory['key'];
  label: string;
  /** The COUNT-derived score from `scoreResume`. Stable across calls. */
  measuredScore: number;
  /** What the model made it. Null when the model did not grade this category. */
  modelScore: number | null;
  /** modelScore − measuredScore, or null. */
  delta: number | null;
  /** True when the two readings are far enough apart to need saying out loud. */
  disagrees: boolean;
  /** The measurement behind `measuredScore` — the evidence a person can check. */
  evidence: string;
  gaps: GradeGap[];
}

export interface ResumeGrade {
  /** The deterministic reading, unchanged. */
  measured: ResumeScore;
  /** The model's overall, when it gave one. */
  modelOverall: number | null;
  categories: GradedCategory[];
  /** One sentence per category the two readings disagree about. */
  disagreements: string[];
  /** What to believe, said plainly. */
  verdict: string;
}

export const GRADE_RESPONSE_SHAPE = '{"overall":<0-100>,"categories":[{"key":"ats"|"content"|"keywords"|"format"|"impact","score":<0-100>,"gaps":[{"gap":"<what costs the points>","costsPoints":<number>,"evidence":"<exact text from the résumé>"}]}]}';

export function buildGradePrompt(score: ResumeScore, jobDescription?: string): { system: string; user: string } {
  const system = [
    'You grade a résumé across FIVE fixed categories and name the specific gaps that cost the points.',
    'The categories are exactly: ats (a parser can read it and reach the person), content (there is enough of',
    'it, in bullets), keywords (recognisable skill vocabulary), format (consistent dates, scannable bullets),',
    'impact (the bullets claim results, not presence). Grade all five. Invent no sixth.',
    '',
    'A gap must be SPECIFIC and ANCHORED: quote the line or name the missing section. "Could be stronger" is',
    'not a gap. "The three bullets under the most recent role all open with the same passive phrase" is.',
    '',
    'You are shown the measured counts for each category. They are facts about the document, not opinions — if',
    'your score disagrees with one, say what you are seeing that the count does not, in a gap. Do not restate',
    'the counts back as your own finding.',
    `Reply with JSON only, in this shape: ${GRADE_RESPONSE_SHAPE}`,
  ].join('\n');

  const user = [
    'Measured reading of this résumé:',
    ...score.categories.map((category) => `- ${category.key} (${category.label}): ${category.score}/100 — ${category.evidence}`),
    `- overall: ${score.overall}/100`,
    '',
    ...(jobDescription?.trim() ? ['Grade it against this posting as well:', jobDescription.trim().slice(0, 4000), ''] : []),
    'Weaknesses the counts already found (do not simply repeat these — go past them):',
    ...(score.weaknesses.length ? score.weaknesses.map((weakness) => `- ${weakness}`) : ['- none']),
  ].join('\n');

  return { system, user };
}

/**
 * Merge the two readings into one answer that never hides the disagreement.
 *
 * Both scores are returned, per category, side by side. That is the whole design: a
 * measured score is reproducible and a model score is perceptive, and the useful product
 * of the two is not an average — it is the list of places they do not agree, which is
 * exactly where a person should look.
 */
export function parseGradeResponse(raw: string, score: ResumeScore): ResumeGrade {
  const parsed = readObject(raw);
  const modelOverall = clampScore(parsed?.overall);
  const byKey = new Map<string, { score: number | null; gaps: GradeGap[] }>();
  for (const entry of readArray(raw, 'categories')) {
    const key = readString(entry.key).toLowerCase();
    if (!key) continue;
    byKey.set(key, { score: clampScore(entry.score), gaps: readGaps(entry.gaps) });
  }

  const categories: GradedCategory[] = score.categories.map((category) => {
    const model = byKey.get(category.key);
    const modelScore = model?.score ?? null;
    const delta = modelScore == null ? null : modelScore - category.score;
    return {
      key: category.key,
      label: category.label,
      measuredScore: category.score,
      modelScore,
      delta,
      disagrees: delta != null && Math.abs(delta) >= GRADE_DISAGREEMENT_THRESHOLD,
      evidence: category.evidence,
      gaps: model?.gaps ?? [],
    };
  });

  const disagreements = categories
    .filter((category) => category.disagrees)
    .map((category) => `${category.label}: measured ${category.measuredScore}, the model says ${category.modelScore}. The measurement is ${category.evidence} — decide which of those you are being graded on.`);

  return {
    measured: score,
    modelOverall,
    categories,
    disagreements,
    verdict: verdictFor(score.overall, modelOverall, disagreements.length),
  };
}

function verdictFor(measured: number, model: number | null, disagreementCount: number): string {
  if (model == null) return `The measured score is ${measured}/100. The model returned no overall score, so only the measured reading stands.`;
  if (Math.abs(model - measured) < GRADE_DISAGREEMENT_THRESHOLD && disagreementCount === 0) {
    return `Both readings agree: ${measured}/100 measured, ${model}/100 from the model. Work the named gaps in order.`;
  }
  return `The two readings disagree — ${measured}/100 measured against ${model}/100 from the model, across ${disagreementCount} categor${disagreementCount === 1 ? 'y' : 'ies'}. The measured score is a count over your document and will not move unless the document does; the model score is a judgement and will move if you ask again. Treat the named gaps as the answer and the two numbers as two ways of pointing at them.`;
}

// ---------------------------------------------------------------------------
// Shared JSON reading
// ---------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>;

/**
 * Parse a model reply into an object, tolerating a fenced block around it.
 *
 * `response_format: json_object` makes that the uncommon case rather than the normal
 * one, but a proxy that failed over to a vendor which does not honour the flag still has
 * to produce an answer instead of a 500 — and every caller here degrades to the
 * deterministic half, which needed no model in the first place.
 */
function readObject(raw: string): JsonRecord | null {
  // THE one fence-and-brace reader (domain/shared/json). A malformed reply is a REFUSAL,
  // not a crash — and not a silent one either: `null` makes the caller's verification
  // pass mark every candidate `not_answered`, which is surfaced to the person as "the
  // model returned nothing for this line" rather than as an empty result. There is
  // nothing to report to an error channel; a model writing prose where JSON was asked
  // for is a routine outcome this layer exists to absorb.
  return extractJsonObject(raw);
}

function readArray(raw: string, field: string): JsonRecord[] {
  const value = readObject(raw)?.[field];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is JsonRecord => !!entry && typeof entry === 'object' && !Array.isArray(entry));
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clampScore(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function readGaps(value: unknown): GradeGap[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is JsonRecord => !!entry && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => ({
      gap: readString(entry.gap).slice(0, 400),
      costsPoints: clampScore(entry.costsPoints),
      evidence: readString(entry.evidence).slice(0, 400),
    }))
    .filter((gap) => gap.gap.length > 0)
    .slice(0, 8);
}
