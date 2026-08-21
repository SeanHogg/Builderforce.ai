/**
 * TEACHING, as card acts — distributing an assignment, pulling a roster, marking
 * a submission, computing a gradebook, validating a curriculum map, importing a
 * bibliography.
 *
 * ── WHY THEY ARE HERE ────────────────────────────────────────────────────────
 * PRD 22 §3.4 names four of these six as use cases implemented inside
 * `CanvasInner` and belonging to a context the canvas map does not own. That is
 * exactly what they were: `markSubmission` alone is sixty lines of rubric
 * application, late policy and an LMS score push, and the only way to exercise
 * "a submission with no placements is refused rather than marked zero" was to
 * mount 940 KB of canvas in jsdom.
 *
 * ── WHAT STAYS IN `lib/academic/` ────────────────────────────────────────────
 * The ENGINES: `applyRubric`, `applyLatePolicy`, `statsOf`, `curriculumMapProblems`.
 * They are shared with the derivations that compute the same figures live on the
 * cards, and the whole point of `markSubmission` calling them is that the mark a
 * teacher writes and the mean the gradebook shows come from one implementation.
 * These acts orchestrate; they do not re-derive.
 */

import { makeSpecDeriveBoard, specRefKey } from '@/lib/specObjects';
import { learnersFromCohort } from '@/lib/academic/gradebook';
import { curriculumMapProblems, mappingRows, statsOf } from '@/lib/academic/derivations';
import {
  applyLatePolicy,
  applyRubric,
  hoursLate,
  parseLatePolicy,
  rubricFromNode,
  rubricProblems,
  type CriterionSelection,
} from '@/lib/academic/marking';
import { entryRowFromRecord, parseReferences } from '@/lib/academic/citations';
import { pullLtiRoster, pushLtiScore } from '@/lib/ltiApi';
import { canvasDocument } from '@/lib/canvasDocuments';
import { actEdge, cardRows, cardText, type CardAct } from '@/domains/canvas/application/CardAct';
import type { CanvasObject, CreationObjectKind } from '@/domains/canvas/domain/canvasObject';

/** The board a computed field reads, indexed once per act rather than per card —
 *  indexing per object would be the O(N²) fan-out shape the platform rejects. */
function specBoardOf(source: readonly CanvasObject[]) {
  return makeSpecDeriveBoard(source.map((node) => node.data as unknown as Record<string, unknown>));
}

/**
 * `assignment.distribute` — fan the task into one `submission` per roster row.
 *
 * Idempotent by construction: a learner who already has a submission for this
 * assignment (matched on `learnerRef`) is skipped, so distributing twice — a late
 * enrolment, a re-run after the roster grew — creates only what is missing rather
 * than duplicating every submission on the board.
 */
export const distributeAssignmentAct: CardAct = {
  kind: 'assignment' as CreationObjectKind,
  actions: ['distribute'],
  run({ object: assignment, board, t }) {
    const all = board.objects;
    const cohort = specBoardOf(all).byRef('cohort', assignment.data.cohortRef);
    const roster = cohort ? learnersFromCohort(cohort) : [];
    if (!roster.length) return { notice: t('noticeSubmissionsNoCohort') };

    const assignmentKey = specRefKey(assignment.data.title);
    const already = new Set(all
      .filter((node) => node.data.kind === 'submission' && specRefKey(node.data.assignmentRef) === assignmentKey)
      .map((node) => specRefKey(node.data.learnerRef)));
    const toCreate = roster.filter((learner) => !already.has(specRefKey(learner.ref)));
    if (!toCreate.length) return { notice: t('noticeSubmissionsAlreadyDistributed') };

    const created = toCreate.map((learner, index) => {
      const node = board.create('submission' as CreationObjectKind, {
        x: assignment.position.x + 440 + (index % 3) * 300,
        y: assignment.position.y + 220 + Math.floor(index / 3) * 190,
      });
      node.data = {
        ...node.data,
        title: `${learner.name} — ${String(assignment.data.title ?? '')}`,
        learnerRef: learner.ref,
        learnerName: learner.name,
        assignmentRef: String(assignment.data.title ?? ''),
      };
      return node;
    });

    return {
      add: { nodes: created, edges: created.map((node) => actEdge(assignment, node, 'submission', 'membership')) },
      notice: t('noticeSubmissionsDistributed', { count: created.length }),
    };
  },
};

/**
 * `cohort.import`'s GENERIC path — invoked with no roster text, so it pulls
 * through NRPS using whatever `ltiIssuer`/`ltiMembershipsUrl` the cohort already
 * carries. A CSV paste goes through the dedicated `canvas_import_roster` tool
 * instead, which has the text to parse.
 */
export const importCohortRosterAct: CardAct = {
  kind: 'cohort' as CreationObjectKind,
  actions: ['import'],
  async run({ object, t }) {
    const data = object.data as Record<string, unknown>;
    const issuer = cardText(data, 'ltiIssuer');
    const membershipsUrl = cardText(data, 'ltiMembershipsUrl');
    if (!issuer || !membershipsUrl) return { notice: t('noticeRosterNoLmsBound') };

    try {
      const result = await pullLtiRoster(issuer, membershipsUrl);
      return {
        patch: { roster: result.roster, enrolledCount: result.roster.length },
        notice: t('noticeRosterPulled', { count: result.roster.length }),
      };
    } catch (error) {
      // NAMED rather than left to the generic failure notice: "could not reach the
      // LMS" and "the LMS said this course has no memberships" are different
      // problems for the person holding the register.
      return { notice: t('noticeRosterPullFailed', { reason: error instanceof Error ? error.message : String(error) }) };
    }
  },
};

/**
 * `gradebook.compute` — the matrix, mean, median, pass rate and distribution are
 * already `derive`d live from the submissions on the board (see
 * `academic/derivations.ts`); this act's job is to make that explicit and
 * reportable, stamping the figure onto the card rather than leaving it to be read
 * off a toast that closes.
 */
export const computeGradebookAct: CardAct = {
  kind: 'gradebook' as CreationObjectKind,
  actions: ['compute'],
  run({ object, board, t }) {
    const stats = statsOf(object.data as unknown as Record<string, unknown>, specBoardOf(board.objects));
    if (!stats) return { notice: t('noticeGradebookEmpty') };
    return {
      patch: {
        status: `Computed — ${stats.mean ?? 0}% mean, ${stats.markedCount}/${stats.learnerCount} marked`,
        computedAt: new Date().toISOString(),
      },
      notice: t('noticeGradebookComputed', { mean: stats.mean ?? 0, marked: stats.markedCount, total: stats.learnerCount }),
    };
  },
};

/** Why {@link rubricProblems} refused to mark, in one short clause. */
function rubricBlockReason(code: string): string {
  if (code === 'noLevels') return 'it declares no achievement levels';
  if (code === 'noCriteria') return 'it declares no criteria';
  return 'every criterion weight is zero';
}

/**
 * `submission.mark` — apply the rubric to the placements already authored onto
 * `submission.placements`, apply the assignment's late policy, and write the
 * result.
 *
 * Never invents a judgement: the placements are the input, `applyRubric` and
 * `applyLatePolicy` are the same engines the gradebook already trusts, and a
 * submission with no placements yet is refused rather than marked zero.
 *
 * The LMS push rides `settle` rather than a floating `.then`. It is the slow half
 * — and the half that answers "did this grade reach the gradebook the student
 * actually reads" — so it belongs in the result rather than in a promise nobody
 * holds.
 */
export const markSubmissionAct: CardAct = {
  kind: 'submission' as CreationObjectKind,
  actions: ['mark'],
  run({ object: submission, board, t }) {
    const specBoard = specBoardOf(board.objects);
    const assignment = specBoard.byRef('assignment', submission.data.assignmentRef);
    const rubric = assignment ? specBoard.byRef('rubric', assignment.rubricRef) : null;
    if (!assignment || !rubric) return { notice: t('noticeSubmissionNoRubric') };

    const parsedRubric = rubricFromNode(rubric);
    const maxMarks = Number(assignment.maxMarks);
    const problems = rubricProblems(parsedRubric, Number.isFinite(maxMarks) ? maxMarks : undefined);
    const blocking = problems.find((problem) => problem.code === 'noLevels' || problem.code === 'noCriteria' || problem.code === 'weightsZero');
    if (blocking) return { notice: t('noticeSubmissionRubricBroken', { reason: rubricBlockReason(blocking.code) }) };

    const placements = cardRows(submission.data as Record<string, unknown>, 'placements');
    if (!placements.length) return { notice: t('noticeSubmissionNoPlacements') };
    const selections: CriterionSelection[] = placements.flatMap((row): CriterionSelection[] => {
      const criterion = cardText(row, 'criterion');
      const levelIndex = Number(row.levelIndex);
      if (!criterion || !Number.isInteger(levelIndex)) return [];
      return [{ criterion, levelIndex, comment: typeof row.comment === 'string' ? row.comment : undefined }];
    });
    const result = applyRubric(parsedRubric, selections);
    if (result.unmarked.length) return { notice: t('noticeSubmissionPlacementsIncomplete', { criteria: result.unmarked.join(', ') }) };

    const policy = parseLatePolicy(assignment.latePolicy);
    const hours = hoursLate(submission.data.submittedAt, assignment.dueAt);
    const late = applyLatePolicy(result.total, hours, policy);
    const percent = parsedRubric.totalMarks > 0 ? Math.round((late.mark / parsedRubric.totalMarks) * 1000) / 10 : 0;

    const commentNotes = result.breakdown.map((row) => row.comment).filter(Boolean).join(' ');
    const lateNote = late.daysLate > 0
      ? ` Submitted ${late.daysLate} day${late.daysLate === 1 ? '' : 's'} late; ${late.deducted} marks deducted under the late policy.`
      : '';
    const feedback = `${commentNotes}${lateNote}`.trim();
    const markBreakdown = result.breakdown.map((row) => ({ criterion: row.criterion, level: row.level, marks: row.marks, comment: row.comment }));

    const learnerName = String(submission.data.learnerName ?? submission.data.learnerRef ?? '');
    const learnerRef = cardText(submission.data as Record<string, unknown>, 'learnerRef');
    const cohort = specBoard.byRef('cohort', assignment.cohortRef);
    const issuer = cohort ? String(cohort.ltiIssuer ?? '').trim() : '';
    const lineItemUrl = String(assignment.ltiLineItemUrl ?? '').trim();

    const notice = late.daysLate > 0
      ? t('noticeSubmissionMarkedLate', { name: learnerName, percent, mark: late.mark, total: parsedRubric.totalMarks, days: late.daysLate, deducted: late.deducted })
      : t('noticeSubmissionMarked', { name: learnerName, percent, mark: late.mark, total: parsedRubric.totalMarks });

    return {
      patch: { mark: late.mark, markBreakdown, feedback, status: `Marked — ${percent}%` },
      notice,
      ...(issuer && lineItemUrl && learnerRef ? {
        settle: pushLtiScore({
          issuer, lineItemUrl, userId: learnerRef, scoreGiven: late.mark, scoreMaximum: parsedRubric.totalMarks,
          released: true, ...(feedback ? { comment: feedback } : {}),
        })
          .then(() => `${notice} ${t('noticeSubmissionScorePushed')}`)
          .catch((error: unknown) => `${notice} ${t('noticeSubmissionScorePushFailed', { reason: error instanceof Error ? error.message : String(error) })}`),
      } : {}),
    };
  },
};

/**
 * `curriculumMap.validate` — structural problems the coverage figure alone cannot
 * show: an outcome nobody mapped, a mapping column naming an assessment that is
 * not actually on this board. See `curriculumMapProblems`.
 */
export const validateCurriculumMapAct: CardAct = {
  kind: 'curriculumMap' as CreationObjectKind,
  actions: ['validate'],
  run({ object, board, t }) {
    const data = object.data as unknown as Record<string, unknown>;
    const problems = curriculumMapProblems(data, specBoardOf(board.objects));
    const rows = mappingRows(data);
    const coverage = rows.length ? Math.round((rows.filter((row) => row.assured).length / rows.length) * 100) : 0;
    return {
      patch: {
        status: problems.length ? `Validated — ${problems.length} issue(s)` : 'Validated — fully mapped',
        validatedAt: new Date().toISOString(),
      },
      notice: t('noticeCurriculumMapValidated', { coverage, issues: problems.length }),
    };
  },
};

/**
 * `bibliography.import`'s GENERIC path — invoked with no reference text, so it
 * looks for a `.bib`/`.ris` export already sitting on the board as a document and
 * parses that. A pasted or uploaded reference list goes through the dedicated
 * `canvas_import_references` tool instead, which has the text directly.
 */
export const importReferencesAct: CardAct = {
  kind: 'bibliography' as CreationObjectKind,
  actions: ['import'],
  run({ object, board, t }) {
    const candidate = board.objects
      .map((node) => ({ node, records: parseReferences(canvasDocument(node.data)?.markdown ?? '') }))
      .find((entry) => entry.records.length > 0);
    if (!candidate) return { notice: t('noticeReferencesImportEmpty') };
    const existing = Array.isArray(object.data.entries) ? object.data.entries : [];
    return {
      patch: { entries: [...existing, ...candidate.records.map(entryRowFromRecord)] },
      notice: t('noticeReferencesImported', { count: candidate.records.length }),
    };
  },
};

export const TEACHING_CARD_ACTS: readonly CardAct[] = [
  distributeAssignmentAct,
  importCohortRosterAct,
  computeGradebookAct,
  markSubmissionAct,
  validateCurriculumMapAct,
  importReferencesAct,
];
