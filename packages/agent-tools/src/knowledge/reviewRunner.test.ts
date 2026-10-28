import { describe, expect, it } from 'vitest';
import {
    localSnapshotStore, type DirectorySource, type JudgementPort, type ReviewProgress,
} from '@seanhogg/builderforce-memory/knowledge';
import { InMemoryIngestManifest } from '@seanhogg/builderforce-memory/ingest';
import { buildStoredGraph, forcedManifest, planKnowledgeReview, reviewPacks, runKnowledgeReview, type KnowledgeReviewPorts } from './reviewRunner.js';
import { completionJudgement, fallbackJudgement, replyJson } from './judgement.js';

const DOCS: Record<string, string> = {
    'lease.md': '# Lease\n\nThe lease ends on 1 June.\n\n## Termination\n\nEither party may terminate with 30 days notice.\n',
    'policy.md': '# Policy\n\nRent is paid monthly.\n\n## Deposits\n\nDeposits are returned within 14 days.\n',
};

function memorySource(files: Record<string, string>): DirectorySource {
    return {
        rootId: 'docs',
        title: 'docs',
        async *list() {
            for (const [path, text] of Object.entries(files)) yield { path, hash: `h:${path}:${text.length}`, size: text.length };
        },
        async read(path) {
            return { id: path, tenantId: 'docs', title: path, content: { kind: 'text', text: files[path] ?? '', mediaType: 'text/markdown' } };
        },
    };
}

/** A judgement port that answers every section with one claim, counting its calls. */
function countingJudgement(): JudgementPort & { calls: number } {
    const port = {
        calls: 0,
        async judge(req: Parameters<JudgementPort['judge']>[0]) {
            port.calls += 1;
            return {
                extract: req.items.map((i) => ({ ref: i.ref, claims: [{ subject: 'lease', predicate: 'says', object: 'something', quote: i.text.slice(0, 20) }], entities: [] })),
                invalid: 0,
            };
        },
    };
    return port;
}

function ports(judgement?: JudgementPort): KnowledgeReviewPorts {
    let snapshot: string | undefined;
    return {
        source: memorySource(DOCS),
        store: localSnapshotStore({ read: async () => snapshot, write: async (s) => { snapshot = s; } }),
        manifest: new InMemoryIngestManifest(),
        ...(judgement ? { judgement } : {}),
    };
}

describe('the shared review runner', () => {
    it('plans without writing, then reviews and reports progress through every phase', async () => {
        const p = ports(countingJudgement());
        const plan = await planKnowledgeReview(p);
        expect(plan.files).toBe(2);
        expect(plan.unchanged).toBe(0);
        expect(await p.store.scopes()).toEqual([]);

        const phases: ReviewProgress['phase'][] = [];
        const report = await runKnowledgeReview(p, { onProgress: (e) => phases.push(e.phase) });
        expect(report.aborted).toBe(false);
        expect(phases[0]).toBe('plan');
        expect(phases.at(-1)).toBe('done');
        expect(phases).toContain('judge');

        // A second plan over unchanged files reads nothing new; *Re-review all* re-plans everything.
        expect((await planKnowledgeReview(p)).unchanged).toBe(2);
        expect((await planKnowledgeReview(p, { force: true })).unchanged).toBe(0);
    });

    it('stops judging at the budget and counts the rest', async () => {
        const judge = countingJudgement();
        const report = await runKnowledgeReview(ports(judge), { modelCalls: 1 });
        expect(judge.calls).toBe(1);
        expect(report.judged).toBe(1);
        expect(report.unjudged).toBeGreaterThan(0);
    });

    it('aborts between files: an already-stopped review writes nothing judged', async () => {
        const judge = countingJudgement();
        const abort = new AbortController();
        abort.abort();
        const report = await runKnowledgeReview(ports(judge), { signal: abort.signal });
        expect(report.aborted).toBe(true);
        expect(judge.calls).toBe(0);
    });

    it('builds the root graph from what the review left in the store', async () => {
        const p = ports();
        await runKnowledgeReview(p);
        const graph = await buildStoredGraph({ rootId: 'docs', store: p.store, manifest: p.manifest, packs: reviewPacks({}) });
        expect(graph?.nodes.some((n) => n.ref === 'src:docs::lease.md')).toBe(true);
        expect(await buildStoredGraph({ rootId: 'other', store: p.store, manifest: p.manifest, packs: reviewPacks({}) })).toBeNull();
    });

    it('forcedManifest hides prior hashes but still persists', async () => {
        const inner = new InMemoryIngestManifest();
        await inner.set('a', [{ id: 'x', hash: '1' }]);
        const forced = forcedManifest(inner);
        expect(await forced.get('a')).toBeUndefined();
        await forced.set('b', [{ id: 'y', hash: '2' }]);
        expect(await inner.get('b')).toEqual([{ id: 'y', hash: '2' }]);
    });
});

describe('the completion judgement port', () => {
    it('reads fenced JSON and validates it with memory', async () => {
        expect(replyJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
        expect(replyJson('no json')).toBeUndefined();
        const port = completionJudgement(async () => '{"extract":[{"ref":"src:docs::a.md","claims":[{"subject":"s","predicate":"p","object":"o","quote":"q"}],"entities":[]}]}');
        const out = await port.judge({ kind: 'extract', items: [{ ref: 'src:docs::a.md', text: 'x', sourceHash: 'h' }] });
        expect(out.extract?.[0]?.claims).toHaveLength(1);
    });

    it('falls back to the next port when one throws', async () => {
        const failing: JudgementPort = { judge: async () => { throw new Error('no engine'); } };
        const ok: JudgementPort = { judge: async () => ({ extract: [], invalid: 0 }) };
        await expect(fallbackJudgement([failing, ok]).judge({ kind: 'extract', items: [] })).resolves.toEqual({ extract: [], invalid: 0 });
        await expect(fallbackJudgement([failing]).judge({ kind: 'extract', items: [] })).rejects.toThrow('no engine');
    });
});
