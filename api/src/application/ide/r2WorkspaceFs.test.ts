/**
 * The IDE workspace behind the ONE coding provider: list / read / search / write / edit / delete
 * over R2, with the store's own path + content contract. (These scenarios used to run against the
 * cloud host's own `ideWorkspaceCoding` file functions.)
 */
import { describe, it, expect } from 'vitest';
import { listFilesTool } from '@builderforce/agent-tools';
import { createRepoCapabilities } from '@builderforce/agent-tools/workspace';
import type { Db } from '../../infrastructure/database/connection';
import { writeWorkspaceFile, readWorkspaceFile } from './workspaceStore';
import { applyTaskWorkspaceChanges } from './taskWorkspaceTarget';
import { r2Capabilities, r2WorkspaceFs } from './r2WorkspaceFs';

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

const fakeDb = { insert: () => ({ values: async () => undefined }) } as unknown as Db;

/** The capabilities a cloud run gets over `projectId`'s workspace. */
function capabilities(bucket: R2Bucket, projectId: number) {
  return r2Capabilities(r2WorkspaceFs(bucket, projectId, {
    applyChanges: (changes) => applyTaskWorkspaceChanges(fakeDb, bucket, { tenantId: 1, taskId: 7, executionId: 9, agent: 'coder', projectId, changes }),
  }));
}

describe('IDE workspace listing pagination', () => {
  it('pages past an R2 cursor so a glob match on a later page is not a miss', async () => {
    const prefix = 'ide/projects/7/';
    const pages = [
      {
        objects: [{ key: `${prefix}noise/a.ts`, size: 1 }],
        truncated: true,
        cursor: 'page-2',
      },
      {
        objects: [{ key: `${prefix}frontend/src/lib/widget.test.ts`, size: 1 }],
        truncated: false,
      },
    ];
    let call = 0;
    const bucket = {
      async list(opts: { prefix: string; cursor?: string }) {
        expect(opts.prefix).toBe(prefix);
        if (call === 1) expect(opts.cursor).toBe('page-2');
        return pages[call++]!;
      },
    } as unknown as R2Bucket;
    const listed = await capabilities(bucket, 7).repoRead.listFiles('frontend/src/lib', '**/*.test.ts');
    expect(listed.ok).toBe(true);
    expect(listed.paths).toEqual(['frontend/src/lib/widget.test.ts']);
    expect(listed.truncated).toBe(false);
    expect(call).toBe(2);
  });

  it('says an empty truncated glob search is incomplete, not absence (the tool words the note from `truncated`)', async () => {
    const bucket = {
      async list() {
        return { objects: [{ key: 'ide/projects/7/a.ts', size: 1 }], truncated: true, cursor: 'more' };
      },
    } as unknown as R2Bucket;
    const listed = await capabilities(bucket, 7).repoRead.listFiles('frontend/src/lib', '**/*.test.ts');
    expect(listed.paths).toEqual([]);
    expect(listed.truncated).toBe(true);
  });

  it('the list_files tool words an empty glob over a cut-short R2 listing as NOT proof of absence', async () => {
    const bucket = {
      async list() {
        return { objects: [{ key: 'ide/projects/7/a.ts', size: 1 }], truncated: true, cursor: 'more' };
      },
    } as unknown as R2Bucket;
    const out = await listFilesTool.execute({ path: 'frontend/src/lib', glob: '**/*.test.ts' }, { caps: capabilities(bucket, 7) } as never);
    const data = (out as { data: { note?: string } }).data;
    expect(data.note).toContain('NOT proof the file does not exist');
    expect(data.note).not.toContain('0 matches means no such file exists');
  });

  it('maxPages bounds the snapshot to that many R2 pages and reports the rest incomplete', async () => {
    let calls = 0;
    const bucket = {
      async list() { calls++; return { objects: [{ key: 'ide/projects/7/a.ts', size: 1 }], truncated: true, cursor: `c${calls}` }; },
    } as unknown as R2Bucket;
    const fs = r2WorkspaceFs(bucket, 7, { maxPages: 1 });
    const seen: string[] = [];
    for await (const e of fs.list('', {})) seen.push(e.path);
    expect(seen).toEqual(['a.ts']);
    expect(calls).toBe(1);
    expect(fs.listingIncomplete()).toBe(true);
  });

  it('an unscoped agent search reads at most one page of files, a scoped one is not capped to it', async () => {
    const r2 = fakeR2();
    for (let i = 0; i < 1_050; i++) r2.store.set(`ide/projects/7/src/f${String(i).padStart(4, '0')}.txt`, 'nothing');
    let reads = 0;
    const counting = { ...r2, async get(key: string) { reads++; return r2.get(key); } };
    const fs = r2WorkspaceFs(counting as unknown as R2Bucket, 7);
    const unscoped = await createRepoCapabilities(fs).repoRead.searchCode('needle');
    expect(unscoped).toMatchObject({ ok: true, total: 0, truncated: true });
    expect(reads).toBeLessThanOrEqual(1_000);
    reads = 0;
    const scoped = await createRepoCapabilities(r2WorkspaceFs(counting as unknown as R2Bucket, 7)).repoRead.searchCode('needle', 'src');
    expect(scoped).toMatchObject({ ok: true, total: 0, truncated: false });
    // Every file of the scope is read (plus the one probe of the scope itself).
    expect(reads).toBeGreaterThanOrEqual(1_050);
  });

  it('pages the prefix once per adapter however many listings follow', async () => {
    let lists = 0;
    const bucket = {
      async list() { lists++; return { objects: [{ key: 'ide/projects/7/src/a.ts', size: 1 }] }; },
    } as unknown as R2Bucket;
    const caps = capabilities(bucket, 7);
    await caps.repoRead.listFiles('src');
    await caps.repoRead.listFiles(undefined, '*.ts');
    expect(lists).toBe(1);
  });
});

describe('IDE workspace file ops', () => {
  it('lists, reads, searches, writes, edits and deletes against R2', async () => {
    const r2 = fakeR2();
    const bucket = asBucket(r2);
    await writeWorkspaceFile(bucket, 34, 'src/App.jsx', 'export const App = () => 1;\n');
    await writeWorkspaceFile(bucket, 34, 'README.md', '# hi\n');
    const { repoRead, repoWrite } = capabilities(bucket, 34);

    const listed = await repoRead.listFiles('src');
    expect(listed.ok).toBe(true);
    expect(listed.paths).toEqual(['src/App.jsx']);

    expect((await repoRead.listFiles(undefined, '*.md')).paths).toEqual(['README.md']);
    expect((await repoRead.listFiles('src', '*.jsx')).paths).toEqual(['src/App.jsx']);

    const read = await repoRead.readFile('src/App.jsx');
    expect(read).toEqual({ ok: true, path: 'src/App.jsx', content: 'export const App = () => 1;\n' });
    expect((await repoRead.readFile('missing.ts')).ok).toBe(false);

    const found = await repoRead.searchCode('export const App');
    expect(found.ok).toBe(true);
    expect(found.matches?.map((m) => m.path)).toEqual(['src/App.jsx']);

    const created = await repoWrite.writeFile('src/added.js', 'export const a = 1;\n');
    expect(created.ok).toBe(true);
    expect(created.change).toBe('created');
    expect(created.branch).toBe('workspace');
    expect(created.note).toContain('wrote to the IDE workspace');
    expect(await readWorkspaceFile(bucket, 34, 'src/added.js')).toBe('export const a = 1;\n');

    const edited = await repoWrite.editFile('src/added.js', 'a = 1', 'a = 2');
    expect(edited.ok).toBe(true);
    expect(edited.branch).toBe('workspace');
    expect(await readWorkspaceFile(bucket, 34, 'src/added.js')).toBe('export const a = 2;\n');

    const deleted = await repoWrite.deleteFile('src/added.js');
    expect(deleted.ok).toBe(true);
    expect(deleted.deleted).toBe(true);
    expect(deleted.branch).toBe('workspace');
    expect(deleted.note).toContain('deleted from the IDE workspace');
    expect(await readWorkspaceFile(bucket, 34, 'src/added.js')).toBeNull();
    // The snapshot a listing built stays true after the write and the delete.
    expect((await repoRead.listFiles('src')).paths).toEqual(['src/App.jsx']);
  });

  it('edit of a missing file is an honest error; delete of a missing path is a no-op', async () => {
    const bucket = asBucket(fakeR2());
    const { repoWrite } = capabilities(bucket, 34);

    const missingEdit = await repoWrite.editFile('src/gone.js', 'a', 'b');
    expect(missingEdit.ok).toBe(false);
    expect(missingEdit.code).toBe('not_found');

    await writeWorkspaceFile(bucket, 34, 'src/gone.js', 'export const a = 1;\n');
    const noMatch = await repoWrite.editFile('src/gone.js', 'does-not-exist', 'x');
    expect(noMatch.ok).toBe(false);
    expect(noMatch.code).toBe('no_match');

    const missingDelete = await repoWrite.deleteFile('src/never.js');
    expect(missingDelete.ok).toBe(true);
    expect(missingDelete.deleted).toBe(false);
  });

  it('refuses a traversal write instead of dumping it into R2', async () => {
    const r2 = fakeR2();
    const result = await capabilities(asBucket(r2), 34).repoWrite.writeFile('../../etc/passwd', 'x');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('outside_root');
    expect(r2.store.size).toBe(0);
  });

  it('keeps the store contract: a cross-wired file is rejected, and a read-only adapter writes nothing', async () => {
    const r2 = fakeR2();
    const bucket = asBucket(r2);
    const { repoWrite } = capabilities(bucket, 34);
    const bad = await repoWrite.writeFile('data.json', '<html></html>');
    expect(bad.ok).toBe(false);
    expect(r2.store.size).toBe(0);

    const readOnly = r2Capabilities(r2WorkspaceFs(bucket, 34)).repoWrite;
    const refused = await readOnly.writeFile('a.txt', 'x');
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe('unsupported');
  });
});
