import { describe, expect, it, vi } from 'vitest';
import type { JudgementPort } from '@seanhogg/builderforce-memory/knowledge';
import { InMemoryIngestManifest } from '@seanhogg/builderforce-memory/ingest';
import { reviewDirectory, DOCS_PACK, localSnapshotStore } from '@seanhogg/builderforce-memory/knowledge';
import { JudgementTimeout, judgementWithTimeout } from './judgement.js';

const request = (signal?: AbortSignal) => ({ kind: 'extract' as const, items: [{ ref: 'src:r::a.md#a' as never, text: 'x', sourceHash: 'h' }], ...(signal ? { signal } : {}) });

describe('judgementWithTimeout (PRD 41 A10 rule 9)', () => {
    it('aborts the real call through a signal, throws a timeout (never an empty answer) and returns after the call ended', async () => {
        vi.useFakeTimers();
        try {
            let seen: AbortSignal | undefined;
            let endedAt = 0;
            const port: JudgementPort = {
                judge: (req) => new Promise((_, reject) => {
                    seen = req.signal;
                    req.signal?.addEventListener('abort', () => setTimeout(() => { endedAt = Date.now(); reject(new Error('aborted')); }, 50), { once: true });
                }),
            };
            const settled = judgementWithTimeout(port, 1_000).judge(request()).then(() => 'answered', (e: unknown) => e);
            await vi.advanceTimersByTimeAsync(1_000);
            expect(seen?.aborted).toBe(true);
            await vi.advanceTimersByTimeAsync(60);
            const out = await settled;
            expect(out).toBeInstanceOf(JudgementTimeout);
            expect(endedAt).toBeGreaterThan(0); // the slot was held until the real call ended
        } finally {
            vi.useRealTimers();
        }
    });

    it('passes the answer, the call\'s own failure and the caller\'s abort through', async () => {
        const ok: JudgementPort = { judge: async () => ({ extract: [], invalid: 0 }) };
        await expect(judgementWithTimeout(ok, 1_000).judge(request())).resolves.toEqual({ extract: [], invalid: 0 });
        const bad: JudgementPort = { judge: async () => { throw new Error('401'); } };
        await expect(judgementWithTimeout(bad, 1_000).judge(request())).rejects.toThrow('401');
        const abort = new AbortController();
        const hang: JudgementPort = { judge: (req) => new Promise((_, reject) => req.signal?.addEventListener('abort', () => reject(new Error('stopped')))) };
        const p = judgementWithTimeout(hang, 60_000).judge(request(abort.signal));
        abort.abort();
        await expect(p).rejects.toThrow('stopped');
    });

    it('a timed-out section is not recorded as judged: the next run still owes it', async () => {
        const store = localSnapshotStore({ read: async () => undefined, write: async () => undefined });
        const manifest = new InMemoryIngestManifest();
        const source = {
            rootId: 'r', title: 'R',
            async *list() { yield { path: 'a.md', hash: 'h-a', size: 10 }; },
            async read(path: string) { return { id: path, tenantId: 't', content: { kind: 'text' as const, text: '# A\nalpha\n' } }; },
        };
        const hanging: JudgementPort = { judge: (req) => new Promise((_, reject) => req.signal?.addEventListener('abort', () => reject(new Error('aborted')))) };
        const base = { source, store, manifest, packs: [DOCS_PACK], budget: { modelCalls: 10, ms: 60_000 } };
        const first = await reviewDirectory({ ...base, judgement: judgementWithTimeout(hanging, 30) });
        expect(first.judged).toBe(0);
        expect(first.failures.some((f) => f.phase === 'judge')).toBe(true);

        const answered: JudgementPort = { judge: async (req) => ({ extract: req.items.map((it) => ({ ref: it.ref, claims: [], entities: [{ name: 'Alpha', type: 'thing' }] })), invalid: 0 }) };
        const second = await reviewDirectory({ ...base, judgement: answered });
        expect(second.judged).toBe(1);
    });
});
