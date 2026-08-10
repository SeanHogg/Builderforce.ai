import { describe, expect, it } from 'vitest';
import { answersComplete, defaultInput, questionIds, type ToolDefinition } from './tools';

const CALCULATOR: ToolDefinition = {
  id: 'ai-cost-estimator', name: 'AI Cost Estimator', tagline: 'What your agents cost.',
  icon: '💰', category: 'finops', kind: 'calculator', about: 'Estimate monthly agent spend.',
  inputs: [
    { id: 'seats', label: 'Seats', type: 'number', default: 10 },
    { id: 'runs', label: 'Runs per day', type: 'number', default: 40 },
  ],
};

const QUESTIONNAIRE: ToolDefinition = {
  id: 'agentic-maturity', name: 'Agentic Maturity', tagline: 'How mature is delivery?',
  icon: '📈', category: 'delivery', kind: 'questionnaire', about: 'Six practices.',
  scale: [{ value: 1, label: 'Never' }, { value: 5, label: 'Always' }],
  sections: [
    { key: 'flow', name: 'Flow', description: '', recommendations: {}, questions: [{ id: 'flow.wip', text: 'WIP is limited' }] },
    { key: 'ci', name: 'CI', description: '', recommendations: {}, questions: [{ id: 'ci.trunk', text: 'Trunk-based' }] },
  ],
};

/**
 * `defaultInput` answers "what should the form start at" and is EMPTY for the
 * answer-based kinds, which have nothing to seed. `questionIds` answers "what
 * may a caller send" — a different question, and the one `canvas_add_diagnostic`
 * needs before it posts a model's answers to `/compute`. Using the first for the
 * second silently accepted every key for a questionnaire and none for a quiz.
 */
describe('questionIds', () => {
  it('lists a calculator\'s inputs', () => {
    expect(questionIds(CALCULATOR)).toEqual(['seats', 'runs']);
  });

  it('flattens a questionnaire across its sections', () => {
    expect(questionIds(QUESTIONNAIRE)).toEqual(['flow.wip', 'ci.trunk']);
    // The distinction that matters: this is exactly where `defaultInput` is empty.
    expect(defaultInput(QUESTIONNAIRE)).toEqual({});
  });

  it('covers every id `answersComplete` requires, so a full answer set is runnable', () => {
    const answers = Object.fromEntries(questionIds(QUESTIONNAIRE).map((id) => [id, 3]));
    expect(answersComplete(QUESTIONNAIRE, answers)).toBe(true);
    expect(answersComplete(QUESTIONNAIRE, {})).toBe(false);
  });
});
