import { describe, expect, it } from 'vitest';
import type { KnowledgeFiles } from './fileManifest.js';
import { readReviewCommit, writeReviewCommit } from './reviewCommit.js';

function memoryFiles(withRemove = true): KnowledgeFiles & { store: Map<string, string> } {
    const store = new Map<string, string>();
    return {
        store,
        read: async (name) => store.get(name),
        write: async (name, text) => { store.set(name, text); },
        ...(withRemove ? { remove: async (name: string) => { store.delete(name); } } : {}),
    };
}

describe('review commit record', () => {
    it('keeps what was recorded: reading never asks git, so a HEAD that moved since the review changes nothing', async () => {
        const files = memoryFiles();
        await writeReviewCommit(files, 'ws:a', 'a'.repeat(40));
        expect(await readReviewCommit(files, 'ws:a')).toBe('a'.repeat(40));
        expect(await readReviewCommit(files, 'ws:a')).toBe('a'.repeat(40));
    });

    it('is per root', async () => {
        const files = memoryFiles();
        await writeReviewCommit(files, 'ws:a', 'a'.repeat(40));
        expect(await readReviewCommit(files, 'ws:b')).toBeUndefined();
    });

    it('a later review that recorded none (a dirty tree) REPLACES the earlier commit with unknown', async () => {
        for (const withRemove of [true, false]) {
            const files = memoryFiles(withRemove);
            await writeReviewCommit(files, 'ws:a', 'a'.repeat(40));
            await writeReviewCommit(files, 'ws:a', undefined);
            expect(await readReviewCommit(files, 'ws:a')).toBeUndefined();
        }
    });

    it('is undefined before any review recorded one', async () => {
        expect(await readReviewCommit(memoryFiles(), 'ws:a')).toBeUndefined();
    });

    it('a damaged record throws, so the pump reports it instead of treating it as unknown', async () => {
        const files = memoryFiles();
        await writeReviewCommit(files, 'ws:a', 'a'.repeat(40));
        for (const k of files.store.keys()) files.store.set(k, '{not json');
        await expect(readReviewCommit(files, 'ws:a')).rejects.toThrow();
    });
});
