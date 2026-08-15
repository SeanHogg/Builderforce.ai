import { describe, expect, it } from 'vitest';
import { FORM_FIELD_TYPES } from '@builderforce/creation-canvas-contract';
import { readQuestions } from './formPublishing';

/**
 * `readQuestions` is the only thing standing between a JSONB column and a
 * stranger's browser, so it is tested as the boundary it is. Every case below is
 * a shape an older writer, a model, or a hand-edited row could put in that column.
 */
describe('reading a published form’s questions', () => {
  it('accepts every declared field type and nothing else', () => {
    const declared = FORM_FIELD_TYPES.map((type, i) => ({
      id: `q${i}`,
      type,
      label: `Question ${i}`,
      // select/multiSelect are refused without options — supplied for all, ignored
      // by the rest, which is what the contract says `options` is for.
      options: ['a', 'b'],
    }));
    expect(readQuestions(declared)).toHaveLength(FORM_FIELD_TYPES.length);
    expect(readQuestions([{ id: 'x', type: 'signature', label: 'Sign here' }])).toEqual([]);
  });

  it('drops an unknown type rather than degrading it to a text box', () => {
    // A control that silently changes what it collects is worse than a question
    // that is missing: the responder answers something nobody asked.
    expect(readQuestions([{ id: 'a', type: 'file', label: 'Upload your CV' }])).toEqual([]);
  });

  it('refuses a select with no options, which renders a control nobody can answer', () => {
    expect(readQuestions([{ id: 'a', type: 'select', label: 'Pick one' }])).toEqual([]);
    expect(readQuestions([{ id: 'a', type: 'multiSelect', label: 'Pick some', options: [] }])).toEqual([]);
    expect(readQuestions([{ id: 'a', type: 'select', label: 'Pick one', options: ['x'] }])).toHaveLength(1);
  });

  it('refuses a question with no label', () => {
    expect(readQuestions([{ id: 'a', type: 'shortText', label: '   ' }])).toEqual([]);
  });

  it('gives an unnamed question a positional id so answers still key to something', () => {
    const [first, second] = readQuestions([
      { type: 'shortText', label: 'Name' },
      { type: 'email', label: 'Email' },
    ]);
    expect(first?.id).toBe('q1');
    expect(second?.id).toBe('q2');
  });

  it('clamps a scale to a range a control can actually draw', () => {
    expect(readQuestions([{ id: 'a', type: 'scale', label: 'How likely?', max: 500 }])[0]?.max).toBe(10);
    expect(readQuestions([{ id: 'a', type: 'scale', label: 'How likely?', max: 0 }])[0]?.max).toBe(2);
  });

  it('survives anything at all in the column', () => {
    expect(readQuestions(null)).toEqual([]);
    expect(readQuestions('[]')).toEqual([]);
    expect(readQuestions([null, 42, 'question', { label: 'no type' }])).toEqual([]);
  });

  it('bounds the set, because a form is rendered to an unauthenticated browser', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ id: `q${i}`, type: 'shortText', label: `Q${i}` }));
    expect(readQuestions(many).length).toBeLessThanOrEqual(60);
  });

  it('keeps `required` only when it is actually true', () => {
    expect(readQuestions([{ id: 'a', type: 'shortText', label: 'A', required: false }])[0]).not.toHaveProperty('required');
    expect(readQuestions([{ id: 'a', type: 'shortText', label: 'A', required: true }])[0]?.required).toBe(true);
  });
});
