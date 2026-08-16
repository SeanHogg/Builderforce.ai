/**
 * The academic vocabulary's COMPUTED fields — one module, because they are a
 * derivation and not a declaration.
 *
 * ── WHY THIS IS NOT IN `academicObjects.ts` ─────────────────────────────────────
 * That file is a LIST: twenty-five kinds and their fields, read by the node body, the
 * model-facing documentation, the mutable/context lists and the empty-shell rule. This
 * is the arithmetic those fields resolve THROUGH — a gradebook aggregated from the
 * submissions beside it, a lateness measured against an assignment's deadline. Two
 * different jobs, and keeping both in one file pushed it past the 800-line architecture
 * ratchet, which is the ratchet doing exactly what it exists for. It is the same split
 * `specDerivedRegistry.ts` already draws for the registry.
 *
 * ── NOTHING HERE RE-IMPLEMENTS AN ENGINE ────────────────────────────────────────
 * `buildGradebook`, `gradebookStats` and `hoursLate` are used exactly as written.
 * A second implementation of a weighted module mark is how two screens come to
 * disagree about whether a student passed.
 */

import {
  deriveNumber, derivePercent, deriveRows, specRefKey, sumColumn, type SpecDeriveBoard,
} from '../specObjects';
import {
  buildGradebook, columnFromAssignment, gradebookStats, learnersFromCohort, markFromSubmission,
  type GradebookColumn, type GradebookLearner, type GradebookMatrix, type LearnerMark,
} from './gradebook';
import { gradeBandsFromNode, hoursLate, type GradeBand } from './marking';

// The derivations — the half this vocabulary declared and never produced
// ---------------------------------------------------------------------------
//
// ── WHAT WAS WRONG ─────────────────────────────────────────────────────────────
// Nineteen fields here were flagged `derived: true`, which is the right rule — it
// stops a model asserting a grade nobody earned — and it says only who may not WRITE
// a value. Nothing on the platform ever produced one, so a `gradebook` sitting beside
// two hundred marked submissions reported no mean, no median and no pass rate, and a
// late submission reported no lateness. `lib/academic/gradebook.ts` and `marking.ts`
// had computed all of it correctly, with tests, since the day the vocabulary landed;
// what was missing was one wire.
//
// This is that wire. Nothing below re-implements the engines: `buildGradebook`,
// `gradebookStats`, `hoursLate` and the three canvas adapters are used exactly as
// written, because a second implementation of a weighted module mark is how two
// screens come to disagree about whether a student passed.
//
// ── WHAT IS STILL `derived: true`, AND WHY THAT IS CORRECT ─────────────────────
// A mark, a mark breakdown, feedback, an integrity ledger, an attendance count, a
// poll's responses, a moderation record and a feedback bank's usage count are all
// EVIDENCE of something that happened off the board. They cannot be computed from it
// and must not be invented: they stay `derived` and wait for the action that records
// them. The distinction this pass draws is exactly the useful one — a field that is
// arithmetic is now computed, and a field that is testimony still is not.

/** Does `ref` name THIS object? The mirror of `board.byRef` — an assignment carries a
 *  `cohortRef` and the cohort has to recognise itself in it. Uses the same
 *  normalisation the board indexes with, so the two cannot disagree. */
export function identifies(data: Record<string, unknown>, ref: unknown): boolean {
  const key = specRefKey(ref);
  return !!key && [data.title, data.courseCode].some((value) => specRefKey(value) === key);
}

/** Every submission on the board that answers this assignment. */
export function submissionsFor(data: Record<string, unknown>, board: SpecDeriveBoard): readonly Record<string, unknown>[] {
  const title = specRefKey(data.title);
  return title ? board.ofKind('submission').filter((submission) => specRefKey(submission.assignmentRef) === title) : [];
}

/**
 * One row per programme outcome, with whether anything ASSURES it.
 *
 * `introduced` and `developed` deliberately do not count: an accreditor asks where an
 * outcome is ASSURED, and a coverage figure that counts a mention would report a
 * programme as complete on the strength of having introduced everything and assured
 * nothing — which is the exact submission that fails a review.
 */
export function mappingRows(data: Record<string, unknown>): Array<{ code: string; assured: boolean }> {
  const mapping = data.mapping;
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return [];
  const rows = deriveRows((mapping as Record<string, unknown>).rows);
  return rows.flatMap((row) => {
    const code = String(row.label ?? row.code ?? '').trim();
    if (!code) return [];
    const cells = Array.isArray(row.cells) ? row.cells : [];
    return [{ code, assured: cells.some((cell) => String(cell ?? '').trim().toLowerCase() === 'assured') }];
  });
}

/** The assignment titles a gradebook aggregates, in the order it lists them. */
function gradebookColumns(data: Record<string, unknown>, board: SpecDeriveBoard): GradebookColumn[] {
  const titles = Array.isArray(data.assignments)
    ? data.assignments.map((entry) => String(entry ?? '').trim()).filter(Boolean)
    // A gradebook that names no assignments still aggregates the board's, because an
    // empty `assignments` list is far more often "nobody typed them" than "deliberately
    // none" — and a gradebook with no columns is the empty card this closes.
    : [];
  const fallback = titles.length
    ? []
    : board.ofKind('assignment').map((assignment) => String(assignment.title ?? '').trim()).filter(Boolean);

  return [...titles, ...fallback].flatMap((title) => {
    const assignment = board.byRef('assignment', title);
    // An assignment named on the gradebook and absent from the board contributes a
    // column with no weight rather than being dropped: the column is what tells the
    // reader the mark is missing, and dropping it hides the gap it exists to show.
    return [assignment ? columnFromAssignment(assignment) : { title, weight: 0, maxMarks: 100 }];
  });
}

/** Every learner a gradebook has rows for — its cohort's roster, or whoever submitted. */
function gradebookLearners(data: Record<string, unknown>, board: SpecDeriveBoard): GradebookLearner[] {
  const cohort = board.byRef('cohort', data.cohortRef);
  const roster = cohort ? learnersFromCohort(cohort) : [];
  if (roster.length) return [...roster];

  // No roster: fall back to the learners who actually submitted. A cohort of "everyone
  // who handed something in" flatters the pass rate — every non-submitter is invisible —
  // so it is the fallback and never the preference, and `gradebookStats` computes its
  // pass rate over rows rather than over marked rows for the same reason.
  const seen = new Map<string, GradebookLearner>();
  for (const submission of board.ofKind('submission')) {
    const ref = String(submission.learnerRef ?? '').trim();
    if (!ref || seen.has(ref)) continue;
    seen.set(ref, { ref, name: String(submission.learnerName ?? '').trim() || ref });
  }
  return [...seen.values()];
}

/** Every mark on the board that belongs to one of these columns. */
function gradebookMarks(board: SpecDeriveBoard, columns: readonly GradebookColumn[]): LearnerMark[] {
  const wanted = new Set(columns.map((column) => column.title));
  return board.ofKind('submission')
    .flatMap((submission) => {
      const mark = markFromSubmission(submission);
      return mark && wanted.has(mark.assignmentTitle) ? [mark] : [];
    });
}

/**
 * The whole gradebook, built once per derivation.
 *
 * Six fields on the card read this — the matrix, the mean, the median, the pass rate,
 * the distribution and the marked count — and each one calling `buildGradebook` would
 * rebuild a 300 × 6 matrix six times per render. The board object is stable for the
 * life of a render, so the result is cached against it by identity: a WeakMap keyed on
 * the board keeps nothing alive and costs one lookup.
 */
const gradebookCache = new WeakMap<SpecDeriveBoard, Map<string, { matrix: GradebookMatrix; bands: readonly GradeBand[] }>>();

export function gradebookOf(data: Record<string, unknown>, board: SpecDeriveBoard) {
  let perBoard = gradebookCache.get(board);
  if (!perBoard) {
    perBoard = new Map();
    gradebookCache.set(board, perBoard);
  }
  // Keyed on the two fields that decide what this gradebook covers, so two gradebooks
  // on one board (two cohorts, or a running one and a final one) do not share a matrix.
  const key = `${String(data.cohortRef ?? '')}::${JSON.stringify(data.assignments ?? '')}`;
  const cached = perBoard.get(key);
  if (cached) return cached;

  const columns = gradebookColumns(data, board);
  const learners = gradebookLearners(data, board);
  const bands = gradeBandsFromNode(data.gradeBands);
  const matrix = buildGradebook(learners, columns, gradebookMarks(board, columns), bands);
  const built = { matrix, bands };
  perBoard.set(key, built);
  return built;
}

/** The stats, or null when there is nothing to aggregate — a gradebook with no learners
 *  and no columns must report nothing rather than a mean of zero. */
export function statsOf(data: Record<string, unknown>, board: SpecDeriveBoard) {
  const { matrix, bands } = gradebookOf(data, board);
  if (!matrix.rows.length || !matrix.columns.length) return null;
  return gradebookStats(matrix, bands);
}

// ---------------------------------------------------------------------------
// One function per computed field
// ---------------------------------------------------------------------------
//
// Named and exported rather than written inline on the spec, so `academicObjects.ts`
// stays what it is — a list of kinds and their fields — and every piece of arithmetic
// in this vocabulary is in one file where it can be read against its neighbours.

/** The shape `SpecField.derive` declares. Stated once here so each function below is
 *  checked against the contract rather than against the call site that happens to use it. */
type SpecDerive = (data: Record<string, unknown>, board: SpecDeriveBoard) => unknown;

/** `cohort.progress` — see the field's hint for what it means. */
export const deriveCohortProgress: SpecDerive = (data, board) => {
  const roster = learnersFromCohort(data);
  if (!roster.length) return undefined;
  const now = Date.now();
  const due = board.ofKind('assignment')
    .filter((assignment) => {
      // An assignment with no `cohortRef` is counted: a single-cohort board is the
      // common case and refusing to count its work would report 0% forever.
      if (assignment.cohortRef && !identifies(data, assignment.cohortRef)) return false;
      const deadline = Date.parse(String(assignment.dueAt ?? ''));
      return Number.isFinite(deadline) && deadline <= now;
    })
    .map((assignment) => String(assignment.title ?? '').trim())
    .filter(Boolean);
  if (!due.length) return undefined;

  const handedIn = new Set(board.ofKind('submission')
    .filter((submission) => String(submission.submittedAt ?? '').trim())
    .map((submission) => `${String(submission.learnerRef ?? '').trim()}::${String(submission.assignmentRef ?? '').trim()}`));
  const complete = roster.filter((learner) => due.every((title) => handedIn.has(`${learner.ref}::${title}`))).length;
  return derivePercent(complete, roster.length);
};

/** `assignment.submissionCount` — see the field's hint for what it means. */
export const deriveAssignmentSubmissionCount: SpecDerive = (data, board) => {
  const count = submissionsFor(data, board).filter((submission) => String(submission.submittedAt ?? '').trim()).length;
  return count > 0 ? count : undefined;
};

/** `assignment.markedCount` — see the field's hint for what it means. */
export const deriveAssignmentMarkedCount: SpecDerive = (data, board) => {
  const count = submissionsFor(data, board).filter((submission) => deriveNumber(submission.mark) !== undefined).length;
  return count > 0 ? count : undefined;
};

/** `submission.lateBy` — see the field's hint for what it means. */
export const deriveSubmissionLateBy: SpecDerive = (data, board) => {
  const assignment = board.byRef('assignment', data.assignmentRef);
  if (!assignment || !String(data.submittedAt ?? '').trim()) return undefined;
  const hours = hoursLate(data.submittedAt, assignment.dueAt);
  if (hours <= 0) return undefined;
  return hours < 48 ? `${Math.round(hours)}h late` : `${Math.round(hours / 24)}d late`;
};

/** `gradebook.marks` — see the field's hint for what it means. */
export const deriveGradebookMarks: SpecDerive = (data, board) => {
  const { matrix } = gradebookOf(data, board);
  return matrix.rows.length && matrix.columns.length ? matrix : undefined;
};

/** `gradebook.distribution` — see the field's hint for what it means. */
export const deriveGradebookDistribution: SpecDerive = (data, board) => statsOf(data, board)?.distribution;

/** `gradebook.mean` — see the field's hint for what it means. */
export const deriveGradebookMean: SpecDerive = (data, board) => statsOf(data, board)?.mean ?? undefined;

/** `gradebook.median` — see the field's hint for what it means. */
export const deriveGradebookMedian: SpecDerive = (data, board) => statsOf(data, board)?.median ?? undefined;

/** `gradebook.passRate` — see the field's hint for what it means. */
export const deriveGradebookPassRate: SpecDerive = (data, board) => (statsOf(data, board) ? statsOf(data, board)!.passRate : undefined);

/** `lecture.attendanceRate` — see the field's hint for what it means. */
export const deriveLectureAttendanceRate: SpecDerive = (data, board) => {
  const cohort = board.byRef('cohort', data.cohortRef);
  const enrolled = cohort
    ? deriveNumber(cohort.enrolledCount) ?? learnersFromCohort(cohort).length
    : undefined;
  return derivePercent(deriveNumber(data.attendanceCount), enrolled || undefined);
};

/** `poll.responseCount` — see the field's hint for what it means. */
export const derivePollResponseCount: SpecDerive = (data) => sumColumn(data.responses, 'value');

/** `poll.correctRate` — see the field's hint for what it means. */
export const derivePollCorrectRate: SpecDerive = (data) => {
  const index = deriveNumber(data.correctIndex);
  if (index === undefined) return undefined;
  const bars = deriveRows(data.responses);
  const correct = deriveNumber(bars[index]?.value ?? bars[index]?.count);
  return derivePercent(correct, sumColumn(data.responses, 'value'));
};

/** `officeHours.utilisation` — see the field's hint for what it means. */
export const deriveOfficeHoursUtilisation: SpecDerive = (data) => {
  const slots = deriveRows(data.slots);
  if (!slots.length) return undefined;
  return derivePercent(slots.filter((slot) => String(slot.bookedBy ?? '').trim()).length, slots.length);
};

/** `curriculumMap.coverage` — see the field's hint for what it means. */
export const deriveCurriculumMapCoverage: SpecDerive = (data) => {
  const rows = mappingRows(data);
  if (!rows.length) return undefined;
  return derivePercent(rows.filter((row) => row.assured).length, rows.length);
};

/** `curriculumMap.gaps` — see the field's hint for what it means. */
export const deriveCurriculumMapGaps: SpecDerive = (data) => {
  const missing = mappingRows(data).filter((row) => !row.assured).map((row) => row.code);
  return missing.length ? missing : undefined;
};

/** `participantPool.consentRate` — see the field's hint for what it means. */
export const deriveParticipantPoolConsentRate: SpecDerive = (data) => derivePercent(deriveNumber(data.consentedN), deriveNumber(data.recruitedN));

/** `bibliography.entryCount` — see the field's hint for what it means. */
export const deriveBibliographyEntryCount: SpecDerive = (data) => deriveRows(data.entries).length || undefined;

// ---------------------------------------------------------------------------
// curriculumMap.validate — structural problems the coverage figure cannot show
// ---------------------------------------------------------------------------
//
// `deriveCurriculumMapCoverage` and `deriveCurriculumMapGaps` above answer "how much of
// the programme is assured" — a number an accreditor reads. They cannot say WHY an
// outcome has no evidence: it might genuinely be unassessed, or it might be a typo — an
// outcome declared as "LO3" and mapped as "L03". `curriculumMapProblems` is the second
// question, asked by the `validate` action, and it is deliberately not folded into the
// coverage derivation: a card renders coverage on every view, and a validation pass is
// something a programme lead runs deliberately and reads the detail of.

export type CurriculumMapProblem =
  | { code: 'noOutcomes' }
  | { code: 'noMapping' }
  | { code: 'unmappedOutcome'; outcome: string }
  | { code: 'unknownColumn'; column: string };

/** Structural problems in one `curriculumMap` object, read against the board so an
 *  "unknown column" means an assessment that genuinely is not on this board rather than
 *  one this object simply has not heard of yet. */
export function curriculumMapProblems(data: Record<string, unknown>, board: SpecDeriveBoard): readonly CurriculumMapProblem[] {
  const problems: CurriculumMapProblem[] = [];
  const outcomeCodes = deriveRows(data.outcomes)
    .map((row) => String(row.code ?? '').trim())
    .filter(Boolean);
  if (!outcomeCodes.length) problems.push({ code: 'noOutcomes' });

  const mapping = data.mapping && typeof data.mapping === 'object' && !Array.isArray(data.mapping)
    ? data.mapping as Record<string, unknown>
    : null;
  const rows = mapping ? deriveRows(mapping.rows) : [];
  if (!rows.length) problems.push({ code: 'noMapping' });

  const mappedCodes = new Set(rows.map((row) => String(row.label ?? row.code ?? '').trim()).filter(Boolean));
  for (const code of outcomeCodes) {
    if (!mappedCodes.has(code)) problems.push({ code: 'unmappedOutcome', outcome: code });
  }

  const columns = mapping && Array.isArray(mapping.columns)
    ? mapping.columns.map((column) => String(column ?? '').trim()).filter(Boolean)
    : [];
  for (const column of columns) {
    if (!board.byRef('assignment', column) && !board.byRef('lecture', column)) {
      problems.push({ code: 'unknownColumn', column });
    }
  }
  return problems;
}
