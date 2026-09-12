import { describe, expect, it } from 'vitest';
import { makeSpecDeriveBoard } from '@/lib/specObjects';
import { readAssessments } from './assessmentReading';
import type { AcademicNode } from './academicBoard';

/**
 * The assessment desk's reading — exam mode, the extra time accommodations grant,
 * whether the rubric can mark, and which submissions need a conversation or a marker.
 */

const NOW = Date.parse('2026-09-12T10:00:00Z');
const DUE = '2026-09-12T12:00:00Z';

const nodes: AcademicNode[] = [
  {
    id: 'a1',
    data: {
      kind: 'assignment', title: 'Essay 1', assessmentMode: 'closed',
      releaseAt: '2026-09-12T09:00:00Z', dueAt: DUE, durationMinutes: 120, rubricRef: 'Essay rubric', maxMarks: 100,
    },
  },
  {
    id: 'r1',
    data: {
      kind: 'rubric', title: 'Essay rubric', totalMarks: 100, levels: ['Fail', 'Pass'],
      criteria: { columns: ['Fail', 'Pass'], rows: [{ label: 'Argument', weight: 1, cells: ['Weak', 'Strong'] }] },
    },
  },
  { id: 'acc', data: { kind: 'accommodation', learnerRef: 'l2', extraTimePercent: 25, evidenceHeld: 'held' } },
  {
    id: 's1',
    data: {
      kind: 'submission', assignmentRef: 'Essay 1', learnerRef: 'l1', learnerName: 'Ada', submittedAt: '2026-09-12T11:00:00Z',
      declaration: 'All my own work', integrity: [{ source: 'assistant', edits: 3, characters: 400 }, { source: 'learner', edits: 9, characters: 1600 }],
      placements: [{ criterion: 'Argument', levelIndex: 1 }],
    },
  },
  { id: 's2', data: { kind: 'submission', assignmentRef: 'Essay 1', learnerRef: 'l2', learnerName: 'Grace', submittedAt: '2026-09-12T11:30:00Z', mark: 70 } },
  { id: 'a2', data: { kind: 'assignment', title: 'Lab report' } },
];

const read = () => readAssessments(nodes, makeSpecDeriveBoard(nodes.map((node) => node.data)), NOW);

describe('readAssessments', () => {
  it('reports the gate every composer obeys — a released closed-book paper turns the assistant off', () => {
    expect(read().gate).toMatchObject({ mode: 'closed', assistantAllowed: false });
  });

  it('reads each assignment: mode, window, liveness, counts and a rubric that can mark', () => {
    const [essay, lab] = read().assignments;
    expect(essay).toMatchObject({ title: 'Essay 1', mode: 'closed', window: 'open', live: true, submitted: 2, marked: 1, rubric: { state: 'ready' } });
    expect(lab).toMatchObject({ mode: 'open', live: false, rubric: { state: 'missing' }, dueAt: null });
  });

  it('extends the DURATION by the approved extra time, not the calendar deadline', () => {
    const [essay] = read().assignments;
    expect(essay!.extraTime).toEqual({ learners: 1, latestDue: Date.parse(DUE) + 30 * 60_000 });
  });

  it('flags the assistant acting in a closed-book assessment as a control failure, with its share', () => {
    expect(read().flagged).toEqual([
      { id: 's1', learner: 'Ada', assignment: 'Essay 1', verdict: 'closedBookViolation', assistantPercent: 20 },
    ]);
  });

  it('offers to mark only what is handed in, placed on the rubric and not yet marked', () => {
    expect(read().readyToMark).toEqual([{ id: 's1', learner: 'Ada', assignment: 'Essay 1' }]);
  });
});
