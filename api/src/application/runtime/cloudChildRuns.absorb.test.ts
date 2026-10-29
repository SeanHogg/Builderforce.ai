/**
 * absorbChildWrites: the files a run's descendants committed join the parent's written set —
 * and the parent's own hash for any of them goes, so a fact never anchors to text a child replaced.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const diff = vi.hoisted(() => vi.fn());
vi.mock('../repos/readRepoContents', () => ({ listBranchDiff: diff }));

import { absorbChildWrites } from './cloudChildRuns';

const repoCtx = { branch: 'ticket-5', base: 'main' } as never;
const dbWithChildren = (children: Array<{ id: number }>) =>
  ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => children }) }) }) }) as never;

beforeEach(() => diff.mockReset());

describe('absorbChildWrites', () => {
  it('adds the child-committed paths and drops the parent’s stale hash for each', async () => {
    diff.mockResolvedValue({ ok: true, files: [{ path: 'src/a.ts' }, { path: 'src/child.ts' }], truncated: false });
    const writtenPaths = new Set(['src/a.ts', 'src/own.ts']);
    const writtenHashes = new Map([['src/a.ts', 'parent-hash-a'], ['src/own.ts', 'parent-hash-own']]);
    await absorbChildWrites(dbWithChildren([{ id: 9 }]), 1, 41, repoCtx, writtenPaths, writtenHashes);
    expect([...writtenPaths].sort()).toEqual(['src/a.ts', 'src/child.ts', 'src/own.ts']);
    expect(writtenHashes.has('src/a.ts')).toBe(false);
    expect(writtenHashes.has('src/child.ts')).toBe(false);
    // A path the branch diff does not list keeps its hash.
    expect(writtenHashes.get('src/own.ts')).toBe('parent-hash-own');
  });

  it('still absorbs the paths when the caller keeps no hashes', async () => {
    diff.mockResolvedValue({ ok: true, files: [{ path: 'src/child.ts' }], truncated: false });
    const writtenPaths = new Set<string>();
    await absorbChildWrites(dbWithChildren([{ id: 9 }]), 1, 41, repoCtx, writtenPaths);
    expect([...writtenPaths]).toEqual(['src/child.ts']);
  });

  it('touches nothing for a run with no children, or when the diff cannot be read', async () => {
    const writtenPaths = new Set(['src/own.ts']);
    const writtenHashes = new Map([['src/own.ts', 'h']]);
    await absorbChildWrites(dbWithChildren([]), 1, 41, repoCtx, writtenPaths, writtenHashes);
    expect(diff).not.toHaveBeenCalled();
    diff.mockResolvedValue({ ok: false, reason: 'compare request failed (network)' });
    await absorbChildWrites(dbWithChildren([{ id: 9 }]), 1, 41, repoCtx, writtenPaths, writtenHashes);
    expect([...writtenPaths]).toEqual(['src/own.ts']);
    expect(writtenHashes.get('src/own.ts')).toBe('h');
  });

  it('does nothing without a repo', async () => {
    const writtenHashes = new Map([['a', 'h']]);
    await absorbChildWrites(dbWithChildren([{ id: 9 }]), 1, 41, null, new Set(['a']), writtenHashes);
    expect(writtenHashes.size).toBe(1);
  });
});
