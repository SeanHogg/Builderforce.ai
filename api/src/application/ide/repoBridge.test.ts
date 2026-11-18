/**
 * The push deletes only what the import baseline held and the workspace lost: a file the
 * import skipped (read only in part, past MAX_IMPORT_FILES, unreadable) is never deleted
 * from the repo by the next push.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';

const mocks = vi.hoisted(() => ({
  tree: [] as string[],
  reads: new Map<string, { content: string; truncated: boolean; truncatedReason?: 'size' | 'incomplete' } | null>(),
  deleteFileFromRepo: vi.fn(async () => ({ ok: true })),
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
  resolveRepoCredential: async () => ({
    repo: { id: 'repo-1', projectId: 7, provider: 'github', host: null, owner: 'acme', repo: 'app', defaultBranch: 'main', segmentId: null },
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
      getTree: async () => ({ entries: mocks.tree.map((path) => ({ path, type: 'file' })), truncated: false }),
      getFileContent: async (path: string) => mocks.reads.get(path)?.content ?? null,
      readFile: async (path: string) => mocks.reads.get(path) ?? null,
      getLanguages: async () => ({}),
      listCommits: async () => [],
    }),
  };
});

import { commitWorkspaceToRepo, importRepoToWorkspace } from './repoBridge';
import { baselineKey } from './workspaceRepoBaseline';

/** An in-memory R2 bucket: put / get / list by prefix. */
function memoryBucket() {
  const objects = new Map<string, string>();
  return {
    objects,
    put: async (key: string, value: string) => { objects.set(key, value); },
    get: async (key: string) => (objects.has(key) ? { text: async () => objects.get(key)! } : null),
    delete: async (key: string) => { objects.delete(key); },
    list: async ({ prefix }: { prefix: string }) => ({
      objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })),
      truncated: false,
    }),
  };
}

const deletedPaths = () => (mocks.deleteFileFromRepo.mock.calls as unknown as Array<[{ path: string }]>).map(([input]) => input.path);

beforeEach(() => {
  mocks.tree = [];
  mocks.reads.clear();
  mocks.deleteFileFromRepo.mockClear();
  mocks.commitFileToRepo.mockClear();
});

describe('repoBridge: a push never deletes what the import did not bring in', () => {
  it('regression: a file read only in part is skipped on import and NOT deleted by the next push', async () => {
    mocks.tree = ['src/app.ts', 'src/huge.ts'];
    mocks.reads.set('src/app.ts', { content: 'app', truncated: false });
    mocks.reads.set('src/huge.ts', { content: 'part', truncated: true, truncatedReason: 'incomplete' });
    const bucket = memoryBucket();
    const env = { UPLOADS: bucket } as unknown as Env;

    const imported = await importRepoToWorkspace(env, 1, 7, 'repo-1');
    expect(imported).toMatchObject({ ok: true, imported: 1, truncated: true });
    expect([...bucket.objects.keys()].some((k) => k.endsWith('src/huge.ts'))).toBe(false);
    expect(bucket.objects.has(baselineKey(7))).toBe(true);

    await commitWorkspaceToRepo(env, 1, 7, 'repo-1', {});
    expect(deletedPaths()).not.toContain('src/huge.ts');
    expect(deletedPaths()).toEqual([]);
  });

  it('regression: files past MAX_IMPORT_FILES are not imported and NOT deleted by the next push', async () => {
    mocks.tree = Array.from({ length: 805 }, (_, i) => `f${i}.ts`);
    for (const path of mocks.tree) mocks.reads.set(path, { content: path, truncated: false });
    const bucket = memoryBucket();
    const env = { UPLOADS: bucket } as unknown as Env;

    const imported = await importRepoToWorkspace(env, 1, 7, 'repo-1');
    expect(imported).toMatchObject({ ok: true, imported: 800 });
    await commitWorkspaceToRepo(env, 1, 7, 'repo-1', {});
    expect(deletedPaths()).toEqual([]);
  });

  it('a file imported and then removed from the workspace IS deleted', async () => {
    mocks.tree = ['keep.ts', 'drop.ts'];
    mocks.reads.set('keep.ts', { content: 'k', truncated: false });
    mocks.reads.set('drop.ts', { content: 'd', truncated: false });
    const bucket = memoryBucket();
    const env = { UPLOADS: bucket } as unknown as Env;

    await importRepoToWorkspace(env, 1, 7, 'repo-1');
    const dropKey = [...bucket.objects.keys()].find((k) => k.endsWith('drop.ts'))!;
    await bucket.delete(dropKey);
    await commitWorkspaceToRepo(env, 1, 7, 'repo-1', {});
    expect(deletedPaths()).toEqual(['drop.ts']);
  });

  it('a workspace with no baseline (from before baselines) deletes nothing', async () => {
    mocks.tree = ['a.ts', 'b.ts'];
    const bucket = memoryBucket();
    await bucket.put('ide/projects/7/a.ts', 'a');
    await commitWorkspaceToRepo({ UPLOADS: bucket } as unknown as Env, 1, 7, 'repo-1', {});
    expect(deletedPaths()).toEqual([]);
  });
});
