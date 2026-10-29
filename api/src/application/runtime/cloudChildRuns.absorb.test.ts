/**
 * absorbChildWrites: the files a run's descendants committed join the parent's written set —
 * and each is RE-HASHED from its final content on the branch (the read the write/edit tools use),
 * so a fact never anchors to text a child replaced; one that cannot be read drops its hash.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const diff = vi.hoisted(() => vi.fn());
const read = vi.hoisted(() => vi.fn());
vi.mock('../repos/readRepoContents', () => ({ listBranchDiff: diff, readRepoFile: read }));

import { absorbChildWrites } from './cloudChildRuns';
import { sha256Hex } from '../../domain/shared/hash';
import { createRepoReadMemo } from '../repos/repoReadMemo';
import { verifyWrittenFiles } from '../repos/verifyWrittenFiles';

const repoCtx = { branch: 'ticket-5', base: 'main' } as never;
const dbWithChildren = (children: Array<{ id: number }>) =>
  ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => children }) }) }) }) as never;

/** The branch's files by path; anything else is unreadable. */
const branch = (files: Record<string, { content: string; truncated?: boolean }>) =>
  read.mockImplementation(async (_ctx: unknown, path: string) =>
    files[path] ? { ok: true, path, content: files[path]!.content, truncated: files[path]!.truncated ?? false } : { ok: false, reason: 'not found' });

beforeEach(() => { diff.mockReset(); read.mockReset(); });

describe('absorbChildWrites', () => {
  it('adds the child-committed paths and re-hashes each from its final content on the branch', async () => {
    diff.mockResolvedValue({ ok: true, files: [{ path: 'src/a.ts', status: 'modified' }, { path: 'src/child.ts', status: 'added' }], truncated: false });
    branch({ 'src/a.ts': { content: 'child rewrote a' }, 'src/child.ts': { content: 'child file' } });
    const writtenPaths = new Set(['src/a.ts', 'src/own.ts']);
    const writtenHashes = new Map([['src/a.ts', 'parent-hash-a'], ['src/own.ts', 'parent-hash-own']]);
    await absorbChildWrites(dbWithChildren([{ id: 9 }]), 1, 41, repoCtx, writtenPaths, writtenHashes);
    expect([...writtenPaths].sort()).toEqual(['src/a.ts', 'src/child.ts', 'src/own.ts']);
    expect(writtenHashes.get('src/a.ts')).toBe(await sha256Hex('child rewrote a'));
    expect(writtenHashes.get('src/child.ts')).toBe(await sha256Hex('child file'));
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ ref: 'ticket-5' }), 'src/a.ts');
    // A path the branch diff does not list keeps its hash, and is not read.
    expect(writtenHashes.get('src/own.ts')).toBe('parent-hash-own');
    expect(read).not.toHaveBeenCalledWith(expect.anything(), 'src/own.ts');
  });

  it('drops the hash only when the content cannot be read: unreadable, too large, or removed by a child', async () => {
    diff.mockResolvedValue({
      ok: true,
      files: [{ path: 'gone.ts', status: 'removed' }, { path: 'huge.ts', status: 'modified' }, { path: 'lost.ts', status: 'modified' }, { path: 'ok.ts', status: 'modified' }],
      truncated: false,
    });
    branch({ 'huge.ts': { content: 'x', truncated: true }, 'ok.ts': { content: 'fine' } });
    const writtenHashes = new Map([['gone.ts', 'h1'], ['huge.ts', 'h2'], ['lost.ts', 'h3'], ['ok.ts', 'h4']]);
    await absorbChildWrites(dbWithChildren([{ id: 9 }]), 1, 41, repoCtx, new Set(), writtenHashes);
    expect([...writtenHashes.keys()]).toEqual(['ok.ts']);
    expect(writtenHashes.get('ok.ts')).toBe(await sha256Hex('fine'));
  });

  it('reads each path ONCE per finish attempt when re-hashing and verification share the attempt’s memo', async () => {
    diff.mockResolvedValue({ ok: true, files: [{ path: 'src/a.ts', status: 'modified' }, { path: 'cfg/b.json', status: 'added' }, { path: 'docs/c.md', status: 'added' }], truncated: false });
    branch({ 'src/a.ts': { content: 'export const a = 1;\n' }, 'cfg/b.json': { content: '{}' }, 'docs/c.md': { content: '# c' } });
    const attempt = async () => {
      const writtenPaths = new Set<string>();
      const readFile = createRepoReadMemo({ branch: 'ticket-5', ref: 'ticket-5' } as never);
      await absorbChildWrites(dbWithChildren([{ id: 9 }]), 1, 41, repoCtx, writtenPaths, new Map(), readFile);
      await verifyWrittenFiles({ ref: 'ticket-5' } as never, writtenPaths, readFile);
    };
    await attempt();
    expect(read).toHaveBeenCalledTimes(3); // three paths, one read each — not one per consumer (6)
    // The next attempt builds its own memo: the model edits between a blocked finish and the next.
    await attempt();
    expect(read).toHaveBeenCalledTimes(6);
  });

  it('still absorbs the paths when the caller keeps no hashes', async () => {
    diff.mockResolvedValue({ ok: true, files: [{ path: 'src/child.ts' }], truncated: false });
    const writtenPaths = new Set<string>();
    await absorbChildWrites(dbWithChildren([{ id: 9 }]), 1, 41, repoCtx, writtenPaths);
    expect([...writtenPaths]).toEqual(['src/child.ts']);
    expect(read).not.toHaveBeenCalled();
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
