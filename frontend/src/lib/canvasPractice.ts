/**
 * Practice — the one model for "answer a question, find out, try again".
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * The canvas could present questions and could not record answering them. A
 * Course rendered one knowledge check per module and held the chosen answer in
 * `useState`, so closing the card forgot it: no score, no history of what was
 * got wrong, and nothing that could say what still needs work. A study loop that
 * cannot remember the last attempt is a quiz you take once and learn nothing from.
 *
 * Attempts therefore live in the OBJECT (canvas objects are already persisted
 * documents, so this needs no table), and the recall order is derived from them
 * rather than stored — one fact in one place.
 *
 * Deliberately NOT model-writable: `attempts` is absent from the registry's
 * mutable fields for every kind. It is the learner's record of what they
 * actually did, and an LLM patch that could rewrite it could report mastery
 * nobody demonstrated.
 */

export const PRACTICE_MODES = ['quiz', 'flashcards'] as const;
export type CanvasPracticeMode = (typeof PRACTICE_MODES)[number];

export interface CanvasPracticeQuestion {
  id: string;
  prompt: string;
  /** Present ⇒ multiple choice. Absent ⇒ self-graded recall (flashcard). */
  choices?: string[];
  /** Index into {@link choices}. */
  answerIndex?: number;
  /** The answer text, for a flashcard or a short-answer question. */
  answerText?: string;
  explanation?: string;
  hint?: string;
}

export interface CanvasPracticeAttempt {
  /** The question this attempt answers. */
  questionId: string;
  at: string;
  correct: boolean;
  /** Which choice was picked, when the question had choices. */
  chosen?: number;
}

/** How many attempts an object keeps. Long enough to show a real trend, short
 * enough that a board object stays a document rather than a log. */
const MAX_ATTEMPTS = 500;
const MAX_QUESTIONS = 200;
const MAX_CHOICES = 8;

/** Two correct answers in a row. One correct answer is a coin flip on a
 * four-choice question; two is the cheapest evidence that is not. */
export const MASTERY_STREAK = 2;

function text(value: unknown, limit = 4_000): string {
  return typeof value === 'string' ? value.slice(0, limit) : '';
}

/** Read a question list off anything — an authored patch, a stored object, an
 * import — dropping whatever cannot be answered. */
export function practiceQuestions(value: unknown): CanvasPracticeQuestion[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_QUESTIONS).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const raw = entry as Record<string, unknown>;
    const prompt = text(raw.prompt) || text(raw.question);
    if (!prompt.trim()) return [];
    const choices = Array.isArray(raw.choices)
      ? raw.choices.slice(0, MAX_CHOICES).map((choice) => text(choice, 400)).filter((choice) => choice.trim().length > 0)
      : [];
    const answerIndex = Number(raw.answerIndex ?? raw.answer);
    const answerText = text(raw.answerText) || (typeof raw.answer === 'string' ? text(raw.answer) : '');
    const question: CanvasPracticeQuestion = {
      id: text(raw.id, 120).trim() || `q${index + 1}`,
      prompt,
      ...(choices.length > 1 ? { choices } : {}),
      ...(choices.length > 1 && Number.isInteger(answerIndex) && answerIndex >= 0 && answerIndex < choices.length ? { answerIndex } : {}),
      ...(answerText.trim() ? { answerText } : {}),
      ...(text(raw.explanation) ? { explanation: text(raw.explanation) } : {}),
      ...(text(raw.hint) ? { hint: text(raw.hint) } : {}),
    };
    // A question with neither a correct choice nor an answer cannot be practised
    // — it would grade every response the same way.
    if (question.answerIndex == null && !question.answerText) return [];
    return [question];
  });
}

export function practiceAttempts(value: unknown): CanvasPracticeAttempt[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_ATTEMPTS).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const raw = entry as Record<string, unknown>;
    const questionId = text(raw.questionId, 120).trim();
    if (!questionId) return [];
    const chosen = Number(raw.chosen);
    return [{
      questionId,
      at: text(raw.at, 40) || new Date(0).toISOString(),
      correct: raw.correct === true,
      ...(Number.isInteger(chosen) && chosen >= 0 ? { chosen } : {}),
    }];
  });
}

export function practiceMode(value: unknown): CanvasPracticeMode {
  return PRACTICE_MODES.includes(value as CanvasPracticeMode) ? value as CanvasPracticeMode : 'quiz';
}

export function recordPracticeAttempt(
  attempts: readonly CanvasPracticeAttempt[],
  attempt: CanvasPracticeAttempt,
): CanvasPracticeAttempt[] {
  return [...attempts, attempt].slice(-MAX_ATTEMPTS);
}

/** Is this response right? The one grader, so the card, the score and the
 * recall order can never disagree about what counts as correct. */
export function isPracticeResponseCorrect(question: CanvasPracticeQuestion, chosen: number | string): boolean {
  if (typeof chosen === 'number') return question.answerIndex === chosen;
  const expected = question.answerText?.trim().toLowerCase();
  if (!expected) return false;
  return chosen.trim().toLowerCase() === expected;
}

export interface PracticeQuestionRecord {
  attempts: number;
  correct: number;
  /** Correct answers at the END of the history — the streak mastery is judged on. */
  streak: number;
  lastCorrect: boolean | null;
  lastAt: string | null;
}

export interface PracticeProgress {
  total: number;
  /** Questions answered at least once. */
  answered: number;
  /** Questions with a {@link MASTERY_STREAK}-long run of correct answers. */
  mastered: number;
  /** Answered, but the last answer was wrong — this is the study list. */
  weak: number;
  /** Percent of all attempts that were correct, 0 when nothing was attempted. */
  accuracy: number;
  percent: number;
  byQuestion: Map<string, PracticeQuestionRecord>;
}

export function practiceProgress(
  questions: readonly CanvasPracticeQuestion[],
  attempts: readonly CanvasPracticeAttempt[],
): PracticeProgress {
  const byQuestion = new Map<string, PracticeQuestionRecord>(
    questions.map((question) => [question.id, { attempts: 0, correct: 0, streak: 0, lastCorrect: null, lastAt: null }]),
  );
  let totalAttempts = 0;
  let totalCorrect = 0;
  for (const attempt of attempts) {
    const record = byQuestion.get(attempt.questionId);
    if (!record) continue; // an attempt at a question that has since been rewritten
    record.attempts += 1;
    record.lastCorrect = attempt.correct;
    record.lastAt = attempt.at;
    record.streak = attempt.correct ? record.streak + 1 : 0;
    if (attempt.correct) record.correct += 1;
    totalAttempts += 1;
    if (attempt.correct) totalCorrect += 1;
  }
  const records = [...byQuestion.values()];
  const mastered = records.filter((record) => record.streak >= MASTERY_STREAK).length;
  return {
    total: questions.length,
    answered: records.filter((record) => record.attempts > 0).length,
    mastered,
    weak: records.filter((record) => record.lastCorrect === false).length,
    accuracy: totalAttempts ? Math.round(totalCorrect / totalAttempts * 100) : 0,
    percent: questions.length ? Math.round(mastered / questions.length * 100) : 0,
    byQuestion,
  };
}

/**
 * What to ask next — spaced repetition, reduced to the part that earns its keep.
 *
 * Never seen beats got-it-wrong beats seen-once beats mastered, and within a
 * tier the least recently seen comes first. That is the whole of what makes a
 * practice set feel like studying rather than re-reading: the questions you keep
 * missing keep coming back, and the ones you have proved twice get out of the way.
 */
export function nextPracticeQuestion(
  questions: readonly CanvasPracticeQuestion[],
  attempts: readonly CanvasPracticeAttempt[],
  exceptId?: string,
): CanvasPracticeQuestion | null {
  if (!questions.length) return null;
  const { byQuestion } = practiceProgress(questions, attempts);
  const pool = questions.length > 1 && exceptId ? questions.filter((question) => question.id !== exceptId) : questions;
  const tier = (question: CanvasPracticeQuestion): number => {
    const record = byQuestion.get(question.id);
    if (!record || record.attempts === 0) return 0;
    if (record.lastCorrect === false) return 1;
    if (record.streak >= MASTERY_STREAK) return 3;
    return 2;
  };
  return [...pool].sort((a, b) => {
    const byTier = tier(a) - tier(b);
    if (byTier !== 0) return byTier;
    const lastA = byQuestion.get(a.id)?.lastAt ?? '';
    const lastB = byQuestion.get(b.id)?.lastAt ?? '';
    return lastA.localeCompare(lastB);
  })[0] ?? null;
}
