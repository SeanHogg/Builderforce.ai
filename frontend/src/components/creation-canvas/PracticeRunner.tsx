'use client';

/**
 * The study loop, once: ask, answer, find out, come back to it.
 *
 * One component for both surfaces that ask questions on the canvas — the
 * Practice object (a whole set) and a Course module's knowledge check (a set of
 * one). They were never going to be two different things: the same question
 * shape, the same grader, the same record of attempts. Splitting them is how a
 * course check came to hold its answer in `useState` and forget it, while
 * anything that wanted a real quiz had nowhere to live at all.
 *
 * Everything durable is delegated: {@link isPracticeResponseCorrect} grades,
 * {@link practiceProgress} scores, {@link nextPracticeQuestion} decides what to
 * ask next, and the caller persists the attempt onto its own object. This file
 * owns only what is on screen right now.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from './CreationCanvas.module.css';
import {
  isPracticeResponseCorrect, nextPracticeQuestion, practiceProgress,
  type CanvasPracticeAttempt, type CanvasPracticeMode, type CanvasPracticeQuestion,
} from '@/lib/canvasPractice';

export interface PracticeRunnerProps {
  questions: readonly CanvasPracticeQuestion[];
  attempts: readonly CanvasPracticeAttempt[];
  mode?: CanvasPracticeMode;
  /** False on a read-only board: the questions still read, nothing records. */
  editable: boolean;
  onRecord: (attempt: CanvasPracticeAttempt) => void;
  onReset?: () => void;
  /** Hides the score strip where the host already shows one (a course header). */
  compact?: boolean;
}

export function PracticeRunner({ questions, attempts, mode = 'quiz', editable, onRecord, onReset, compact }: PracticeRunnerProps) {
  const t = useTranslations('creationCanvas.practice');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);

  const progress = practiceProgress(questions, attempts);
  const active = questions.find((question) => question.id === activeId)
    ?? nextPracticeQuestion(questions, attempts)
    ?? null;
  if (!active) return <p className={styles.practiceEmpty}>{t('empty')}</p>;

  const record = progress.byQuestion.get(active.id);
  const isFlashcard = mode === 'flashcards' || !active.choices?.length;
  const answered = chosen != null || (isFlashcard && revealed && chosen != null);

  const advance = () => {
    const next = nextPracticeQuestion(questions, attempts, questions.length > 1 ? active.id : undefined);
    setActiveId(next?.id ?? null);
    setChosen(null);
    setRevealed(false);
  };
  const answer = (correct: boolean, index?: number) => {
    if (!editable) return;
    setChosen(index ?? (correct ? 1 : 0));
    onRecord({ questionId: active.id, at: new Date().toISOString(), correct, ...(index != null ? { chosen: index } : {}) });
  };
  const correctNow = chosen != null && (isFlashcard ? chosen === 1 : isPracticeResponseCorrect(active, chosen));

  return <div className={`${styles.practiceRunner} nodrag nowheel`} onClick={(event) => event.stopPropagation()}>
    {!compact && <div className={styles.practiceScore}>
      <span><b>{t('mastered', { mastered: progress.mastered, total: progress.total })}</b></span>
      <span>{t('accuracy', { percent: progress.accuracy })}</span>
      {progress.weak > 0 && <span data-weak="true">{t('weak', { count: progress.weak })}</span>}
      <div className={styles.practiceBar} role="progressbar" aria-label={t('progressLabel')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><i style={{ width: `${progress.percent}%` }} /></div>
    </div>}

    <p className={styles.practicePrompt}>{active.prompt}</p>

    {isFlashcard
      ? <div className={styles.practiceCard}>
        {revealed
          ? <><p className={styles.practiceAnswer}>{active.answerText || active.choices?.[active.answerIndex ?? 0] || ''}</p>
            {!answered && <div className={styles.practiceChoices}>
              <button type="button" disabled={!editable} onClick={() => answer(true, 1)}>{t('gotIt')}</button>
              <button type="button" disabled={!editable} onClick={() => answer(false, 0)}>{t('missedIt')}</button>
            </div>}</>
          : <button type="button" className={styles.practiceReveal} onClick={() => setRevealed(true)}>{t('showAnswer')}</button>}
      </div>
      : <div className={styles.practiceChoices}>
        {active.choices?.map((choice, index) => <button
          key={`${active.id}-${index}`}
          type="button"
          disabled={!editable || chosen != null}
          data-selected={chosen === index || undefined}
          data-correct={chosen != null && index === active.answerIndex ? 'true' : undefined}
          onClick={() => answer(isPracticeResponseCorrect(active, index), index)}
        ><span aria-hidden>{String.fromCharCode(65 + index)}</span>{choice}</button>)}
      </div>}

    {answered && <p role="status" className={styles.practiceFeedback} data-correct={correctNow || undefined}>
      <b>{correctNow ? t('correct') : t('notQuite')}</b>
      {active.explanation ? ` ${active.explanation}` : ''}
    </p>}

    {!answered && !revealed && active.hint && <p className={styles.practiceHint}>{t('hint', { hint: active.hint })}</p>}

    <div className={styles.practiceActions}>
      {answered && questions.length > 1 && <button type="button" onClick={advance}>{t('next')}</button>}
      {answered && <button type="button" onClick={() => { setChosen(null); setRevealed(false); }}>{t('tryAgain')}</button>}
      {onReset && attempts.length > 0 && <button type="button" onClick={() => { onReset(); setChosen(null); setRevealed(false); setActiveId(null); }}>{t('resetProgress')}</button>}
      {record && record.attempts > 0 && <small>{t('seenBefore', { count: record.attempts, correct: record.correct })}</small>}
    </div>
  </div>;
}
