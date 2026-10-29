import { describe, expect, it } from 'vitest';
import { filesManifestKey, type JudgementPort, type ReviewProgress } from '@seanhogg/builderforce-memory/knowledge';
import {
    analysisSha, buildStoredGraph, planKnowledgeReview, planKnowledgeReviewDetail, reviewPacks, runKnowledgeReview,
    workspaceCodeAnalyzers,
} from './reviewRunner.js';
import { countingJudgement, ports } from './reviewRunner.fixtures.test-util.js';
import type { CapabilityProvider } from '../capabilities.js';
import type { CodeAnalysisSnapshot } from '../codeAnalysis.js';
import { dependency, duplicates, fixtureSnapshot, unused } from './codeFixtures.test-util.js';
import { forgetWorkspaceAnalyses, readRepoGraph } from './workspaceAnalysis.js';
import { completionJudgement, fallbackJudgement, replyJson } from './judgement.js';

/** A readable head label as the 40-hex object id git prints (distinct labels, distinct ids). */
const hexHead = (label: string): string => Buffer.from(label).toString('hex').padEnd(40, '0').slice(0, 40);

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

    it('feeds the host index after the review and reports an index phase between write and done', async () => {
        const p = ports(countingJudgement());
        const upserts: number[] = [];
        p.index = { upsertFromGraph: async (graph) => { upserts.push(graph.nodes.length); }, discardProvisional: async () => undefined };
        const events: Array<[string, number, number]> = [];
        await runKnowledgeReview(p, { onProgress: (e) => events.push([e.phase, e.done, e.total]) });

        const phases = events.map((e) => e[0]);
        expect(phases.lastIndexOf('write')).toBeGreaterThanOrEqual(0);
        expect(phases.indexOf('index')).toBeGreaterThan(phases.lastIndexOf('write'));
        expect(phases.at(-1)).toBe('done');
        expect(phases.filter((x) => x === 'done')).toHaveLength(1);
        expect(upserts).toHaveLength(1);
        const total = upserts[0]!;
        expect(total).toBeGreaterThan(0);
        expect(events.filter((e) => e[0] === 'index')).toEqual([['index', 0, total], ['index', total, total]]);
    });

    it('a failed index update is reported, never a failed review; without an index there is no index phase', async () => {
        const p = ports(countingJudgement());
        const errors: unknown[] = [];
        p.index = { upsertFromGraph: async () => { throw new Error('index down'); }, discardProvisional: async () => undefined };
        p.onIndexError = (e) => errors.push(e);
        const phases: string[] = [];
        const report = await runKnowledgeReview(p, { onProgress: (e) => phases.push(e.phase) });
        expect(report.aborted).toBe(false);
        expect(errors).toHaveLength(1);
        expect(phases.at(-1)).toBe('done');

        const plain: string[] = [];
        await runKnowledgeReview(ports(countingJudgement()), { onProgress: (e) => plain.push(e.phase) });
        expect(plain).not.toContain('index');
        expect(plain.at(-1)).toBe('done');
    });

    it('prefers the platform graph when the host has one, and falls back to the store when it fails', async () => {
        const seen: string[] = [];
        const p = ports();
        p.index = { upsertFromGraph: async (graph) => { seen.push(graph.scope.rootId); }, discardProvisional: async () => undefined };
        p.platformGraph = async () => ({ scope: { rootId: 'from-platform', packs: [], digest: 'd' }, nodes: [], edges: [], findings: [], stats: { sources: 0, nodes: 0, stale: 0, truncated: false } } as never);
        await runKnowledgeReview(p);
        p.platformGraph = async () => { throw new Error('offline'); };
        await runKnowledgeReview(p, { force: true });
        expect(seen[0]).toBe('from-platform');
        expect(seen[1]).toBe('docs');
    });

    it('*Re-review all* plans every file as changed and leaves the manifest consistent', async () => {
        const p = ports(countingJudgement());
        await runKnowledgeReview(p);
        expect((await planKnowledgeReview(p)).unchanged).toBe(2);
        const forced = await planKnowledgeReview(p, { force: true });
        expect(forced.unchanged).toBe(0);
        expect(forced.files).toBe(2);
        const manifestBefore = await p.manifest.get(filesManifestKey('docs'));
        await runKnowledgeReview(p, { force: true });
        expect(await p.manifest.get(filesManifestKey('docs'))).toEqual(manifestBefore);
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

    it('a host without `similar` plans no compare term, and the plan agrees with what the run does', async () => {
        const judge = countingJudgement();
        const without = await planKnowledgeReview(ports(judge));
        const withSimilar = await planKnowledgeReview({ ...ports(judge), similar: async () => [] });
        // The same two files, judged the same: only the compare phase differs — and only a run that can compare pays it.
        expect(withSimilar.estimatedModelCalls).toBeGreaterThan(without.estimatedModelCalls);
        // `similar` without a judgement port compares nothing either: the same plan as no `similar` at all.
        expect((await planKnowledgeReview({ ...ports(), similar: async () => [] })).estimatedModelCalls)
            .toBe((await planKnowledgeReview(ports())).estimatedModelCalls);
        // Forcing does not change the rule.
        const forced = await planKnowledgeReview(ports(judge), { force: true });
        expect(forced.estimatedModelCalls).toBe(without.estimatedModelCalls);
    });

    it('planKnowledgeReview is the same plan, numbers only', async () => {
        const p = ports();
        expect(await planKnowledgeReview(p)).toEqual((await planKnowledgeReviewDetail(p)).plan);
    });
});

describe("the code pack's analyzers over a workspace", () => {
    interface Tree { head: string; status?: string; prefix?: string; dependency?: unknown; listing?: { paths: string[]; truncated?: boolean } }
    const shell = (tree: Tree) => ({
        run: async (command: string) => {
            if (command.includes('depcruise')) return { ok: true, exitCode: 0, stdout: JSON.stringify(tree.dependency ?? dependency) };
            if (command.includes('knip')) return { ok: true, exitCode: 0, stdout: JSON.stringify(unused) };
            if (command.includes('rev-parse --show-toplevel --show-prefix HEAD')) return { ok: true, exitCode: 0, stdout: ['/repo', tree.prefix ?? '', hexHead(tree.head)].join('\n') };
            if (command.includes('status --porcelain')) return { ok: true, exitCode: 0, stdout: tree.status ?? '' };
            return { ok: true, exitCode: 0, stdout: '' };
        },
    });
    const caps = (head: string, extra: Partial<Tree> = {}) => ({
        capabilities: new Set(),
        shell: shell({ head, ...extra }),
        repoRead: {
            listFiles: async () => ({ ok: true, ...(extra.listing ?? { paths: ['src/a.ts', 'src/b.ts'] }) }),
            readFile: async (path: string) => ({ ok: true, path, content: path.endsWith('jscpd-report.json') ? JSON.stringify(duplicates) : 'export const x = 1;' }),
            searchCode: async () => ({ ok: true, query: '', matches: [] }),
        },
    }) as unknown as CapabilityProvider;
    const repoGraph = {
        accepts: () => true,
        create: () => ({ addFile: () => true, build: () => ({ graph: { paths: ['src/a.ts', 'src/b.ts'], out: [[[1, 0.75] as const], []] } }) }),
    };

    it("feeds the repo map's references in alongside the analyzers, and uploads under the sha", async () => {
        forgetWorkspaceAnalyses();
        const uploads: string[] = [];
        const out = await workspaceCodeAnalyzers({
            caps: caps('abc'), repoGraph, upload: async (sha) => { uploads.push(sha); },
        }).analyse('root');
        const refs = out.filter((e) => e.edges.some((edge) => edge.kind === 'references' && edge.weight === 0.75));
        expect(refs.map((e) => e.sourceRef)).toEqual(['src:root::src/a.ts']);
        expect(uploads).toEqual([hexHead('abc')]);
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

    it('does not share an analysis between roots, or between folders of one repository', async () => {
        forgetWorkspaceAnalyses();
        let depcruiseRuns = 0;
        const counted = (extra: Partial<Tree> = {}) => {
            const c = caps('shared-sha', extra);
            const run = c.shell!.run.bind(c.shell);
            (c.shell as { run: unknown }).run = async (command: string, opts?: unknown) => { if (command.includes('depcruise')) depcruiseRuns += 1; return run(command, opts as never); };
            return c;
        };
        await workspaceCodeAnalyzers({ caps: counted() }).analyse('root-a');
        await workspaceCodeAnalyzers({ caps: counted() }).analyse('root-b');
        expect(depcruiseRuns).toBe(2);
        await workspaceCodeAnalyzers({ caps: counted({ prefix: 'packages/x/' }) }).analyse('root-a');
        expect(depcruiseRuns).toBe(3);
        await workspaceCodeAnalyzers({ caps: counted() }).analyse('root-a');
        expect(depcruiseRuns).toBe(3);
    });

    it('stores dirty snapshots of one commit under different ids, in a form the API accepts', () => {
        const clean = { ...fixtureSnapshot(), source: { commit: 'abc', branch: 'main', dirty: false } };
        const dirtyA = { ...fixtureSnapshot(), id: 'a', source: { commit: 'abc', branch: 'main', dirty: true, dirtyHash: '1111' } };
        const dirtyB = { ...fixtureSnapshot(), id: 'b', source: { commit: 'abc', branch: 'main', dirty: true, dirtyHash: '2222' } };
        expect(analysisSha(clean)).toBe('abc');
        expect(analysisSha(dirtyA)).toBe('abc.1111');
        expect(analysisSha(dirtyB)).toBe('abc.2222');
        for (const sha of [analysisSha(clean), analysisSha(dirtyA), analysisSha(dirtyB)]) expect(sha).toMatch(/^~?[A-Za-z0-9._:-]{1,160}$/);
        // Without a commit (or an unidentifiable dirty tree) the snapshot's own id is used.
        expect(analysisSha({ ...clean, id: 'own', source: { commit: null, branch: null, dirty: null } })).toBe('own');
        expect(analysisSha({ ...dirtyA, source: { commit: 'abc', branch: 'main', dirty: true } })).toBe('a');
    });

    it('reads every file of a big repository, however many the listing has, and says when it is partial', async () => {
        forgetWorkspaceAnalyses();
        const paths = Array.from({ length: 450 }, (_, i) => `src/f${i}.ts`).concat(['node_modules/x/index.ts']);
        const read: string[] = [];
        const added: string[] = [];
        const listed: Array<[string | undefined, string | undefined]> = [];
        const c = caps('big', { listing: { paths, truncated: true } });
        const repoRead = c.repoRead as unknown as { listFiles: (sub?: string, glob?: string) => Promise<unknown>; readFile: (p: string) => Promise<unknown> };
        const list = repoRead.listFiles;
        repoRead.listFiles = async (sub, glob) => { listed.push([sub, glob]); return list(sub, glob); };
        const readFile = repoRead.readFile;
        repoRead.readFile = async (p) => { read.push(p); return readFile(p); };
        const warnings: string[] = [];
        const graph = await readRepoGraph({
            caps: c, onWarn: (m) => warnings.push(m),
            repoGraph: { accepts: () => true, create: () => ({ addFile: (p: string) => { added.push(p); return true; }, build: () => ({ graph: { paths: added, out: added.map(() => []) } }) }) },
        });
        // A glob is passed: without one a big repository answers with a folder summary.
        expect(listed[0]?.[1]).toBeTruthy();
        expect(added).toHaveLength(450);
        expect(added).not.toContain('node_modules/x/index.ts');
        expect(read).toHaveLength(450);
        expect(graph?.graph.paths).toHaveLength(450);
        expect(warnings.some((w) => /truncated/.test(w))).toBe(true);
    });

    it("names a reviewed sub-folder's files relative to the sub-folder, and drops what lies outside it", async () => {
        forgetWorkspaceAnalyses();
        const dependencyUnder = { modules: [
            { source: 'pkg/src/a.ts', dependencies: [{ resolved: 'pkg/src/b.ts', circular: false }, { resolved: 'other/x.ts', circular: false }] },
            { source: 'pkg/src/b.ts', dependencies: [] },
            { source: 'other/x.ts', dependencies: [{ resolved: 'pkg/src/a.ts', circular: false }] },
        ] };
        const graphOver = {
            accepts: () => true,
            create: () => ({ addFile: () => true, build: () => ({ graph: { paths: ['other/x.ts', 'pkg/src/a.ts', 'pkg/src/b.ts'], out: [[[1, 0.5] as const], [[2, 0.75] as const, [0, 0.25] as const], []] } }) }),
        };
        const uploaded: Array<{ sha: string; snapshot: CodeAnalysisSnapshot }> = [];
        const out = await workspaceCodeAnalyzers({
            caps: caps('sub', { dependency: dependencyUnder }), path: 'pkg', repoGraph: graphOver,
            upload: async (sha, snapshot) => { uploaded.push({ sha, snapshot }); },
        }).analyse('pkg-root');
        // The snapshot the platform builds this root's graph from uses the root's own paths, like its manifest.
        expect(uploaded).toHaveLength(1);
        expect(uploaded[0]!.sha).toBe(hexHead('sub'));
        const { nodes, edges, issues } = uploaded[0]!.snapshot;
        expect(nodes).toEqual(['src/a.ts', 'src/b.ts']);
        for (const path of [...nodes, ...edges.flatMap((e) => [e.from, e.to]), ...issues.flatMap((i) => i.locations.map((l) => l.path))]) {
            expect(path.startsWith('pkg/') || path.startsWith('other/'), path).toBe(false);
        }
        expect(edges).toEqual([{ from: 'src/a.ts', to: 'src/b.ts', circular: false }]);
        const refs = out.map((e) => e.sourceRef);
        expect(refs.every((r) => r.startsWith('src:pkg-root::src/'))).toBe(true);
        expect(refs).toContain('src:pkg-root::src/a.ts');
        expect(refs.some((r) => r.includes('other/') || r.includes('pkg/'))).toBe(false);
        const a = out.find((e) => e.sourceRef === 'src:pkg-root::src/a.ts')!;
        // The repo map's edge a → b survives (weight 0.75); the one to a file outside the folder does not.
        expect(a.edges.filter((e) => e.kind === 'references' && e.weight === 0.75).map((e) => e.to)).toEqual(['src:pkg-root::src/b.ts']);
        expect(a.edges.some((e) => e.to.includes('other'))).toBe(false);
    });

    it('a tree git cannot identify is still analysed once for the actions that follow', async () => {
        forgetWorkspaceAnalyses();
        let depcruiseRuns = 0;
        const c = caps('x');
        (c.shell as { run: unknown }).run = async (command: string) => {
            if (command.includes('depcruise')) { depcruiseRuns += 1; return { ok: true, exitCode: 0, stdout: JSON.stringify(dependency) }; }
            if (command.includes('knip')) return { ok: true, exitCode: 0, stdout: JSON.stringify(unused) };
            return /^(git |set -e)/.test(command) ? { ok: false, exitCode: 128, stdout: '' } : { ok: true, exitCode: 0, stdout: '' };
        };
        await workspaceCodeAnalyzers({ caps: c }).analyse('r');
        await workspaceCodeAnalyzers({ caps: c }).analyse('r');
        expect(depcruiseRuns).toBe(1);
    });
});
