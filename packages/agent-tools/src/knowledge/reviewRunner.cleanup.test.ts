import { describe, expect, it } from 'vitest';
import type { JudgementPort } from '@seanhogg/builderforce-memory/knowledge';
import { runKnowledgeReview, type KnowledgeReviewPorts } from './reviewRunner.js';
import { countingJudgement, failPruneStep, ports } from './reviewRunner.fixtures.test-util.js';

describe('the review runner — cleanup, listeners and per-root serialisation', () => {
    it('a run that throws after memory\'s done still forwards done once, and clears the provisional cards', async () => {
        const p = ports(countingJudgement());
        const discards: number[] = [];
        const upserts: number[] = [];
        p.index = { upsertFromGraph: async (graph) => { upserts.push(graph.nodes.length); }, discardProvisional: async () => { discards.push(1); } };
        // Pruning the superseded edits is the step after memory's `done`; make it fail.
        failPruneStep(p);
        const phases: string[] = [];
        await expect(runKnowledgeReview(p, { onProgress: (e) => phases.push(e.phase) })).rejects.toThrow('manifest down');
        expect(phases.filter((x) => x === 'done')).toHaveLength(1);
        expect(phases.at(-1)).toBe('done');
        expect(upserts).toHaveLength(0);
        expect(discards).toHaveLength(1);
    });

    it('a progress listener that throws on the forwarded done does not replace the review error, and is not an index error', async () => {
        const p = ports(countingJudgement());
        const reported: unknown[] = [];
        p.index = { upsertFromGraph: async () => undefined, discardProvisional: async () => undefined };
        p.onIndexError = (e) => reported.push(e);
        failPruneStep(p);
        const onProgress = (e: { phase: string }): void => { if (e.phase === 'done') throw new Error('listener down'); };
        await expect(runKnowledgeReview(p, { onProgress })).rejects.toThrow('manifest down');
        expect(reported).toEqual([]);
    });

    it('a progress listener that throws on the forwarded done after a clean run is rethrown, once the provisional cards are discarded', async () => {
        const p = ports(countingJudgement());
        const reported: unknown[] = [];
        const discards: number[] = [];
        p.index = { upsertFromGraph: async () => undefined, discardProvisional: async () => { discards.push(1); } };
        p.onIndexError = (e) => reported.push(e);
        const onProgress = (e: { phase: string }): void => { if (e.phase === 'done') throw new Error('listener down'); };
        await expect(runKnowledgeReview(p, { onProgress })).rejects.toThrow('listener down');
        expect(discards).toHaveLength(1);
        expect(reported).toEqual([]);
    });

    it('a progress listener that throws on the index phase does not skip the upsert and is not an index error: it is rethrown after cleanup, with done still forwarded', async () => {
        const p = ports(countingJudgement());
        const reported: unknown[] = [];
        const order: string[] = [];
        p.index = { upsertFromGraph: async () => { order.push('upsert'); }, discardProvisional: async () => { order.push('discard'); } };
        p.onIndexError = (e) => reported.push(e);
        const phases: string[] = [];
        const onProgress = (e: { phase: string }): void => {
            phases.push(e.phase);
            if (e.phase === 'index') throw new Error('listener down');
            if (e.phase === 'done') order.push('done');
        };
        await expect(runKnowledgeReview(p, { onProgress })).rejects.toThrow('listener down');
        expect(order).toEqual(['upsert', 'discard', 'done']);
        expect(phases.filter((x) => x === 'index')).toHaveLength(2);
        expect(reported).toEqual([]);
    });

    it('a discard that throws synchronously is reported as an index error, never a failed review', async () => {
        const p = ports(countingJudgement());
        const reported: unknown[] = [];
        p.index = {
            upsertFromGraph: async () => undefined,
            discardProvisional: (): Promise<void> => { throw new Error('discard down'); },
        };
        p.onIndexError = (e) => reported.push(e);
        const phases: string[] = [];
        const report = await runKnowledgeReview(p, { onProgress: (e) => phases.push(e.phase) });
        expect(report.aborted).toBe(false);
        expect(reported).toHaveLength(1);
        expect(phases.at(-1)).toBe('done');
    });

    it('reviews of one root run one after another; reviews of different roots overlap', async () => {
        /** A judgement port whose first call parks until released; `reached` settles on the first call, so no test waits on the clock. */
        const gate = (): { port: JudgementPort; started: () => number; release: () => void; reached: Promise<void> } => {
            let calls = 0;
            let open!: () => void;
            let reach!: () => void;
            const parked = new Promise<void>((resolve) => { open = resolve; });
            const reached = new Promise<void>((resolve) => { reach = resolve; });
            const inner = countingJudgement();
            return {
                port: { async judge(req) { calls += 1; reach(); if (calls === 1) await parked; return inner.judge(req); } },
                started: () => calls,
                release: open,
                reached,
            };
        };
        const withRoot = (p: KnowledgeReviewPorts, rootId: string): KnowledgeReviewPorts => ({ ...p, source: { ...p.source, rootId } });
        /** A few macrotask turns: whatever the queued run could have started by now has started. */
        const turns = async (): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => { setImmediate(resolve); }); };

        const firstGate = gate();
        const secondGate = gate();
        const first = runKnowledgeReview(withRoot(ports(firstGate.port), 'same'));
        const second = runKnowledgeReview(withRoot(ports(secondGate.port), 'same'));
        await firstGate.reached;
        await turns();
        expect(firstGate.started()).toBe(1);
        expect(secondGate.started()).toBe(0);
        firstGate.release();
        await first;
        await secondGate.reached;
        secondGate.release();
        await second;
        expect(secondGate.started()).toBeGreaterThan(0);

        const aGate = gate();
        const bGate = gate();
        const a = runKnowledgeReview(withRoot(ports(aGate.port), 'root-a'));
        const b = runKnowledgeReview(withRoot(ports(bGate.port), 'root-b'));
        await Promise.all([aGate.reached, bGate.reached]);
        expect(aGate.started()).toBe(1);
        expect(bGate.started()).toBe(1);
        aGate.release();
        bGate.release();
        await Promise.all([a, b]);
    });

    it('a failed review does not stall the next review of the same root', async () => {
        const failing = ports(countingJudgement());
        failPruneStep(failing);
        const first = runKnowledgeReview(failing);
        const second = runKnowledgeReview(ports(countingJudgement()));
        await expect(first).rejects.toThrow('manifest down');
        expect((await second).aborted).toBe(false);
    });

    it('clears the provisional cards after a clean run too, and done stays last', async () => {
        const p = ports(countingJudgement());
        const order: string[] = [];
        p.index = { upsertFromGraph: async () => { order.push('upsert'); }, discardProvisional: async () => { order.push('discard'); } };
        const phases: string[] = [];
        await runKnowledgeReview(p, { onProgress: (e) => { phases.push(e.phase); if (e.phase === 'done') order.push('done'); } });
        expect(order).toEqual(['upsert', 'discard', 'done']);
        expect(phases.filter((x) => x === 'done')).toHaveLength(1);
    });
});
