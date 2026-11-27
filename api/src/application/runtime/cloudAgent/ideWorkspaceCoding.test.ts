/**
 * Cloud/board runs against a Brain project (no git) must write the IDE
 * workspace — not dump the deliverable in the finish summary.
 *
 * The file tools over that workspace (list / read / search / write / edit / delete) are the shared
 * coding provider on `ide/r2WorkspaceFs.ts`, tested in `ide/r2WorkspaceFs.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import type { Db } from '../../../infrastructure/database/connection';
import type { Env } from '../../../env';
import { writeWorkspaceFile } from '../../ide/workspaceStore';
import {
  codingTargetToolingLine,
  describeWorkspaceBlock,
  resolveIdeWorkspaceForRun,
  snapshotIdeWorkspace,
  workspaceSourceRef,
} from './ideWorkspaceCoding';

function fakeR2() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      if (!store.has(key)) return null;
      const value = store.get(key)!;
      return { text: async () => value, body: value };
    },
    async put(key: string, value: string) { store.set(key, value); },
    async delete(key: string) { store.delete(key); },
    async list({ prefix }: { prefix: string }) {
      return {
        objects: [...store.entries()]
          .filter(([k]) => k.startsWith(prefix))
          .map(([key, v]) => ({ key, size: v.length })),
      };
    },
  };
}
const asBucket = (r2: ReturnType<typeof fakeR2>) => r2 as unknown as R2Bucket;

function fakeDb(rowsInOrder: unknown[][]): Db {
  let call = 0;
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => rowsInOrder[call++] ?? [],
    then: undefined,
  } as unknown as Record<string, unknown>;
  return {
    select: () => chain,
    insert: () => ({ values: async () => undefined }),
  } as unknown as Db;
}

describe('describeWorkspaceBlock / codingTargetToolingLine', () => {
  it('tells the model to WRITE the IDE workspace, not dump prose', () => {
    const view = {
      repo: null,
      ide: { projectId: 34, projectName: 'Brain App' },
      topLevel: ['src/', 'package.json'],
      fileCount: 4,
      truncated: false,
    };
    const block = describeWorkspaceBlock(view);
    expect(block).toContain('IDE workspace');
    expect(block).toContain('Brain App');
    expect(block).toContain('write_file');
    expect(block).not.toMatch(/no files to edit/i);
    expect(block).not.toMatch(/return the complete deliverable in your final summary/i);

    const line = codingTargetToolingLine(view);
    expect(line).toContain('Write files into the IDE workspace');
    expect(line).not.toMatch(/return the complete deliverable/i);

    expect(workspaceSourceRef(view)).toBe('workspace:Brain App');
  });

  it('keeps the git prompt when a repo IS bound', () => {
    const view = {
      repo: { owner: 'acme', repo: 'web', base: 'main' },
      topLevel: ['src/'],
      fileCount: 12,
      truncated: false,
    };
    expect(describeWorkspaceBlock(view)).toContain('acme/web');
    expect(codingTargetToolingLine(view)).not.toContain('IDE workspace');
    expect(workspaceSourceRef(view)).toBe('acme/web');
  });

  it('falls back to prose only when neither git nor workspace is bound', () => {
    const view = { repo: null, reason: 'no repo bound to this task', topLevel: [], fileCount: 0, truncated: false };
    expect(describeWorkspaceBlock(view)).toMatch(/no files to edit/i);
    expect(codingTargetToolingLine(view)).toMatch(/no repository and no IDE workspace/i);
    expect(workspaceSourceRef(view)).toBe('unbound workspace');
  });
});

describe('resolveIdeWorkspaceForRun / snapshotIdeWorkspace', () => {
  it('returns null when R2 is not configured', async () => {
    expect(await resolveIdeWorkspaceForRun({} as Env, fakeDb([]), 1, 7)).toBeNull();
  });

  it('has-workspace: resolves even with no git repoId, falling back to the project itself', async () => {
    const r2 = fakeR2();
    const env = { UPLOADS: asBucket(r2) } as Env;
    await writeWorkspaceFile(env.UPLOADS!, 5, 'src/index.js', 'ok');
    const db = fakeDb([
      [{ projectId: 5 }],
      [{ id: 5, name: 'Plain' }],
      [],
    ]);
    const run = await resolveIdeWorkspaceForRun(env, db, 42, 7);
    expect(run).toMatchObject({ projectId: 5, projectName: 'Plain' });
    const snap = await snapshotIdeWorkspace(run!);
    expect(snap.fileCount).toBe(1);
    expect(snap.topLevel).toEqual(['src/']);
    expect(snap.truncated).toBe(false);
    expect(snap.ide.projectName).toBe('Plain');
  });

  it('has-workspace: prefers the IDE child storage project when one is bound (still no git)', async () => {
    const r2 = fakeR2();
    const env = { UPLOADS: asBucket(r2) } as Env;
    await writeWorkspaceFile(env.UPLOADS!, 34, 'src/App.jsx', 'export const App = () => 1;\n');
    const db = fakeDb([
      [{ projectId: 5 }],
      [{ id: 5, name: 'Container' }],
      [{ storageProjectId: 34, name: 'Brain App' }],
    ]);
    const run = await resolveIdeWorkspaceForRun(env, db, 42, 7);
    expect(run).toMatchObject({ projectId: 34, projectName: 'Brain App' });
    expect(run?.bucket).toBe(env.UPLOADS);
    const snap = await snapshotIdeWorkspace(run!);
    expect(snap.ide).toEqual({ projectId: 34, projectName: 'Brain App' });
    expect(snap.topLevel).toEqual(['src/']);
  });

  it('no-workspace: returns null when the task/project is gone even if R2 is configured', async () => {
    const env = { UPLOADS: asBucket(fakeR2()) } as Env;
    expect(await resolveIdeWorkspaceForRun(env, fakeDb([[]]), 42, 7)).toBeNull();
  });

  it('marks the snapshot truncated when more than 40 top-level entries exist', async () => {
    const r2 = fakeR2();
    const bucket = asBucket(r2);
    for (let i = 0; i < 41; i++) {
      await writeWorkspaceFile(bucket, 9, `f${String(i).padStart(2, '0')}.js`, 'export const x = 1;\n');
    }
    const snap = await snapshotIdeWorkspace({ bucket, projectId: 9, projectName: 'Wide' });
    expect(snap.fileCount).toBe(41);
    expect(snap.topLevel).toHaveLength(40);
    expect(snap.truncated).toBe(true);
  });
});
