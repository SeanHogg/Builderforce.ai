/**
 * factCandidateRows.test.ts — the raw candidate mounts beside the fact store, in the folder's `index.sqlite`: per root,
 * put and delete, survive a reopen, and a file that never stored any reads as empty.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { localSqliteAvailable } from '../node-local-sqlite.js';
import { nodeKnowledgeStore, sqliteCandidateRows, type NodeKnowledgeStore } from '../node-knowledge-store.js';

const folders: string[] = [];
const open: NodeKnowledgeStore[] = [];
afterEach(() => {
    for (const o of open.splice(0)) { try { o.close(); } catch { /* closed */ } }
    for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true });
});

const mount = { prefix: '/users', target: 'use:{"s":"./users","n":"users","p":"/users"}', order: 0, router: 'app' };

describe.skipIf(!localSqliteAvailable())('sqliteCandidateRows', () => {
    it('puts, deletes, keeps roots apart and survives a reopen', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'fact-candidates-'));
        folders.push(dir);
        const k = nodeKnowledgeStore(dir);
        open.push(k);
        expect((await sqliteCandidateRows(k.persistence, 'r1').load()).size).toBe(0);
        await sqliteCandidateRows(k.persistence, 'r1').write([{ path: 'src/app.js', hash: 'h1', mounts: [mount] }, { path: 'src/b.js', hash: 'h2', mounts: [] }], []);
        await sqliteCandidateRows(k.persistence, 'r1').write([], ['src/b.js']);
        expect((await sqliteCandidateRows(k.persistence, 'r2').load()).size).toBe(0);
        k.close();
        open.splice(0);
        const again = nodeKnowledgeStore(dir);
        open.push(again);
        expect([...(await sqliteCandidateRows(again.persistence, 'r1').load()).values()]).toEqual([{ path: 'src/app.js', hash: 'h1', mounts: [mount] }]);
    });
});
