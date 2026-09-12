import {
  assessmentGate, assessmentModeOf, effectiveDeadline, extraTimeFor, liveAssessmentMode, windowState,
  type AssessmentGate, type AssessmentMode, type WindowState,
} from '@/lib/academic/assessment';
import { identifies } from '@/lib/academic/derivations';
import { assistantShare, integrityFromNode, integrityVerdict, type IntegrityVerdict } from '@/lib/academic/integrity';
import { rubricFromNode, rubricProblems, type RubricProblem } from '@/lib/academic/marking';
import type { SpecDeriveBoard } from '@/lib/specObjects';
import type { AcademicNode } from './academicBoard';

/**
 * The assessment desk's reading of a board — exam mode, windows, deadlines with
 * extra time, the rubric each assignment is marked against, the integrity verdict on
 * each submission, and what is ready to mark.
 *
 * Pure and `now`-parameterised, for the reason `assessment.ts` gives: an exam window
 * that depends on an ambient clock cannot be tested. Every figure comes from the
 * engines in `lib/academic/`; this only joins assignments to what hangs off them.
 */

export type RubricState =
  | { state: 'ready' }
  | { state: 'missing' }
  | { state: 'problem'; problem: RubricProblem };

export interface AssignmentReading {
  id: string;
  title: string;
  mode: AssessmentMode;
  window: WindowState;
  /** Released and not yet past its deadline — being SAT right now. */
  live: boolean;
  dueAt: number | null;
  /** Learners with approved extra time, and the latest deadline that grants. */
  extraTime: { learners: number; latestDue: number | null };
  rubric: RubricState;
  submitted: number;
  marked: number;
}

export interface IntegrityFlag {
  id: string;
  learner: string;
  assignment: string;
  verdict: Extract<IntegrityVerdict, 'undeclaredAssistance' | 'closedBookViolation'>;
  assistantPercent: number;
}

export interface MarkingReady {
  id: string;
  learner: string;
  assignment: string;
}

export interface AssessmentReading {
  gate: AssessmentGate;
  assignments: AssignmentReading[];
  /** The only integrity verdicts that need a conversation — see `integrityVerdict`. */
  flagged: IntegrityFlag[];
  declaredCount: number;
  readyToMark: MarkingReady[];
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '');
const finite = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number(text(value));
  return text(value) !== '' && Number.isFinite(parsed) ? parsed : undefined;
};
const hasMark = (data: Readonly<Record<string, unknown>>): boolean => text(data.mark) !== '';

function rubricStateOf(assignment: Readonly<Record<string, unknown>>, board: SpecDeriveBoard): RubricState {
  const rubric = board.byRef('rubric', assignment.rubricRef);
  if (!rubric) return { state: 'missing' };
  const problem = rubricProblems(rubricFromNode(rubric), finite(assignment.maxMarks))[0];
  return problem ? { state: 'problem', problem } : { state: 'ready' };
}

export function readAssessments(nodes: readonly AcademicNode[], board: SpecDeriveBoard, now: number): AssessmentReading {
  const accommodations = nodes.filter((node) => node.data.kind === 'accommodation').map((node) => node.data);
  const accommodated = [...new Set(accommodations.map((data) => text(data.learnerRef)).filter(Boolean))];
  const submissions = nodes.filter((node) => node.data.kind === 'submission');

  const flagged: IntegrityFlag[] = [];
  const readyToMark: MarkingReady[] = [];
  let declaredCount = 0;

  const assignments = nodes.filter((node) => node.data.kind === 'assignment').map((node): AssignmentReading => {
    const data = node.data;
    const mode = assessmentModeOf(data);
    const window = windowState(data, now);
    const title = text(data.title);
    const extras = accommodated.map((ref) => extraTimeFor(ref, accommodations, now)).filter((percent) => percent > 0);
    const own = submissions.filter((submission) => identifies(data, submission.data.assignmentRef));

    for (const submission of own) {
      const learner = text(submission.data.learnerName) || text(submission.data.learnerRef);
      const rows = integrityFromNode(submission.data.integrity);
      const verdict = integrityVerdict(rows, submission.data.declaration, mode);
      if (verdict === 'declaredAssistance') declaredCount += 1;
      if (verdict === 'undeclaredAssistance' || verdict === 'closedBookViolation') {
        flagged.push({ id: submission.id, learner, assignment: title, verdict, assistantPercent: assistantShare(rows) });
      }
      const placed = Array.isArray(submission.data.placements) && submission.data.placements.length > 0;
      if (placed && text(submission.data.submittedAt) && !hasMark(submission.data)) {
        readyToMark.push({ id: submission.id, learner, assignment: title });
      }
    }

    return {
      id: node.id,
      title,
      mode,
      window,
      live: Number.isFinite(Date.parse(text(data.releaseAt))) && window === 'open',
      dueAt: effectiveDeadline(data.dueAt),
      extraTime: {
        learners: extras.length,
        latestDue: extras.length ? effectiveDeadline(data.dueAt, Math.max(...extras), finite(data.durationMinutes)) : null,
      },
      rubric: rubricStateOf(data, board),
      submitted: own.filter((submission) => text(submission.data.submittedAt)).length,
      marked: own.filter((submission) => hasMark(submission.data)).length,
    };
  });

  return {
    gate: assessmentGate(liveAssessmentMode(nodes.map((node) => node.data), now)),
    assignments,
    flagged,
    declaredCount,
    readyToMark,
  };
}
