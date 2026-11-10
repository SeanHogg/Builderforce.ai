import { describe, expect, it, vi } from 'vitest';
import { createFsDirectorySource, MAX_LISTED_FILES, type KnowledgeFs } from './fsDirectorySource.js';
import { memoryKnowledgeFs, type MemoryFile } from './memoryKnowledgeFs.test-util.js';
import { memoryHashCache, type GitHints, type HashCache } from './statManifest.js';

const OLD = 1_000; // ms: a file last modified long before any walk

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

describe('the stat prefilter (PRD 41 B2)', () => {
    it('a warm re-walk reads zero files when nothing changed, and saves nothing', async () => {
        const files: Record<string, MemoryFile> = { '/r/a.ts': { text: 'a', mtime: OLD }, '/r/d/b.ts': { text: 'bb', mtime: OLD } };
        const { fs, readFile } = counted(files);
        const inner = memoryHashCache();
        const save = vi.fn(inner.save);
        const hashCache: HashCache = { ...inner, save };
        const first = await walk(fs, { hashCache });
        expect(readFile).toHaveBeenCalledTimes(2);
        expect(save).toHaveBeenCalledTimes(1);
        readFile.mockClear();
        const second = await walk(fs, { hashCache });
        expect(readFile).not.toHaveBeenCalled();
        expect(second).toEqual(first);
        expect(save).toHaveBeenCalledTimes(1); // an unchanged walk writes nothing
    });

    it('re-reads a file whose size, mtime or file id changed, and drops a deleted file from the rows', async () => {
        const files: Record<string, MemoryFile> = { '/r/a.ts': { text: 'a', mtime: OLD }, '/r/b.ts': { text: 'b', mtime: OLD }, '/r/c.ts': { text: 'c', mtime: OLD } };
        const { fs, readFile } = counted(files);
        const hashCache = memoryHashCache();
        await walk(fs, { hashCache });
        readFile.mockClear();
        files['/r/a.ts'] = { text: 'A', mtime: OLD + 5 };
        delete files['/r/c.ts'];
        const out = await walk(fs, { hashCache });
        expect(readFile.mock.calls.map((c) => c[0])).toEqual(['/r/a.ts']);
        expect(out.map((f) => f.path)).toEqual(['a.ts', 'b.ts']);
        expect([...(await hashCache.load('r')).rows.keys()].sort()).toEqual(['a.ts', 'b.ts']);
        // A changed file id (the file was replaced) re-reads even at the same size and mtime.
        const base = memoryKnowledgeFs(files);
        let id = 1n;
        const withIds: KnowledgeFs = { ...base, readFile, stat: async (p) => ({ ...(await base.stat(p)), fileId: p.endsWith('b.ts') ? id : 7n }) };
        await walk(withIds, { hashCache });
        readFile.mockClear();
        id = 2n;
        await walk(withIds, { hashCache });
        expect(readFile.mock.calls.map((c) => c[0])).toEqual(['/r/b.ts']);
    });

    it('re-hashes a file modified within 2 s of the rows being written (racy), and trusts one outside that window', async () => {
        const files: Record<string, MemoryFile> = { '/r/racy.ts': { text: 'x', mtime: 10_000 }, '/r/calm.ts': { text: 'y', mtime: 5_000 } };
        const { fs, readFile } = counted(files);
        const hashCache = memoryHashCache();
        // The rows are written at 11.5 s: racy.ts (10 s) is within 2 s of it, calm.ts (5 s) is not.
        await walk(fs, { hashCache, now: () => 11_500 });
        readFile.mockClear();
        await walk(fs, { hashCache, now: () => 11_600 });
        expect(readFile.mock.calls.map((c) => c[0])).toEqual(['/r/racy.ts']);
        // The re-hash re-wrote the rows at 11.6 s, so the next walk still finds it racy (10 s ≥ 9.6 s); written at 12.5 s, it settles (10 s < 10.5 s).
        readFile.mockClear();
        await walk(fs, { hashCache, now: () => 12_500 });
        expect(readFile.mock.calls.map((c) => c[0])).toEqual(['/r/racy.ts']);
        readFile.mockClear();
        await walk(fs, { hashCache, now: () => 20_000 });
        expect(readFile).not.toHaveBeenCalled();
    });

    it('a clean git file whose stat moved but whose blob is the one it was hashed at is not read; a dirty one is', async () => {
        const files: Record<string, MemoryFile> = { '/r/clean.ts': { text: 'c', mtime: OLD }, '/r/dirty.ts': { text: 'd', mtime: OLD } };
        const { fs, readFile } = counted(files);
        const hashCache = memoryHashCache();
        const hints = (blobs: Record<string, string>, takenAtMs: number) => async (): Promise<GitHints> =>
            ({ blobs: new Map(Object.entries(blobs)), takenAtNs: BigInt(takenAtMs) * 1_000_000n });
        const first = await walk(fs, { hashCache, gitHints: hints({ 'clean.ts': 'b1', 'dirty.ts': 'b2' }, OLD + 1) });
        expect((await hashCache.load('r')).rows.get('clean.ts')?.gitBlob).toBe('b1');
        readFile.mockClear();
        // A checkout touched both files (same bytes and size, new mtimes); git says clean.ts is clean at b1, dirty.ts is not clean.
        files['/r/clean.ts'] = { text: 'c', mtime: 50_000 };
        files['/r/dirty.ts'] = { text: 'D', mtime: 50_000 };
        const second = await walk(fs, { hashCache, gitHints: hints({ 'clean.ts': 'b1' }, 60_000), now: () => 70_000 });
        expect(readFile.mock.calls.map((c) => c[0])).toEqual(['/r/dirty.ts']);
        expect(second.find((f) => f.path === 'clean.ts')!.hash).toBe(first.find((f) => f.path === 'clean.ts')!.hash);
        // A hint taken BEFORE the file was modified is not used: git saw other bytes.
        files['/r/clean.ts'] = { text: 'c', mtime: 80_000 };
        readFile.mockClear();
        await walk(fs, { hashCache, gitHints: hints({ 'clean.ts': 'b1' }, 75_000), now: () => 90_000 });
        expect(readFile.mock.calls.map((c) => c[0])).toEqual(['/r/clean.ts']);
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
