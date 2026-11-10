/**
 * factStoreRows.test.ts — memory's FactStorePort on the folder's G03 knowledge SQLite file (PRD 41 §B4): a saved graph
 * loads back to the same canonical dump, a stale save conflicts on the version CAS, the sweep drops unreferenced objects
 * and moves the generation, reset mints a new epoch, two roots in one file never see each other, and the knowledge rows'
 * generation never moves.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    FACTS_EXTRACTOR_VERSION, buildFactGraph, factGraphDump, loadFactGraph, saveFactGraph, sweepFactStore, updateFactGraph, type FileFacts,
} from '@seanhogg/builderforce-memory/knowledge';
import { localSqliteAvailable } from '../node-local-sqlite.js';
import { nodeKnowledgeStore, sqliteFactStore, type NodeKnowledgeStore } from '../node-knowledge-store.js';

const folders: string[] = [];
const open: NodeKnowledgeStore[] = [];
afterEach(() => {
    for (const o of open.splice(0)) { try { o.close(); } catch { /* closed */ } }
    for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true });
});
const opened = (dir?: string): NodeKnowledgeStore => {
    const d = dir ?? mkdtempSync(join(tmpdir(), 'fact-store-'));
    if (!dir) folders.push(d);
    const k = nodeKnowledgeStore(d);
    open.push(k);
    return k;
};
const facts = (hash: string, exports: string[] = []): FileFacts => ({
    factsVersion: FACTS_EXTRACTOR_VERSION, extractor: 'tree-sitter@3.1/typescript=x/eol-lf@1', language: 'typescript', contentHash: hash,
    symbols: [], imports: [], exports: exports.map((name) => ({ name, kind: 'function', signatureHash: name })), entryPoints: [], calls: [], complexity: [], capabilityImports: [],
});

describe.skipIf(!localSqliteAvailable())('sqliteFactStore (PRD 41 §B4)', () => {
    it('round-trips a graph to the same canonical dump; the next save writes only the delta', async () => {
        const k = opened();
        const port = sqliteFactStore(k.persistence, 'r1');
        const built = buildFactGraph([['src/a.ts', facts('a', ['x'])], ['src/b.ts', facts('b')]], []).graph;
        const saved = await saveFactGraph(port, built);
        expect(saved.generation).toBe(1);
        const loaded = await loadFactGraph(port, { verify: 'full' });
        expect(factGraphDump(loaded.graph)).toBe(factGraphDump(built));
        const next = updateFactGraph(loaded.graph, [{ path: 'src/b.ts', facts: facts('b2') }], []).graph;
        const delta = await saveFactGraph(port, next, loaded);
        expect(delta.puts).toEqual(['src/b.ts']);
        expect(factGraphDump((await loadFactGraph(port, { verify: 'manifest' })).graph)).toBe(factGraphDump(next));
    });

    it('a save from a stale version conflicts (another writer committed in between)', async () => {
        const k = opened();
        const port = sqliteFactStore(k.persistence, 'r1');
        const base = await saveFactGraph(port, buildFactGraph([['a.ts', facts('a')]], []).graph);
        await saveFactGraph(port, buildFactGraph([['a.ts', facts('a2')]], []).graph, base);
        // A writer still holding generation 1 writes generation 2 again: the CAS refuses it.
        await expect(port.writeManifest({ epoch: base.epoch, generation: base.generation + 1, puts: new Map(), deletes: [] }, [], [])).rejects.toThrow(/fact_store_generation_conflict/);
    });

    it('sweeps unreferenced objects (moving the generation); reset mints a new epoch at generation 0', async () => {
        const k = opened();
        const port = sqliteFactStore(k.persistence, 'r1');
        const first = await saveFactGraph(port, buildFactGraph([['a.ts', facts('a')]], []).graph);
        await saveFactGraph(port, buildFactGraph([['a.ts', facts('a2')]], []).graph, first);
        const before = await port.readVersion();
        expect(await sweepFactStore(port)).toBe(1);
        expect((await port.readVersion()).generation).toBe(before.generation + 1);
        expect(await sweepFactStore(port)).toBe(0);
        await port.reset();
        const after = await port.readVersion();
        expect(after.generation).toBe(0);
        expect(after.epoch).not.toBe(before.epoch);
        expect((await port.readManifest()).files.size).toBe(0);
    });

    it('roots share the folder file but never each other\'s rows; the knowledge generation never moves; it survives a reopen', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'fact-store-'));
        folders.push(dir);
        const k = opened(dir);
        const knowledgeGeneration = k.persistence.getMeta('generation');
        await saveFactGraph(sqliteFactStore(k.persistence, 'r1'), buildFactGraph([['a.ts', facts('a')]], []).graph);
        expect((await sqliteFactStore(k.persistence, 'r2').readManifest()).files.size).toBe(0);
        expect(k.persistence.getMeta('generation')).toBe(knowledgeGeneration);
        k.close();
        open.splice(open.indexOf(k), 1);
        const again = opened(dir);
        expect([...(await loadFactGraph(sqliteFactStore(again.persistence, 'r1'))).graph.manifest.keys()]).toEqual(['a.ts']);
    });

    it('reads a file that never stored facts as an empty store at epoch \'\' generation 0', async () => {
        const k = opened();
        const port = sqliteFactStore(k.persistence, 'r1');
        expect(await port.readVersion()).toEqual({ epoch: '', generation: 0 });
        expect((await loadFactGraph(port)).graph.manifest.size).toBe(0);
    });
});
