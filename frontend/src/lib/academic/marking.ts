/**
 * Marking — the rubric as an INSTRUMENT, and the arithmetic that applies it.
 *
 * ── WHY A RUBRIC IS A GRID AND NOT A LIST OF CRITERIA ────────────────────────────
 * The canvas already had something rubric-shaped: `pitchScorecard`, which scores a
 * pitch against a competition's published criteria. It is a list of criteria with a
 * number each, and that is exactly the thing a university cannot defend at an appeal.
 * A criterion with a score says the marker's opinion; a criterion with a DESCRIPTOR
 * PER LEVEL says what work at that level looks like, which is what makes two markers
 * agree and what an appeal panel actually reads.
 *
 * So the model here is a grid — criteria down, levels across, a descriptor in every
 * cell — and a mark is a SELECTION of one cell per criterion. The number is derived
 * from the selection and the criterion's weight; it is never typed directly. That is
 * the difference between "I gave it 63" and "I placed it at Credit on four criteria
 * and Pass on one, which totals 63".
 *
 * ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────────────
 * No similarity checking, and no "AI detector". Both are unreliable in ways that harm
 * real students — a detector that flags one essay in twenty as machine-written is a
 * false accusation machine at a cohort of two hundred. The platform answers the
 * integrity question with EVIDENCE it actually holds instead: who edited what, when,
 * and from which source (`integrity.ts`).
 */

/** The achievement levels, worst to best. Order is data — the grid reads left to right. */
export interface RubricCriterion {
  label: string;
  /** Share of the total marks this criterion carries. Weights are normalised on read,
   *  so a grid whose weights sum to 90 or to 5 still produces a correct total. */
  weight: number;
  /** One descriptor per level, in level order. A missing descriptor is an empty cell. */
  descriptors: readonly string[];
}

export interface Rubric {
  levels: readonly string[];
  criteria: readonly RubricCriterion[];
  totalMarks: number;
}

const text = (value: unknown, limit = 600): string =>
  typeof value === 'string' ? value.trim().slice(0, limit) : typeof value === 'number' ? String(value) : '';

const number = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) && String(value ?? '').trim() !== '' ? parsed : null;
};

const MAX_LEVELS = 10;
const MAX_CRITERIA = 40;

/**
 * Read a rubric off a canvas object.
 *
 * Accepts the matrix shape the generic body renders (`{columns, rows}`) so the stored
 * document and the rendered grid are the same data, and tolerates a bare criteria
 * array so a rubric imported from a spreadsheet is not silently empty.
 */
export function rubricFromNode(data: Readonly<Record<string, unknown>>): Rubric {
  const declaredLevels = Array.isArray(data.levels)
    ? data.levels.map((level) => text(level, 60)).filter(Boolean).slice(0, MAX_LEVELS)
    : [];

  const matrix = data.criteria && typeof data.criteria === 'object' && !Array.isArray(data.criteria)
    ? data.criteria as Record<string, unknown>
    : null;

  const matrixLevels = matrix && Array.isArray(matrix.columns)
    ? matrix.columns.map((column) => text(column, 60)).filter(Boolean).slice(0, MAX_LEVELS)
    : [];

  const levels = declaredLevels.length ? declaredLevels : matrixLevels;

  const rawRows = matrix && Array.isArray(matrix.rows)
    ? matrix.rows
    : Array.isArray(data.criteria) ? data.criteria : [];

  const criteria = rawRows.slice(0, MAX_CRITERIA).flatMap((raw): RubricCriterion[] => {
    if (typeof raw === 'string') return raw.trim() ? [{ label: raw.trim(), weight: 1, descriptors: [] }] : [];
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    const label = text(row.label, 200) || text(row.criterion, 200) || text(row.title, 200);
    if (!label) return [];
    const cells = Array.isArray(row.cells) ? row.cells : Array.isArray(row.descriptors) ? row.descriptors : [];
    return [{
      label,
      weight: number(row.weight) ?? number(row.marks) ?? 1,
      descriptors: cells.slice(0, MAX_LEVELS).map((cell) => text(cell, 600)),
    }];
  });

  return { levels, criteria, totalMarks: number(data.totalMarks) ?? 100 };
}

/**
 * What is wrong with this rubric, in the words a marker needs.
 *
 * Returned as message KEYS with parameters rather than sentences, because every one of
 * these is shown in the UI and the UI is localised in five languages — a validator
 * that returns English is a validator whose output cannot ship.
 */
export type RubricProblem =
  | { code: 'noLevels' }
  | { code: 'noCriteria' }
  | { code: 'missingDescriptors'; criterion: string; missing: number }
  | { code: 'weightsZero' }
  | { code: 'totalMismatch'; totalMarks: number; maxMarks: number };

export function rubricProblems(rubric: Rubric, maxMarks?: number): readonly RubricProblem[] {
  const problems: RubricProblem[] = [];
  if (!rubric.levels.length) problems.push({ code: 'noLevels' });
  if (!rubric.criteria.length) problems.push({ code: 'noCriteria' });

  for (const criterion of rubric.criteria) {
    const missing = rubric.levels.length - criterion.descriptors.filter((cell) => cell.trim()).length;
    if (rubric.levels.length && missing > 0) {
      problems.push({ code: 'missingDescriptors', criterion: criterion.label, missing });
    }
  }

  const weightTotal = rubric.criteria.reduce((sum, criterion) => sum + Math.max(0, criterion.weight), 0);
  if (rubric.criteria.length && weightTotal <= 0) problems.push({ code: 'weightsZero' });

  if (typeof maxMarks === 'number' && Number.isFinite(maxMarks) && maxMarks > 0 && rubric.totalMarks !== maxMarks) {
    problems.push({ code: 'totalMismatch', totalMarks: rubric.totalMarks, maxMarks });
  }
  return problems;
}

/** One marker's placement on one criterion. */
export interface CriterionSelection {
  criterion: string;
  /** Zero-based index into `levels`. */
  levelIndex: number;
  comment?: string;
}

export interface CriterionMark {
  criterion: string;
  level: string;
  marks: number;
  available: number;
  comment: string;
}

export interface MarkResult {
  total: number;
  available: number;
  percent: number;
  breakdown: readonly CriterionMark[];
  /** Criteria the marker has not placed yet. A partial mark is not a mark. */
  unmarked: readonly string[];
}

/**
 * Apply a set of placements to a rubric.
 *
 * The marks for a criterion are `weightShare × totalMarks × levelFraction`, where the
 * level fraction runs from 0 for the lowest level to 1 for the highest. Two levels
 * therefore mean 0 or full marks, and five levels mean 0, 0.25, 0.5, 0.75, 1 — which
 * is what a five-band scale means when a human uses one.
 *
 * A single-level rubric would divide by zero; it scores the one level at full marks,
 * because "met the standard" is a legitimate one-level instrument (a checklist) and
 * crashing on it would be worse than the edge case is rare.
 */
export function applyRubric(rubric: Rubric, selections: readonly CriterionSelection[]): MarkResult {
  const byCriterion = new Map(selections.map((selection) => [selection.criterion, selection]));
  const weightTotal = rubric.criteria.reduce((sum, criterion) => sum + Math.max(0, criterion.weight), 0) || 1;
  const span = Math.max(1, rubric.levels.length - 1);

  const breakdown: CriterionMark[] = [];
  const unmarked: string[] = [];
  let total = 0;

  for (const criterion of rubric.criteria) {
    const available = (Math.max(0, criterion.weight) / weightTotal) * rubric.totalMarks;
    const selection = byCriterion.get(criterion.label);
    if (!selection || !Number.isInteger(selection.levelIndex) || selection.levelIndex < 0) {
      unmarked.push(criterion.label);
      continue;
    }
    const index = Math.min(selection.levelIndex, Math.max(0, rubric.levels.length - 1));
    const fraction = rubric.levels.length <= 1 ? 1 : index / span;
    const marks = round2(available * fraction);
    total += marks;
    breakdown.push({
      criterion: criterion.label,
      level: rubric.levels[index] ?? '',
      marks,
      available: round2(available),
      comment: selection.comment?.trim() ?? '',
    });
  }

  const rounded = round2(total);
  return {
    total: rounded,
    available: rubric.totalMarks,
    percent: rubric.totalMarks > 0 ? round2((rounded / rubric.totalMarks) * 100) : 0,
    breakdown,
    unmarked,
  };
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

// ---------------------------------------------------------------------------
// Grade bands
// ---------------------------------------------------------------------------

export interface GradeBand {
  grade: string;
  minimum: number;
  maximum: number;
}

/**
 * Read the institution's scale off an object.
 *
 * Sorted descending on read so `gradeFor` can take the first match: a scale typed in
 * ascending order and one typed in descending order must grade identically, and
 * relying on the author's ordering is how a board reports every mark as the lowest
 * band it matches.
 */
export function gradeBandsFromNode(value: unknown): readonly GradeBand[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).flatMap((raw): GradeBand[] => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    const grade = text(row.grade, 40);
    const minimum = number(row.minimum);
    if (!grade || minimum == null) return [];
    return [{ grade, minimum, maximum: number(row.maximum) ?? 100 }];
  }).sort((left, right) => right.minimum - left.minimum);
}

export function gradeFor(percent: number, bands: readonly GradeBand[]): string {
  if (!Number.isFinite(percent)) return '';
  const band = bands.find((candidate) => percent >= candidate.minimum && percent <= candidate.maximum);
  return band?.grade ?? '';
}

/** The lowest band that is not a fail, by convention the second from the bottom of a
 *  scale whose bottom band is the fail. Used for the pass rate a gradebook reports. */
export function passMark(bands: readonly GradeBand[]): number {
  if (bands.length < 2) return 50;
  return bands[bands.length - 2].minimum;
}

// ---------------------------------------------------------------------------
// Late policy
// ---------------------------------------------------------------------------

export interface LatePolicy {
  perDayPercent: number;
  /** Days after which the mark is zero. Infinity when the policy does not cap. */
  zeroAfterDays: number;
  /** Grace period in hours before any penalty applies. */
  graceHours: number;
}

export const NO_LATE_PENALTY: LatePolicy = { perDayPercent: 0, zeroAfterDays: Infinity, graceHours: 0 };

/**
 * Read a late policy out of the sentence a course handbook actually contains.
 *
 * Staff write "10% per day, zero after 5 days" in a handbook, not a JSON object, and
 * asking them to enter it twice is how the board's rule and the handbook's rule come
 * to disagree — at which point the handbook wins and the board is wrong. Parsing the
 * sentence keeps ONE statement of the rule.
 *
 * Anything unrecognised yields no penalty rather than a guessed one: silently deducting
 * marks from a real student on a misparse is the worst available failure.
 */
export function parseLatePolicy(source: unknown): LatePolicy {
  const raw = text(source, 500).toLowerCase();
  if (!raw) return NO_LATE_PENALTY;
  if (/\bno\s+late\b|\bnot\s+accepted\b|\bzero\s+tolerance\b/.test(raw)) {
    return { perDayPercent: 100, zeroAfterDays: 0, graceHours: 0 };
  }
  const perDay = /(\d+(?:\.\d+)?)\s*%\s*(?:deduction\s*)?(?:per|a|each|\/)\s*(day|hour)/.exec(raw);
  const zeroAfter = /(?:zero|0%?|no marks|nothing)\s*(?:after|beyond|past)\s*(\d+)\s*(day|hour)/.exec(raw)
    ?? /(?:after|beyond|past)\s*(\d+)\s*(day|hour)s?[^.]*\b(?:zero|0%|no marks)/.exec(raw);
  const grace = /(\d+)\s*(hour|minute|day)s?\s*(?:of\s*)?grace/.exec(raw);

  if (!perDay && !zeroAfter) return NO_LATE_PENALTY;

  const perDayPercent = perDay
    ? Number(perDay[1]) * (perDay[2] === 'hour' ? 24 : 1)
    : 0;
  const zeroAfterDays = zeroAfter
    ? Number(zeroAfter[1]) / (zeroAfter[2] === 'hour' ? 24 : 1)
    : perDayPercent > 0 ? 100 / perDayPercent : Infinity;
  const graceHours = grace
    ? Number(grace[1]) * (grace[2] === 'day' ? 24 : grace[2] === 'minute' ? 1 / 60 : 1)
    : 0;

  return { perDayPercent, zeroAfterDays, graceHours };
}

/** Hours late, or 0 when on time. Both arguments are ISO instants. */
export function hoursLate(submittedAt: unknown, dueAt: unknown): number {
  const submitted = Date.parse(text(submittedAt, 60));
  const due = Date.parse(text(dueAt, 60));
  if (!Number.isFinite(submitted) || !Number.isFinite(due)) return 0;
  return Math.max(0, (submitted - due) / 3_600_000);
}

export interface LateOutcome {
  /** The mark after penalty. */
  mark: number;
  /** Marks removed. Shown to the learner, because a deduction they cannot see is a
   *  complaint waiting to happen. */
  deducted: number;
  daysLate: number;
}

/**
 * Apply a late policy.
 *
 * Days are CEILED, because every handbook that says "10% per day" means a submission
 * three hours late loses 10%, not 1.25%. Flooring is the intuitive implementation and
 * it is wrong in the direction that quietly gives marks away.
 */
export function applyLatePolicy(mark: number, hours: number, policy: LatePolicy): LateOutcome {
  if (!Number.isFinite(mark) || hours <= policy.graceHours || policy.perDayPercent <= 0) {
    return { mark: round2(Math.max(0, mark)), deducted: 0, daysLate: 0 };
  }
  const effectiveHours = hours - policy.graceHours;
  const daysLate = Math.ceil(effectiveHours / 24);
  if (daysLate > policy.zeroAfterDays) return { mark: 0, deducted: round2(mark), daysLate };
  const penalty = Math.min(100, daysLate * policy.perDayPercent) / 100;
  const next = round2(Math.max(0, mark * (1 - penalty)));
  return { mark: next, deducted: round2(mark - next), daysLate };
}

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

export interface ModerationRow {
  learnerRef: string;
  firstMark: number | null;
  secondMark: number | null;
  gap: number | null;
  agreed: number | null;
}

/**
 * Which double-marked submissions need a conversation.
 *
 * `tolerance` is in marks, not percent, because that is how a moderation policy is
 * written ("more than 10 marks apart goes to a third marker"). Rows missing a second
 * mark are returned as needing one rather than silently treated as agreeing — an
 * un-moderated fail is the case that actually gets appealed.
 */
export function moderationNeeded(rows: readonly ModerationRow[], tolerance = 10): readonly ModerationRow[] {
  return rows.filter((row) => {
    if (row.agreed != null) return false;
    if (row.firstMark == null || row.secondMark == null) return true;
    return Math.abs(row.firstMark - row.secondMark) > tolerance;
  });
}

export function moderationRowsFromNode(value: unknown): readonly ModerationRow[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 1_000).flatMap((raw): ModerationRow[] => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    const learnerRef = text(row.learnerRef, 120);
    if (!learnerRef) return [];
    const firstMark = number(row.firstMark);
    const secondMark = number(row.secondMark);
    return [{
      learnerRef,
      firstMark,
      secondMark,
      gap: firstMark != null && secondMark != null ? round2(Math.abs(firstMark - secondMark)) : null,
      agreed: number(row.agreed),
    }];
  });
}
