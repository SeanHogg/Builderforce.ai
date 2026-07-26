import { describe, expect, it } from 'vitest';
import {
  REPO_ROOT,
  conflictKeysFor,
  coordinationScopeKey,
  findBlockingLease,
  isLeaseLive,
  normalizeResourcePath,
  resourceKeyFor,
  type LeaseLike,
} from './resourceKey';

const NOW = new Date('2026-07-26T12:00:00Z');
const lease = (over: Partial<LeaseLike> = {}): LeaseLike => ({
  resourceKey: 'repo:acme/web:src/app.ts',
  mode: 'exclusive',
  executionId: 1,
  expiresAt: new Date(NOW.getTime() + 60_000),
  releasedAt: null,
  ...over,
});

describe('normalizeResourcePath', () => {
  it('folds every spelling of one file onto one key', () => {
    const keys = ['src/app.ts', './src/app.ts', '/src/app.ts', 'src//app.ts', ' src/app.ts '].map(normalizeResourcePath);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('src/app.ts');
  });

  it('treats repo / . / / / empty as the whole tree', () => {
    for (const raw of ['repo', 'REPO', '.', '/', '', '   ', '*']) expect(normalizeResourcePath(raw)).toBe(REPO_ROOT);
  });

  it('drops traversal segments so a key can never escape the repo', () => {
    expect(normalizeResourcePath('../../etc/passwd')).toBe('etc/passwd');
    expect(normalizeResourcePath('src/../secrets')).toBe('src/secrets');
  });

  it('strips a trailing slash so a directory has one identity', () => {
    expect(normalizeResourcePath('src/api/')).toBe(normalizeResourcePath('src/api'));
  });
});

describe('resourceKeyFor', () => {
  it('is case-insensitive on the repo slug (one host repo = one lock)', () => {
    expect(resourceKeyFor('Acme/Web', 'src/a.ts')).toBe(resourceKeyFor('acme/web', 'src/a.ts'));
  });

  it('separates the same path in different repos', () => {
    expect(resourceKeyFor('acme/web', 'src/a.ts')).not.toBe(resourceKeyFor('acme/api', 'src/a.ts'));
  });

  it('falls back to a stable slug when no repo is bound', () => {
    expect(resourceKeyFor('', 'src/a.ts')).toBe('repo:unbound:src/a.ts');
  });
});

describe('conflictKeysFor', () => {
  it('enumerates the file then every ancestor then the root, most specific first', () => {
    expect(conflictKeysFor('acme/web', 'src/api/routes.ts')).toEqual([
      'repo:acme/web:src/api/routes.ts',
      'repo:acme/web:src/api',
      'repo:acme/web:src',
      'repo:acme/web:*',
    ]);
  });

  it('reduces to just the root for a whole-repo claim', () => {
    expect(conflictKeysFor('acme/web', 'repo')).toEqual(['repo:acme/web:*']);
  });

  it('makes a repo-root lease block a nested file (containment)', () => {
    expect(conflictKeysFor('acme/web', 'src/a.ts')).toContain(resourceKeyFor('acme/web', REPO_ROOT));
  });

  it('makes a directory lease block a file inside it', () => {
    expect(conflictKeysFor('acme/web', 'src/api/routes.ts')).toContain(resourceKeyFor('acme/web', 'src/api'));
  });
});

describe('isLeaseLive', () => {
  it('is false once released', () => {
    expect(isLeaseLive(lease({ releasedAt: NOW }), NOW)).toBe(false);
  });

  it('is false once expired, so a dead run cannot wedge a path forever', () => {
    expect(isLeaseLive(lease({ expiresAt: new Date(NOW.getTime() - 1) }), NOW)).toBe(false);
  });

  it('is true while held and unexpired', () => {
    expect(isLeaseLive(lease(), NOW)).toBe(true);
  });
});

describe('findBlockingLease', () => {
  it('never blocks the holder itself (re-claim is a renewal)', () => {
    expect(findBlockingLease([lease({ executionId: 7 })], 7, 'exclusive', NOW)).toBeNull();
  });

  it('blocks a different run', () => {
    expect(findBlockingLease([lease({ executionId: 7 })], 9, 'exclusive', NOW)?.executionId).toBe(7);
  });

  it('lets two shared readers coexist', () => {
    expect(findBlockingLease([lease({ executionId: 7, mode: 'shared' })], 9, 'shared', NOW)).toBeNull();
  });

  it('blocks an exclusive claim against a shared holder', () => {
    expect(findBlockingLease([lease({ executionId: 7, mode: 'shared' })], 9, 'exclusive', NOW)).not.toBeNull();
  });

  it('blocks a shared claim against an exclusive holder', () => {
    expect(findBlockingLease([lease({ executionId: 7, mode: 'exclusive' })], 9, 'shared', NOW)).not.toBeNull();
  });

  it('ignores expired and released leases', () => {
    const stale = [
      lease({ executionId: 7, expiresAt: new Date(NOW.getTime() - 1) }),
      lease({ executionId: 8, releasedAt: NOW }),
    ];
    expect(findBlockingLease(stale, 9, 'exclusive', NOW)).toBeNull();
  });

  it('treats an anonymous claimant as never self-matching', () => {
    expect(findBlockingLease([lease({ executionId: null })], null, 'exclusive', NOW)).not.toBeNull();
  });
});

describe('coordinationScopeKey', () => {
  it('gives one ticket one blackboard', () => {
    expect(coordinationScopeKey(42)).toBe('ticket:42');
    expect(coordinationScopeKey(42)).not.toBe(coordinationScopeKey(43));
  });
});
