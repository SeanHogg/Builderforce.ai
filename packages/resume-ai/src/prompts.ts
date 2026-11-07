/**
 * Résumé AI — the shared PLAN + PROMPT half of every model-assisted résumé capability.
 * Source-only, used by the API (which verifies the reply) and by the web client (which
 * asks the device's own model first, PRD 42 · D2). The verification — `parse*Response`,
 * the invented-number refusal, the grade — stays in the API's `resumeAiPrompts.ts`.
 *
 * ── WHY THE PROMPT AND THE PARSER LIVE APART FROM THE MODEL CALL ─────────────────
 * `analysis.ts` opens with the argument that every number it reports is a COUNT
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
import { consolidateResumes, scoreResume, type ResumeConsolidation, type ResumeScore } from './analysis';

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
export const hasAccomplishment = (bullet: ResumeBullet): boolean => bullet.strongOpener && !bullet.weakOpener;

/** The method clause: a marker word that is not the very first word of the line. */
function hasMethod(text: string): boolean {
  const match = METHOD_MARKERS.exec(text);
  return !!match && match.index > 0;
}

/** Does this text carry a number a screener can read as a size? */
export const hasMeasure = (text: string): boolean => /\d/.test(text);

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
export function syntheticBullet(text: string): ResumeBullet {
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

