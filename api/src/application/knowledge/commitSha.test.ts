import { describe, expect, it } from 'vitest';
import { COMMIT_SHA_PATTERN, commitShaOf } from './commitSha';

// The SAME table as the editor's `COMMIT_SHA` test (clients/vscode/src/knowledge/sourcePortAt.test.ts): one shape, 7-64 hex.
const OK = ['abc1234', 'ABC1234', 'a'.repeat(40), 'a'.repeat(64)];
const BAD = ['', 'abc123', 'a'.repeat(65), 'HEAD', 'main', 'HEAD~1', 'abc1234..def5678', '--output=x', '-abc1234', 'abc1234\n', 'abc1234 ', 'abc123g'];

describe('commitSha (parity table with the editor\'s COMMIT_SHA)', () => {
  it('accepts only 7-64 hex', () => {
    for (const ok of OK) expect(COMMIT_SHA_PATTERN.test(ok)).toBe(true);
    for (const bad of BAD) expect(COMMIT_SHA_PATTERN.test(bad)).toBe(false);
  });

  it('commitShaOf lower-cases a sha and answers undefined for anything else, including a non-string', () => {
    for (const ok of OK) expect(commitShaOf(ok)).toBe(ok.toLowerCase());
    for (const bad of BAD) expect(commitShaOf(bad)).toBeUndefined();
    for (const bad of [undefined, null, 5, {}, ['abc1234']]) expect(commitShaOf(bad)).toBeUndefined();
  });
});
