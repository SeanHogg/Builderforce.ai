/**
 * Cloud/board runs against a Brain project (no git) must write the IDE
 * workspace — not dump the deliverable in the finish summary.
 */
import { describe, it, expect } from 'vitest';
import type { Db } from '../../../infrastructure/database/connection';
import type { Env } from '../../../env';
import { writeWorkspaceFile, readWorkspaceFile } from '../../ide/workspaceStore';
import {
  codingTargetToolingLine,
  describeWorkspaceBlock,
  deleteIdeWorkspaceFile,
  editIdeWorkspaceFile,
  listIdeWorkspaceFiles,
  readIdeWorkspaceFile,
  resolveIdeWorkspaceForRun,
  searchIdeWorkspace,
  snapshotIdeWorkspace,
  workspaceSourceRef,
  writeIdeWorkspaceFile,
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

describe('IDE workspace file ops', () => {
  it('lists, reads, searches, writes, edits and deletes against R2', async () => {
    const r2 = fakeR2();
    const bucket = asBucket(r2);
    await writeWorkspaceFile(bucket, 34, 'src/App.jsx', 'export const App = () => 1;\n');
    await writeWorkspaceFile(bucket, 34, 'README.md', '# hi\n');

    const listed = await listIdeWorkspaceFiles(bucket, 34, 'src');
    expect(listed.ok).toBe(true);
    expect(listed.paths).toEqual(['src/App.jsx']);

    const globbed = await listIdeWorkspaceFiles(bucket, 34, undefined, '*.md');
    expect(globbed.paths).toEqual(['README.md']);

    const read = await readIdeWorkspaceFile(bucket, 34, 'src/App.jsx');
    expect(read).toEqual({ ok: true, path: 'src/App.jsx', content: 'export const App = () => 1;\n' });
    expect((await readIdeWorkspaceFile(bucket, 34, 'missing.ts')).ok).toBe(false);

    const found = await searchIdeWorkspace(bucket, 34, 'export const App');
    expect(found.ok).toBe(true);
    expect(found.matches?.map((m) => m.path)).toEqual(['src/App.jsx']);

    const db = fakeDb([]);
    const run = { bucket, projectId: 34, projectName: 'Brain App' };
    const created = await writeIdeWorkspaceFile(db, run, {
      tenantId: 1, taskId: 7, executionId: 9, agent: 'coder',
      path: 'src/added.js', content: 'export const a = 1;\n',
    });
    expect(created.ok).toBe(true);
    expect(created.change).toBe('created');
    expect(await readWorkspaceFile(bucket, 34, 'src/added.js')).toBe('export const a = 1;\n');

    const edited = await editIdeWorkspaceFile(db, run, {
      tenantId: 1, taskId: 7, executionId: 9, agent: 'coder',
      path: 'src/added.js', oldString: 'a = 1', newString: 'a = 2',
    });
    expect(edited.ok).toBe(true);
    expect(await readWorkspaceFile(bucket, 34, 'src/added.js')).toBe('export const a = 2;\n');

    const deleted = await deleteIdeWorkspaceFile(db, run, {
      tenantId: 1, taskId: 7, executionId: 9, agent: 'coder', path: 'src/added.js',
    });
    expect(deleted.ok).toBe(true);
    expect(deleted.deleted).toBe(true);
    expect(await readWorkspaceFile(bucket, 34, 'src/added.js')).toBeNull();
  });

  it('refuses a traversal write instead of dumping it into R2', async () => {
    const r2 = fakeR2();
    const result = await writeIdeWorkspaceFile(fakeDb([]), { bucket: asBucket(r2), projectId: 34, projectName: 'X' }, {
      tenantId: 1, taskId: 7, executionId: 9, agent: 'coder',
      path: '../../etc/passwd', content: 'x',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/traversal/i);
    expect(r2.store.size).toBe(0);
  });
});

describe('resolveIdeWorkspaceForRun / snapshotIdeWorkspace', () => {
  it('returns null when R2 is not configured', async () => {
    expect(await resolveIdeWorkspaceForRun({} as Env, fakeDb([]), 1, 7)).toBeNull();
  });

  it('resolves the task workspace and snapshots its tree', async () => {
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
    expect(snap.ide.projectName).toBe('Plain');
  });
});
