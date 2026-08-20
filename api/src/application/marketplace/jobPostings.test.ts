/**
 * The rules that decide what a posting IS, pinned.
 *
 * `upsertJobPosting` itself needs a database and is exercised through the routes; what is
 * unit-testable — and what actually carries the design decisions of migration 0985 — are
 * the four validators it is built out of. Each test below names the decision it protects,
 * because every one of them is a place where a plausible alternative implementation would
 * be quietly wrong rather than visibly broken.
 */
import { describe, expect, it } from 'vitest';
import {
  BudgetShapeError,
  MAX_SCREENING_QUESTIONS,
  normalizeAttachments,
  normalizeBudget,
  normalizeCategory,
  normalizeScreeningAnswers,
  normalizeScreeningQuestions,
  postingTypeIfStated,
  postingTypeOf,
} from './jobPostings';

describe('normalizeBudget — a total is not a rate', () => {
  it('refuses a whole-job total on hourly work, which the DB check also refuses', () => {
    expect(() => normalizeBudget({ engagementType: 'hourly', budgetTotalCents: 600000 }))
      .toThrow(BudgetShapeError);
  });

  it('accepts a total on fixed-price work, and on work whose shape was never stated', () => {
    expect(normalizeBudget({ engagementType: 'fixed_bid', budgetTotalCents: 600000 }).budgetTotalCents).toBe(600000);
    expect(normalizeBudget({ engagementType: null, budgetTotalCents: 600000 }).budgetTotalCents).toBe(600000);
  });

  it('keeps the hourly band and the total as SEPARATE quantities', () => {
    const budget = normalizeBudget({ engagementType: 'hourly', rateMinCents: 8000, rateMaxCents: 12000 });
    expect(budget).toEqual({ rateMinCents: 8000, rateMaxCents: 12000, budgetTotalCents: null });
  });

  it('rights a band whose ends are the wrong way round — a slip, not an intention', () => {
    const budget = normalizeBudget({ engagementType: 'hourly', rateMinCents: 12000, rateMaxCents: 8000 });
    expect(budget.rateMinCents).toBe(8000);
    expect(budget.rateMaxCents).toBe(12000);
  });

  it('reads an unusable number as "not stated" rather than losing the whole posting', () => {
    expect(normalizeBudget({ engagementType: 'fixed_bid', rateMinCents: 'lots', budgetTotalCents: -5 }))
      .toEqual({ rateMinCents: null, rateMaxCents: null, budgetTotalCents: null });
  });

  it('distinguishes blank from zero: blank is "not stated", zero is a stated zero', () => {
    expect(normalizeBudget({ engagementType: 'fixed_bid', budgetTotalCents: '' }).budgetTotalCents).toBeNull();
    expect(normalizeBudget({ engagementType: 'fixed_bid', budgetTotalCents: 0 }).budgetTotalCents).toBe(0);
  });
});

describe('normalizeCategory — a specialty is only meaningful under its parent', () => {
  it('keeps a leaf that belongs to the discipline being written', () => {
    expect(normalizeCategory('dba', 'postgres')).toEqual({ discipline: 'dba', specialty: 'postgres' });
  });

  it('DROPS an orphan rather than storing it in a branch the browse tree cannot surface', () => {
    expect(normalizeCategory('designer', 'postgres')).toEqual({ discipline: 'designer', specialty: null });
    expect(normalizeCategory(null, 'postgres')).toEqual({ discipline: null, specialty: null });
  });

  it('refuses a discipline outside the closed vocabulary', () => {
    expect(normalizeCategory('astronaut', 'frontend')).toEqual({ discipline: null, specialty: null });
  });
});

describe('normalizeScreeningQuestions — ids are what hold answers to questions', () => {
  it('PRESERVES a supplied id, so editing the wording never orphans the answers given', () => {
    const [question] = normalizeScreeningQuestions([{ id: 'q1', prompt: 'Rewritten wording', type: 'text' }]);
    expect(question?.id).toBe('q1');
    expect(question?.prompt).toBe('Rewritten wording');
  });

  it('mints an id for a new question, and for a DUPLICATE one — two questions must not share an answer', () => {
    const questions = normalizeScreeningQuestions([
      { id: 'q1', prompt: 'First' },
      { id: 'q1', prompt: 'Second' },
    ]);
    expect(questions).toHaveLength(2);
    expect(questions[0]?.id).toBe('q1');
    expect(questions[1]?.id).not.toBe('q1');
  });

  it('drops a question with no prompt, defaults the type, and defaults required to false', () => {
    const questions = normalizeScreeningQuestions([{ prompt: '   ' }, { prompt: 'Real', type: 'nonsense' }]);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({ prompt: 'Real', type: 'text', required: false });
  });

  it('is a READ validator too: unreadable JSONB degrades to "asks nothing", never a crash', () => {
    expect(normalizeScreeningQuestions('not json')).toEqual([]);
    expect(normalizeScreeningQuestions(null)).toEqual([]);
    expect(normalizeScreeningQuestions([null, 7, 'x'])).toEqual([]);
  });

  it('is bounded — a screening form past the cap is an application form', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ prompt: `Q${i}` }));
    expect(normalizeScreeningQuestions(many)).toHaveLength(MAX_SCREENING_QUESTIONS);
  });
});

describe('normalizeScreeningAnswers — the prompt is frozen INTO the answer', () => {
  const questions = normalizeScreeningQuestions([
    { id: 'q1', prompt: 'Years of Rust?', type: 'number', required: true },
    { id: 'q2', prompt: 'Timezone?', type: 'text', required: false },
  ]);

  it('copies the prompt from the CURRENT question, not from the request', () => {
    const { answers } = normalizeScreeningAnswers(
      [{ questionId: 'q1', prompt: 'A question nobody asked', answer: '6' }],
      questions,
    );
    expect(answers[0]).toEqual({ questionId: 'q1', prompt: 'Years of Rust?', answer: '6' });
  });

  it('reports a blank REQUIRED answer by naming the question, not as "invalid"', () => {
    const { answers, missingRequired } = normalizeScreeningAnswers([{ questionId: 'q2', answer: 'UTC+1' }], questions);
    expect(missingRequired).toEqual(['Years of Rust?']);
    expect(answers).toHaveLength(1);
  });

  it('DROPS an answer to a question that no longer exists — it keys onto nothing', () => {
    const { answers } = normalizeScreeningAnswers([{ questionId: 'gone', answer: 'x' }], questions);
    expect(answers).toEqual([]);
  });

  it('orders answers by the QUESTIONS, whatever order the client sent them in', () => {
    const { answers } = normalizeScreeningAnswers([
      { questionId: 'q2', answer: 'UTC+1' },
      { questionId: 'q1', answer: '6' },
    ], questions);
    expect(answers.map((a) => a.questionId)).toEqual(['q1', 'q2']);
  });

  it('asks nothing of a posting with no questions', () => {
    expect(normalizeScreeningAnswers([{ questionId: 'q1', answer: '6' }], [])).toEqual({ answers: [], missingRequired: [] });
  });
});

describe('normalizeAttachments — metadata pointing at bytes, never bytes', () => {
  it('requires a key, and fills a missing name and a nonsense size', () => {
    const attachments = normalizeAttachments([
      { key: 'job-attachments/1/a/x.pdf', size: -3 },
      { name: 'no key here' },
    ]);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ key: 'job-attachments/1/a/x.pdf', name: 'attachment', size: 0 });
    expect(attachments[0]?.id).toBeTruthy();
  });

  it('degrades an unreadable column to an empty list', () => {
    expect(normalizeAttachments('{}')).toEqual([]);
  });
});

describe('postingTypeOf / postingTypeIfStated', () => {
  it('"not mentioned" and "reset to the default" are opposite instructions', () => {
    expect(postingTypeOf(undefined)).toBe('project_bid');
    expect(postingTypeOf(undefined, 'design')).toBe('design');
    expect(postingTypeIfStated(undefined)).toBeNull();
    expect(postingTypeIfStated('design')).toBe('design');
    expect(postingTypeIfStated('sculpture')).toBeNull();
  });
});
