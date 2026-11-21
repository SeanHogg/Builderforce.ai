import { describe, expect, it } from 'vitest';
import { normalizeRepoPath } from './repoPath';

describe('normalizeRepoPath', () => {
  it('strips leading ./ and /, collapses repeated slashes, converts backslashes', () => {
    expect(normalizeRepoPath('./src//a.ts')).toBe('src/a.ts');
    expect(normalizeRepoPath('src\\b.ts')).toBe('src/b.ts');
    expect(normalizeRepoPath('/src/c.ts')).toBe('src/c.ts');
    expect(normalizeRepoPath('  ./././d.ts ')).toBe('d.ts');
  });

  it('resolves . and .. segments', () => {
    expect(normalizeRepoPath('a/./b/../c')).toBe('a/c');
    expect(normalizeRepoPath('docs/specs/../ROADMAP.md')).toBe('docs/ROADMAP.md');
  });

  it('keeps a .. that climbs above the root', () => {
    expect(normalizeRepoPath('../x.md')).toBe('../x.md');
    expect(normalizeRepoPath('a/../../x.md')).toBe('../x.md');
  });
});
