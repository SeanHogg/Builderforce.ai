'use client';

/**
 * The inspector half of learning on the canvas: say it at my level, teach me
 * this subject, and give me something to practise.
 *
 * All three are Brain requests plus a little authored state, so they share ONE
 * route back to the model (`onAskBrain`) rather than adding a callback per
 * feature to an inspector that already takes forty. Each control decides its own
 * visibility from the object it is given.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from './CreationCanvas.module.css';
import type { CreationNodeData } from './types';
import { canRelevelCanvasObject } from '@/lib/canvasProse';
import { READING_LEVELS, relevelRequest } from '@/lib/readingLevels';
import { courseFromNode } from '@/lib/courseLms';
import type { CanvasPracticeQuestion } from '@/lib/canvasPractice';

export interface LearningControlProps {
  data: CreationNodeData;
  editable: boolean;
  onChange: (patch: Partial<CreationNodeData>) => void;
  onAskBrain: (request: string) => void;
}

/**
 * "Say this at my level" — on every object whose body is prose.
 *
 * Which kinds those are is read off the registry (see `canRelevelCanvasObject`),
 * so a document, a note, a report, a PRD and next year's prose kind are all
 * covered without a list here that could fall behind.
 */
export function ReadingLevelControl({ data, editable, onAskBrain }: Omit<LearningControlProps, 'onChange'>) {
  const t = useTranslations('creationCanvas.readingLevel');
  const [level, setLevel] = useState<string>('simple');
  if (!canRelevelCanvasObject(data)) return null;
  return <section className={styles.learningControl} aria-label={t('title')}>
    <label>{t('title')}<select value={level} onChange={(event) => setLevel(event.target.value)}>
      {READING_LEVELS.map((option) => <option key={option.id} value={option.id}>{t(option.id)}</option>)}
    </select></label>
    <button type="button" className={styles.fullButton} disabled={!editable} onClick={() => onAskBrain(relevelRequest(data.title, data.kind, level))}>{t('action')}</button>
    <p className={styles.inspectorHint}>{t('hint')}</p>
  </section>;
}

/** A course knows its subject; Brain writes the modules, lessons and checks. */
export function CourseSubjectControl({ data, editable, onChange, onAskBrain }: LearningControlProps) {
  const t = useTranslations('creationCanvas.course');
  if (data.kind !== 'course') return null;
  const course = courseFromNode(data);
  const written = course.modules.length > 0;
  return <section className={styles.learningControl} aria-label={t('subjectTitle')}>
    <label>{t('subjectTitle')}<input
      value={course.subject}
      disabled={!editable}
      placeholder={t('subjectPlaceholder')}
      onChange={(event) => onChange({ course: { ...course, subject: event.target.value } })}
    /></label>
    <button
      type="button"
      className={styles.fullButton}
      disabled={!editable || !course.subject.trim()}
      onClick={() => onAskBrain(
        `Write a complete course about "${course.subject}" into the course object "${data.title}" on this canvas. `
        + 'Author real teaching content: 4-6 modules, each with 2-3 lessons carrying an objective, an explanation a learner can actually learn from, and a practice activity, '
        + 'plus one multiple-choice knowledge check per module with the correct answer marked and an explanation. '
        + `${written ? 'Replace the modules that are there now. ' : ''}Use canvas_update_object on the existing object; do not create a second course.`,
      )}
    >{written ? t('rewriteAction') : t('writeAction')}</button>
    <p className={styles.inspectorHint}>{t('subjectHint')}</p>
  </section>;
}

/**
 * Practice authoring: make my own cards, or have Brain make them from something
 * already on the board.
 *
 * The attempt record is never touched here — it belongs to the learner, not to
 * whoever is editing the questions.
 */
export function PracticeAuthoring({ data, editable, onChange, onAskBrain }: LearningControlProps) {
  const t = useTranslations('creationCanvas.practice');
  const [topic, setTopic] = useState('');
  if (data.kind !== 'practice') return null;
  /* The RAW authored list, not `practiceQuestions()`. The normalizer drops a
     question that cannot yet be graded, which is exactly what a question looks
     like one keystroke after "Add question" — reading through it here would
     delete every card as it was being typed. The runner normalizes for STUDY;
     the editor edits what was written. */
  const questions: CanvasPracticeQuestion[] = Array.isArray(data.questions) ? data.questions as CanvasPracticeQuestion[] : [];

  const write = (next: CanvasPracticeQuestion[]) => onChange({ questions: next, status: t('statusCount', { count: next.length }) });
  const update = (index: number, patch: Partial<CanvasPracticeQuestion>) => write(questions.map((question, at) => at === index ? { ...question, ...patch } : question));
  /** Choices, one per line, `*` marking the right one — the fastest way to type
   * a multiple-choice question that exists, and the same convention every
   * teacher's answer key already uses. */
  const choiceText = (question: CanvasPracticeQuestion) => (question.choices ?? []).map((choice, index) => `${index === question.answerIndex ? '*' : ''}${choice}`).join('\n');
  const parseChoices = (value: string): Partial<CanvasPracticeQuestion> => {
    const lines = value.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return { choices: undefined, answerIndex: undefined };
    const answerIndex = Math.max(0, lines.findIndex((line) => line.startsWith('*')));
    return { choices: lines.map((line) => line.replace(/^\*/, '').trim()), answerIndex };
  };

  return <section className={styles.learningControl} aria-label={t('authoringTitle')}>
    <label>{t('topic')}<input value={topic} disabled={!editable} placeholder={t('topicPlaceholder')} onChange={(event) => setTopic(event.target.value)} /></label>
    <button
      type="button"
      className={styles.fullButton}
      disabled={!editable || !topic.trim()}
      onClick={() => onAskBrain(
        `Write practice questions about "${topic}" into the practice object "${data.title}" on this canvas. `
        + 'Ground them in the objects connected to it where there are any. Write 8-12 questions in the `questions` field, each with an id, a prompt, four choices, '
        + 'answerIndex pointing at the correct one, and a one-sentence explanation of WHY it is correct. '
        + 'Use canvas_update_object on the existing object; never write the attempts field.',
      )}
    >{t('generate')}</button>

    {questions.map((question, index) => <div key={question.id} className={styles.practiceEditor}>
      <label>{t('questionLabel', { number: index + 1 })}<input value={question.prompt} disabled={!editable} onChange={(event) => update(index, { prompt: event.target.value })} /></label>
      <label>{t('choicesLabel')}<textarea rows={3} value={choiceText(question)} disabled={!editable} placeholder={t('choicesPlaceholder')} onChange={(event) => update(index, parseChoices(event.target.value))} /></label>
      <label>{t('answerLabel')}<input value={question.answerText ?? ''} disabled={!editable} placeholder={t('answerPlaceholder')} onChange={(event) => update(index, { answerText: event.target.value })} /></label>
      <button type="button" disabled={!editable} onClick={() => write(questions.filter((_, at) => at !== index))}>{t('removeQuestion')}</button>
    </div>)}

    <button
      type="button"
      className={styles.fullButton}
      disabled={!editable}
      onClick={() => write([...questions, { id: `q${questions.length + 1}-${Date.now().toString(36)}`, prompt: '', answerText: '' }])}
    >{t('addQuestion')}</button>
    <p className={styles.inspectorHint}>{t('authoringHint')}</p>
  </section>;
}
