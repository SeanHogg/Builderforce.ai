/**
 * The push deletes only what THIS repo's import baseline held and the workspace lost: a
 * file the import skipped (read only in part, past MAX_IMPORT_FILES, unreadable) is never
 * deleted from the repo by the next push, nor is another repo's file.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';

const mocks = vi.hoisted(() => ({
  tree: [] as string[],
  treeFails: false,
  reads: new Map<string, { content: string; truncated: boolean; truncatedReason?: 'size' | 'incomplete' } | null>(),
  deleteFails: new Set<string>(),
  deleteFileFromRepo: vi.fn(async (input: { path: string }) => ({ ok: !mocks.deleteFails.has(input.path) })),
  commitFileToRepo: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../../infrastructure/database/connection', () => {
  const chain: Record<string, unknown> = {};
  for (const name of ['update', 'set', 'where', 'insert', 'values', 'select', 'from']) chain[name] = () => chain;
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve([]);
  (chain as { catch: unknown }).catch = () => Promise.resolve();
  return { buildDatabase: () => chain };
});
vi.mock('../integrations/integrationCredentialSecret', () => ({ integrationCredentialSecret: () => 'secret' }));
vi.mock('../repos/resolveRepoCredential', () => ({
  isResolveError: () => false,
  resolveRepoCredential: async (_db: unknown, _secret: string, _tenantId: number, repoId: string) => ({
    repo: { id: repoId, projectId: 7, provider: 'github', host: null, owner: 'acme', repo: repoId, defaultBranch: 'main', segmentId: null },
    token: 't',
  }),
}));
vi.mock('../repos/commitFileToRepo', () => ({ commitFileToRepo: mocks.commitFileToRepo, deleteFileFromRepo: mocks.deleteFileFromRepo }));
vi.mock('../repos/createPullRequest', () => ({ createPullRequest: async () => ({ ok: false }) }));
vi.mock('../repos/sources/RepoSource', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../repos/sources/RepoSource')>();
  return {
    ...actual,
    createRepoSource: () => ({
      getDefaultBranch: async () => 'main',
      getTree: async () => {
        if (mocks.treeFails) throw new Error('tree unavailable');
        return { entries: mocks.tree.map((path) => ({ path, type: 'file' })), truncated: false };
      },
      getFileContent: async (path: string) => mocks.reads.get(path)?.content ?? null,
      readFile: async (path: string) => mocks.reads.get(path) ?? null,
      getLanguages: async () => ({}),
      listCommits: async () => [],
    }),
  };
});

import { commitWorkspaceToRepo, importRepoToWorkspace } from './repoBridge';
import { baselineKey, readRepoBaseline } from './workspaceRepoBaseline';

/** An in-memory R2 bucket: put / get / delete / list by prefix; any op can be made to fail. */
function memoryBucket(fail: { get?: boolean; put?: (key: string) => boolean } = {}) {
  const objects = new Map<string, string>();
  return {
    objects,
    put: async (key: string, value: string) => {
      if (fail.put?.(key)) throw new Error('R2 put failed');
      objects.set(key, value);
    },
    get: async (key: string) => {
      if (fail.get && key.includes('repo-baselines')) throw new Error('R2 get failed');
      return objects.has(key) ? { text: async () => objects.get(key)! } : null;
    },
    delete: async (key: string) => { objects.delete(key); },
    list: async ({ prefix }: { prefix: string }) => ({
      objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })),
      truncated: false,
    }),
  };
}

const deletedPaths = () => (mocks.deleteFileFromRepo.mock.calls as unknown as Array<[{ path: string }]>).map(([input]) => input.path);
const envOf = (bucket: ReturnType<typeof memoryBucket>) => ({ UPLOADS: bucket }) as unknown as Env;
const baselineOf = async (bucket: ReturnType<typeof memoryBucket>, repoId = 'repo-1') => {
  const read = await readRepoBaseline(bucket, 7, repoId);
  return read.state === 'ok' ? [...read.paths].sort() : read.state;
};

beforeEach(() => {
  mocks.tree = [];
  mocks.treeFails = false;
  mocks.reads.clear();
  mocks.deleteFails.clear();
  mocks.deleteFileFromRepo.mockClear();
  mocks.commitFileToRepo.mockClear();
});

function repoWith(files: Record<string, string>) {
  mocks.tree = Object.keys(files);
  for (const [path, content] of Object.entries(files)) mocks.reads.set(path, { content, truncated: false });
}

describe('repoBridge: a push never deletes what the import did not bring in', () => {
  it('regression: a file read only in part is skipped on import and NOT deleted by the next push', async () => {
    repoWith({ 'src/app.ts': 'app', 'src/huge.ts': 'part' });
    mocks.reads.set('src/huge.ts', { content: 'part', truncated: true, truncatedReason: 'incomplete' });
    const bucket = memoryBucket();

    const imported = await importRepoToWorkspace(envOf(bucket), 1, 7, 'repo-1');
    expect(imported).toMatchObject({ ok: true, imported: 1, truncated: true });
    expect([...bucket.objects.keys()].some((k) => k.endsWith('src/huge.ts'))).toBe(false);
    expect(bucket.objects.has(baselineKey(7, 'repo-1'))).toBe(true);

    await commitWorkspaceToRepo(envOf(bucket), 1, 7, 'repo-1', {});
    expect(deletedPaths()).toEqual([]);
  });

  it('regression: files past MAX_IMPORT_FILES are not imported and NOT deleted by the next push', async () => {
    repoWith(Object.fromEntries(Array.from({ length: 805 }, (_, i) => [`f${i}.ts`, `f${i}`])));
    const bucket = memoryBucket();
    expect(await importRepoToWorkspace(envOf(bucket), 1, 7, 'repo-1')).toMatchObject({ ok: true, imported: 800 });
    await commitWorkspaceToRepo(envOf(bucket), 1, 7, 'repo-1', {});
    expect(deletedPaths()).toEqual([]);
  });

  it('a file imported and then removed from the workspace IS deleted; the push rewrites the baseline', async () => {
    repoWith({ 'keep.ts': 'k', 'drop.ts': 'd' });
    const bucket = memoryBucket();
    await importRepoToWorkspace(envOf(bucket), 1, 7, 'repo-1');
    await bucket.delete('ide/projects/7/drop.ts');
    await bucket.put('ide/projects/7/new.ts', 'n');
    await commitWorkspaceToRepo(envOf(bucket), 1, 7, 'repo-1', {});
    expect(deletedPaths()).toEqual(['drop.ts']);
    expect(await baselineOf(bucket)).toEqual(['keep.ts', 'new.ts']);
  });

  it('a delete that fails stays in the baseline and is retried by the next push', async () => {
    repoWith({ 'keep.ts': 'k', 'drop.ts': 'd' });
    const bucket = memoryBucket();
    await importRepoToWorkspace(envOf(bucket), 1, 7, 'repo-1');
    await bucket.delete('ide/projects/7/drop.ts');
    mocks.deleteFails.add('drop.ts');
    await commitWorkspaceToRepo(envOf(bucket), 1, 7, 'repo-1', {});
    expect(await baselineOf(bucket)).toEqual(['drop.ts', 'keep.ts']);
    mocks.deleteFails.clear();
    mocks.deleteFileFromRepo.mockClear();
    await commitWorkspaceToRepo(envOf(bucket), 1, 7, 'repo-1', {});
    expect(deletedPaths()).toEqual(['drop.ts']);
    expect(await baselineOf(bucket)).toEqual(['keep.ts']);
  });

  it('a baseline path no longer on base is not deleted, and leaves the baseline', async () => {
    repoWith({ 'keep.ts': 'k', 'moved.ts': 'm' });
    const bucket = memoryBucket();
    await importRepoToWorkspace(envOf(bucket), 1, 7, 'repo-1');
    await bucket.delete('ide/projects/7/moved.ts');
    mocks.tree = ['keep.ts']; // someone else already removed it on base
    await commitWorkspaceToRepo(envOf(bucket), 1, 7, 'repo-1', {});
    expect(deletedPaths()).toEqual([]);
    expect(await baselineOf(bucket)).toEqual(['keep.ts']);
  });

  it('secret and binary baseline paths are never deleted', async () => {
    mocks.tree = ['a.ts', '.env', 'logo.png'];
    const bucket = memoryBucket();
    await bucket.put('ide/projects/7/a.ts', 'a');
    await bucket.put(baselineKey(7, 'repo-1'), JSON.stringify({ paths: ['a.ts', '.env', 'logo.png'] }));
    await commitWorkspaceToRepo(envOf(bucket), 1, 7, 'repo-1', {});
    expect(deletedPaths()).toEqual([]);
  });

  it('an unreadable base tree deletes nothing and keeps every gone path pending', async () => {
    repoWith({ 'keep.ts': 'k', 'drop.ts': 'd' });
    const bucket = memoryBucket();
    await importRepoToWorkspace(envOf(bucket), 1, 7, 'repo-1');
    await bucket.delete('ide/projects/7/drop.ts');
    mocks.treeFails = true;
    expect(await commitWorkspaceToRepo(envOf(bucket), 1, 7, 'repo-1', {})).toMatchObject({ ok: true, deleted: 0 });
    expect(await baselineOf(bucket)).toEqual(['drop.ts', 'keep.ts']);
  });

  it('a workspace with no baseline (from before baselines) deletes nothing', async () => {
    mocks.tree = ['a.ts', 'b.ts'];
    const bucket = memoryBucket();
    await bucket.put('ide/projects/7/a.ts', 'a');
    await commitWorkspaceToRepo(envOf(bucket), 1, 7, 'repo-1', {});
    expect(deletedPaths()).toEqual([]);
  });

  it('two repos in one project: repo A\'s import never makes a push to repo B delete anything', async () => {
    repoWith({ 'a.ts': 'a', 'shared.ts': 's' });
    const bucket = memoryBucket();
    await importRepoToWorkspace(envOf(bucket), 1, 7, 'repo-a');
    await bucket.delete('ide/projects/7/shared.ts');
    await commitWorkspaceToRepo(envOf(bucket), 1, 7, 'repo-b', {});
    expect(deletedPaths()).toEqual([]);
    expect(await baselineOf(bucket, 'repo-a')).toEqual(['a.ts', 'shared.ts']);
  });
});

describe('repoBridge: R2 baseline failures are never fatal', () => {
  it('an unreadable baseline: the push deletes nothing and does NOT rewrite it (pending deletes survive)', async () => {
    repoWith({ 'keep.ts': 'k', 'drop.ts': 'd' });
    const bucket = memoryBucket();
    await bucket.put('ide/projects/7/keep.ts', 'k');
    await bucket.put(baselineKey(7, 'repo-1'), '{ not json');
    expect(await commitWorkspaceToRepo(envOf(bucket), 1, 7, 'repo-1', {})).toMatchObject({ ok: true, deleted: 0 });
    expect(deletedPaths()).toEqual([]);
    expect(bucket.objects.get(baselineKey(7, 'repo-1'))).toBe('{ not json');
  });

  it('an R2 get failure on the baseline: the push still lands, deleting nothing', async () => {
    repoWith({ 'keep.ts': 'k' });
    const bucket = memoryBucket({ get: true });
    await bucket.put('ide/projects/7/keep.ts', 'k');
    expect(await commitWorkspaceToRepo(envOf(bucket), 1, 7, 'repo-1', {})).toMatchObject({ ok: true, committed: 1, deleted: 0 });
  });

  it('an R2 put failure on the baseline: the import and the push still succeed', async () => {
    repoWith({ 'keep.ts': 'k' });
    const bucket = memoryBucket({ put: (key) => key.includes('repo-baselines') });
    expect(await importRepoToWorkspace(envOf(bucket), 1, 7, 'repo-1')).toMatchObject({ ok: true, imported: 1 });
    expect(await commitWorkspaceToRepo(envOf(bucket), 1, 7, 'repo-1', {})).toMatchObject({ ok: true, committed: 1 });
  });

  it('an import does not overwrite an unreadable baseline', async () => {
    repoWith({ 'keep.ts': 'k' });
    const bucket = memoryBucket();
    await bucket.put(baselineKey(7, 'repo-1'), '{ not json');
    await importRepoToWorkspace(envOf(bucket), 1, 7, 'repo-1');
    expect(bucket.objects.get(baselineKey(7, 'repo-1'))).toBe('{ not json');
  });
});
