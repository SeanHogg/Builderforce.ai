import { describe, expect, it } from 'vitest';
import { arithmeticHandler, evaluateExpression } from './arithmetic';

const now = new Date('2026-10-22T12:00:00Z');
const answer = (q: string) => arithmeticHandler.answer(q, now)?.content ?? null;

describe('evaluateExpression', () => {
  it('honours precedence, associativity and parentheses', () => {
    expect(evaluateExpression('2 + 3 * 4')).toBe(14);
    expect(evaluateExpression('(2 + 3) * 4')).toBe(20);
    expect(evaluateExpression('2 ^ 3 ^ 2')).toBe(512);
    expect(evaluateExpression('-2 ^ 2')).toBe(-4);
    expect(evaluateExpression('10 - 4 - 3')).toBe(3);
    expect(evaluateExpression('2 ** 10')).toBe(1024);
    expect(evaluateExpression('1,000 + 24')).toBe(1024);
    expect(evaluateExpression('3 x 4')).toBe(12);
    expect(evaluateExpression('8 ÷ 2 × 3')).toBe(12);
  });

  it('declines anything it is not sure is arithmetic', () => {
    for (const expr of ['42', '-5', '(3)', '2026-10-22', '10/22/2026', '555-1234', '555-123-4567', '1.2.3', '12 34',
      '0x10', '5 / 0', '(2 + 3', '2 +', '10 % 3', '2 ^ 5000', 'two plus two', '']) {
      expect(evaluateExpression(expr), expr).toBeNull();
    }
  });
});

describe('arithmeticHandler', () => {
  it('answers a whole-message expression behind a question phrase', () => {
    expect(answer('What is 12 * (3 + 4)?')).toBe('12 * (3 + 4) = 84');
    expect(answer('calculate 2^10')).toBe('2^10 = 1024');
    expect(answer('0.1 + 0.2 =')).toBe('0.1 + 0.2 = 0.3');
    expect(answer('7 / 2')).toBe('7 / 2 = 3.5');
    expect(answer("what's 15% of 80")).toBe('15% of 80 = 12');
  });

  it('does not answer prose that merely contains numbers', () => {
    for (const q of [
      'What is 2 + 2 in binary?',
      'Is 2 + 2 = 5?',
      'Explain why 0.1 + 0.2 is not 0.3 in JavaScript',
      'Solve x + 2 = 5',
      'refactor the 3 * 4 grid component',
      'what is 10 % 3',
      'what is the date 2026-10-22',
    ]) {
      expect(answer(q), q).toBeNull();
    }
  });
});
