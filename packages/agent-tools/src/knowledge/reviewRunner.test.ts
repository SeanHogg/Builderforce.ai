import { describe, expect, it } from 'vitest';
import {
    localSnapshotStore, type DirectorySource, type JudgementPort, type ReviewProgress,
} from '@seanhogg/builderforce-memory/knowledge';
import { InMemoryIngestManifest } from '@seanhogg/builderforce-memory/ingest';
import {
    analysisSha, buildStoredGraph, forcedManifest, planKnowledgeReview, planKnowledgeReviewDetail, reviewPacks, runKnowledgeReview,
    workspaceCodeAnalyzers, type KnowledgeReviewPorts,
} from './reviewRunner.js';
import type { CapabilityProvider } from '../capabilities.js';
import { dependency, duplicates, fixtureSnapshot, unused } from './codeFixtures.test-util.js';
import { forgetWorkspaceAnalyses } from './workspaceAnalysis.js';
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

describe('the confirmed plan is reused (§4.3 Continue)', () => {
    it('runs the review on the plan the person confirmed, without walking the folder again', async () => {
        const p = ports(countingJudgement());
        let walks = 0;
        const list = p.source.list.bind(p.source);
        p.source.list = () => { walks += 1; return list(); };

        const detail = await planKnowledgeReviewDetail(p);
        expect(detail.plan.files).toBe(2);
        expect(detail.files.map((f) => f.path)).toEqual(['lease.md', 'policy.md']);
        expect(walks).toBe(1);

        const report = await runKnowledgeReview(p, { plan: detail });
        expect(report.extracted).toBe(2);
        // The review did not re-list the folder — it re-read `changed` from the manifest.
        expect(walks).toBe(1);
    });

    it('planKnowledgeReview is the same plan, numbers only', async () => {
        const p = ports();
        expect(await planKnowledgeReview(p)).toEqual((await planKnowledgeReviewDetail(p)).plan);
    });
});

describe('the code pack's analyzers over a workspace', () => {
    const shell = (head: string, status = '') => ({
        run: async (command: string) => {
            if (command.includes('depcruise')) return { ok: true, exitCode: 0, stdout: JSON.stringify(dependency) };
            if (command.includes('knip')) return { ok: true, exitCode: 0, stdout: JSON.stringify(unused) };
            if (command === 'git rev-parse HEAD') return { ok: true, exitCode: 0, stdout: head };
            if (command.startsWith('git status')) return { ok: true, exitCode: 0, stdout: status };
            return { ok: true, exitCode: 0, stdout: '' };
        },
    });
    const caps = (head: string, status = '') => ({
        capabilities: new Set(),
        shell: shell(head, status),
        repoRead: {
            listFiles: async () => ({ ok: true, paths: ['src/a.ts', 'src/b.ts'] }),
            readFile: async (path: string) => ({ ok: true, path, content: path.endsWith('jscpd-report.json') ? JSON.stringify(duplicates) : 'export const x = 1;' }),
            searchCode: async () => ({ ok: true, query: '', matches: [] }),
        },
    }) as unknown as CapabilityProvider;
    const repoGraph = {
        accepts: () => true,
        create: () => ({ addFile: () => true, build: () => ({ graph: { paths: ['src/a.ts', 'src/b.ts'], out: [[[1, 0.75] as const], []] } }) }),
    };

    it('feeds the repo map's references in alongside the analyzers, and uploads under the sha', async () => {
        forgetWorkspaceAnalyses();
        const uploads: string[] = [];
        const out = await workspaceCodeAnalyzers({
            caps: caps('abc'), repoGraph, upload: async (sha) => { uploads.push(sha); },
        }).analyse('root');
        const refs = out.filter((e) => e.edges.some((edge) => edge.kind === 'references' && edge.weight === 0.75));
        expect(refs.map((e) => e.sourceRef)).toEqual(['src:root::src/a.ts']);
        expect(uploads).toEqual(['abc']);
    });

    it('runs the analyzers once per sha across reviews', async () => {
        forgetWorkspaceAnalyses();
        let depcruiseRuns = 0;
        const c = caps('same-sha');
        const run = c.shell!.run.bind(c.shell);
        (c.shell as { run: unknown }).run = async (command: string, opts?: unknown) => { if (command.includes('depcruise')) depcruiseRuns += 1; return run(command, opts as never); };
        await workspaceCodeAnalyzers({ caps: c }).analyse('root');
        await workspaceCodeAnalyzers({ caps: c }).analyse('root');
        expect(depcruiseRuns).toBe(1);
    });

    it('stores dirty snapshots of one commit under different ids', () => {
        const clean = { ...fixtureSnapshot(), source: { commit: 'abc', branch: 'main', dirty: false } };
        const dirtyA = { ...fixtureSnapshot(), id: 'a', source: { commit: 'abc', branch: 'main', dirty: true, dirtyHash: '1111' } };
        const dirtyB = { ...fixtureSnapshot(), id: 'b', source: { commit: 'abc', branch: 'main', dirty: true, dirtyHash: '2222' } };
        expect(analysisSha(clean)).toBe('abc');
        expect(analysisSha(dirtyA)).toBe('abc+1111');
        expect(analysisSha(dirtyB)).toBe('abc+2222');
        // Without a commit (or an unidentifiable dirty tree) the snapshot's own id is used.
        expect(analysisSha({ ...clean, id: 'own', source: { commit: null, branch: null, dirty: null } })).toBe('own');
        expect(analysisSha({ ...dirtyA, source: { commit: 'abc', branch: 'main', dirty: true } })).toBe('a');
    });
});
