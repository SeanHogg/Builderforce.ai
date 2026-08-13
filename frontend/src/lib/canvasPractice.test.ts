import { describe, expect, it } from 'vitest';
import {
  isPracticeResponseCorrect, nextPracticeQuestion, practiceAttempts, practiceProgress,
  practiceQuestions, recordPracticeAttempt, type CanvasPracticeAttempt,
} from './canvasPractice';

const QUESTIONS = [
  { id: 'a', prompt: 'Which organelle photosynthesises?', choices: ['Mitochondria', 'Chloroplast'], answerIndex: 1, explanation: 'Chloroplasts hold the chlorophyll.' },
  { id: 'b', prompt: 'What gas is released?', choices: ['Oxygen', 'Nitrogen'], answerIndex: 0 },
  { id: 'c', prompt: 'Define a chloroplast', answerText: 'The organelle where photosynthesis happens' },
];

const attempt = (questionId: string, correct: boolean, at: string): CanvasPracticeAttempt => ({ questionId, correct, at });

describe('practice questions', () => {
  it('keeps questions that can be graded and drops the ones that cannot', () => {
    const parsed = practiceQuestions([
      ...QUESTIONS,
      { id: 'empty', prompt: '   ' },
      { id: 'no-answer', prompt: 'Unanswerable', choices: ['one', 'two'] },
    ]);
    expect(parsed.map((question) => question.id)).toEqual(['a', 'b', 'c']);
  });

  it('reads a model-authored question that used `question` and `answer`', () => {
    const [parsed] = practiceQuestions([{ question: 'Capital of France?', choices: ['Lyon', 'Paris'], answer: 1 }]);
    expect(parsed).toMatchObject({ prompt: 'Capital of France?', answerIndex: 1 });
  });

  it('grades a choice and a typed answer through one rule', () => {
    expect(isPracticeResponseCorrect(QUESTIONS[0]!, 1)).toBe(true);
    expect(isPracticeResponseCorrect(QUESTIONS[0]!, 0)).toBe(false);
    expect(isPracticeResponseCorrect(QUESTIONS[2]!, ' The organelle where photosynthesis happens ')).toBe(true);
  });
});

describe('practice progress', () => {
  it('counts mastery as a streak, not as ever having been right', () => {
    const attempts = [
      attempt('a', true, '2026-08-13T10:00:00.000Z'),
      attempt('a', false, '2026-08-13T10:05:00.000Z'),
      attempt('b', true, '2026-08-13T10:06:00.000Z'),
      attempt('b', true, '2026-08-13T10:07:00.000Z'),
    ];
    const progress = practiceProgress(QUESTIONS, attempts);
    expect(progress.answered).toBe(2);
    expect(progress.mastered).toBe(1);
    expect(progress.weak).toBe(1);
    expect(progress.accuracy).toBe(75);
    expect(progress.byQuestion.get('a')?.streak).toBe(0);
  });

  it('ignores attempts at a question that has since been rewritten away', () => {
    const progress = practiceProgress(QUESTIONS, [attempt('gone', true, '2026-08-13T10:00:00.000Z')]);
    expect(progress.answered).toBe(0);
    expect(progress.accuracy).toBe(0);
  });

  it('keeps the attempt log bounded and append-only', () => {
    const many = Array.from({ length: 520 }, (_, index) => attempt('a', true, `2026-08-13T10:${String(index % 60).padStart(2, '0')}:00.000Z`));
    const recorded = many.reduce<CanvasPracticeAttempt[]>((log, entry) => recordPracticeAttempt(log, entry), []);
    expect(recorded).toHaveLength(500);
    expect(practiceAttempts(recorded)).toHaveLength(500);
  });
});

describe('what to ask next', () => {
  it('asks an unseen question before anything already answered', () => {
    const attempts = [attempt('a', true, '2026-08-13T10:00:00.000Z'), attempt('b', false, '2026-08-13T10:01:00.000Z')];
    expect(nextPracticeQuestion(QUESTIONS, attempts)?.id).toBe('c');
  });

  it('brings back the one that was missed before the ones that were right', () => {
    const attempts = [
      attempt('a', true, '2026-08-13T10:00:00.000Z'), attempt('a', true, '2026-08-13T10:01:00.000Z'),
      attempt('b', false, '2026-08-13T10:02:00.000Z'),
      attempt('c', true, '2026-08-13T10:03:00.000Z'),
    ];
    expect(nextPracticeQuestion(QUESTIONS, attempts)?.id).toBe('b');
  });

  it('does not ask the same question twice in a row while others remain', () => {
    const attempts = [attempt('b', false, '2026-08-13T10:02:00.000Z')];
    expect(nextPracticeQuestion(QUESTIONS, attempts, 'a')?.id).not.toBe('a');
  });

  it('has nothing to ask when there are no questions', () => {
    expect(nextPracticeQuestion([], [])).toBeNull();
  });
});
