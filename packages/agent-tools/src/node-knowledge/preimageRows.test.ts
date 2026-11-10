import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { localSqliteAvailable } from '../node-local-sqlite.js';
import { nodeKnowledgeStore, type NodeKnowledgeStore } from '../node-knowledge-store.js';
import { PREIMAGE_RETENTION_MS, PREIMAGE_WRITE_CHUNK_BYTES, putPreimages, readPreimages, sweepPreimages, unpinPreimages } from './preimageRows.js';

const folders: string[] = [];
const open: NodeKnowledgeStore[] = [];
afterEach(() => {
    for (const o of open.splice(0)) { try { o.close(); } catch { /* closed */ } }
    for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true });
});
const opened = (): NodeKnowledgeStore => {
    const dir = mkdtempSync(join(tmpdir(), 'preimage-rows-'));
    folders.push(dir);
    const k = nodeKnowledgeStore(dir);
    open.push(k);
    return k;
};
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const generation = (k: NodeKnowledgeStore): string | undefined => k.persistence.getMeta('generation');

describe.skipIf(!localSqliteAvailable())('pre-image rows (PRD 41 C1.3)', () => {
    it('reads nothing from a file that never captured a pre-image', async () => {
        const k = opened();
        expect(await readPreimages(k.persistence, ['h1'])).toEqual(new Map());
    });

    it('stores bytes by hash, pins them to the run, and never moves the fact generation', async () => {
        const k = opened();
        const before = generation(k);
        await putPreimages(k.persistence, 'run-1', [{ hash: 'h1', bytes: bytes('one') }, { hash: 'h2', bytes: bytes('two') }], 1_000);
        await unpinPreimages(k.persistence, 'run-1', 2_000);
        await sweepPreimages(k.persistence, 3_000);
        const read = await readPreimages(k.persistence, ['h1', 'h2', 'h3']);
        expect(new TextDecoder().decode(read.get('h1'))).toBe('one');
        expect(new TextDecoder().decode(read.get('h2'))).toBe('two');
        expect(read.has('h3')).toBe(false);
        expect(generation(k)).toBe(before);
    });

    it('never sweeps a row pinned within the retention; an unpinned row lives for the retention from its unpin', async () => {
        const R = PREIMAGE_RETENTION_MS;
        const k = opened();
        await putPreimages(k.persistence, 'run-1', [{ hash: 'h1', bytes: bytes('one') }], 10 * R);
        await putPreimages(k.persistence, 'run-2', [{ hash: 'h2', bytes: bytes('two') }], 11 * R);
        expect(await sweepPreimages(k.persistence, 10.5 * R)).toBe(0);

        await unpinPreimages(k.persistence, 'run-1', 10.5 * R);
        expect(await sweepPreimages(k.persistence, 10.9 * R)).toBe(0);
        expect(await sweepPreimages(k.persistence, 11.6 * R)).toBe(1);
        expect([...(await readPreimages(k.persistence, ['h1', 'h2'])).keys()]).toEqual(['h2']);
    });

    it('drops a pin its run never released once it is older than the retention, then sweeps the row', async () => {
        const k = opened();
        await putPreimages(k.persistence, 'crashed-run', [{ hash: 'h', bytes: bytes('x') }], 0);
        expect(await sweepPreimages(k.persistence, PREIMAGE_RETENTION_MS + 1)).toBe(1);
        expect((await readPreimages(k.persistence, ['h'])).size).toBe(0);
    });

    it('writes a large set in several transactions, all pinned to the run', async () => {
        const k = opened();
        const big = new Uint8Array(PREIMAGE_WRITE_CHUNK_BYTES - 10);
        await putPreimages(k.persistence, 'run-big', [{ hash: 'a', bytes: big }, { hash: 'b', bytes: big }, { hash: 'c', bytes: bytes('c') }], 0);
        expect([...(await readPreimages(k.persistence, ['a', 'b', 'c'])).keys()].sort()).toEqual(['a', 'b', 'c']);
        const pins = k.persistence.db.prepare('SELECT COUNT(*) AS n FROM preimage_pin WHERE run_id = ?').get('run-big') as { n: number };
        expect(Number(pins.n)).toBe(3);
    });

    it('refuses writes to a file of a newer format', async () => {
        const k = opened();
        k.persistence.db.prepare("INSERT INTO meta(k, v) VALUES ('format', '99') ON CONFLICT(k) DO UPDATE SET v = excluded.v").run();
        const dir = folders[folders.length - 1]!;
        k.close();
        const newer = nodeKnowledgeStore(dir);
        open.push(newer);
        expect(newer.formatNewer).toBe(true);
        await expect(putPreimages(newer.persistence, 'r', [{ hash: 'h', bytes: bytes('x') }], 0)).rejects.toThrow(/knowledge_index_format_newer/);
    });

    it('keeps a row another run still pins when one run unpins it', async () => {
        const k = opened();
        await putPreimages(k.persistence, 'run-1', [{ hash: 'h', bytes: bytes('x') }], 0);
        await putPreimages(k.persistence, 'run-2', [{ hash: 'h', bytes: bytes('x') }], 0);
        await unpinPreimages(k.persistence, 'run-1', 0);
        // run-2 is still live (pinned recently): its hold keeps the old row.
        k.persistence.db.prepare('UPDATE preimage_pin SET pinned_at = ? WHERE run_id = ?').run(PREIMAGE_RETENTION_MS * 2, 'run-2');
        expect(await sweepPreimages(k.persistence, PREIMAGE_RETENTION_MS * 2.5)).toBe(0);
        expect((await readPreimages(k.persistence, ['h'])).has('h')).toBe(true);
    });
});
