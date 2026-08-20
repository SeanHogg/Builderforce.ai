/**
 * The IDE workspace as a repo-less run's WORKING TREE.
 *
 * A project created from the Brain has no connected git repo, so a board
 * dispatch used to degrade to reasoning-only. These pin the two facts that make
 * the workspace path a real substitute: the run writes into the prefix the IDE
 * actually opens (the IDE child's storage project, not its container), and an
 * agent write is held to the SAME path/content contract the editor is held to,
 * with rejections reported rather than swallowed.
 */
import { describe, it, expect } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import { applyTaskWorkspaceChanges, readTaskWorkspaceTree, resolveTaskWorkspaceTarget } from './taskWorkspaceTarget';
import { readWorkspaceFile, writeWorkspaceFile } from './workspaceStore';

/** In-memory R2 stand-in covering the surface the store uses. */
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

/**
 * Fake Db serving the three reads `resolveTaskWorkspaceTarget` makes, in order:
 * the task, its project, then the project's IDE child.
 */
function fakeDb(rowsInOrder: unknown[][]): Db {
  let call = 0;
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => rowsInOrder[call++] ?? [],
    then: undefined,
  } as unknown as Record<string, unknown>;
  return { select: () => chain, insert: () => ({ values: async () => undefined }) } as unknown as Db;
}

describe('resolveTaskWorkspaceTarget', () => {
  it('prefers the IDE child\'s storage project — the prefix the Designer actually opens', async () => {
    const db = fakeDb([
      [{ projectId: 5 }],                                          // task
      [{ id: 5, name: 'Container' }],                              // project
      [{ storageProjectId: 34, name: 'Brain App' }],               // ide child
    ]);
    expect(await resolveTaskWorkspaceTarget(db, 42, 7)).toEqual({ projectId: 34, projectName: 'Brain App' });
  });

  it('falls back to the project itself when it backs no IDE project', async () => {
    const db = fakeDb([[{ projectId: 5 }], [{ id: 5, name: 'Plain' }], []]);
    expect(await resolveTaskWorkspaceTarget(db, 42, 7)).toEqual({ projectId: 5, projectName: 'Plain' });
  });

  it('returns null for a task this tenant does not own', async () => {
    expect(await resolveTaskWorkspaceTarget(fakeDb([[]]), 42, 7)).toBeNull();
  });
});

describe('applyTaskWorkspaceChanges', () => {
  it('writes the agent\'s files and records created vs modified honestly', async () => {
    const r2 = fakeR2();
    await writeWorkspaceFile(asBucket(r2), 34, 'src/App.jsx', 'old');
    const db = fakeDb([]);

    const result = await applyTaskWorkspaceChanges(db, asBucket(r2), {
      tenantId: 42, taskId: 7, projectId: 34, executionId: 99, agent: 'implementer',
      changes: {
        writes: [
          { path: 'src/App.jsx', content: 'new' },
          { path: 'src/added.js', content: 'export const a = 1;' },
        ],
        deletes: ['gone.txt'],
      },
    });

    expect(result.written).toBe(2);
    expect(result.deleted).toBe(1);
    expect(result.rejected).toEqual([]);
    expect(await readWorkspaceFile(asBucket(r2), 34, 'src/App.jsx')).toBe('new');
    expect(await readWorkspaceFile(asBucket(r2), 34, 'src/added.js')).toBe('export const a = 1;');
  });

  it('refuses a traversal path and reports WHY instead of silently dropping it', async () => {
    const r2 = fakeR2();
    const result = await applyTaskWorkspaceChanges(fakeDb([]), asBucket(r2), {
      tenantId: 42, taskId: 7, projectId: 34, executionId: null, agent: 'implementer',
      changes: { writes: [{ path: '../../etc/passwd', content: 'x' }] },
    });
    expect(result.written).toBe(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.path).toBe('../../etc/passwd');
    expect(result.rejected[0]!.reason).toMatch(/traversal/i);
    expect(r2.store.size).toBe(0);
  });

  it('holds an agent write to the same content contract the editor is held to', async () => {
    const r2 = fakeR2();
    const result = await applyTaskWorkspaceChanges(fakeDb([]), asBucket(r2), {
      tenantId: 42, taskId: 7, projectId: 34, executionId: null, agent: 'implementer',
      changes: { writes: [{ path: 'package.json', content: 'not json at all' }] },
    });
    expect(result.written).toBe(0);
    expect(result.rejected[0]!.reason).toMatch(/valid JSON/i);
  });
});

describe('readTaskWorkspaceTree', () => {
  it('reads the whole tree, and reports truncation rather than pretending it is complete', async () => {
    const r2 = fakeR2();
    for (const p of ['a.txt', 'b.txt', 'c.txt']) await writeWorkspaceFile(asBucket(r2), 34, p, p);

    const all = await readTaskWorkspaceTree(asBucket(r2), 34);
    expect(all.files.map((f) => f.path).sort()).toEqual(['a.txt', 'b.txt', 'c.txt']);
    expect(all.truncated).toBe(false);

    const capped = await readTaskWorkspaceTree(asBucket(r2), 34, { maxFiles: 2 });
    expect(capped.files).toHaveLength(2);
    expect(capped.truncated).toBe(true);
  });
});
