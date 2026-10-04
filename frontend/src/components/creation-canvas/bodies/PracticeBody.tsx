import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { practiceAttempts, practiceMode, practiceQuestions, practiceProgress, recordPracticeAttempt } from '@/lib/canvasPractice';
import { PracticeRunner } from '../PracticeRunner';
import type { CreationBodyProps } from './types';
import { useCreationNodeActions } from './nodeActions';

/**
 * The Practice object — a set of questions and the record of answering them.
 *
 * The card IS the study session (the inspector only authors), because the point
 * of practice on a canvas is that it sits next to the notes it came from and can
 * be done in the ten seconds a person actually has. Mode is a value, not a second
 * object kind: a flashcard and a multiple-choice question are the same question
 * asked two ways, and both are graded and recorded by the same model.
 */
export function PracticeBody({ data }: CreationBodyProps) {
  const { edit: onEdit } = useCreationNodeActions();
  const t = useTranslations('creationCanvas.practice');
  const questions = practiceQuestions(data.questions);
  const attempts = practiceAttempts(data.attempts);
  const mode = practiceMode(data.practiceMode);
  const progress = practiceProgress(questions, attempts);
  return <div className={styles.practiceShell}>
    {questions.length > 1 && <div className={`${styles.practiceModes} nodrag`} role="group" aria-label={t('modeLabel')}>
      <button type="button" aria-pressed={mode === 'quiz'} disabled={!onEdit} onClick={(event) => { event.stopPropagation(); onEdit?.({ practiceMode: 'quiz' }); }}>{t('modeQuiz')}</button>
      <button type="button" aria-pressed={mode === 'flashcards'} disabled={!onEdit} onClick={(event) => { event.stopPropagation(); onEdit?.({ practiceMode: 'flashcards' }); }}>{t('modeFlashcards')}</button>
    </div>}
    <PracticeRunner
      questions={questions}
      attempts={attempts}
      mode={mode}
      editable={!!onEdit}
      onRecord={(attempt) => onEdit?.({
        attempts: recordPracticeAttempt(attempts, attempt),
        status: t('statusStudied', { mastered: practiceProgress(questions, recordPracticeAttempt(attempts, attempt)).mastered, total: questions.length }),
      })}
      {...(onEdit && attempts.length ? { onReset: () => onEdit({ attempts: [], status: t('statusReset') }) } : {})}
    />
    {progress.weak > 0 && <p className={styles.practiceStudyList}>{t('studyList', { count: progress.weak })}</p>}
  </div>;
}
