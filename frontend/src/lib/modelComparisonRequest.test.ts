import { describe, expect, it } from 'vitest';
import { appendModelComparison, modelComparisonCanvasHref, readModelComparison } from './modelComparisonRequest';

describe('model comparison request', () => {
  it('deduplicates and caps selected models', () => {
    const params = new URLSearchParams('compare=1&model=a&model=b&model=a&model=c&model=d');
    expect(readModelComparison(params)).toEqual(['a', 'b', 'c']);
  });

  it('only creates an executable comparison with at least two models', () => {
    expect(appendModelComparison(new URLSearchParams({ prompt: 'hello' }), ['a']).toString()).toBe('prompt=hello');
    expect(modelComparisonCanvasHref('session-1', ['a', 'b'])).toBe('/create/session-1?compare=1&model=a&model=b');
  });
});
