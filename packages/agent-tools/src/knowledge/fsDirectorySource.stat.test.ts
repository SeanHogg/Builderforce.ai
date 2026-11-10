import { describe, expect, it, vi } from 'vitest';
import { createFsDirectorySource, DEFAULT_HASH_RULE, MAX_LISTED_FILES, type KnowledgeFs } from './fsDirectorySource.js';
import { memoryKnowledgeFs, type MemoryFile } from './memoryKnowledgeFs.test-util.js';
import { memoryHashCache, type GitHints, type HashCache, type StatDelta } from './statManifest.js';

const OLD = 1_000; // ms: a file last modified long before any walk
const RULE = DEFAULT_HASH_RULE;

async function walk(fs: KnowledgeFs, extra: Partial<Parameters<typeof createFsDirectorySource>[0]> = {}) {
    const source = createFsDirectorySource({ fs, rootPath: '/r', rootId: 'r', title: 'r', ...extra });
    const out: Array<{ path: string; hash: string; size: number }> = [];
    for await (const f of source.list()) out.push(f);
    return out;
}

function counted(files: Record<string, MemoryFile>) {
    const base = memoryKnowledgeFs(files);
    const readFile = vi.fn(base.readFile);
    return { fs: { ...base, readFile } as KnowledgeFs, readFile };
}

/** A memory port whose saves are recorded. */
function recording(): HashCache & { deltas: StatDelta[] } {
    const inner = memoryHashCache();
    const deltas: StatDelta[] = [];
    return { ...inner, deltas, save: async (rootId, delta) => { deltas.push(delta); await inner.save(rootId, delta); } };
}

const ns = (ms: number): bigint => BigInt(ms) * 1_000_000n;
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
/** A stand-in for git's blob id: deterministic per byte content. */
const fakeBlobId = (bytes: Uint8Array): string => `blob:${text(bytes)}`;
const hints = (blobs: Record<string, string>, takenAtMs: number) => async (): Promise<GitHints> =>
    ({ blobs: new Map(Object.entries(blobs)), takenAtNs: ns(takenAtMs) });

describe('the stat prefilter (PRD 41 B2)', () => {
    it('a warm re-walk reads zero files when nothing changed, and saves nothing', async () => {
        const files: Record<string, MemoryFile> = { '/r/a.ts': { text: 'a', mtime: OLD }, '/r/d/b.ts': { text: 'bb', mtime: OLD } };
        const { fs, readFile } = counted(files);
        const hashCache = recording();
        const first = await walk(fs, { hashCache });
        expect(readFile).toHaveBeenCalledTimes(2);
        expect(hashCache.deltas).toHaveLength(1);
        readFile.mockClear();
        const second = await walk(fs, { hashCache });
        expect(readFile).not.toHaveBeenCalled();
        expect(second).toEqual(first);
        expect(hashCache.deltas).toHaveLength(1); // an unchanged walk writes nothing
    });

    it('saves a DELTA: a one-file edit on a large set upserts one row, a deleted file deletes one', async () => {
        const files: Record<string, MemoryFile> = {};
        for (let i = 0; i < 500; i++) files[`/r/f${String(i).padStart(3, '0')}.ts`] = { text: `v${i}`, mtime: OLD };
        const { fs, readFile } = counted(files);
        const hashCache = recording();
        await walk(fs, { hashCache });
        readFile.mockClear();
        files['/r/f007.ts'] = { text: 'changed', mtime: OLD + 5 };
        delete files['/r/f300.ts'];
        await walk(fs, { hashCache });
        expect(readFile.mock.calls.map((c) => c[0])).toEqual(['/r/f007.ts']);
        const delta = hashCache.deltas.at(-1)!;
        expect(delta.upserts.map((r) => r.path)).toEqual(['f007.ts']);
        expect(delta.deletes).toEqual(['f300.ts']);
        expect(delta.replace).toBeUndefined();
        expect((await hashCache.load('r', RULE)).rows.size).toBe(499);
    });

    it('re-reads a file whose file id changed at the same size and mtime', async () => {
        const files: Record<string, MemoryFile> = { '/r/a.ts': { text: 'a', mtime: OLD }, '/r/b.ts': { text: 'b', mtime: OLD } };
        const base = memoryKnowledgeFs(files);
        const readFile = vi.fn(base.readFile);
        let id = 1n;
        const fs: KnowledgeFs = { ...base, readFile, stat: async (p) => ({ ...(await base.stat(p)), fileId: p.endsWith('b.ts') ? id : 7n }) };
        const hashCache = memoryHashCache();
        await walk(fs, { hashCache });
        readFile.mockClear();
        id = 2n;
        await walk(fs, { hashCache });
        expect(readFile.mock.calls.map((c) => c[0])).toEqual(['/r/b.ts']);
    });

    it('re-hashes a file modified within 2 s of the reference time (the START of the walk that saved), and trusts one outside it', async () => {
        const files: Record<string, MemoryFile> = { '/r/racy.ts': { text: 'x', mtime: 10_000 }, '/r/calm.ts': { text: 'y', mtime: 5_000 } };
        const { fs, readFile } = counted(files);
        const hashCache = recording();
        // Walk 1 starts at 11.5 s: racy.ts (10 s) is within 2 s of it, calm.ts (5 s) is not.
        await walk(fs, { hashCache, now: () => 11_500 });
        expect(hashCache.deltas.at(-1)!.writtenAtNs).toBe(ns(11_500));
        readFile.mockClear();
        // At 11.6 s racy.ts is re-read; the same bytes, still racy against 11.6 s: nothing is written.
        await walk(fs, { hashCache, now: () => 11_600 });
        expect(readFile.mock.calls.map((c) => c[0])).toEqual(['/r/racy.ts']);
        expect(hashCache.deltas).toHaveLength(1);
        // At 12.5 s it is re-read once more, and the save moves the reference so it leaves the racy window (10 s < 10.5 s).
        readFile.mockClear();
        await walk(fs, { hashCache, now: () => 12_500 });
        expect(readFile.mock.calls.map((c) => c[0])).toEqual(['/r/racy.ts']);
        expect(hashCache.deltas).toHaveLength(2);
        expect(hashCache.deltas.at(-1)!).toMatchObject({ upserts: [], deletes: [], writtenAtNs: ns(12_500) });
        readFile.mockClear();
        await walk(fs, { hashCache, now: () => 20_000 });
        expect(readFile).not.toHaveBeenCalled();
    });

    it('a file with a future mtime is re-read every walk but never rewrites the rows', async () => {
        const { fs, readFile } = counted({ '/r/future.ts': { text: 'f', mtime: 1_000_000 } });
        const hashCache = recording();
        await walk(fs, { hashCache, now: () => 10_000 });
        for (const at of [20_000, 30_000, 40_000]) await walk(fs, { hashCache, now: () => at });
        expect(readFile).toHaveBeenCalledTimes(4);
        expect(hashCache.deltas).toHaveLength(1);
    });

    it('a clean git file whose stat moved but whose verified blob is the index blob is not read; a dirty one is', async () => {
        const files: Record<string, MemoryFile> = { '/r/clean.ts': { text: 'c', mtime: OLD }, '/r/dirty.ts': { text: 'd', mtime: OLD } };
        const { fs, readFile } = counted(files);
        const hashCache = memoryHashCache();
        const first = await walk(fs, { hashCache, gitBlobId: fakeBlobId, gitHints: hints({ 'clean.ts': 'blob:c', 'dirty.ts': 'blob:d' }, OLD + 1) });
        expect((await hashCache.load('r', RULE)).rows.get('clean.ts')?.gitBlob).toBe('blob:c');
        readFile.mockClear();
        // A checkout touched both files (new mtimes); git says clean.ts is clean at its blob, dirty.ts is not clean.
        files['/r/clean.ts'] = { text: 'c', mtime: 50_000 };
        files['/r/dirty.ts'] = { text: 'D', mtime: 50_000 };
        const second = await walk(fs, { hashCache, gitBlobId: fakeBlobId, gitHints: hints({ 'clean.ts': 'blob:c' }, 60_000), now: () => 70_000 });
        expect(readFile.mock.calls.map((c) => c[0])).toEqual(['/r/dirty.ts']);
        expect(second.find((f) => f.path === 'clean.ts')!.hash).toBe(first.find((f) => f.path === 'clean.ts')!.hash);
        // A hint taken BEFORE the file was modified is not used: git saw other bytes.
        files['/r/clean.ts'] = { text: 'c', mtime: 80_000 };
        readFile.mockClear();
        await walk(fs, { hashCache, gitBlobId: fakeBlobId, gitHints: hints({ 'clean.ts': 'blob:c' }, 75_000), now: () => 90_000 });
        expect(readFile.mock.calls.map((c) => c[0])).toEqual(['/r/clean.ts']);
    });

    it('records no hint for bytes git never saw: a save between status and read, or a same-size filter/EOL difference', async () => {
        // git reported the index blob of "old" clean; the file was saved as "new" (same size) before the walk read it.
        const files: Record<string, MemoryFile> = { '/r/a.ts': { text: 'new', mtime: OLD } };
        const { fs, readFile } = counted(files);
        const hashCache = memoryHashCache();
        await walk(fs, { hashCache, gitBlobId: fakeBlobId, gitHints: hints({ 'a.ts': 'blob:old' }, OLD + 1) });
        expect((await hashCache.load('r', RULE)).rows.get('a.ts')?.gitBlob).toBeUndefined();
        // Next walk: the stat moved and git still names "old" clean: the hint is not trusted, the file is read.
        readFile.mockClear();
        files['/r/a.ts'] = { text: 'new', mtime: 50_000 };
        await walk(fs, { hashCache, gitBlobId: fakeBlobId, gitHints: hints({ 'a.ts': 'blob:old' }, 60_000), now: () => 70_000 });
        expect(readFile).toHaveBeenCalledTimes(1);
        // Without a blob hasher no hint is ever recorded.
        const bare = memoryHashCache();
        await walk(fs, { hashCache: bare, gitHints: hints({ 'a.ts': 'blob:new' }, OLD + 1) });
        expect((await bare.load('r', RULE)).rows.get('a.ts')?.gitBlob).toBeUndefined();
    });

    it('rows of another hash rule are never reused, and the next save replaces them', async () => {
        const { fs, readFile } = counted({ '/r/a.ts': { text: 'a', mtime: OLD } });
        const hashCache = recording();
        await walk(fs, { hashCache, hash: () => 'raw-a', hashRule: 'raw' });
        readFile.mockClear();
        const out = await walk(fs, { hashCache, hash: () => 'lf-a', hashRule: 'eol-lf@1' });
        expect(readFile).toHaveBeenCalledTimes(1);
        expect(out[0]!.hash).toBe('lf-a');
        expect(hashCache.deltas.at(-1)).toMatchObject({ rule: 'eol-lf@1', replace: true });
        // A host digest with no rule never trusts or writes the rows.
        readFile.mockClear();
        await walk(fs, { hashCache, hash: () => 'x' });
        expect(readFile).toHaveBeenCalledTimes(1);
        expect(hashCache.deltas).toHaveLength(2);
    });

    it('a capped or stopped walk saves what it visited as a merge, keeping the reference time', async () => {
        const files: Record<string, MemoryFile> = {};
        for (let i = 0; i < 10; i++) files[`/r/f${i}.ts`] = { text: `v${i}`, mtime: OLD };
        const { fs } = counted(files);
        const hashCache = recording();
        await walk(fs, { hashCache, now: () => 10_000 });
        files['/r/f0.ts'] = { text: 'changed', mtime: OLD + 1 };
        files['/r/f9.ts'] = { text: 'changed', mtime: OLD + 1 };
        await walk(fs, { hashCache, maxListed: 3, now: () => 20_000 });
        expect(hashCache.deltas.at(-1)).toMatchObject({ upserts: [expect.objectContaining({ path: 'f0.ts' })], deletes: [], writtenAtNs: ns(10_000) });
        // A consumer that stops early still saves what it visited.
        files['/r/f1.ts'] = { text: 'changed', mtime: OLD + 1 };
        const source = createFsDirectorySource({ fs, rootPath: '/r', rootId: 'r', title: 'r', hashCache, now: () => 30_000 });
        for await (const f of source.list()) if (f.path === 'f1.ts') break;
        // The folder's batch was hashed before the break (f9 changed in the capped walk, which never reached it).
        const stopped = hashCache.deltas.at(-1)!;
        expect(stopped.upserts.map((r) => r.path).sort()).toEqual(['f1.ts', 'f9.ts']);
        expect(stopped).toMatchObject({ deletes: [], writtenAtNs: ns(10_000) });
        expect((await hashCache.load('r', RULE)).rows.size).toBe(10);
    });

    it('a failing git or a failing store is the plain stat path, never a failed walk', async () => {
        const { fs, readFile } = counted({ '/r/a.ts': { text: 'a', mtime: OLD } });
        const errors: unknown[] = [];
        const broken: HashCache = { load: async () => { throw new Error('locked'); }, save: async () => { throw new Error('locked'); } };
        const out = await walk(fs, { hashCache: broken, gitHints: async () => { throw new Error('no git'); }, onHashCacheError: (e) => errors.push(e) });
        expect(out.map((f) => f.path)).toEqual(['a.ts']);
        expect(readFile).toHaveBeenCalledTimes(1);
        expect(errors).toHaveLength(2);
    });

    it(`lists every file of a root over ${MAX_LISTED_FILES} files: the plan has no cap of its own`, async () => {
        const files: Record<string, MemoryFile> = {};
        const total = MAX_LISTED_FILES + 50;
        for (let i = 0; i < total; i++) files[`/r/d${i % 4}/f${String(i).padStart(6, '0')}.ts`] = { text: 'x', mtime: OLD };
        const out = await walk(memoryKnowledgeFs(files), { hash: () => 'h' });
        expect(out).toHaveLength(total);
    });
});
