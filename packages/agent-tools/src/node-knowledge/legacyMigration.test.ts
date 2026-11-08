import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { filesManifestKey } from '@seanhogg/builderforce-memory/knowledge';
import { extractedLogFileName, manifestFileName, migratingRootFiles, replicaFileName, dirtyFileName, analysisPendingFileName, snapshotFileName, type KnowledgeFiles } from '../knowledge/fileManifest.js';
import { localSqliteAvailable } from '../node-local-sqlite.js';
import { nodeKnowledgeStore, type NodeKnowledgeStore } from '../node-knowledge-store.js';
import { CHUNK_ROWS, migrateLegacyKnowledge } from './legacyMigration.js';

const folders: string[] = [];
const opened: NodeKnowledgeStore[] = [];
afterEach(() => {
    for (const o of opened.splice(0)) { try { o.close(); } catch { /* closed */ } }
    for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true });
});

const open = (dir: string, busyTimeoutMs?: number): NodeKnowledgeStore => {
    const k = nodeKnowledgeStore(dir, busyTimeoutMs === undefined ? {} : { busyTimeoutMs });
    opened.push(k);
    return k;
};
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'legacy-migration-')); folders.push(d); return d; };

interface MemFiles extends KnowledgeFiles { data: Map<string, string>; failRename: { on: boolean } }
function memoryFiles(seed: Record<string, string> = {}): MemFiles {
    const data = new Map(Object.entries(seed));
    const failRename = { on: false };
    return {
        data, failRename,
        read: async (n) => data.get(n),
        write: async (n, t) => { data.set(n, t); },
        rename: async (from, to) => {
            if (failRename.on) throw new Error('EBUSY');
            if (!data.has(from)) throw new Error('ENOENT');
            data.set(to, data.get(from)!);
            data.delete(from);
        },
    };
}

const ROOT = 'vscode:github.com/acme/app';
const fact = (_root: string, key: string) => ({ key, content: `c ${key}`, source: 's', importance: 0.5, origin: 'model' as const, fileAnchors: [] });
const snapshotOf = (root: string, facts = 2): string => JSON.stringify({
    version: 1,
    scopes: [{ rootId: root, title: 'App', packs: ['code'] }],
    facts: { [root]: Array.from({ length: facts }, (_, i) => fact(root, `claim:${i}`)) },
    relations: { [root]: [{ from: 'fact:claim:0', to: `src:${root}::a.ts`, kind: 'about', weight: 1, origin: 'model' }] },
    recheck: ['rc1'],
});
const manifestOf = (root: string): string => JSON.stringify({ [filesManifestKey(root)]: [{ id: 'a.ts', hash: 'h1' }] });
const logLine = (hash: string): string => `${JSON.stringify({ h: hash, e: [{ sourceRef: `src:${ROOT}::a.ts`, sourceHash: hash, nodes: [], edges: [], keys: [] }] })}\n`;
const legacySeed = (root = ROOT, facts = 2): Record<string, string> => ({
    [snapshotFileName(root)]: snapshotOf(root, facts),
    [manifestFileName(root)]: manifestOf(root),
    [extractedLogFileName(root)]: logLine('h1'),
});

describe.skipIf(!localSqliteAvailable())('migrateLegacyKnowledge', () => {
    it('imports the snapshot, manifest and extract log, then renames the three files and leaves the replica files alone', async () => {
        const dir = tmp();
        const k = open(dir);
        const files = memoryFiles({
            ...legacySeed(),
            [replicaFileName(ROOT)]: '{"replica":1}', [dirtyFileName(ROOT)]: '{"dirty":1}', [analysisPendingFileName(ROOT)]: '{}', 'runs/r1.json': '{}',
        });
        const lines: string[] = [];
        const result = await migrateLegacyKnowledge(files, k, ROOT, { log: (l) => lines.push(l) });
        expect(result).toMatchObject({ imported: true, corrupt: false });
        expect(lines.join('\n')).toMatch(/migrated legacy files of .* in \d+ ms/);

        for (const name of [snapshotFileName(ROOT), manifestFileName(ROOT), extractedLogFileName(ROOT)]) {
            expect(files.data.has(name)).toBe(false);
            expect(files.data.has(`${name}.migrated`)).toBe(true);
        }
        for (const untouched of [replicaFileName(ROOT), dirtyFileName(ROOT), analysisPendingFileName(ROOT), 'runs/r1.json']) expect(files.data.has(untouched)).toBe(true);

        expect((await k.store.facts({ rootId: ROOT })).map((f) => f.key).sort()).toEqual(['claim:0', 'claim:1']);
        expect(await k.store.relations({ rootId: ROOT })).toHaveLength(1);
        expect(await k.store.recheckHashes()).toEqual(['rc1']);
        expect(await k.manifest.get(filesManifestKey(ROOT))).toEqual([{ id: 'a.ts', hash: 'h1' }]);
        expect(await k.store.getExtracted!('h1')).toHaveLength(1);
        expect(k.persistence.getMeta('format')).toBe('1');
    });

    it('the first read waits for a migration that is still in flight', async () => {
        const k = open(tmp());
        const files = memoryFiles(legacySeed());
        void migrateLegacyKnowledge(files, k, ROOT); // not awaited
        expect((await k.store.facts({ rootId: ROOT })).length).toBe(2);
    });

    it('a crash after the commit (the rename failed) still renames on the next open, without importing twice', async () => {
        const dir = tmp();
        const k = open(dir);
        const files = memoryFiles(legacySeed());
        files.failRename.on = true;
        await migrateLegacyKnowledge(files, k, ROOT);
        expect(files.data.has(snapshotFileName(ROOT))).toBe(true); // rows committed, files still there
        expect(k.persistence.getMeta('format')).toBe('1');
        k.close();

        files.failRename.on = false;
        const reopened = open(dir);
        const second = await migrateLegacyKnowledge(files, reopened, ROOT);
        expect(second.imported).toBe(false);
        for (const name of [snapshotFileName(ROOT), manifestFileName(ROOT), extractedLogFileName(ROOT)]) {
            expect(files.data.has(name)).toBe(false);
            expect(files.data.has(`${name}.migrated`)).toBe(true);
        }
        expect((await reopened.store.facts({ rootId: ROOT })).length).toBe(2);
    });

    it('keeps a snapshot that does not parse as .corrupt, sets format and starts empty (no manifest ahead of missing facts)', async () => {
        const k = open(tmp());
        const files = memoryFiles({
            [snapshotFileName(ROOT)]: '{ truncated',
            [manifestFileName(ROOT)]: manifestOf(ROOT),
            [extractedLogFileName(ROOT)]: logLine('h1'),
        });
        const result = await migrateLegacyKnowledge(files, k, ROOT);
        expect(result.corrupt).toBe(true);
        expect(files.data.get(`${snapshotFileName(ROOT)}.corrupt`)).toBe('{ truncated');
        expect(files.data.has(snapshotFileName(ROOT))).toBe(false);
        expect(k.persistence.getMeta('format')).toBe('1');
        expect(await k.store.scopes()).toEqual([]);
        expect(await k.manifest.get(filesManifestKey(ROOT))).toBeUndefined();
    });

    it('a root with no legacy files only gets its marker (and a second call reads nothing)', async () => {
        const k = open(tmp());
        const files = memoryFiles();
        expect(await migrateLegacyKnowledge(files, k, ROOT)).toMatchObject({ imported: true, rows: 0 });
        expect(k.persistence.getMeta(`migrated:${ROOT}`)).toBe('1');
        files.data.set(snapshotFileName(ROOT), snapshotOf(ROOT));
        expect((await migrateLegacyKnowledge(files, k, ROOT)).imported).toBe(false);
    });

    it('imports each root of a folder separately (format is per file, the marker per root)', async () => {
        const other = 'vscode:github.com/acme/other';
        const k = open(tmp());
        await migrateLegacyKnowledge(memoryFiles(legacySeed(ROOT)), k, ROOT);
        await migrateLegacyKnowledge(memoryFiles(legacySeed(other)), k, other);
        expect((await k.store.scopes()).map((s) => s.rootId).sort()).toEqual([other, ROOT].sort());
        expect((await k.store.facts({ rootId: other })).length).toBe(2);
    });

    it('imports a root reviewed under its legacy id through migratingRootFiles, and renames both generations of files', async () => {
        const OLD = 'app';
        const raw = memoryFiles({
            [snapshotFileName(OLD)]: snapshotOf(OLD),
            [manifestFileName(OLD)]: manifestOf(OLD),
        });
        const k = open(tmp());
        await migrateLegacyKnowledge(migratingRootFiles(raw, ROOT, OLD), k, ROOT, { legacyRootId: OLD });
        expect((await k.store.scopes()).map((s) => s.rootId)).toEqual([ROOT]);
        expect((await k.store.facts({ rootId: ROOT })).length).toBe(2);
        expect(await k.manifest.get(filesManifestKey(ROOT))).toEqual([{ id: 'a.ts', hash: 'h1' }]);
        for (const id of [OLD, ROOT]) {
            expect(raw.data.has(snapshotFileName(id))).toBe(false);
            expect(raw.data.has(`${snapshotFileName(id)}.migrated`)).toBe(true);
        }
    });

    it('imports a large snapshot in chunks of at most 2000 rows inside one transaction', async () => {
        const k = open(tmp());
        const total = CHUNK_ROWS * 2 + 500;
        const files = memoryFiles({ [snapshotFileName(ROOT)]: snapshotOf(ROOT, total) });
        const before = Number(k.persistence.getMeta('generation') ?? 0);
        await migrateLegacyKnowledge(files, k, ROOT);
        expect((await k.store.facts({ rootId: ROOT })).length).toBe(total);
        expect(Number(k.persistence.getMeta('generation'))).toBe(before + 1); // ONE transaction
    });

    it('a second window that meets SQLITE_BUSY waits, sees the first window\'s marker and only renames', async () => {
        const dir = tmp();
        const first = open(dir);
        const second = open(dir, 20);
        const filesA = memoryFiles(legacySeed());
        const filesB = memoryFiles(legacySeed());
        let started!: () => void;
        const held = new Promise<void>((resolve) => { started = resolve; });
        // The first window holds the write lock across event-loop turns, then commits its marker.
        const slow = first.persistence.transaction(async (w) => {
            started();
            await new Promise((r) => setTimeout(r, 250));
            w.upsert({ upserts: { scopes: [{ rootId: ROOT, title: 'App', packs: ['code'] }], facts: [], relations: [], extracted: [], recheck: [] }, deletes: { scopes: [], facts: [], relations: [], extracted: [], recheck: [] } });
            w.setMeta('format', '1');
            w.setMeta(`migrated:${ROOT}`, '1');
        });
        await held;
        const result = await migrateLegacyKnowledge(filesB, second, ROOT);
        await slow;
        expect(result.imported).toBe(false);
        expect(filesB.data.has(snapshotFileName(ROOT))).toBe(false);
        expect(filesB.data.has(`${snapshotFileName(ROOT)}.migrated`)).toBe(true);
        expect(filesA.data.has(snapshotFileName(ROOT))).toBe(true); // the first window's own files are its business
    });

    it('regression: rows a review wrote after a failed import are never overwritten by the next session\'s legacy import', async () => {
        const k = open(tmp());
        // The first session's import failed (never marked); the review then wrote NEWER rows for the root.
        await k.store.write({ scope: { rootId: ROOT, title: 'Newer', packs: ['code'] }, facts: [{ ...fact(ROOT, 'claim:0'), content: 'NEWER' }], relations: [] });
        await k.manifest.set(filesManifestKey(ROOT), [{ id: 'new.ts', hash: 'n' }]);
        const files = memoryFiles(legacySeed());
        const result = await migrateLegacyKnowledge(files, k, ROOT);
        expect(result.imported).toBe(false);
        expect((await k.store.facts({ rootId: ROOT })).map((f) => [f.key, f.content])).toEqual([['claim:0', 'NEWER']]); // claim:1 was not imported either
        expect((await k.store.scopes())[0]!.title).toBe('Newer');
        expect(await k.manifest.get(filesManifestKey(ROOT))).toEqual([{ id: 'new.ts', hash: 'n' }]);
        expect(k.persistence.getMeta(`migrated:${ROOT}`)).toBe('1');
        expect(files.data.has(snapshotFileName(ROOT))).toBe(false); // only the rename happened
        expect(files.data.has(`${snapshotFileName(ROOT)}.migrated`)).toBe(true);
    });

    it('regression: the import itself is insert-only (DO NOTHING), so a conflicting legacy row never overwrites', async () => {
        const k = open(tmp());
        await k.store.write({ scope: { rootId: ROOT, title: 'Newer', packs: ['code'] }, facts: [{ ...fact(ROOT, 'claim:0'), content: 'NEWER' }], relations: [] });
        const empty = { scopes: [], facts: [], relations: [], extracted: [], recheck: [] };
        await k.persistence.transaction((w) => {
            w.upsert({
                upserts: { ...empty, scopes: [{ rootId: ROOT, title: 'Legacy', packs: ['code'] }], facts: [[ROOT, { ...fact(ROOT, 'claim:0'), content: 'LEGACY' }], [ROOT, fact(ROOT, 'claim:9')]] as Array<[string, never]> },
                deletes: { ...empty },
            });
            w.upsertManifest({ k: [{ id: 'old', hash: '1' }] });
            w.upsertManifest({ k: [{ id: 'older', hash: '0' }] });
        });
        const reloaded = (await k.persistence.load())!;
        expect(reloaded.facts[ROOT]!.map((f) => [f.key, f.content]).sort()).toEqual([['claim:0', 'NEWER'], ['claim:9', 'c claim:9']]);
        expect(reloaded.scopes[0]!.title).toBe('Newer');
        expect(await k.manifest.get('k')).toEqual([{ id: 'old', hash: '1' }]); // the first write won
    });

    it('a transaction that wrote no rows does not move the generation (a root with no legacy files)', async () => {
        const k = open(tmp());
        const before = k.persistence.getMeta('generation');
        await migrateLegacyKnowledge(memoryFiles(), k, ROOT);
        expect(k.persistence.getMeta('generation')).toBe(before);
        expect(k.persistence.getMeta(`migrated:${ROOT}`)).toBe('1');
    });

    it('a window gives up after the wall-time limit with a clear error, and keeps its legacy files', async () => {
        const dir = tmp();
        const first = open(dir);
        const second = open(dir, 20);
        let started!: () => void;
        const held = new Promise<void>((resolve) => { started = resolve; });
        const slow = first.persistence.transaction(async () => { started(); await new Promise((r) => setTimeout(r, 600)); });
        await held;
        const files = memoryFiles(legacySeed());
        await expect(migrateLegacyKnowledge(files, second, ROOT, { busyLimitMs: 150 })).rejects.toThrow(/knowledge_migration_busy/);
        await slow;
        expect(files.data.has(snapshotFileName(ROOT))).toBe(true);
        // The next open imports them.
        expect((await migrateLegacyKnowledge(files, second, ROOT)).imported).toBe(true);
    });
});
