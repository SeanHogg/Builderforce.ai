/** The IDE import's baseline record (POST /api/repos/repositories/:id/import-baseline). */
import { describe, expect, it } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import { recordRepoImportBaseline } from './recordRepoImportBaseline';
import { baselineKey, readRepoBaseline } from './workspaceRepoBaseline';

/** A db whose tenant-scoped repo lookup returns `rows`. */
function dbReturning(rows: Array<{ projectId: number | null }>): Db {
  const chain = { select: () => chain, from: () => chain, where: async () => rows };
  return chain as unknown as Db;
}

function memoryBucket() {
  const objects = new Map<string, string>();
  return {
    objects,
    put: async (key: string, value: string) => { objects.set(key, value); },
    get: async (key: string) => (objects.has(key) ? { text: async () => objects.get(key)! } : null),
    delete: async (key: string) => { objects.delete(key); },
  };
}

describe('recordRepoImportBaseline', () => {
  it("another tenant's repo (no row for this tenant) is 404", async () => {
    expect(await recordRepoImportBaseline(dbReturning([]), memoryBucket(), 1, 'repo-x', ['a.ts'])).toEqual({ ok: false, status: 404, error: 'Repository not found' });
  });

  it('a repo bound to no project is 400', async () => {
    expect(await recordRepoImportBaseline(dbReturning([{ projectId: null }]), memoryBucket(), 1, 'repo-1', ['a.ts']))
      .toMatchObject({ ok: false, status: 400 });
  });

  it('no storage is 503', async () => {
    expect(await recordRepoImportBaseline(dbReturning([{ projectId: 7 }]), undefined, 1, 'repo-1', ['a.ts'])).toMatchObject({ ok: false, status: 503 });
  });

  it('unions with the prior baseline, keyed by the repo', async () => {
    const bucket = memoryBucket();
    await bucket.put(baselineKey(7, 'repo-1'), JSON.stringify({ paths: ['old.ts'] }));
    expect(await recordRepoImportBaseline(dbReturning([{ projectId: 7 }]), bucket, 1, 'repo-1', ['a.ts', 'b.ts']))
      .toEqual({ ok: true, recorded: 2, stored: true });
    const baseline = await readRepoBaseline(bucket, 7, 'repo-1');
    expect(baseline.state === 'ok' ? [...baseline.paths].sort() : baseline).toEqual(['a.ts', 'b.ts', 'old.ts']);
    expect((await readRepoBaseline(bucket, 7, 'repo-2')).state).toBe('missing');
  });
});
