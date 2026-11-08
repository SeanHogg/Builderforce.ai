import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalDump, type Extracted, type ScopeRecord, type StoredFact, type StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
import { localSqliteAvailable } from './node-local-sqlite.js';
import { knowledgeDbPath, nodeIngestManifest, nodeKnowledgeStore, type NodeKnowledgeStore } from './node-knowledge-store.js';
import { moveAside } from './node-knowledge/openKnowledgeDb.js';
import { writeManifestEntries } from './node-knowledge/manifestBuffer.js';

// A hook to make the opener fail the way a read-only or failing disk does (the real opener is used otherwise).
const hook = vi.hoisted(() => ({ failOpenWith: undefined as Error | undefined }));
vi.mock('./node-local-sqlite.js', async (importOriginal) => {
    const real = await importOriginal<typeof import('./node-local-sqlite.js')>();
    return {
        ...real,
        openLocalSqlite: (...args: Parameters<typeof real.openLocalSqlite>) => {
            if (hook.failOpenWith) throw hook.failOpenWith;
            return real.openLocalSqlite(...args);
        },
    };
});

const folders: string[] = [];
const open: Array<{ close(): void }> = [];

afterEach(() => {
    hook.failOpenWith = undefined;
    vi.restoreAllMocks();
    for (const o of open.splice(0)) { try { o.close(); } catch { /* closed */ } }
    for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true });
});

const folder = (): string => { const d = mkdtempSync(join(tmpdir(), 'node-knowledge-')); folders.push(d); return d; };
const opened = (dir: string): NodeKnowledgeStore => { const k = nodeKnowledgeStore(dir); open.push(k); return k; };

const SCOPE: ScopeRecord = { rootId: 'r', title: 'R', packs: ['docs'] };
const fact = (key: string, content: string): StoredFact => ({ key, content, source: 's', importance: 0.5, origin: 'model', fileAnchors: [] });
const rel = (to: string, kind: string): StoredRelation => ({ from: 'fact:claim:1', to: to as StoredRelation['to'], kind, weight: 1, origin: 'model', sourceHash: 'h1' });
const emptyRows = () => ({ scopes: [], facts: [], relations: [], extracted: [], recheck: [] });
const changeOf = (key: string) => ({
    upserts: { ...emptyRows(), scopes: [SCOPE], facts: [['r', fact(key, key)] as [string, StoredFact]] },
    deletes: emptyRows(),
});
const extracted = (hash: string): Extracted => ({ sourceRef: 'src:r::a.ts', sourceHash: hash, nodes: [], edges: [], keys: [] });

describe.skipIf(!localSqliteAvailable())('nodeKnowledgeStore', () => {
    it('round-trips scope, facts, relations, recheck and extract bodies through memory\'s store, byte-equal to the canonical dump', async () => {
        const dir = folder();
        const a = opened(dir);
        await a.store.write({ scope: SCOPE, facts: [fact('claim:1', 'one'), fact('claim:2', 'two')], relations: [rel('src:r::a.md#a', 'about')] });
        await a.store.putExtracted!('h1', [extracted('h1')]);
        await a.store.markRecheck(['c1']);
        const dump = await canonicalDump(a.store);
        a.close();

        const b = opened(dir);
        expect((await b.store.facts({ rootId: 'r' })).map((f) => f.key).sort()).toEqual(['claim:1', 'claim:2']);
        expect(await b.store.relations({ rootId: 'r' })).toHaveLength(1);
        expect(await b.store.scopes()).toEqual([SCOPE]);
        expect(await b.store.recheckHashes()).toEqual(['c1']);
        expect(await canonicalDump(b.store)).toBe(dump);
    });

    it('loads extract bodies lazily per hash and all of them for a dump', async () => {
        const dir = folder();
        const a = opened(dir);
        await a.store.putExtracted!('h1', [extracted('h1')]);
        await a.store.putExtracted!('h2', [extracted('h2')]);
        a.close();

        const b = opened(dir);
        const lazy = vi.spyOn(b.persistence, 'loadExtracted');
        await b.store.scopes(); // the load carries rows only
        expect(lazy).not.toHaveBeenCalled();
        expect(await b.store.getExtracted!('h1')).toEqual([extracted('h1')]);
        expect(lazy).toHaveBeenCalledWith('h1');
        expect(await b.store.getExtracted!('missing')).toBeUndefined();
        expect(Object.keys(await b.store.extractedEntries()).sort()).toEqual(['h1', 'h2']);
        expect(Object.keys(await b.persistence.loadAllExtracted())).toEqual(expect.arrayContaining(['h1', 'h2']));
    });

    it('two stores on one file see each other\'s writes, and a stale writer reloads on a generation mismatch', async () => {
        const dir = folder();
        const a = opened(dir);
        const b = opened(dir);
        await a.store.write({ scope: SCOPE, facts: [fact('claim:a', 'from a')], relations: [] });
        expect((await b.store.facts({ rootId: 'r' })).map((f) => f.key)).toEqual(['claim:a']); // data_version noticed

        await b.store.write({ scope: SCOPE, facts: [fact('claim:b', 'from b')], relations: [] });
        // A has not read since B wrote: its apply meets a generation mismatch and gets the rows back.
        await a.store.write({ scope: SCOPE, facts: [fact('claim:c', 'from a again')], relations: [] });
        expect((await a.store.facts({ rootId: 'r' })).map((f) => f.key).sort()).toEqual(['claim:a', 'claim:b', 'claim:c']);
        expect((await b.store.facts({ rootId: 'r' })).map((f) => f.key).sort()).toEqual(['claim:a', 'claim:b', 'claim:c']);
    });

    it('returns `reloaded` (rows, no extract bodies) only when another writer committed since this one last saw the store', async () => {
        const dir = folder();
        const a = opened(dir);
        const b = opened(dir);
        await a.persistence.load();
        const change = (key: string) => ({
            upserts: { scopes: [SCOPE], facts: [['r', fact(key, key)] as [string, StoredFact]], relations: [], extracted: [['h', [extracted('h')]] as [string, Extracted[]]], recheck: [] },
            deletes: { scopes: [], facts: [], relations: [], extracted: [], recheck: [] },
        });
        const own = await a.persistence.apply(change('k1'));
        expect(own.reloaded).toBeUndefined();
        await b.persistence.load();
        await b.persistence.apply(change('k2'));
        const stale = await a.persistence.apply(change('k3'));
        expect(Object.values(stale.reloaded!.facts).flat().map((f) => f.key).sort()).toEqual(['k1', 'k2', 'k3']);
        expect(stale.reloaded!.extracted).toBeUndefined();
        expect(stale.generation).toBeGreaterThan(own.generation);
    });

    it('applies a retry with a superset of a committed change idempotently', async () => {
        const a = opened(folder());
        await a.persistence.load();
        const empty = { scopes: [], facts: [], relations: [], extracted: [], recheck: [] };
        const first = { upserts: { ...empty, scopes: [SCOPE], facts: [['r', fact('k1', 'v')] as [string, StoredFact]], recheck: ['c'] }, deletes: { ...empty } };
        await a.persistence.apply(first);
        await a.persistence.apply(first);
        const superset = { upserts: { ...first.upserts, facts: [...first.upserts.facts, ['r', fact('k2', 'w')] as [string, StoredFact]] }, deletes: { ...empty, facts: [['r', 'gone'] as [string, string]] } };
        const again = await a.persistence.apply(superset);
        const snap = again.reloaded ?? (await a.persistence.load())!;
        expect(snap.facts.r!.map((f) => f.key).sort()).toEqual(['k1', 'k2']);
        expect(snap.recheck).toEqual(['c']);
    });

    it('notices another writer through PRAGMA data_version, and stops noticing once it has loaded', async () => {
        const dir = folder();
        const a = opened(dir);
        const b = opened(dir);
        await a.persistence.load();
        expect(await a.persistence.changedElsewhere()).toBe(false);
        await b.store.write({ scope: SCOPE, facts: [fact('claim:1', 'x')], relations: [] });
        expect(await a.persistence.changedElsewhere()).toBe(true);
        await a.persistence.load();
        expect(await a.persistence.changedElsewhere()).toBe(false);
    });

    it('a manifest set rides with dirty facts in ONE apply, and commits alone (manifest-only) when no fact is dirty', async () => {
        const dir = folder();
        const a = opened(dir);
        const apply = vi.spyOn(a.persistence, 'apply');
        const alone = vi.spyOn(a.persistence, 'commitBuffered');
        await a.store.batched(async () => {
            await a.store.write({ scope: SCOPE, facts: [fact('claim:1', 'x')], relations: [] }); // held back by the batch
            expect(apply).not.toHaveBeenCalled();
            await a.manifest.set('knowledge:r', [{ id: 'a.md', hash: 'h1' }]);
            expect(apply).toHaveBeenCalledTimes(1);
            expect(alone).not.toHaveBeenCalled();
        });
        const reader = nodeIngestManifest(dir);
        open.push(reader);
        const readerStore = opened(dir);
        expect(await reader.get('knowledge:r')).toEqual([{ id: 'a.md', hash: 'h1' }]);
        expect((await readerStore.store.facts({ rootId: 'r' })).map((f) => f.key)).toEqual(['claim:1']);

        await a.manifest.set('knowledge:r:judged', [{ id: 's', hash: 'h2' }]); // nothing dirty
        expect(alone).toHaveBeenCalledTimes(1);
        expect(await reader.get('knowledge:r:judged')).toEqual([{ id: 's', hash: 'h2' }]);
    });

    it('a failed apply rolls back the facts AND the manifest write, and the manifest still reads through its buffer', async () => {
        const a = opened(folder());
        const circular: Record<string, unknown> = { key: 'claim:x' };
        circular.self = circular;
        await a.store.batched(async () => {
            await a.store.write({ scope: SCOPE, facts: [circular as unknown as StoredFact], relations: [] });
            await expect(a.manifest.set('knowledge:r', [{ id: 'a.md', hash: 'h1' }])).rejects.toThrow();
            expect(await a.manifest.get('knowledge:r')).toEqual([{ id: 'a.md', hash: 'h1' }]); // buffered, not committed
            expect(await a.persistence.readCommitted('knowledge:r')).toBeUndefined();
        }).catch(() => undefined); // the batch's own final write fails for the same poisoned fact
    });

    it('get reads through the buffer and delete removes a source', async () => {
        const dir = folder();
        const m = nodeIngestManifest(dir);
        open.push(m);
        await m.set('k', [{ id: 'a', hash: '1' }]);
        expect(await m.get('k')).toEqual([{ id: 'a', hash: '1' }]);
        m.close();
        const again = nodeIngestManifest(dir);
        open.push(again);
        expect(await again.get('k')).toEqual([{ id: 'a', hash: '1' }]);
        await again.delete('k');
        expect(await again.get('k')).toBeUndefined();
        expect(await again.get('never')).toBeUndefined();
    });

    it('writes the cache .gitignore (`*`) once and never edits the repo\'s .gitignore', () => {
        const dir = folder();
        writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
        opened(dir).close();
        const ignore = join(dir, '.builderforce', 'cache', '.gitignore');
        expect(readFileSync(ignore, 'utf8').trim()).toBe('*');
        writeFileSync(ignore, '*\n# mine\n');
        opened(dir).close();
        expect(readFileSync(ignore, 'utf8')).toContain('# mine');
        expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe('node_modules\n');
        expect(existsSync(knowledgeDbPath(dir))).toBe(true);
    });

    it('moves a corrupt index.sqlite aside (bytes kept), opens an empty store, and the root can be reviewed again', async () => {
        const dir = folder();
        opened(dir).close();
        const corrupt = 'torn write, not sqlite'.repeat(40);
        writeFileSync(knowledgeDbPath(dir), corrupt);
        const recovered = opened(dir);
        expect(recovered.recoveredFrom).toMatch(/index\.sqlite\.corrupt-\d+$/);
        expect(readFileSync(recovered.recoveredFrom!, 'utf8')).toBe(corrupt);
        expect(await recovered.store.scopes()).toEqual([]);
        await recovered.store.write({ scope: SCOPE, facts: [fact('claim:1', 'x')], relations: [] });
        expect((await recovered.store.facts({ rootId: 'r' })).length).toBe(1);
        recovered.close();
        expect(opened(dir).recoveredFrom).toBeUndefined(); // a healthy file is left alone
    });

    it('regression: a manifest set that races a pending apply commits with the NEXT delta, never the current one', async () => {
        const a = opened(folder());
        await a.persistence.load();
        const commits: number[] = [];
        const db = a.persistence.db as unknown as { exec(sql: string): void; prepare(sql: string): { get(): unknown } };
        const realExec = db.exec.bind(db);
        db.exec = (sql: string) => {
            if (sql === 'COMMIT') commits.push(Number((db.prepare('SELECT count(*) AS n FROM manifest').get() as { n: number }).n));
            realExec(sql);
        };
        // Hold the gate so both calls queue behind it: the apply is CALLED first (its delta is built), the set comes after.
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const held = a.persistence.transaction(() => gate);
        const applying = a.persistence.apply(changeOf('k1'));
        const setting = a.manifest.set('m', [{ id: 'x', hash: '1' }]); // describes facts newer than that delta
        release();
        await Promise.all([held, applying, setting]);
        // hold: 0 manifest rows; the apply: 0 (the set was made after its delta); the set: 1, in its own commit.
        expect(commits).toEqual([0, 0, 1]);
    });

    it('regression: a BUSY at BEGIN keeps the manifest entries, and a retry still commits them (apply and manifest-only)', async () => {
        const dir = folder();
        const a = nodeKnowledgeStore(dir, { busyTimeoutMs: 20 });
        open.push(a);
        const b = opened(dir);
        const reader = nodeIngestManifest(dir);
        open.push(reader);
        const lock = b.persistence.db;

        lock.exec('BEGIN IMMEDIATE');
        await expect(a.manifest.set('m1', [{ id: 'a', hash: '1' }])).rejects.toThrow(/locked|busy/i); // manifest-only commit
        const pending = a.manifest.set('m2', [{ id: 'b', hash: '2' }]).catch(() => undefined);
        await pending;
        await expect(a.persistence.apply(changeOf('k1'))).rejects.toThrow(/locked|busy/i); // fact apply
        lock.exec('ROLLBACK');

        expect(await a.manifest.get('m1')).toEqual([{ id: 'a', hash: '1' }]); // still buffered, readable
        await a.persistence.apply(changeOf('k2'));
        expect(await reader.get('m1')).toEqual([{ id: 'a', hash: '1' }]);
        expect(await reader.get('m2')).toEqual([{ id: 'b', hash: '2' }]);
    });

    it('regression: an open that fails for a reason other than corruption (READONLY, IOERR) never moves the file aside', () => {
        const dir = folder();
        opened(dir).close();
        for (const [message, errcode] of [['attempt to write a readonly database', 8], ['disk I/O error', 10]] as const) {
            hook.failOpenWith = Object.assign(new Error(message), { errcode });
            expect(() => nodeKnowledgeStore(dir)).toThrow(message);
        }
        hook.failOpenWith = undefined;
        const siblings = readdirSync(join(dir, '.builderforce', 'cache', 'knowledge'));
        expect(siblings.some((n) => n.includes('.corrupt-'))).toBe(false);
        expect(siblings).toContain('index.sqlite');
        expect(opened(dir).recoveredFrom).toBeUndefined();
    });

    it('moveAside is all-or-nothing: when the main file cannot be moved, the sidecars are put back', () => {
        const dir = folder();
        const base = join(dir, 'index.sqlite');
        writeFileSync(base, 'main');
        writeFileSync(`${base}-wal`, 'wal');
        writeFileSync(`${base}-shm`, 'shm');
        vi.spyOn(Date, 'now').mockReturnValue(1234);
        mkdirSync(`${base}.corrupt-1234`);
        writeFileSync(join(`${base}.corrupt-1234`, 'occupied'), 'x'); // the main file's target is taken: that rename fails
        expect(() => moveAside(base)).toThrow();
        expect(readFileSync(base, 'utf8')).toBe('main');
        expect(readFileSync(`${base}-wal`, 'utf8')).toBe('wal');
        expect(readFileSync(`${base}-shm`, 'utf8')).toBe('shm');
        expect(existsSync(`${base}.corrupt-1234-wal`)).toBe(false);
    });

    it('a file written by a newer format is read but never written, and says so', async () => {
        const dir = folder();
        const first = opened(dir);
        await first.store.write({ scope: SCOPE, facts: [fact('claim:1', 'x')], relations: [] });
        first.persistence.setMeta('format', '99');
        first.close();
        const newer = opened(dir);
        expect(newer.formatNewer).toBe(true);
        expect((await newer.store.facts({ rootId: 'r' })).length).toBe(1); // still readable
        await expect(newer.persistence.apply(changeOf('k9'))).rejects.toThrow(/knowledge_index_format_newer/);
        await expect(newer.manifest.set('m', [{ id: 'a', hash: '1' }])).rejects.toThrow(/knowledge_index_format_newer/);
        expect(opened(folder()).formatNewer).toBe(false);
    });

    it('an apply refreshes data_version inside its transaction, so another window\'s manifest-only commit is not mistaken for new facts', async () => {
        const dir = folder();
        const a = opened(dir);
        const b = opened(dir);
        await a.persistence.load();
        await b.manifest.set('m', [{ id: 'a', hash: '1' }]); // another connection committed: data_version moves, the generation does not
        expect(await a.persistence.changedElsewhere()).toBe(true);
        await a.persistence.apply(changeOf('k1')); // no generation mismatch: no reload, but data_version is read in the transaction
        expect(await a.persistence.changedElsewhere()).toBe(false);
    });

    it('regression: two manifest commits for the same key in one transaction leave the last value, with no constraint error', async () => {
        const a = opened(folder());
        const db = a.persistence.db;
        db.exec('BEGIN IMMEDIATE');
        writeManifestEntries(db, new Map([['k', [{ id: 'a', hash: '1' }]]]));
        writeManifestEntries(db, new Map([['k', [{ id: 'a', hash: '2' }]], ['gone', null]]));
        writeManifestEntries(db, new Map([['k', [{ id: 'b', hash: '3' }]]]));
        db.exec('COMMIT');
        expect(await a.manifest.get('k')).toEqual([{ id: 'b', hash: '3' }]);
        // Through the buffer too: a second set of the key before its commit leaves the last value.
        await a.manifest.set('k2', [{ id: 'x', hash: '1' }]);
        await a.manifest.set('k2', [{ id: 'x', hash: '2' }]);
        expect(await a.manifest.get('k2')).toEqual([{ id: 'x', hash: '2' }]);
    });

    it('regression: a file of a newer format refuses EVERY write path (apply, manifest-only, transaction, setMeta) and is not touched on open', async () => {
        const dir = folder();
        const first = opened(dir);
        await first.store.write({ scope: SCOPE, facts: [fact('claim:1', 'x')], relations: [] });
        first.persistence.setMeta('format', '99');
        first.persistence.db.exec('DROP TABLE recheck'); // a table a newer BuilderForce no longer has: an open that "creates the schema" would bring it back
        first.close();
        const newer = opened(dir);
        const refused = /knowledge_index_format_newer/;
        expect(newer.journalMode).toBe('unchanged'); // no WAL request: that pragma writes the header
        expect(newer.persistence.db.prepare("SELECT name FROM sqlite_master WHERE name = 'recheck'").all()).toEqual([]);
        await expect(newer.persistence.apply(changeOf('k'))).rejects.toThrow(refused);
        await expect(newer.persistence.commitBuffered()).rejects.toThrow(refused);
        await expect(newer.manifest.set('m', [{ id: 'a', hash: '1' }])).rejects.toThrow(refused);
        expect(await newer.manifest.get('m')).toBeUndefined(); // a refused write is not buffered: nothing is read back that was never written
        await expect(newer.manifest.delete('m')).rejects.toThrow(refused);
        expect(await newer.manifest.get('m')).toBeUndefined();
        await expect(newer.persistence.transaction((w) => { w.setMeta('x', '1'); })).rejects.toThrow(refused);
        expect(() => newer.persistence.setMeta('x', '1')).toThrow(refused);
        expect(newer.persistence.getMeta('x')).toBeUndefined();
        expect(newer.persistence.getMeta('format')).toBe('99');
    });
});
