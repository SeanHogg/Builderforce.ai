import { describe, expect, it } from 'vitest';
import { flattenErrorMessage } from './apiClient';

describe('flattenErrorMessage', () => {
  it('reads flat and nested envelopes without rendering [object Object]', () => {
    expect(flattenErrorMessage({ error: 'nope' })).toBe('nope');
    expect(flattenErrorMessage({ error: { message: 'bad', code: 'X' } })).toBe('bad');
    expect(flattenErrorMessage({ error: 'code_x', message: 'Explained' })).toBe('Explained');
    expect(flattenErrorMessage('x')).toBeUndefined();
  });
});
