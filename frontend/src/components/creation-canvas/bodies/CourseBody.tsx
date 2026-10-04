import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { MathAwareText } from '@/components/academic/MathAwareText';
import styles from '../CreationCanvas.module.css';
import { COURSE_EXPORT_STANDARDS, courseAssessmentQuestions, courseFromNode, courseProgress, courseScore } from '@/lib/courseLms';
import { practiceAttempts, recordPracticeAttempt } from '@/lib/canvasPractice';
import { PracticeRunner } from '../PracticeRunner';
import type { CreationBodyProps } from './types';
import { useCreationNodeActions } from './nodeActions';

export function CourseBody({ data }: CreationBodyProps) {
  const { edit: onEdit } = useCreationNodeActions();
  const t = useTranslations('creationCanvas.course');
  const course = courseFromNode(data);
  const attempts = practiceAttempts(data.attempts);
  const [activeId, setActiveId] = useState(course.modules[0]?.id ?? '');
  const active = course.modules.find((module) => module.id === activeId) ?? course.modules[0];
  const progress = courseProgress(course);
  const score = courseScore(course, attempts);
  const completed = new Set(course.completedLessonIds);
  const toggleLesson = (lessonId: string) => {
    if (!onEdit) return;
    const next = new Set(course.completedLessonIds);
    if (next.has(lessonId)) next.delete(lessonId); else next.add(lessonId);
    onEdit({ course: { ...course, completedLessonIds: [...next] }, status: next.size === progress.total ? t('completed') : t('inProgress') });
  };
  /**
   * A course with no modules is a course waiting for its SUBJECT — the state
   * every new course object now starts in. It used to be impossible to reach,
   * because an empty course silently became the shipped LLM curriculum; the
   * price of that was every learner on every other subject starting by deleting
   * six modules about tokenizers.
   */
  if (!active) return <div className={`${styles.courseEmpty} nodrag nowheel`} onClick={(event) => event.stopPropagation()}>
    <strong>{t('subjectTitle')}</strong>
    <input
      value={course.subject}
      disabled={!onEdit}
      placeholder={t('subjectPlaceholder')}
      aria-label={t('subjectTitle')}
      onChange={(event) => onEdit?.({ course: { ...course, subject: event.target.value }, status: event.target.value.trim() ? t('subjectReady') : t('subjectPending') })}
    />
    <p>{t('subjectHint')}</p>
  </div>;
  return <div className={`${styles.courseShell} nodrag nowheel`}>
    <div className={styles.courseSummary}>
      <div><b>{t('progress', { percent: progress.percent })}</b><span>{t('lessonCount', { completed: progress.completed, total: progress.total })}</span></div>
      <div className={styles.courseProgress} role="progressbar" aria-label={t('progressLabel')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><i style={{ width: `${progress.percent}%` }} /></div>
      {/* The knowledge-check score, which now survives closing the card. */}
      <small>{t('duration', { minutes: course.estimatedMinutes })} · {t('checkScore', { percent: score.percent, answered: score.answered, total: score.total })}{score.passed ? ` · ${t('passed', { score: course.passingScore })}` : ''} · {COURSE_EXPORT_STANDARDS.join(' · ')}</small>
    </div>
    <div className={styles.courseWorkspace}>
      <nav aria-label={t('modules')}>
        {course.modules.map((module) => {
          const moduleDone = module.lessons.every((item) => completed.has(item.id));
          return <button key={module.id} type="button" aria-current={module.id === active.id ? 'step' : undefined} onClick={(event) => { event.stopPropagation(); setActiveId(module.id); }}><span>{moduleDone ? '✓' : String(course.modules.indexOf(module) + 1)}</span><b>{module.title.replace(/^\d+\.\s*/, '')}</b></button>;
        })}
      </nav>
      <section>
        <header><small>{t('module')}</small><h3>{active.title}</h3><p>{active.description}</p></header>
        {active.lessons.map((item) => <details key={item.id} open={!completed.has(item.id)}>
          <summary><span>{completed.has(item.id) ? '✓' : '○'}</span><b>{item.title}</b><small>{t('minutes', { count: item.durationMinutes })}</small></summary>
          <div className={styles.courseLesson}><strong>{t('objective')}</strong><MathAwareText text={item.objective} /><MathAwareText text={item.content} /><strong>{t('practice')}</strong><MathAwareText text={item.activity} /><button type="button" disabled={!onEdit} onClick={(event) => { event.stopPropagation(); toggleLesson(item.id); }}>{completed.has(item.id) ? t('markIncomplete') : t('markComplete')}</button></div>
        </details>)}
        {/* The knowledge check is a one-question practice set, run by the SAME
            component the Practice object uses — so the answer is graded once,
            recorded once, and is still there tomorrow. It used to live in
            `useState`, which is why a course could never tell you your score. */}
        <div className={styles.courseQuiz}>
          <strong>{t('knowledgeCheck')}</strong>
          <PracticeRunner
            questions={courseAssessmentQuestions(course).filter((question) => question.id === active.id)}
            attempts={attempts}
            editable={!!onEdit}
            compact
            onRecord={(attempt) => onEdit?.({ attempts: recordPracticeAttempt(attempts, attempt) })}
          />
        </div>
      </section>
    </div>
  </div>;
}
