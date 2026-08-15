/**
 * Contract tests for the workspace store — the "basic task": read files from the
 * R2 workspace, update them, save them. These pin the behaviors whose absence
 * produced real production corruption: silent-empty reads, cross-wired content
 * persisted to the wrong path, unvalidated keys, and cross-project bleed.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  captureWorkspaceVersion,
  listWorkspaceHistory,
  readWorkspaceVersion,
  restoreWorkspaceVersion,
  validateWorkspacePath,
  validateWorkspaceContent,
  workspacePrefix,
  workspaceKey,
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
  writeWorkspaceBinary,
  deleteWorkspaceFile,
} from './workspaceStore';

/** In-memory R2 stand-in covering the surface the store uses. */
function fakeR2() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      if (!store.has(key)) return null;
      const value = store.get(key)!;
      // `body` as well as `text`: the history capture copies the BODY, so a fake
      // without one would let a bug that corrupts every archived version pass.
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

// ---------------------------------------------------------------------------
// Round-trip: what you save is EXACTLY what you read back
// ---------------------------------------------------------------------------

describe('workspaceStore round-trip', () => {
  it('stores binary media without applying the text content guard', async () => {
    const put = vi.fn(async () => undefined);
    const bucket = { put } as unknown as R2Bucket;
    const bytes = new Uint8Array([0, 1, 2, 255]);
    expect(await writeWorkspaceBinary(bucket, 7, 'recordings/live.webm', bytes, 'video/webm')).toEqual({ ok: true });
    expect(put).toHaveBeenCalledWith('ide/projects/7/recordings/live.webm', bytes, { httpMetadata: { contentType: 'video/webm' } });
  });
  it.each([
    ['plain source', 'App.js', "export default function App() { return null; }"],
    ['unicode + emoji', 'App.js', "const label = 'héllo wörld 🚀 — ñ 中文';"],
    ['CRLF line endings', 'App.js', "line one\r\nline two\r\n"],
    ['JSON with nested quotes', 'package.json', JSON.stringify({ name: 'a "quoted" app', scripts: { dev: 'vite' } }, null, 2)],
    ['HTML document', 'index.html', '<!DOCTYPE html>\n<html><body><div id="root"></div></body></html>'],
    ['CSS', 'src/index.css', 'body { margin: 0; }\n'],
    ['markdown', 'README.md', '# Title\n\nSome *content* with `code`.'],
    ['deeply nested path', 'src/screens/settings/Advanced.js', 'export default () => null;'],
    ['whitespace-only (blank file)', 'notes.md', '   \n\t\n'],
  ])('preserves %s byte-for-byte', async (_label, path, content) => {
    const r2 = fakeR2();
    const write = await writeWorkspaceFile(asBucket(r2), 7, path, content);
    expect(write).toEqual({ ok: true });
    expect(await readWorkspaceFile(asBucket(r2), 7, path)).toBe(content);
  });

  it('a large file survives the round-trip intact', async () => {
    const r2 = fakeR2();
    const big = 'const line = 1;\n'.repeat(50_000); // ~800KB
    await writeWorkspaceFile(asBucket(r2), 1, 'big.js', big);
    const back = await readWorkspaceFile(asBucket(r2), 1, 'big.js');
    expect(back).toHaveLength(big.length);
    expect(back).toBe(big);
  });

  it('overwriting a file replaces its content completely', async () => {
    const r2 = fakeR2();
    await writeWorkspaceFile(asBucket(r2), 1, 'App.js', 'export const v1 = 1;');
    await writeWorkspaceFile(asBucket(r2), 1, 'App.js', 'export const v2 = 2;');
    expect(await readWorkspaceFile(asBucket(r2), 1, 'App.js')).toBe('export const v2 = 2;');
  });
});

// ---------------------------------------------------------------------------
// Missing vs empty — the silent-'' bug class
// ---------------------------------------------------------------------------

describe('missing vs empty', () => {
  it('a never-written file reads as null, not empty string', async () => {
    const r2 = fakeR2();
    expect(await readWorkspaceFile(asBucket(r2), 1, 'ghost.js')).toBeNull();
  });

  it('a real empty file reads as empty string, not null', async () => {
    const r2 = fakeR2();
    await writeWorkspaceFile(asBucket(r2), 1, 'blank.md', '');
    expect(await readWorkspaceFile(asBucket(r2), 1, 'blank.md')).toBe('');
  });

  it('a deleted file reads as null afterwards', async () => {
    const r2 = fakeR2();
    await writeWorkspaceFile(asBucket(r2), 1, 'App.js', 'export default 1;');
    await deleteWorkspaceFile(asBucket(r2), 1, 'App.js');
    expect(await readWorkspaceFile(asBucket(r2), 1, 'App.js')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Project isolation — writes/reads/lists can never bleed across projects
// ---------------------------------------------------------------------------

describe('project isolation', () => {
  it('the same path in two projects holds independent content', async () => {
    const r2 = fakeR2();
    await writeWorkspaceFile(asBucket(r2), 1, 'package.json', '{"name":"one"}');
    await writeWorkspaceFile(asBucket(r2), 2, 'package.json', '{"name":"two"}');
    expect(await readWorkspaceFile(asBucket(r2), 1, 'package.json')).toBe('{"name":"one"}');
    expect(await readWorkspaceFile(asBucket(r2), 2, 'package.json')).toBe('{"name":"two"}');
  });

  // The trailing slash in the prefix is load-bearing: without it, listing
  // project 1 would also match project 12's keys.
  it("project 1's listing does not include project 12's files", async () => {
    const r2 = fakeR2();
    await writeWorkspaceFile(asBucket(r2), 1, 'a.js', 'export const a = 1;');
    await writeWorkspaceFile(asBucket(r2), 12, 'b.js', 'export const b = 1;');
    const files = await listWorkspaceFiles(asBucket(r2), 1);
    expect(files.map((f) => f.path)).toEqual(['a.js']);
    expect(workspacePrefix(1)).toBe('ide/projects/1/');
    expect(workspacePrefix(12)).toBe('ide/projects/12/');
  });

  it('lists paths relative to the project (no prefix leakage) with sizes', async () => {
    const r2 = fakeR2();
    await writeWorkspaceFile(asBucket(r2), 3, 'src/main.jsx', 'export default 1;');
    const files = await listWorkspaceFiles(asBucket(r2), 3);
    expect(files).toEqual([{ path: 'src/main.jsx', size: 'export default 1;'.length }]);
  });

  // `String.replace(prefix, '')` (the old route code) removes the FIRST match
  // anywhere; a path that embeds the prefix text must still round-trip.
  it('handles a path that contains the prefix string itself', async () => {
    const r2 = fakeR2();
    const tricky = 'docs/ide/projects/3/notes.md';
    await writeWorkspaceFile(asBucket(r2), 3, tricky, '# notes');
    const files = await listWorkspaceFiles(asBucket(r2), 3);
    expect(files.map((f) => f.path)).toContain(tricky);
    expect(await readWorkspaceFile(asBucket(r2), 3, tricky)).toBe('# notes');
  });
});

// ---------------------------------------------------------------------------
// Path validation — nothing malformed can become a key
// ---------------------------------------------------------------------------

describe('validateWorkspacePath', () => {
  it.each([
    'App.js',
    'src/main.jsx',
    'src/screens/Home.js',
    'assets/logo-2x.png',
    '.gitignore',
    'my file with spaces.md',
    'vite.config.js',
    'a/b/c/d/e/f.txt',
  ])('accepts legitimate path %s', (path) => {
    expect(validateWorkspacePath(path)).toEqual({ ok: true });
  });

  it.each([
    ['empty', ''],
    ['absolute', '/etc/passwd'],
    ['traversal up', '../other-project/secrets.js'],
    ['embedded traversal', 'src/../../escape.js'],
    ['current-dir segment', './App.js'],
    ['backslashes', 'src\\main.jsx'],
    ['empty segment', 'src//main.jsx'],
    ['trailing slash', 'src/'],
    ['newline', 'evil\n.js'],
    ["null byte", "evil" + String.fromCharCode(0) + ".js"],
    ['overlong', 'a/'.repeat(300) + 'x.js'],
  ])('rejects %s', (_label, path) => {
    expect(validateWorkspacePath(path).ok).toBe(false);
  });

  it('workspaceKey throws on an invalid path (a bad key can never be built)', () => {
    expect(() => workspaceKey(1, '../escape.js')).toThrow(/Invalid workspace path/);
    expect(workspaceKey(1, 'App.js')).toBe('ide/projects/1/App.js');
  });

  it('write refuses an invalid path with 400 and stores nothing', async () => {
    const r2 = fakeR2();
    const res = await writeWorkspaceFile(asBucket(r2), 1, '../escape.js', 'x');
    expect(res).toMatchObject({ ok: false, status: 400 });
    expect(r2.store.size).toBe(0);
  });

  it('read/delete of an invalid path are safe no-ops (null / no throw)', async () => {
    const r2 = fakeR2();
    expect(await readWorkspaceFile(asBucket(r2), 1, '../escape.js')).toBeNull();
    await expect(deleteWorkspaceFile(asBucket(r2), 1, '../escape.js')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Content contract — cross-wired content can never be persisted
// ---------------------------------------------------------------------------

describe('write-time content contract', () => {
  it("rejects package.json's JSON written to vite.config.js (422), stores nothing", async () => {
    const r2 = fakeR2();
    const res = await writeWorkspaceFile(asBucket(r2), 1, 'vite.config.js', '{\n  "name": "my-mobile-app"\n}');
    expect(res).toMatchObject({ ok: false, status: 422 });
    expect(r2.store.size).toBe(0);
  });

  it('rejects JS/config source written to index.html (the raw-source preview bug)', async () => {
    const r2 = fakeR2();
    const res = await writeWorkspaceFile(asBucket(r2), 1, 'index.html', "import { defineConfig } from 'vite';");
    expect(res).toMatchObject({ ok: false, status: 422 });
  });

  it('rejects an HTML document written to index.js', async () => {
    const res = await writeWorkspaceFile(asBucket(fakeR2()), 1, 'index.js', '<!DOCTYPE html><html></html>');
    expect(res).toMatchObject({ ok: false, status: 422 });
  });

  it('rejects malformed JSON written to package.json', async () => {
    const res = await writeWorkspaceFile(asBucket(fakeR2()), 1, 'package.json', 'body { color: red; }');
    expect(res).toMatchObject({ ok: false, status: 422 });
  });

  it('a rejected write leaves the previous content intact', async () => {
    const r2 = fakeR2();
    const good = '{\n  "name": "my-app"\n}';
    await writeWorkspaceFile(asBucket(r2), 1, 'package.json', good);
    await writeWorkspaceFile(asBucket(r2), 1, 'package.json', 'not json at all {');
    expect(await readWorkspaceFile(asBucket(r2), 1, 'package.json')).toBe(good);
  });

  it('allows legitimate edge content (JSX with <, bare scalar, blank file)', () => {
    expect(validateWorkspaceContent('App.jsx', 'const ok = a < b;')).toEqual({ ok: true });
    expect(validateWorkspaceContent('flag.js', 'true')).toEqual({ ok: true });
    expect(validateWorkspaceContent('anything.js', '   ')).toEqual({ ok: true });
    expect(validateWorkspaceContent('data.jsonl', '{"a":1}\n{"b":2}')).toEqual({ ok: true });
    expect(validateWorkspaceContent('styles.css', 'body { color: red; }')).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// File history — the undo behind every write
// ---------------------------------------------------------------------------

describe('workspace file history', () => {
  it('archives the version a write replaces, and never the file being created', async () => {
    const r2 = fakeR2();
    await writeWorkspaceFile(asBucket(r2), 1, 'App.js', 'export const v1 = 1;');
    // Creating a file destroys nothing, so there is nothing to keep — recording a
    // phantom "before" would make the undo list claim a version that never existed.
    expect(await listWorkspaceHistory(asBucket(r2), 1)).toHaveLength(0);

    await writeWorkspaceFile(asBucket(r2), 1, 'App.js', 'export const v2 = 2;');
    const versions = await listWorkspaceHistory(asBucket(r2), 1);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.path).toBe('App.js');
    expect(await readWorkspaceVersion(asBucket(r2), 1, 'App.js', versions[0]!.at)).toBe('export const v1 = 1;');
  });

  it('restores an earlier version, and archives the restore so it can be undone again', async () => {
    const r2 = fakeR2();
    await writeWorkspaceFile(asBucket(r2), 1, 'App.js', 'good');
    await writeWorkspaceFile(asBucket(r2), 1, 'App.js', 'broken');

    const [version] = await listWorkspaceHistory(asBucket(r2), 1, 'App.js');
    expect((await restoreWorkspaceVersion(asBucket(r2), 1, 'App.js', version!.at)).ok).toBe(true);
    expect(await readWorkspaceFile(asBucket(r2), 1, 'App.js')).toBe('good');
    // The restore went through the write path, so 'broken' is now itself archived.
    const after = await listWorkspaceHistory(asBucket(r2), 1, 'App.js');
    expect(after.length).toBeGreaterThan(1);
  });

  it('refuses a version that is not there rather than writing nothing silently', async () => {
    const r2 = fakeR2();
    await writeWorkspaceFile(asBucket(r2), 1, 'App.js', 'x');
    const result = await restoreWorkspaceVersion(asBucket(r2), 1, 'App.js', 123);
    expect(result.ok).toBe(false);
  });

  it('narrows to one file, and keeps projects apart', async () => {
    const r2 = fakeR2();
    await writeWorkspaceFile(asBucket(r2), 1, 'App.js', 'a');
    await writeWorkspaceFile(asBucket(r2), 1, 'App.js', 'b');
    await writeWorkspaceFile(asBucket(r2), 1, 'other.js', 'a');
    await writeWorkspaceFile(asBucket(r2), 1, 'other.js', 'b');
    await writeWorkspaceFile(asBucket(r2), 2, 'App.js', 'a');
    await writeWorkspaceFile(asBucket(r2), 2, 'App.js', 'b');

    expect(await listWorkspaceHistory(asBucket(r2), 1, 'App.js')).toHaveLength(1);
    expect(await listWorkspaceHistory(asBucket(r2), 1)).toHaveLength(2);
    expect(await listWorkspaceHistory(asBucket(r2), 2)).toHaveLength(1);
  });

  // The archive is a safety net for the save. It must never be the reason a save
  // fails — that would lose the very work the undo exists to protect.
  it('never fails the write when archiving cannot be done', async () => {
    const broken = {
      get: async () => ({ text: async () => 'old', body: 'old' }),
      put: async () => { throw new Error('R2 is having a bad day'); },
      list: async () => ({ objects: [] }),
      delete: async () => undefined,
    } as unknown as R2Bucket;
    await expect(captureWorkspaceVersion(broken, 1, 'App.js')).resolves.toBeUndefined();
  });
});
