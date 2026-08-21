/**
 * Marking, distributing and computing — without a canvas.
 *
 * `markSubmission` is the one that matters: sixty lines deciding a student's
 * grade, and until it moved out of `CanvasInner` the only way to assert "a
 * submission with no placements is refused rather than marked zero" was to mount
 * 940 KB of component in jsdom.
 */

import { describe, expect, it } from 'vitest';
import {
  computeGradebookAct,
  distributeAssignmentAct,
  markSubmissionAct,
  validateCurriculumMapAct,
} from './academicActs';
import type { CardActBoard } from '@/domains/canvas/application/CardAct';
import type { CanvasObject, CreationObjectKind } from '@/domains/canvas/domain/canvasObject';

const t = (key: string, values?: Record<string, string | number>) => (values ? `${key}:${JSON.stringify(values)}` : key);

function object(id: string, kind: string, data: Record<string, unknown> = {}): CanvasObject {
  return { id, type: 'creation', position: { x: 0, y: 0 }, data: { kind: kind as CreationObjectKind, title: id, ...data } };
}

function board(objects: CanvasObject[]): CardActBoard {
  return {
    objects,
    create: (kind, position) => ({ id: `new-${kind}-${position.x}-${position.y}`, type: 'creation', position, data: { kind, title: '' } }),
  };
}

describe('assignment.distribute', () => {
  const cohort = object('c1', 'cohort', { title: 'Cohort A', roster: [{ ref: 'l1', name: 'Ada' }, { ref: 'l2', name: 'Grace' }] });
  const assignment = object('a1', 'assignment', { title: 'Essay 1', cohortRef: 'Cohort A' });

  it('creates one submission per learner, connected to the assignment', () => {
    const outcome = distributeAssignmentAct.run({ object: assignment, action: 'distribute', board: board([cohort, assignment]), t });
    if (outcome instanceof Promise) throw new Error('expected a synchronous act');
    expect(outcome.add?.nodes).toHaveLength(2);
    expect(outcome.add?.edges).toHaveLength(2);
    expect(outcome.add?.edges[0]?.data).toMatchObject({ connectionKind: 'membership' });
  });

  it('is IDEMPOTENT — a second run creates only what is missing', () => {
    // A late enrolment or a re-run after the roster grew must not duplicate every
    // submission already on the board.
    const existing = object('s1', 'submission', { assignmentRef: 'Essay 1', learnerRef: 'l1' });
    const outcome = distributeAssignmentAct.run({ object: assignment, action: 'distribute', board: board([cohort, assignment, existing]), t });
    if (outcome instanceof Promise) throw new Error('expected a synchronous act');
    expect(outcome.add?.nodes).toHaveLength(1);
  });

  it('refuses when nothing on the board answers the cohort reference', () => {
    const outcome = distributeAssignmentAct.run({ object: assignment, action: 'distribute', board: board([assignment]), t });
    if (outcome instanceof Promise) throw new Error('expected a synchronous act');
    expect(outcome.notice).toBe('noticeSubmissionsNoCohort');
    expect(outcome.add).toBeUndefined();
  });
});

describe('submission.mark', () => {
  const rubric = object('r1', 'rubric', {
    title: 'Essay rubric',
    criteria: [{ label: 'Argument', weight: 1 }],
    levels: ['Fail', 'Pass'],
    totalMarks: 10,
  });
  const assignment = object('a1', 'assignment', { title: 'Essay 1', rubricRef: 'Essay rubric', maxMarks: 10 });

  it('refuses a submission with no rubric behind it', () => {
    const submission = object('s1', 'submission', { assignmentRef: 'Nothing' });
    const outcome = markSubmissionAct.run({ object: submission, action: 'mark', board: board([submission]), t });
    if (outcome instanceof Promise) throw new Error('expected a synchronous act');
    expect(outcome.notice).toBe('noticeSubmissionNoRubric');
  });

  it('REFUSES rather than marking zero when nothing has been placed yet', () => {
    // An unmarked submission and a submission worth nothing are different facts,
    // and only one of them belongs in a gradebook.
    const submission = object('s1', 'submission', { assignmentRef: 'Essay 1', placements: [] });
    const outcome = markSubmissionAct.run({ object: submission, action: 'mark', board: board([rubric, assignment, submission]), t });
    if (outcome instanceof Promise) throw new Error('expected a synchronous act');
    expect(outcome.notice).toBe('noticeSubmissionNoPlacements');
    expect(outcome.patch).toBeUndefined();
  });

  it('writes the mark, the breakdown and the status onto the card', () => {
    const submission = object('s1', 'submission', {
      assignmentRef: 'Essay 1',
      learnerName: 'Ada',
      placements: [{ criterion: 'Argument', levelIndex: 1 }],
    });
    const outcome = markSubmissionAct.run({ object: submission, action: 'mark', board: board([rubric, assignment, submission]), t });
    if (outcome instanceof Promise) throw new Error('expected a synchronous act');
    expect(outcome.patch).toMatchObject({ mark: expect.any(Number) });
    expect(String(outcome.patch?.status)).toMatch(/^Marked — /);
    // No LMS bound, so nothing is queued to push — the grade stays on the board.
    expect(outcome.settle).toBeUndefined();
  });
});

describe('gradebook.compute', () => {
  it('says the gradebook is empty rather than stamping a meaningless zero', () => {
    const gradebook = object('g1', 'gradebook', { cohortRef: 'nothing' });
    const outcome = computeGradebookAct.run({ object: gradebook, action: 'compute', board: board([gradebook]), t });
    if (outcome instanceof Promise) throw new Error('expected a synchronous act');
    expect(outcome.notice).toBe('noticeGradebookEmpty');
  });
});

describe('curriculumMap.validate', () => {
  it('reports 0% coverage for a map with no rows instead of dividing by zero', () => {
    const map = object('m1', 'curriculumMap', { mapping: [] });
    const outcome = validateCurriculumMapAct.run({ object: map, action: 'validate', board: board([map]), t });
    if (outcome instanceof Promise) throw new Error('expected a synchronous act');
    expect(outcome.notice).toContain('"coverage":0');
    expect(outcome.patch?.validatedAt).toEqual(expect.any(String));
  });
});
