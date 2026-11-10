import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RowChange } from '@seanhogg/builderforce-memory/knowledge';
import { createFsDirectorySource, DEFAULT_HASH_RULE, type KnowledgeFs } from '../knowledge/fsDirectorySource.js';
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
const RULE = DEFAULT_HASH_RULE;

// 2023-11-14: in ns, past 2^53.
const FILES: Record<string, MemoryFile> = { '/r/a.ts': { text: 'a', mtime: 1_700_000_000_000 }, '/r/src/b.ts': { text: 'bb', mtime: 1_700_000_000_000 } };

function counted(files: Record<string, MemoryFile>) {
    const base = memoryKnowledgeFs(files);
    const readFile = vi.fn(base.readFile);
    // A Node host's stat: ns mtimes and a 64-bit file id past 2^53, which only a lossless column keeps.
    const stat: KnowledgeFs['stat'] = async (p) => ({ ...(await base.stat(p)), mtimeNs: BigInt((files[p] as { mtime: number }).mtime) * 1_000_000n + 123_456n, fileId: 18_446_744_073_709_551_557n });
    return { fs: { ...base, stat, readFile } as KnowledgeFs, readFile };
}

async function walk(fs: KnowledgeFs, store: NodeKnowledgeStore) {
    const source = createFsDirectorySource({ fs, rootPath: '/r', rootId: 'r', title: 'r', hashCache: store.hashCache });
    const out: string[] = [];
    for await (const f of source.list()) out.push(`${f.path}:${f.hash}`);
    return out;
}

const totalChanges = (store: NodeKnowledgeStore): number => Number((store.persistence.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n);

const removeScope = (rootId: string): RowChange => ({
    upserts: { scopes: [], facts: [], relations: [], extracted: [], recheck: [] },
    deletes: { scopes: [rootId], facts: [], relations: [], extracted: [], recheck: [] },
} as unknown as RowChange);

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
        const row = (await readStatSet(again.persistence, 'r', RULE)).rows.get('src/b.ts')!;
        expect(row.mtimeNs).toBe(1_700_000_000_000_123_456n);
        expect(row.fileId).toBe(18_446_744_073_709_551_557n);
        expect(again.hashCache.sizeOf?.('r', 'src/b.ts')).toBe(2);
    });

    it('writes a delta: a one-file edit on a large set changes O(1) rows', async () => {
        const files: Record<string, MemoryFile> = {};
        for (let i = 0; i < 2_000; i++) files[`/r/d${i % 10}/f${i}.ts`] = { text: `v${i}`, mtime: 1_000 };
        const { fs } = counted(files);
        const store = opened(folder());
        await walk(fs, store);
        files['/r/d3/f3.ts'] = { text: 'edited', mtime: 2_000 };
        const before = totalChanges(store);
        await walk(fs, store);
        // One stat row plus the rule, reference-time and format meta keys.
        expect(totalChanges(store) - before).toBeLessThanOrEqual(5);
        expect((await readStatSet(store.persistence, 'r', RULE)).rows.size).toBe(2_000);
    });

    it('rows made under another hash rule load as stale, and a save under the new rule replaces them', async () => {
        const store = opened(folder());
        await walk(counted(FILES).fs, store);
        expect(await readStatSet(store.persistence, 'r', 'another-rule')).toMatchObject({ stale: true });
        expect((await readStatSet(store.persistence, 'r', 'another-rule')).rows.size).toBe(0);
        await store.hashCache.save('r', { rule: 'another-rule', upserts: [], deletes: [], writtenAtNs: 5n, replace: true });
        expect((await readStatSet(store.persistence, 'r', 'another-rule')).rows.size).toBe(0);
        expect(store.persistence.db.prepare("SELECT COUNT(*) AS n FROM stat WHERE root_id = 'r'").get()).toEqual({ n: 0 });
    });

    it('keeps each root apart, a save never moves the fact generation, and a removed root takes its rows with it', async () => {
        const store = opened(folder());
        const generation = store.persistence.getMeta('generation');
        await walk(counted(FILES).fs, store);
        await store.hashCache.save('other', { rule: RULE, upserts: [], deletes: [], writtenAtNs: 5n });
        expect((await readStatSet(store.persistence, 'r', RULE)).rows.size).toBe(2);
        expect(store.persistence.getMeta('generation')).toBe(generation);
        await store.persistence.apply(removeScope('r'));
        expect(store.persistence.db.prepare("SELECT COUNT(*) AS n FROM stat WHERE root_id = 'r'").get()).toEqual({ n: 0 });
        expect(store.persistence.getMeta('stat_written:r')).toBeUndefined();
        expect(store.persistence.getMeta('stat_rule:r')).toBeUndefined();
        expect(store.persistence.getMeta('stat_rule:other')).toBe(RULE);
    });

    it("another window's stat save does not make this one reload its facts; its manifest-only commit still does", async () => {
        const dir = folder();
        const a = opened(dir);
        const b = opened(dir);
        await a.persistence.load();
        expect(await a.persistence.changedElsewhere()).toBe(false);
        await walk(counted(FILES).fs, b); // b writes stat rows: data_version moves for a, nothing else
        expect(await a.persistence.changedElsewhere()).toBe(false);
        await b.manifest.set('m', [{ id: 'a', hash: '1' }]);
        expect(await a.persistence.changedElsewhere()).toBe(true);
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
