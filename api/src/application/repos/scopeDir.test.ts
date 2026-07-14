import { describe, it, expect } from 'vitest';
import { normalizeScopeDir, isUnderScopeDir } from '@builderforce/agent-tools';

// The ONE shared scope-dir helpers every capability provider (cloud GitHub-API,
// on-prem ripgrep, VS Code walk) uses so subdirectory scoping can't drift between them.

describe('normalizeScopeDir', () => {
  it('strips leading ./ and surrounding slashes, normalizes back-slashes', () => {
    expect(normalizeScopeDir('./src/board/')).toBe('src/board');
    expect(normalizeScopeDir('/src/board')).toBe('src/board');
    expect(normalizeScopeDir('src\\board')).toBe('src/board');
    expect(normalizeScopeDir('  frontend/src  ')).toBe('frontend/src');
  });

  it('returns "" for blank/absent (no scope)', () => {
    expect(normalizeScopeDir(undefined)).toBe('');
    expect(normalizeScopeDir(null)).toBe('');
    expect(normalizeScopeDir('   ')).toBe('');
    expect(normalizeScopeDir('./')).toBe('');
  });
});

describe('isUnderScopeDir', () => {
  it('matches the dir itself and anything beneath it', () => {
    expect(isUnderScopeDir('src/board', 'src/board')).toBe(true);
    expect(isUnderScopeDir('src/board/x.ts', 'src/board')).toBe(true);
    expect(isUnderScopeDir('src\\board\\x.ts', 'src/board')).toBe(true);
  });

  it('does NOT match a sibling that merely shares a prefix', () => {
    expect(isUnderScopeDir('src/boardroom/x.ts', 'src/board')).toBe(false);
    expect(isUnderScopeDir('src/other.ts', 'src/board')).toBe(false);
  });

  it('an empty scope matches every path (no scope)', () => {
    expect(isUnderScopeDir('anything/at/all.ts', '')).toBe(true);
  });
});
