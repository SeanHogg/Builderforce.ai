/**
 * Résumé AI — the PURE half of every model-assisted résumé capability.
 *
 * ── WHY THE PROMPT AND THE PARSER LIVE APART FROM THE MODEL CALL ─────────────────
 * `resumeAnalysis.ts` opens with the argument that every number it reports is a COUNT
 * over the parsed document, because a score a model made up moves when you ask twice.
 * The capabilities here are the ones that genuinely need prose — a rewritten bullet, a
 * merged bullet, a named gap — and the same discipline applies to them in a different
 * form: the model is allowed to choose WORDS, and is allowed to choose nothing else.
 *
 * So each capability is three steps, and only the middle one is a model:
 *
 *   1. a DETERMINISTIC pass (`scoreResume`, `parseResume`, `consolidateResumes`) that
 *      decides WHICH lines are in play and what evidence already exists for them;
 *   2. ONE model call, prompted with exactly that structure;
 *   3. a VERIFICATION pass, here, that re-measures the model's answer against the
 *      source and refuses anything it cannot support.
 *
 * Step 3 is the part that cannot be a prompt. The failure mode of an AI résumé tool is
 * not bad writing — it is a number nobody earned: "reduced latency by 40%" appearing on
 * a document that never mentioned latency or 40. A candidate then has to defend that
 * figure in a room, having never measured it. Instructing a model not to do it lowers
 * the rate; measuring the output and rejecting it makes the rate zero, which is the only
 * rate worth shipping. {@link inventedNumbers} is that measurement, and every parser
 * below runs it.
 *
 * The second consequence of step 3 is that `missing` is HONEST. The model is asked which
 * of X (the accomplishment), Y (the measure) and Z (the method) it could not supply, but
 * its answer is not what is returned: the returned `missing` is re-derived from the text
 * it actually wrote, by the same detectors that flagged the bullet in the first place.
 * A model that claims to have added a metric and did not is therefore reported as still
 * missing one, and the person is asked for the figure instead of being told a lie.
 *
 * Everything in this file is pure — no database, no network, no clock, no Worker env —
 * which is the property `career/index.ts` requires of everything it re-exports, and what
 * lets the whole verification story be unit-tested without a model.
 */

import { STRONG_VERBS, parseResume, type ResumeBullet } from '@builderforce/creation-canvas-contract';
import { consolidateResumes, scoreResume, type ResumeConsolidation, type ResumeScore, type ScoreCategory } from './resumeAnalysis';

// ---------------------------------------------------------------------------
// The XYZ shape
// ---------------------------------------------------------------------------

/**
 * The three parts of "accomplished [X] as measured by [Y], by doing [Z]".
 *
 * Kept as single letters because that is how the formula is written everywhere it is
 * taught, and because the model has to echo them back in a JSON field — a longer name
 * is a longer thing to get subtly wrong.
 */
export const XYZ_PARTS = ['X', 'Y', 'Z'] as const;
export type XyzPart = (typeof XYZ_PARTS)[number];

/** What each part means, in the words the prompt and the UI both use. */
export const XYZ_PART_MEANING: Record<XyzPart, string> = {
  X: 'the accomplishment',
  Y: 'the measure',
  Z: 'the method',
};

/** Words that introduce the METHOD half of the formula. */
const METHOD_MARKERS = /\b(by|via|through|using|leveraging|with|after|driving|enabling)\b/i;

/** A bullet's opener is an ownership verb. Mirrors `parseResume`'s own reading. */
const hasAccomplishment = (bullet: ResumeBullet): boolean => bullet.strongOpener && !bullet.weakOpener;

/** The method clause: a marker word that is not the very first word of the line. */
function hasMethod(text: string): boolean {
  const match = METHOD_MARKERS.exec(text);
  return !!match && match.index > 0;
}

/** Does this text carry a number a screener can read as a size? */
const hasMeasure = (text: string): boolean => /\d/.test(text);

/**
 * Which parts of the formula a line is missing, measured from the line itself.
 *
 * The SAME function grades the original and the rewrite. That is deliberate: if the
 * rewrite were graded by a second definition (or by the model's own claim), a bullet
 * could be reported fixed by one reading and broken by the other, and the person would
 * have no way to tell which page was lying.
 */
export function missingXyzParts(text: string, bullet?: ResumeBullet): XyzPart[] {
  const graded = bullet ?? syntheticBullet(text);
  const missing: XyzPart[] = [];
  if (!hasAccomplishment(graded)) missing.push('X');
  if (!hasMeasure(text)) missing.push('Y');
  if (!hasMethod(text)) missing.push('Z');
  return missing;
}

/**
 * Grade a REWRITTEN line, which has no `ResumeBullet` of its own.
 *
 * Re-running `parseResume` over one sentence is the honest way to get the same
 * `strongOpener` / `weakOpener` reading the original was graded by, rather than a second
 * copy of the verb list living here and drifting from the lexicon.
 */
function syntheticBullet(text: string): ResumeBullet {
  const parsed = parseResume(`Experience\n- ${text}`);
  const first = parsed.bullets[0];
  if (first) return first;
  const opener = (text.trim().split(/\s+/)[0] ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return {
    text: text.trim(),
    section: 'experience',
    opener,
    strongOpener: STRONG_VERBS.includes(opener),
    weakOpener: null,
    quantified: hasMeasure(text),
    length: text.trim().length,
  };
}

// ---------------------------------------------------------------------------
// The invented-number guard
// ---------------------------------------------------------------------------

/**
 * Every number in a piece of text, normalised so "$1,200" and "1200" are the same fact
 * and "40%" and "40" are the same fact.
 *
 * Deliberately loose about UNITS and strict about DIGITS. A rewrite that turns
 * "reduced build time by 40%" into "cut build times 40%" must pass; a rewrite that turns
 * "reduced build time" into "reduced build time by 40%" must not. Only the digits
 * separate those two cases.
 */
export function numericFingerprints(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.matchAll(/\d[\d,_]*(?:\.\d+)?/g)) {
    const raw = match[0].replace(/[,_]/g, '');
    if (!raw) continue;
    // Trailing zeros after a decimal point are the same magnitude, not a new claim.
    const normalised = raw.includes('.') ? String(Number(raw)) : raw.replace(/^0+(?=\d)/, '');
    if (normalised && normalised !== 'NaN') out.add(normalised);
  }
  return out;
}

/**
 * The numbers `candidate` asserts that `sources` never did — the fabrication test.
 *
 * `sources` is every text the rewrite is allowed to draw a figure from: the original
 * line, and (for a résumé-wide rewrite) the whole document, because a metric stated in
 * the summary and re-used in a bullet is a real fact the person already claimed.
 */
export function inventedNumbers(candidate: string, sources: readonly string[]): string[] {
  const allowed = new Set<string>();
  for (const source of sources) for (const value of numericFingerprints(source)) allowed.add(value);
  return [...numericFingerprints(candidate)].filter((value) => !allowed.has(value));
}

// ---------------------------------------------------------------------------
// 1 — Rewrite to XYZ
// ---------------------------------------------------------------------------

export interface XyzCandidate {
  /** Index into the parsed bullet list — the handle the model answers with. */
  id: number;
  original: string;
  section: string;
  /** Parts the ORIGINAL line lacks, measured. */
  missing: XyzPart[];
  /** Why this line was picked, in a sentence the UI can show unchanged. */
  reason: string;
}

export interface XyzRewriteBrief {
  /** The deterministic reading the whole capability is grounded on. */
  score: ResumeScore;
  candidates: XyzCandidate[];
  /**
   * Every number that appears anywhere in the document. This is what the model is told
   * it may use, and what {@link parseXyzRewriteResponse} checks the answer against.
   */
  evidence: string[];
  /** Bullets that already satisfy all three parts and were deliberately left alone. */
  alreadyStrong: number;
  /** Candidates past `limit` — reported so the UI never implies the list is the total. */
  deferred: number;
}

const DEFAULT_REWRITE_LIMIT = 12;

/**
 * The deterministic pass: which bullets are worth a model call, and what evidence exists.
 *
 * Ranked by how much is missing, weak openers first, because a bullet that opens
 * "Responsible for…" is the one a screener stops reading at. Capped, because a résumé
 * with sixty bullets does not need sixty rewrites in one turn — it needs the twelve that
 * change the reading.
 */
export function planXyzRewrite(resumeText: string, opts?: { limit?: number }): XyzRewriteBrief {
  const parsed = parseResume(resumeText);
  const score = scoreResume(resumeText);
  const limit = Math.max(1, Math.min(30, opts?.limit ?? DEFAULT_REWRITE_LIMIT));

  const ranked = parsed.bullets
    .map((bullet, id) => ({ bullet, id, missing: missingXyzParts(bullet.text, bullet) }))
    .filter((entry) => entry.missing.length > 0)
    .sort((a, b) => {
      const weak = Number(!!b.bullet.weakOpener) - Number(!!a.bullet.weakOpener);
      if (weak !== 0) return weak;
      return b.missing.length - a.missing.length;
    });

  const candidates: XyzCandidate[] = ranked.slice(0, limit).map((entry) => ({
    id: entry.id,
    original: entry.bullet.text,
    section: entry.bullet.section,
    missing: entry.missing,
    reason: candidateReason(entry.bullet, entry.missing),
  }));

  return {
    score,
    candidates,
    evidence: [...numericFingerprints(parsed.text)].sort(),
    alreadyStrong: parsed.bullets.length - ranked.length,
    deferred: Math.max(0, ranked.length - candidates.length),
  };
}

function candidateReason(bullet: ResumeBullet, missing: readonly XyzPart[]): string {
  if (bullet.weakOpener) return `Opens with "${bullet.weakOpener}", so the line describes presence rather than a result.`;
  return `Missing ${missing.map((part) => XYZ_PART_MEANING[part]).join(', ')}.`;
}

/** One rewritten line, after verification. */
export interface XyzRewrite {
  id: number;
  original: string;
  /** The model's wording, or '' when nothing usable came back. */
  rewritten: string;
  /** Parts still missing, RE-MEASURED from `rewritten` (or from `original` when the
   *  rewrite was refused). Never the model's own claim. */
  missing: XyzPart[];
  /** False when the rewrite was refused — the original stands. */
  accepted: boolean;
  /** Why it was refused. Absent when accepted. */
  refusedBecause?: 'invented_metric' | 'unchanged' | 'empty' | 'not_answered';
  /** Numbers the rewrite asserted that the résumé never did. Absent when accepted. */
  inventedNumbers?: string[];
  /** What the person still has to supply, in their words. */
  ask: string;
}

export interface XyzRewriteResult {
  rewrites: XyzRewrite[];
  accepted: number;
  /** Rewrites thrown away for asserting a figure the document does not contain. */
  refusedForInventedMetric: number;
  instruction: string;
}

/** The response shape the model is held to. */
export const XYZ_RESPONSE_SHAPE = '{"rewrites":[{"id":<number>,"rewritten":"<one line>","missing":["X"|"Y"|"Z"],"ask":"<what you need from them, or empty>"}]}';

export function buildXyzRewritePrompt(brief: XyzRewriteBrief): { system: string; user: string } {
  const system = [
    'You rewrite résumé bullets into the form: accomplished [X] as measured by [Y], by doing [Z].',
    'X is what changed and is owned by the first verb. Y is the number that sizes it. Z is how it was done.',
    '',
    'THE ONE RULE THAT MATTERS: you may not introduce a number, percentage, amount, duration, employer or',
    'technology that does not already appear in the material you were given. Not as an estimate, not as a',
    'plausible example, not as a placeholder. A figure on a résumé is something the person has to defend in',
    'an interview, and a figure you invented is one they cannot.',
    '',
    'When a bullet has no measure available, that is the expected outcome, not a failure. Rewrite the parts',
    'you CAN — the ownership verb and the method — list "Y" in `missing`, and put the question you would ask',
    'the person in `ask` ("how many users?", "over what period?"). An honest gap is worth more than a',
    'convincing invention.',
    '',
    'Keep every proper noun and every existing number verbatim. One sentence per bullet, under 200 characters.',
    `Reply with JSON only, in this shape: ${XYZ_RESPONSE_SHAPE}`,
  ].join('\n');

  const evidence = brief.evidence.length
    ? `Numbers that appear somewhere in this résumé and may therefore be used: ${brief.evidence.join(', ')}.`
    : 'This résumé contains NO numbers at all. Every rewrite must list "Y" in `missing` and ask for the figure.';

  const impact = brief.score.categories.find((category) => category.key === 'impact');
  const user = [
    evidence,
    '',
    `Impact score today: ${impact?.score ?? 0}/100 — ${brief.score.measured.quantifiedBullets} of ${brief.score.measured.bullets} bullets carry a number.`,
    '',
    'Rewrite these bullets:',
    ...brief.candidates.map((candidate) => `${candidate.id}. ${candidate.original}\n   (missing: ${candidate.missing.join(', ') || 'nothing'} — ${candidate.reason})`),
  ].join('\n');

  return { system, user };
}

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

// ---------------------------------------------------------------------------
// 2 — Bullet consolidation
// ---------------------------------------------------------------------------

export interface MergeGroup {
  id: number;
  /** Every phrasing of the same accomplishment, across the sources. */
  variants: string[];
}

export interface BulletMergeBrief {
  /** The deterministic merge reading — duplicates, uniques and the skill union. */
  consolidation: ResumeConsolidation;
  groups: MergeGroup[];
}

export interface MergedBullet {
  id: number;
  variants: string[];
  merged: string;
  accepted: boolean;
  refusedBecause?: 'invented_metric' | 'empty' | 'not_answered';
  inventedNumbers?: string[];
  /** The variant that stands when the merge was refused — the strongest one, measured. */
  fallback: string;
}

export interface BulletMergeResult {
  merged: MergedBullet[];
  accepted: number;
  refusedForInventedMetric: number;
  /** Carried through verbatim: bullets in exactly one source are what a hand-merge loses. */
  uniqueBullets: string[];
  mergedSkills: string[];
  instruction: string;
}

export const MERGE_RESPONSE_SHAPE = '{"merged":[{"id":<number>,"merged":"<one line>"}]}';

/**
 * The deterministic pass: `consolidateResumes` already finds the near-duplicate groups
 * and — the half that matters — the bullets that exist in only one source. Only the
 * WORDING of a merged group needs a model, so only the groups are sent.
 */
export function planBulletMerge(inputs: readonly string[]): BulletMergeBrief {
  const consolidation = consolidateResumes(inputs);
  return {
    consolidation,
    groups: consolidation.duplicateGroups.map((group, id) => ({
      id,
      variants: [group.canonical, ...group.variants],
    })),
  };
}

export function buildBulletMergePrompt(brief: BulletMergeBrief): { system: string; user: string } {
  const system = [
    'You merge duplicate résumé bullets. Each group below is ONE accomplishment written several ways across',
    'several versions of the same résumé. Write the single strongest line for each group.',
    '',
    'Take the union of what the variants say and nothing more. Every number, proper noun, tool and employer in',
    'the merged line must appear in at least one variant of THAT group — you are choosing between existing',
    'facts, never adding one. If two variants disagree about a figure, keep the one stated more precisely and',
    'do not average them.',
    '',
    'Lead with an ownership verb, keep it under 200 characters, one sentence.',
    `Reply with JSON only, in this shape: ${MERGE_RESPONSE_SHAPE}`,
  ].join('\n');

  const user = brief.groups
    .map((group) => `${group.id}.\n${group.variants.map((variant) => `   - ${variant}`).join('\n')}`)
    .join('\n\n');

  return { system, user: user || 'No duplicate groups were found.' };
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
  const trimmed = raw.trim();
  const body = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
    : trimmed;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonRecord) : null;
  } catch {
    // A malformed reply is a REFUSAL, not a crash — and not a silent one either: `null`
    // makes the caller's verification pass mark every candidate `not_answered`, which is
    // surfaced to the person as "the model returned nothing for this line" rather than as
    // an empty result. There is nothing to report to an error channel; a model writing
    // prose where JSON was asked for is a routine outcome this layer exists to absorb.
    return null;
  }
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
