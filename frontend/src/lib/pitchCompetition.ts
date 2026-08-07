/**
 * Pitch competitions as canvas data — ONE rulebook, every competition.
 *
 * A pitch competition is a scored, timed, gated process: a written entry decides
 * who gets on stage, a stopwatch decides how much of the story survives, a
 * published rubric decides who wins, and a judge panel decides whether the
 * answers hold up. Those four things are the objects on the board — `pitch`,
 * `pitchScorecard`, `pitchQa`, `pitchApplication` — and every rule they obey
 * lives here rather than inside a card body, so the node, the inspector, the
 * export, and Brain cannot disagree about whether a pitch is over time or a
 * scorecard is ready.
 *
 * Competitions are DATA, not branches. Shipping SXSW Pitch's real rubric and
 * format is what makes the pack immediately useful; keeping it in the same
 * preset table as a demo day and an accelerator application is what makes it
 * reusable for every other user with a different competition. A tenant that
 * enters something we have never heard of edits the criteria in the inspector
 * and gets the same scoring, the same timing verdict, and the same exports.
 */

import type { CreationNodeData } from '@/components/creation-canvas/types';
import type { CreationObjectKind } from '@builderforce/creation-canvas-contract';

/** The four objects this rulebook governs. */
export const PITCH_OBJECT_KINDS = ['pitch', 'pitchScorecard', 'pitchQa', 'pitchApplication'] as const satisfies readonly CreationObjectKind[];
export type PitchObjectKind = typeof PITCH_OBJECT_KINDS[number];
const PITCH_KIND_SET: ReadonlySet<string> = new Set<string>(PITCH_OBJECT_KINDS);

export function isPitchObjectKind(kind: string): kind is PitchObjectKind {
  return PITCH_KIND_SET.has(kind);
}

/** The highest score a single criterion can be given. Judges score out of five
 * far more often than out of ten, and one scale keeps readiness comparable
 * across competitions. */
export const PITCH_MAX_SCORE = 5;

export interface PitchCriterionSpec {
  id: string;
  label: string;
  /** Relative weight. SXSW Pitch weights its six criteria equally; a demo day
   * that cares mostly about traction does not, and says so here. */
  weight: number;
  /** What a judge is actually looking for — shown as the evidence prompt. */
  prompt: string;
}

export interface PitchBeatSpec {
  id: string;
  label: string;
  seconds: number;
  prompt: string;
}

export interface PitchQuestionSpec {
  id: string;
  label: string;
  maxChars: number;
}

export interface PitchRuleSpec {
  id: string;
  label: string;
}

export interface PitchCompetitionSpec {
  id: string;
  /** Competition name — a proper noun, never translated. */
  name: string;
  url: string;
  pitchSeconds: number;
  qaSeconds: number;
  criteria: readonly PitchCriterionSpec[];
  beats: readonly PitchBeatSpec[];
  questions: readonly PitchQuestionSpec[];
  eligibility: readonly PitchRuleSpec[];
  categories: readonly string[];
}

/**
 * SXSW Pitch: six criteria at equal weighting, a three-minute pitch, and a
 * three-minute judge Q&A. The eligibility gate is as decisive as the rubric —
 * a company that has raised past the cap is out before anyone reads the pitch,
 * which is exactly the kind of thing a board should surface on day one rather
 * than on the day the entry is rejected.
 */
const SXSW_PITCH: PitchCompetitionSpec = {
  id: 'sxsw-pitch',
  name: 'SXSW Pitch',
  url: 'https://sxsw.com/pitch/',
  pitchSeconds: 180,
  qaSeconds: 180,
  criteria: [
    { id: 'innovation', label: 'Innovation / originality', weight: 1, prompt: 'What is genuinely new about the core concept, and what does it make possible that nothing else does?' },
    { id: 'viability', label: 'Viability', weight: 1, prompt: 'Why does this work as a business — unit economics, pricing, cost to serve, path to profitability?' },
    { id: 'marketability', label: 'Marketability', weight: 1, prompt: 'Who buys, how they are reached, and what proof exists that the motion converts?' },
    { id: 'growth', label: 'Potential for growth', weight: 1, prompt: 'Growth rate, retention, expansion, and the size of the market this can grow into.' },
    { id: 'impact', label: 'Capacity for impact', weight: 1, prompt: 'What measurably changes for customers, an industry, or a community if this succeeds?' },
    { id: 'team', label: 'Team / people', weight: 1, prompt: 'Why this team wins — track record, dynamics, diversity, values, mission, culture.' },
  ],
  beats: [
    { id: 'hook', label: 'Hook', seconds: 20, prompt: 'One sentence a judge could repeat to another judge an hour later.' },
    { id: 'problem', label: 'Problem', seconds: 25, prompt: 'Who is hurting, how much it costs them, and why it is unsolved today.' },
    { id: 'solution', label: 'Solution', seconds: 35, prompt: 'What you built, in the customer’s words rather than the architecture’s.' },
    { id: 'demo', label: 'Demo', seconds: 35, prompt: 'The one moment that is more convincing to watch than to describe.' },
    { id: 'traction', label: 'Traction', seconds: 25, prompt: 'Real numbers with dates — revenue, users, retention, pipeline, growth rate.' },
    { id: 'market', label: 'Market & model', seconds: 15, prompt: 'Who pays, how much, and how big that gets.' },
    { id: 'team', label: 'Team', seconds: 15, prompt: 'Why these people, and what they have already shipped together.' },
    { id: 'ask', label: 'Ask', seconds: 10, prompt: 'The single thing you want from the room.' },
  ],
  questions: [
    { id: 'oneLiner', label: 'One-line description', maxChars: 140 },
    { id: 'problem', label: 'Problem you solve', maxChars: 1000 },
    { id: 'solution', label: 'Product or service', maxChars: 1500 },
    { id: 'differentiation', label: 'What makes it original', maxChars: 1000 },
    { id: 'market', label: 'Market and business model', maxChars: 1000 },
    { id: 'traction', label: 'Traction to date', maxChars: 1000 },
    { id: 'impact', label: 'Impact if you succeed', maxChars: 750 },
    { id: 'team', label: 'Team', maxChars: 1000 },
    { id: 'funding', label: 'Funding raised to date', maxChars: 500 },
  ],
  eligibility: [
    { id: 'launchWindow', label: 'Product or service launched after 1 January 2024' },
    { id: 'oneProduct', label: 'Exactly one product or service entered per company' },
    { id: 'founderOwnership', label: 'Founders still hold an ownership stake' },
    { id: 'fundingCap', label: 'Under $10M raised in combined funding' },
    { id: 'registered', label: 'Legally registered and compliant in its jurisdiction' },
    { id: 'categoryFit', label: 'Fits one of the official entry categories' },
  ],
  categories: [
    'Emerging & Frontier Technologies',
    'Entertainment, Media, Sports & Digital Platforms',
    'Life Sciences, Healthcare & Assistive Tech',
    'Mobility, Manufacturing & Industrial Systems',
    'SaaS, Enterprise & Developer Platforms',
    'Smart Data, Security & FinTech',
    'Student Startups',
    'Sustainability, Energy & AgTech',
  ],
};

const DEMO_DAY: PitchCompetitionSpec = {
  id: 'demo-day',
  name: 'Demo day',
  url: '',
  pitchSeconds: 300,
  qaSeconds: 120,
  criteria: [
    { id: 'problem', label: 'Problem clarity', weight: 1, prompt: 'Is the problem specific, expensive, and owned by someone identifiable?' },
    { id: 'solution', label: 'Solution & demo', weight: 1.5, prompt: 'Does the product visibly do the thing, live?' },
    { id: 'traction', label: 'Traction', weight: 1.5, prompt: 'Numbers with dates, and the rate they are changing.' },
    { id: 'market', label: 'Market & model', weight: 1, prompt: 'Who pays, how much, and how that compounds.' },
    { id: 'team', label: 'Team', weight: 1, prompt: 'Founder-market fit and what this team has already shipped.' },
  ],
  beats: [
    { id: 'hook', label: 'Hook', seconds: 30, prompt: 'The line the room remembers.' },
    { id: 'problem', label: 'Problem', seconds: 45, prompt: 'Who is hurting and what it costs them.' },
    { id: 'demo', label: 'Live demo', seconds: 105, prompt: 'Show the product doing the job end to end.' },
    { id: 'traction', label: 'Traction', seconds: 45, prompt: 'Revenue, usage, retention, growth rate.' },
    { id: 'market', label: 'Market & model', seconds: 40, prompt: 'Buyer, price, and size.' },
    { id: 'ask', label: 'Ask', seconds: 35, prompt: 'What you want, and from whom.' },
  ],
  questions: [
    { id: 'oneLiner', label: 'One-line description', maxChars: 140 },
    { id: 'problem', label: 'Problem you solve', maxChars: 800 },
    { id: 'traction', label: 'Traction to date', maxChars: 800 },
    { id: 'ask', label: 'What you are asking for', maxChars: 500 },
  ],
  eligibility: [
    { id: 'cohort', label: 'Currently in the presenting cohort or programme' },
    { id: 'liveProduct', label: 'Product is live and demonstrable' },
  ],
  categories: [],
};

const ACCELERATOR: PitchCompetitionSpec = {
  id: 'accelerator',
  name: 'Accelerator application',
  url: '',
  pitchSeconds: 120,
  qaSeconds: 300,
  criteria: [
    { id: 'founders', label: 'Founders', weight: 2, prompt: 'Why these founders, and what unfair insight they hold.' },
    { id: 'insight', label: 'Insight', weight: 1.5, prompt: 'The non-obvious thing you believe that others do not.' },
    { id: 'progress', label: 'Progress since starting', weight: 1.5, prompt: 'What has changed in the last ninety days.' },
    { id: 'market', label: 'Market', weight: 1, prompt: 'Why this becomes very large.' },
    { id: 'clarity', label: 'Clarity of thought', weight: 1, prompt: 'Whether the answers are short, specific, and free of jargon.' },
  ],
  beats: [
    { id: 'whatYouDo', label: 'What you do', seconds: 20, prompt: 'In one sentence, no adjectives.' },
    { id: 'insight', label: 'Insight', seconds: 30, prompt: 'What you know that the market does not.' },
    { id: 'progress', label: 'Progress', seconds: 40, prompt: 'What you have built and what it has produced.' },
    { id: 'ask', label: 'Ask', seconds: 30, prompt: 'Why this programme, and what you need from it.' },
  ],
  questions: [
    { id: 'whatYouDo', label: 'What are you making?', maxChars: 500 },
    { id: 'insight', label: 'What do you understand that others do not?', maxChars: 750 },
    { id: 'progress', label: 'What have you built so far?', maxChars: 1000 },
    { id: 'users', label: 'Who are your users and how do you know they want this?', maxChars: 1000 },
    { id: 'founders', label: 'Founder background', maxChars: 1000 },
  ],
  eligibility: [
    { id: 'incorporated', label: 'Company is incorporated' },
    { id: 'founderTime', label: 'At least one founder full time' },
    { id: 'equity', label: 'Founders can accept the programme’s equity terms' },
  ],
  categories: [],
};

export const PITCH_COMPETITIONS: readonly PitchCompetitionSpec[] = [SXSW_PITCH, DEMO_DAY, ACCELERATOR];

const BY_ID = new Map(PITCH_COMPETITIONS.map((competition) => [competition.id, competition]));

/** The default a brand-new pitch object opens on. */
export const DEFAULT_PITCH_COMPETITION_ID = SXSW_PITCH.id;

/** The competition an object is entered in, or the default when it names none.
 * A board never has to cope with "no rules" — an unknown id falls back rather
 * than rendering an empty rubric. */
export function pitchCompetition(id: unknown): PitchCompetitionSpec {
  return (typeof id === 'string' ? BY_ID.get(id) : undefined) ?? SXSW_PITCH;
}

export function pitchCompetitionFor(data: CreationNodeData): PitchCompetitionSpec {
  return pitchCompetition(data.competitionId);
}

/**
 * The catalog key for a preset-supplied label, or null once a person has renamed
 * it.
 *
 * Seeded rows are product copy and belong in the message catalogs; a beat a
 * founder renamed to "The Netflix moment" is their words and must survive every
 * language switch untouched. Comparing the row's label against the preset's is
 * what tells those two apart, so the rule lives here rather than being guessed
 * at by each surface that renders a row.
 */
function labelKeyFor(scope: string, id: string, label: string, presetLabel: string | undefined): string | null {
  return presetLabel && presetLabel === label ? `label.${scope}.${id}` : null;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((item) => (item && typeof item === 'object' && !Array.isArray(item) ? [item as Record<string, unknown>] : []))
    : [];
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

/* ---------------------------------------------------------------- the pitch */

/** A row whose label came from a preset carries the catalog key that translates
 * it; a renamed row carries null and is rendered verbatim. */
export interface PitchLabelled {
  label: string;
  labelKey: string | null;
}

export interface PitchBeat extends PitchLabelled {
  id: string;
  seconds: number;
  prompt: string;
  script: string;
  /** Whether this beat has anything written for it yet. */
  written: boolean;
}

const SECONDS_PER_SPOKEN_WORD = 60 / 130;

/**
 * The beats of the pitch, authored ones first and the competition's own outline
 * as the starting point. A pitch object created for SXSW opens as a real
 * three-minute structure rather than an empty card, because the structure is the
 * part most people get wrong.
 */
export function pitchBeats(data: CreationNodeData): PitchBeat[] {
  const spec = pitchCompetitionFor(data);
  const authored = records(data.beats);
  const source: Record<string, unknown>[] = authored.length ? authored : spec.beats.map((beat) => ({ ...beat }));
  const specById = new Map(spec.beats.map((beat) => [beat.id, beat]));
  return source.slice(0, 24).map((beat, index) => {
    const id = text(beat.id, `beat-${index + 1}`);
    const fallback = specById.get(id);
    const script = text(beat.script, text(beat.content));
    const label = text(beat.label, text(beat.title, fallback?.label ?? id));
    return {
      id,
      label,
      labelKey: labelKeyFor('beat', id, label, fallback?.label),
      seconds: Math.round(clampNumber(beat.seconds, 0, 3_600, fallback?.seconds ?? 20)),
      prompt: text(beat.prompt, fallback?.prompt ?? ''),
      script,
      written: script.length > 0,
    };
  });
}

/** How long the pitch is budgeted to run, in seconds. */
export function pitchRuntimeSeconds(beats: readonly PitchBeat[]): number {
  return beats.reduce((total, beat) => total + beat.seconds, 0);
}

/**
 * How long the WRITTEN script actually takes to say, at a measured 130 words a
 * minute. A budget that adds up to exactly three minutes still overruns if the
 * script under it is four minutes of words, and that is the failure people only
 * discover on stage.
 */
export function pitchSpokenSeconds(beats: readonly PitchBeat[]): number {
  const words = beats.reduce((total, beat) => total + (beat.script.match(/\S+/g)?.length ?? 0), 0);
  return Math.round(words * SECONDS_PER_SPOKEN_WORD);
}

export type PitchTone = 'good' | 'watch' | 'risk';

/** Under the limit is good, a little over is worth watching, well over is a
 * disqualifying overrun. Used for both the budget and the spoken script so one
 * rule decides what "over time" means. */
export function pitchTimingTone(seconds: number, limitSeconds: number): PitchTone {
  if (!limitSeconds || seconds <= limitSeconds) return 'good';
  return seconds <= limitSeconds * 1.1 ? 'watch' : 'risk';
}

/** `3:00` — the way a stopwatch shows it. */
export function formatPitchDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

/* ------------------------------------------------------------ the scorecard */

export interface PitchScoredCriterion extends PitchLabelled {
  id: string;
  prompt: string;
  weight: number;
  /** 0 means "not scored yet" rather than "scored zero" — an unscored rubric
   * reads as 0% ready, which is the honest answer. */
  score: number;
  evidence: string;
  gap: string;
}

export function pitchCriteria(data: CreationNodeData): PitchScoredCriterion[] {
  const spec = pitchCompetitionFor(data);
  const authored = records(data.criteria);
  const source: Record<string, unknown>[] = authored.length ? authored : spec.criteria.map((criterion) => ({ ...criterion }));
  const specById = new Map(spec.criteria.map((criterion) => [criterion.id, criterion]));
  return source.slice(0, 24).map((criterion, index) => {
    const id = text(criterion.id, `criterion-${index + 1}`);
    const fallback = specById.get(id);
    const label = text(criterion.label, text(criterion.title, fallback?.label ?? id));
    return {
      id,
      label,
      labelKey: labelKeyFor('criterion', id, label, fallback?.label),
      prompt: text(criterion.prompt, fallback?.prompt ?? ''),
      weight: clampNumber(criterion.weight, 0, 100, fallback?.weight ?? 1),
      score: clampNumber(criterion.score, 0, PITCH_MAX_SCORE, 0),
      evidence: text(criterion.evidence, text(criterion.content)),
      gap: text(criterion.gap),
    };
  });
}

/** Weighted readiness as a whole percentage. Criteria with no weight cannot
 * silently sink the score. */
export function pitchReadiness(criteria: readonly PitchScoredCriterion[]): number {
  const weight = criteria.reduce((total, criterion) => total + criterion.weight, 0);
  if (!weight) return 0;
  const earned = criteria.reduce((total, criterion) => total + criterion.score * criterion.weight, 0);
  return Math.round((earned / (weight * PITCH_MAX_SCORE)) * 100);
}

/** The criteria a judge would mark you down on — lowest scores first, so the
 * card leads with the work rather than the average. */
export function pitchWeakestCriteria(criteria: readonly PitchScoredCriterion[], limit = 3): PitchScoredCriterion[] {
  return [...criteria]
    .filter((criterion) => criterion.weight > 0)
    .sort((a, b) => a.score - b.score || b.weight - a.weight || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export function pitchReadinessTone(readiness: number): PitchTone {
  if (readiness >= 75) return 'good';
  return readiness >= 50 ? 'watch' : 'risk';
}

/* --------------------------------------------------------------- judge Q&A */

export interface PitchQaItem {
  id: string;
  question: string;
  answer: string;
  /** Which rubric criterion the question attacks, when it maps to one. */
  criterionId: string;
  /** 0–5, mirroring the rubric so a weak answer and a weak criterion read the
   * same way. */
  strength: number;
  answered: boolean;
}

/**
 * The questions a judge panel is going to ask. Seeded from the competition's own
 * rubric — every criterion is a question waiting to be asked — so a fresh card
 * already knows what the drill is about.
 */
export function pitchQaItems(data: CreationNodeData): PitchQaItem[] {
  const spec = pitchCompetitionFor(data);
  const authored = records(data.questions);
  const source: Record<string, unknown>[] = authored.length
    ? authored
    : spec.criteria.map((criterion) => ({ id: criterion.id, question: criterion.prompt, criterionId: criterion.id }));
  return source.slice(0, 40).map((item, index) => {
    const answer = text(item.answer, text(item.content));
    return {
      id: text(item.id, `question-${index + 1}`),
      question: text(item.question, text(item.title, text(item.prompt))),
      answer,
      criterionId: text(item.criterionId),
      strength: clampNumber(item.strength, 0, PITCH_MAX_SCORE, 0),
      answered: answer.length > 0,
    };
  }).filter((item) => item.question.length > 0);
}

export interface PitchQaCoverage {
  answered: number;
  total: number;
  percent: number;
  /** Weakest rehearsed answers first — what to drill next. */
  weakest: PitchQaItem[];
}

export function pitchQaCoverage(items: readonly PitchQaItem[], limit = 3): PitchQaCoverage {
  const answered = items.filter((item) => item.answered).length;
  return {
    answered,
    total: items.length,
    percent: items.length ? Math.round((answered / items.length) * 100) : 0,
    weakest: [...items]
      .sort((a, b) => Number(a.answered) - Number(b.answered) || a.strength - b.strength || a.id.localeCompare(b.id))
      .slice(0, limit),
  };
}

/* ------------------------------------------------------------- application */

export interface PitchApplicationAnswer extends PitchLabelled {
  id: string;
  answer: string;
  maxChars: number;
  chars: number;
  /** An over-length answer is a rejected entry, so it is a first-class state
   * rather than something the form discovers on submit. */
  over: boolean;
  answered: boolean;
}

export function pitchApplicationAnswers(data: CreationNodeData): PitchApplicationAnswer[] {
  const spec = pitchCompetitionFor(data);
  const authored = records(data.answers);
  const source: Record<string, unknown>[] = authored.length ? authored : spec.questions.map((question) => ({ ...question }));
  const specById = new Map(spec.questions.map((question) => [question.id, question]));
  return source.slice(0, 40).map((item, index) => {
    const id = text(item.id, `answer-${index + 1}`);
    const fallback = specById.get(id);
    const answer = text(item.answer, text(item.content));
    const maxChars = Math.round(clampNumber(item.maxChars, 0, 20_000, fallback?.maxChars ?? 1_000));
    const label = text(item.label, text(item.question, fallback?.label ?? id));
    return {
      id,
      label,
      labelKey: labelKeyFor('answer', id, label, fallback?.label),
      answer,
      maxChars,
      chars: answer.length,
      over: maxChars > 0 && answer.length > maxChars,
      answered: answer.length > 0,
    };
  });
}

export interface PitchEligibilityCheck extends PitchLabelled {
  id: string;
  met: boolean;
}

export function pitchEligibility(data: CreationNodeData): PitchEligibilityCheck[] {
  const spec = pitchCompetitionFor(data);
  const authored = records(data.eligibility);
  const source: Record<string, unknown>[] = authored.length ? authored : spec.eligibility.map((rule) => ({ ...rule }));
  const specById = new Map(spec.eligibility.map((rule) => [rule.id, rule]));
  return source.slice(0, 24).map((rule, index) => {
    const id = text(rule.id, `rule-${index + 1}`);
    const fallback = specById.get(id);
    const label = text(rule.label, text(rule.title, fallback?.label ?? id));
    return {
      id,
      label,
      labelKey: labelKeyFor('rule', id, label, fallback?.label),
      met: rule.met === true,
    };
  });
}

export interface PitchApplicationReadiness {
  answered: number;
  total: number;
  percent: number;
  overLimit: PitchApplicationAnswer[];
  unmetRules: PitchEligibilityCheck[];
  /** An entry is submittable only when every rule is met and nothing is over
   * length — the two things that get an entry thrown out before it is read. */
  submittable: boolean;
}

export function pitchApplicationReadiness(
  answers: readonly PitchApplicationAnswer[],
  eligibility: readonly PitchEligibilityCheck[],
): PitchApplicationReadiness {
  const answered = answers.filter((answer) => answer.answered).length;
  const overLimit = answers.filter((answer) => answer.over);
  const unmetRules = eligibility.filter((rule) => !rule.met);
  return {
    answered,
    total: answers.length,
    percent: answers.length ? Math.round((answered / answers.length) * 100) : 0,
    overLimit,
    unmetRules,
    submittable: answers.length > 0 && answered === answers.length && !overLimit.length && !unmetRules.length,
  };
}

/* ----------------------------------------------------------------- exports */

function section(heading: string, lines: readonly string[]): string[] {
  return lines.length ? [`## ${heading}`, '', ...lines, ''] : [];
}

/**
 * The markdown a pitch object exports AS — the structured content, not a title
 * stub. These objects hold their substance in arrays rather than in one authored
 * body, so without this a downloaded pitch would be its own heading and nothing
 * else. Authored prose still wins when someone has written it.
 */
export function pitchObjectMarkdown(data: CreationNodeData): string | null {
  if (!isPitchObjectKind(data.kind)) return null;
  const spec = pitchCompetitionFor(data);
  const lines: string[] = [`# ${data.title}`, '', `_${spec.name}_`, ''];
  if (data.kind === 'pitch') {
    const beats = pitchBeats(data);
    lines.push(`Runtime budget: ${formatPitchDuration(pitchRuntimeSeconds(beats))} of ${formatPitchDuration(spec.pitchSeconds)}`, '');
    beats.forEach((beat) => {
      lines.push(`## ${beat.label} · ${formatPitchDuration(beat.seconds)}`, '', beat.script || `_${beat.prompt}_`, '');
    });
  }
  if (data.kind === 'pitchScorecard') {
    const criteria = pitchCriteria(data);
    lines.push(`Readiness: ${pitchReadiness(criteria)}%`, '');
    criteria.forEach((criterion) => {
      lines.push(`## ${criterion.label} · ${criterion.score}/${PITCH_MAX_SCORE}`, '');
      if (criterion.evidence) lines.push(criterion.evidence, '');
      if (criterion.gap) lines.push(`Gap: ${criterion.gap}`, '');
    });
  }
  if (data.kind === 'pitchQa') {
    const items = pitchQaItems(data);
    const coverage = pitchQaCoverage(items);
    lines.push(`Rehearsed: ${coverage.answered}/${coverage.total}`, '');
    items.forEach((item) => {
      lines.push(`## ${item.question}`, '', item.answer || '_Not rehearsed yet._', '');
    });
  }
  if (data.kind === 'pitchApplication') {
    const answers = pitchApplicationAnswers(data);
    const eligibility = pitchEligibility(data);
    lines.push(...section('Eligibility', eligibility.map((rule) => `- [${rule.met ? 'x' : ' '}] ${rule.label}`)));
    answers.forEach((answer) => {
      lines.push(`## ${answer.label}`, '', answer.answer || '_Unanswered._', '');
      if (answer.maxChars > 0) lines.push(`_${answer.chars} / ${answer.maxChars} characters_`, '');
    });
  }
  const authored = typeof data.content === 'string' ? data.content.trim() : '';
  if (authored) lines.push(...section('Notes', [authored]));
  return lines.join('\n').trim();
}
