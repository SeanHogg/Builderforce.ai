import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFsDirectorySource, type KnowledgeFs } from '../knowledge/fsDirectorySource.js';
import { memoryKnowledgeFs, type MemoryFile } from '../knowledge/memoryKnowledgeFs.test-util.js';
import { localSqliteAvailable } from '../node-local-sqlite.js';
import { nodeKnowledgeStore, type NodeKnowledgeStore } from '../node-knowledge-store.js';
import { readStatSet } from './statRows.js';

const folders: string[] = [];
const open: NodeKnowledgeStore[] = [];
afterEach(() => {
    for (const o of open.splice(0)) { try { o.close(); } catch { /* closed */ } }
    for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true });
});
const folder = (): string => { const d = mkdtempSync(join(tmpdir(), 'stat-rows-')); folders.push(d); return d; };
const opened = (dir: string): NodeKnowledgeStore => { const k = nodeKnowledgeStore(dir); open.push(k); return k; };

const FILES: Record<string, MemoryFile> = { '/r/a.ts': { text: 'a', mtime: 1_000 }, '/r/src/b.ts': { text: 'bb', mtime: 1_000 } };

function counted(files: Record<string, MemoryFile>) {
    const base = memoryKnowledgeFs(files);
    const readFile = vi.fn(base.readFile);
    // A Node host's stat: ns mtimes and a 64-bit file id past 2^53, which only a lossless column keeps.
    const stat: KnowledgeFs['stat'] = async (p) => ({ ...(await base.stat(p)), mtimeNs: 1_700_000_000_123_456_789n, fileId: 18_446_744_073_709_551_557n });
    return { fs: { ...base, stat, readFile } as KnowledgeFs, readFile };
}

async function walk(fs: KnowledgeFs, store: NodeKnowledgeStore) {
    const source = createFsDirectorySource({ fs, rootPath: '/r', rootId: 'r', title: 'r', hashCache: store.hashCache });
    const out: string[] = [];
    for await (const f of source.list()) out.push(`${f.path}:${f.hash}`);
    return out;
}

describe.skipIf(!localSqliteAvailable())('the stat manifest in the knowledge SQLite file', () => {
    it('survives reopening the store: a warm walk after a restart reads zero files', async () => {
        const dir = folder();
        const { fs, readFile } = counted(FILES);
        const first = opened(dir);
        const listed = await walk(fs, first);
        expect(readFile).toHaveBeenCalledTimes(2);
        first.close();
        readFile.mockClear();
        const again = opened(dir);
        expect(await walk(fs, again)).toEqual(listed);
        expect(readFile).not.toHaveBeenCalled();
        // BigInts round-trip exactly.
        const row = readStatSet(again.persistence, 'r').rows.get('src/b.ts')!;
        expect(row.mtimeNs).toBe(1_700_000_000_123_456_789n);
        expect(row.fileId).toBe(18_446_744_073_709_551_557n);
        expect(again.hashCache.sizeOf?.('r', 'src/b.ts')).toBe(2);
    });

    it('keeps each root apart, and a save never moves the fact generation', async () => {
        const store = opened(folder());
        const generation = store.persistence.getMeta('generation');
        await walk(counted(FILES).fs, store);
        await store.hashCache.save('other', [], 5n);
        expect(readStatSet(store.persistence, 'r').rows.size).toBe(2);
        expect(readStatSet(store.persistence, 'other').rows.size).toBe(0);
        expect(store.persistence.getMeta('generation')).toBe(generation);
    });

    it('a file of a newer format (read-only here) never gets stat rows written', async () => {
        const dir = folder();
        const first = opened(dir);
        first.persistence.setMeta('format', '99');
        first.close();
        const newer = opened(dir);
        expect(newer.formatNewer).toBe(true);
        const { fs, readFile } = counted(FILES);
        expect(await walk(fs, newer)).toHaveLength(2); // the walk still works
        expect(readFile).toHaveBeenCalledTimes(2);
        expect(newer.persistence.db.prepare('SELECT COUNT(*) AS n FROM stat').get()).toEqual({ n: 0 });
        expect(newer.persistence.getMeta('stat_written:r')).toBeUndefined();
        expect(newer.persistence.getMeta('format')).toBe('99');
        await expect(newer.persistence.writeOwn(() => undefined)).rejects.toThrow(/knowledge_index_format_newer/);
    });
});
