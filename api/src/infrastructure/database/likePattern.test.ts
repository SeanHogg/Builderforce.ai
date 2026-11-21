import { describe, expect, it } from 'vitest';
import { escapeLikePattern } from './likePattern';

describe('escapeLikePattern', () => {
  it('escapes LIKE wildcards and the escape character itself', () => {
    expect(escapeLikePattern('100%_done\\x')).toBe('100\\%\\_done\\\\x');
    expect(escapeLikePattern('[QA] plain')).toBe('[QA] plain');
  });
});
