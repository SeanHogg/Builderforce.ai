/**
 * The gradebook — marks for a whole cohort, COMPUTED rather than kept.
 *
 * ── WHY THE MATRIX IS DERIVED AND NOT STORED ─────────────────────────────────────
 * A gradebook holds the same fact as the submissions it aggregates: this learner got
 * this mark for this assignment. Storing it twice is the classic normalisation error,
 * and its consequence here is not theoretical — a mark changed on appeal updates the
 * submission, and a stored gradebook keeps quoting the old number to the exam board.
 * So the matrix, the mean, the distribution and the pass rate are all `derived` on the
 * spec, computed here from the submission objects on the board, and no patch can set
 * one.
 *
 * ── WHY WEIGHTED, AND WHAT HAPPENS WHEN A MARK IS MISSING ────────────────────────
 * A module mark is the weighted sum of its assessments. The interesting case is the
 * missing one, and there are two honest readings: the work is not marked YET (the
 * running total should ignore it, so the number means "how they are doing so far"), or
 * the work was never handed in (it is a zero, and hiding that flatters a failing
 * student into thinking they are passing). Both are computed and reported separately —
 * `runningPercent` and `finalPercent` — because a teacher needs the first in week 6
 * and an exam board needs the second in week 14.
 */

import {
  gradeFor, passMark,
  type GradeBand,
} from './marking';

export interface GradebookColumn {
  /** Assignment title — what the matrix column is headed with. */
  title: string;
  /** Percentage of the module mark. */
  weight: number;
  maxMarks: number;
}

/**
 * One learner's position on one assignment.
 *
 * `mark` and `submitted` are separate because there are THREE states and a boolean
 * only expresses two. "Not handed in" and "handed in, not marked yet" produce the same
 * empty cell and demand opposite actions — one is a student to chase, the other is a
 * marker to chase — and collapsing them is how a teacher emails a warning to somebody
 * who submitted on time.
 */
export interface LearnerMark {
  learnerRef: string;
  assignmentTitle: string;
  /** Raw marks awarded, out of the assignment's `maxMarks`. Null when not yet marked. */
  mark: number | null;
  submitted: boolean;
}

export interface GradebookLearner {
  ref: string;
  name: string;
  group?: string;
}

export interface GradebookRow {
  label: string;
  ref: string;
  /** One cell per column, in column order. Null where there is no mark. */
  cells: ReadonlyArray<number | null>;
  /** Weighted percentage over MARKED work only — "how are they doing so far". */
  runningPercent: number | null;
  /** Weighted percentage treating unmarked work as zero — what an exam board sees. */
  finalPercent: number;
  grade: string;
  /** Assignments with no submission at all. The list a teacher chases. */
  missing: readonly string[];
  /** Submitted and not yet marked. The list a MARKER chases — a different person and
   *  a different conversation, which is why it is a different field. */
  awaitingMarking: readonly string[];
}

export interface GradebookMatrix {
  columns: readonly string[];
  rows: readonly GradebookRow[];
}

export interface GradebookStats {
  mean: number | null;
  median: number | null;
  passRate: number;
  /** Count per grade band, in band order, for the distribution bars. */
  distribution: ReadonlyArray<{ label: string; value: number }>;
  markedCount: number;
  learnerCount: number;
  /** Submissions sitting in a marking queue. The number a module lead is accountable
   *  for, and the one a "cohort progress" figure otherwise hides. */
  awaitingMarkingCount: number;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Build the matrix.
 *
 * Marks are indexed once into a Map keyed `ref assignment` rather than searched
 * per cell: a 300-learner cohort with 6 assessments is 1,800 cells, and a `.find()`
 * inside the cell loop makes that 1,800 × N scans on every render. The platform
 * rejects that shape of work in a request handler and it is no more acceptable in a
 * component.
 */
export function buildGradebook(
  learners: readonly GradebookLearner[],
  columns: readonly GradebookColumn[],
  marks: readonly LearnerMark[],
  bands: readonly GradeBand[],
): GradebookMatrix {
  const index = new Map<string, LearnerMark>();
  for (const mark of marks) index.set(`${mark.learnerRef} ${mark.assignmentTitle}`, mark);

  const weightTotal = columns.reduce((sum, column) => sum + Math.max(0, column.weight), 0);

  const rows = learners.map((learner): GradebookRow => {
    const cells: Array<number | null> = [];
    const missing: string[] = [];
    const awaitingMarking: string[] = [];
    let markedWeight = 0;
    let markedScore = 0;
    let fullScore = 0;

    for (const column of columns) {
      const entry = index.get(`${learner.ref} ${column.title}`);
      const weight = Math.max(0, column.weight);
      // Nothing handed in: an empty cell, a student to chase, a zero in the final.
      if (!entry || !entry.submitted) {
        cells.push(null);
        missing.push(column.title);
        continue;
      }
      // Handed in, not marked: an empty cell and a zero in the FINAL total (work is
      // not evidence until it is marked), but excluded from the RUNNING total — a
      // learner must not read as failing because their marker has a backlog.
      if (entry.mark == null) {
        cells.push(null);
        awaitingMarking.push(column.title);
        continue;
      }
      const fraction = column.maxMarks > 0 ? entry.mark / column.maxMarks : 0;
      cells.push(round2(entry.mark));
      markedWeight += weight;
      markedScore += fraction * weight;
      fullScore += fraction * weight;
    }

    const runningPercent = markedWeight > 0 ? round2((markedScore / markedWeight) * 100) : null;
    const finalPercent = weightTotal > 0 ? round2((fullScore / weightTotal) * 100) : 0;

    return {
      label: learner.name || learner.ref,
      ref: learner.ref,
      cells,
      runningPercent,
      finalPercent,
      grade: gradeFor(finalPercent, bands),
      missing,
      awaitingMarking,
    };
  });

  return { columns: columns.map((column) => column.title), rows };
}

/**
 * Cohort statistics.
 *
 * The mean and median are taken over learners with at least one mark, because a cohort
 * mean that includes 200 not-yet-marked zeros in week 3 reads as a catastrophe and is
 * an artefact of the calendar. The pass rate is deliberately the opposite — computed
 * over EVERY enrolled learner against the final percentage, because "what share of the
 * class is on track to pass" must not improve by excluding the people who submitted
 * nothing.
 */
export function gradebookStats(matrix: GradebookMatrix, bands: readonly GradeBand[]): GradebookStats {
  const marked = matrix.rows.filter((row) => row.runningPercent != null);
  const values = marked.map((row) => row.runningPercent as number).sort((left, right) => left - right);

  const mean = values.length
    ? round2(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;
  const median = values.length
    ? round2(values.length % 2 === 1
      ? values[(values.length - 1) / 2]
      : (values[values.length / 2 - 1] + values[values.length / 2]) / 2)
    : null;

  const threshold = passMark(bands);
  const passRate = matrix.rows.length
    ? round2((matrix.rows.filter((row) => row.finalPercent >= threshold).length / matrix.rows.length) * 100)
    : 0;

  const distribution = bands.length
    ? bands.map((band) => ({
      label: band.grade,
      value: matrix.rows.filter((row) => row.finalPercent >= band.minimum && row.finalPercent <= band.maximum).length,
    }))
    : [];

  return {
    mean,
    median,
    passRate,
    distribution,
    markedCount: marked.length,
    learnerCount: matrix.rows.length,
    awaitingMarkingCount: matrix.rows.reduce((sum, row) => sum + row.awaitingMarking.length, 0),
  };
}

/**
 * Learners a teacher should look at this week.
 *
 * Ordered by how much trouble they are in rather than alphabetically, because the list
 * exists to be acted on from the top and a cohort of 200 sorted by surname is a list
 * nobody reads past the Bs.
 */
export interface AtRiskLearner {
  ref: string;
  label: string;
  runningPercent: number | null;
  missingCount: number;
  reason: 'missing' | 'failing' | 'both';
}

export function atRiskLearners(matrix: GradebookMatrix, bands: readonly GradeBand[]): readonly AtRiskLearner[] {
  const threshold = passMark(bands);
  return matrix.rows
    .flatMap((row): AtRiskLearner[] => {
      const failing = row.runningPercent != null && row.runningPercent < threshold;
      const missing = row.missing.length > 0;
      if (!failing && !missing) return [];
      return [{
        ref: row.ref,
        label: row.label,
        runningPercent: row.runningPercent,
        missingCount: row.missing.length,
        reason: failing && missing ? 'both' : failing ? 'failing' : 'missing',
      }];
    })
    .sort((left, right) => (right.missingCount - left.missingCount)
      || ((left.runningPercent ?? 101) - (right.runningPercent ?? 101)));
}

/**
 * CSV of the whole gradebook.
 *
 * Every value is quoted and internal quotes are doubled — a learner name containing a
 * comma is not an edge case at a university, and an unquoted export silently shifts an
 * entire row's marks one column to the left.
 */
export function gradebookCsv(matrix: GradebookMatrix, stats: GradebookStats): string {
  const cell = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const header = ['ref', 'name', ...matrix.columns, 'running %', 'final %', 'grade', 'missing'];
  const lines = [header.map(cell).join(',')];
  for (const row of matrix.rows) {
    lines.push([
      row.ref, row.label,
      ...row.cells.map((value) => (value == null ? '' : value)),
      row.runningPercent ?? '', row.finalPercent, row.grade, row.missing.join('; '),
    ].map(cell).join(','));
  }
  lines.push('');
  lines.push([cell('mean'), cell(stats.mean ?? '')].join(','));
  lines.push([cell('median'), cell(stats.median ?? '')].join(','));
  lines.push([cell('pass rate %'), cell(stats.passRate)].join(','));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Canvas adapters
// ---------------------------------------------------------------------------

const text = (value: unknown, limit = 300): string =>
  typeof value === 'string' ? value.trim().slice(0, limit) : typeof value === 'number' ? String(value) : '';
const number = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) && String(value ?? '').trim() !== '' ? parsed : null;
};

/** Read a cohort object's roster. */
export function learnersFromCohort(data: Readonly<Record<string, unknown>>): readonly GradebookLearner[] {
  const roster = Array.isArray(data.roster) ? data.roster : [];
  return roster.slice(0, 2_000).flatMap((raw): GradebookLearner[] => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    const ref = text(row.ref, 120);
    if (!ref) return [];
    if (text(row.status, 40).toLowerCase() === 'withdrawn') return [];
    return [{ ref, name: text(row.name, 200) || ref, group: text(row.group, 80) || undefined }];
  });
}

/** Read one assignment object as a gradebook column. */
export function columnFromAssignment(data: Readonly<Record<string, unknown>>): GradebookColumn {
  return {
    title: text(data.title, 200),
    weight: number(data.weight) ?? 0,
    maxMarks: number(data.maxMarks) ?? 100,
  };
}

/**
 * Read one submission object as a gradebook mark.
 *
 * Returns null only when the object cannot be joined at all (no learner or no
 * assignment). A submission that exists but is unmarked returns `mark: null` with
 * `submitted: true`, which is what keeps "handed in, awaiting marking" distinct from
 * "never handed in" — see {@link LearnerMark}.
 */
export function markFromSubmission(data: Readonly<Record<string, unknown>>): LearnerMark | null {
  const learnerRef = text(data.learnerRef, 120);
  const assignmentTitle = text(data.assignmentRef, 200);
  if (!learnerRef || !assignmentTitle) return null;
  const submitted = Boolean(text(data.submittedAt, 60));
  if (!submitted) return null;
  return { learnerRef, assignmentTitle, mark: number(data.mark), submitted: true };
}
