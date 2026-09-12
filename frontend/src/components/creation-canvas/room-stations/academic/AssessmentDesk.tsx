import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import type { RoomStationInstance } from '@/lib/canvas/roomStations';
import { useClock } from '@/lib/useClock';
import { useCanRunCardActs, useCardActRunner } from '../../cardActRunner';
import type { RoomStationModel, RoomStationView } from '../types';
import { AcademicFace } from './AcademicFace';
import { useAcademicBoard } from './academicBoard';
import { readAssessments, type RubricState } from './assessmentReading';
import styles from './academicStations.module.css';

/**
 * THE ASSESSMENT DESK — where a teacher sees what is being sat, and what the assistant
 * is allowed to do about it.
 *
 * Its headline is the exam gate itself (`assessmentGate` over the assessments LIVE on
 * this board), which is the same verdict every composer in the shell obeys — so what
 * the desk says and what the Brain does cannot disagree. Beneath it: each assignment's
 * mode, window and deadline (with the extra time approved accommodations grant, computed
 * rather than applied by hand), whether its rubric can actually mark, and — for staff —
 * the integrity verdicts that need a conversation and the submissions ready to mark,
 * marked through the ONE card-act runner (`submission.mark`).
 *
 * Entitlement: anyone on the board sees the gate and the deadlines — a learner needs to
 * know the assistant is off and when the paper closes. Integrity and marking are staff
 * (`useAcademicBoard().staff`).
 */

const CLOCK_MS = 30_000;

function useAssessmentReading() {
  const { board, nodes, specBoard, staff } = useAcademicBoard();
  const now = useClock(CLOCK_MS);
  const reading = useMemo(() => readAssessments(nodes, specBoard, now), [nodes, specBoard, now]);
  return { board, reading, staff };
}

function useAssessmentModel(): RoomStationModel | null {
  const t = useTranslations('roomStations.assessment');
  const { board, reading } = useAssessmentReading();
  if (!board || !reading.assignments.length) return null;
  const live = reading.assignments.filter((assignment) => assignment.live).length;
  return {
    title: t('title'),
    summary: t('summary', { count: reading.assignments.length, live }),
    face: (
      <AcademicFace
        figure={String(live)}
        headline={t(`faceGate.${reading.gate.mode}`)}
        lines={reading.assignments.slice(0, 3).map((assignment) => `${assignment.title || t('untitled')} · ${t(`mode.${assignment.mode}`)}`)}
        tone={reading.gate.mode === 'open' ? 'calm' : 'attention'}
      />
    ),
  };
}

function useRubricText() {
  const t = useTranslations('roomStations.assessment.rubric');
  return (rubric: RubricState): string => {
    if (rubric.state === 'ready') return t('ready');
    if (rubric.state === 'missing') return t('missing');
    const { problem } = rubric;
    switch (problem.code) {
      case 'missingDescriptors': return t('missingDescriptors', { criterion: problem.criterion, count: problem.missing });
      case 'totalMismatch': return t('totalMismatch', { totalMarks: problem.totalMarks, maxMarks: problem.maxMarks });
      default: return t(problem.code);
    }
  };
}

function AssessmentDeskPanel(_props: { instance: RoomStationInstance }) {
  const t = useTranslations('roomStations.assessment');
  const fmt = useFormat();
  const rubricText = useRubricText();
  const runAct = useCardActRunner();
  const canAct = useCanRunCardActs();
  const { board, reading, staff } = useAssessmentReading();
  if (!board || !reading.assignments.length) return null;

  return (
    <div className={styles.panel} data-testid="assessment-desk-panel">
      <p className={styles.banner} role="status" data-tone={reading.gate.mode === 'open' ? 'calm' : 'attention'} data-mode={reading.gate.mode}>
        {t(`gate.${reading.gate.mode}`)}
      </p>

      <section className={styles.section} aria-label={t('assignmentsHead')}>
        <h3 className={styles.sectionHead}>{t('assignmentsHead')}</h3>
        <ul className={styles.cards}>
          {reading.assignments.map((assignment) => (
            <li key={assignment.id} className={styles.card} data-testid="assessment-row">
              <div className={styles.cardHead}>
                <strong>{assignment.title || t('untitled')}</strong>
                <span className={styles.badge} data-tone={assignment.mode === 'open' ? 'calm' : 'attention'}>{t(`mode.${assignment.mode}`)}</span>
                <span className={styles.badge} data-tone="calm">{t(`window.${assignment.window}`)}</span>
              </div>
              <p className={styles.line}>{assignment.dueAt != null ? t('due', { date: fmt.dateTime(assignment.dueAt) }) : t('noDue')}</p>
              {assignment.extraTime.learners > 0 && (
                <p className={styles.line}>
                  {t('extraTime', {
                    count: assignment.extraTime.learners,
                    date: assignment.extraTime.latestDue != null ? fmt.dateTime(assignment.extraTime.latestDue) : t('noDue'),
                  })}
                </p>
              )}
              <p className={styles.line} data-tone={assignment.rubric.state === 'ready' ? 'calm' : 'attention'}>{rubricText(assignment.rubric)}</p>
              <p className={styles.line}>{t('submissions', { submitted: assignment.submitted, marked: assignment.marked })}</p>
            </li>
          ))}
        </ul>
      </section>

      {staff && (
        <section className={styles.section} aria-label={t('integrityHead')}>
          <h3 className={styles.sectionHead}>{t('integrityHead')}</h3>
          {reading.flagged.length ? (
            <ul className={styles.rows}>
              {reading.flagged.map((flag) => (
                <li key={flag.id} className={styles.rowItem} data-tone="attention" data-testid="integrity-flag">
                  <span><strong>{flag.learner || t('untitled')}</strong> · {flag.assignment}</span>
                  <span>{t(`verdict.${flag.verdict}`)} · {t('assistantShare', { percent: flag.assistantPercent })}</span>
                </li>
              ))}
            </ul>
          ) : <p className={styles.line}>{t('integrityClear')}</p>}
          {reading.declaredCount > 0 && <p className={styles.line}>{t('declared', { count: reading.declaredCount })}</p>}
        </section>
      )}

      {staff && (
        <section className={styles.section} aria-label={t('markHead')}>
          <h3 className={styles.sectionHead}>{t('markHead')}</h3>
          {reading.readyToMark.length ? (
            <ul className={styles.rows}>
              {reading.readyToMark.map((item) => (
                <li key={item.id} className={styles.rowItem}>
                  <span><strong>{item.learner || t('untitled')}</strong> · {item.assignment}</span>
                  {canAct && (
                    <button type="button" className={styles.action} onClick={() => runAct(item.id, 'mark')} aria-label={t('markNamed', { name: item.learner || t('untitled') })}>
                      {t('mark')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : <p className={styles.line}>{t('markNone')}</p>}
        </section>
      )}
    </div>
  );
}

export const assessmentDeskView: RoomStationView = {
  useModel: () => useAssessmentModel(),
  Panel: AssessmentDeskPanel,
};
