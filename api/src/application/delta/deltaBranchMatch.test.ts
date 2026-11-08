import { describe, expect, it, vi } from 'vitest';
import { isBaseBranch, isLongLivedBranch, normalizeBranch, ticketIdsOnBranch } from './deltaBranchMatch';

/** A Drizzle-shaped chain: every builder method returns the chain, awaiting it yields `rows`. */
function chainDb(rows: Array<{ id: number }>) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'selectDistinct', 'from', 'where']) chain[m] = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return chain as unknown as Parameters<typeof ticketIdsOnBranch>[0] & { selectDistinct: ReturnType<typeof vi.fn> };
}

const SCOPE = { repoId: 'repo-1', isProjectDefault: true, allDefaultBranches: [] as string[] };

describe('normalizeBranch / isBaseBranch', () => {
  it('strips refs/heads and whitespace; empty is null', () => {
    expect(normalizeBranch(' refs/heads/feature/x ')).toBe('feature/x');
    expect(normalizeBranch('')).toBeNull();
    expect(normalizeBranch(null)).toBeNull();
  });

  it('treats main, master and the repo default as bases', () => {
    expect(isBaseBranch('main')).toBe(true);
    expect(isBaseBranch('master')).toBe(true);
    expect(isBaseBranch('dev')).toBe(false);
    expect(isBaseBranch('dev', 'dev')).toBe(true);
  });

  it('accepts the default branches of several repos', () => {
    expect(isBaseBranch('next', ['main', 'next'])).toBe(true);
    expect(isBaseBranch('feature/x', ['main', 'next'])).toBe(false);
  });

  it('treats develop and release/* style branches as long-lived bases', () => {
    for (const b of ['develop', 'development', 'staging', 'release/2026.11', 'releases/1.x', 'hotfix/1.2']) {
      expect(isLongLivedBranch(b)).toBe(true);
      expect(isBaseBranch(b)).toBe(true);
    }
    expect(isLongLivedBranch('release')).toBe(false);
    expect(isLongLivedBranch('feature/release-notes')).toBe(false);
  });
});

describe('ticketIdsOnBranch', () => {
  it('returns the tickets recorded on a work branch in ONE query', async () => {
    const db = chainDb([{ id: 11 }, { id: 12 }]);
    expect(await ticketIdsOnBranch(db, 1, 2, 'refs/heads/agent/quick-fix', null, SCOPE)).toEqual([11, 12]);
    expect(db.selectDistinct).toHaveBeenCalledTimes(1);
  });

  it('a repo whose default is dev does not match a ticket recorded on dev', async () => {
    const db = chainDb([{ id: 5 }]);
    expect(await ticketIdsOnBranch(db, 1, 2, 'dev', 'dev', SCOPE)).toEqual([]);
    expect(db.selectDistinct).not.toHaveBeenCalled();
  });

  it('never queries for a base branch, ANOTHER repo\'s default, a long-lived branch or an empty name', async () => {
    const db = chainDb([{ id: 99 }]);
    expect(await ticketIdsOnBranch(db, 1, 2, 'main', null, SCOPE)).toEqual([]);
    expect(await ticketIdsOnBranch(db, 1, 2, 'dev', 'dev', SCOPE)).toEqual([]);
    expect(await ticketIdsOnBranch(db, 1, 2, 'next', 'main', { ...SCOPE, allDefaultBranches: ['main', 'next'] })).toEqual([]);
    expect(await ticketIdsOnBranch(db, 1, 2, 'develop', null, SCOPE)).toEqual([]);
    expect(await ticketIdsOnBranch(db, 1, 2, 'release/2026.11', null, SCOPE)).toEqual([]);
    expect(await ticketIdsOnBranch(db, 1, 2, null, null, SCOPE)).toEqual([]);
    expect(db.selectDistinct).not.toHaveBeenCalled();
  });
});
