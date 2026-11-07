/**
 * knowledge/systemsRecord.test.ts — the systems a review records and the repo graph's reading of
 * them (PRD 41 A9): no file-count cap, every skipped file counted by reason, copies found.
 */

import { describe, expect, it } from 'vitest';
import { InMemoryIngestManifest } from '@seanhogg/builderforce-memory/ingest';
import type { DirectorySource, PlanDetail } from '@seanhogg/builderforce-memory/knowledge';
import type { CapabilityProvider } from '../capabilities.js';
import { noteGraphReads, type GraphFileReads } from './graphReads.js';
import { readSystems, recordSystems } from './systemsRecord.js';
import { readRepoGraph } from './workspaceAnalysis.js';

const text = (files: Record<string, string>, extra: { gitRoots?: () => string[]; hasGit?: (f: string) => Promise<boolean> } = {}): DirectorySource & { gitRoots(): string[] } => ({
    rootId: 'r', title: 'agentic', gitRoots: () => ['orig', 'other'], ...extra,
    async *list() { for (const [path, content] of Object.entries(files)) yield { path, hash: `h:${content}`, size: content.length }; },
    async read(path) { return { id: path, tenantId: 'r', content: { kind: 'text', text: files[path] ?? '' } }; },
});
const planOf = (files: Record<string, string>): PlanDetail => ({
    plan: { skipped: [] }, files: Object.entries(files).map(([path, content]) => ({ path, hash: `h:${content}` })),
}) as unknown as PlanDetail;

describe('recordSystems', () => {
    const files: Record<string, string> = { 'orig/.git': '', 'other/.git': '', 'copy/package.json': '{"name":"proj"}', 'orig/package.json': '{"name":"proj"}', 'other/package.json': '{"name":"other"}' };
    for (let i = 0; i < 10; i++) { files[`orig/src/f${i}.ts`] = `x${i}`; files[`copy/src/f${i}.ts`] = `x${i}`; files[`other/f${i}.ts`] = `o${i}`; }

    it('records the systems, marks the loose copy, and the graph build reads them back', async () => {
        const manifest = new InMemoryIngestManifest();
        noteGraphReads('r', {
            read: ['orig/package.json', ...Array.from({ length: 10 }, (_, i) => `orig/src/f${i}.ts`), ...Array.from({ length: 10 }, (_, i) => `other/f${i}.ts`)],
            skipped: [{ reason: 'too-large', paths: ['orig/src/big1.ts', 'orig/src/big2.ts'] }],
        });
        await recordSystems({ rootId: 'r', rootName: 'agentic', source: text(files), manifest });
        const systems = await readSystems(manifest, 'r');
        expect(systems.map((s) => s.path)).toEqual(['copy', 'orig', 'other']);
        expect(systems.find((s) => s.path === 'copy')).toMatchObject({ copyOf: 'orig', copyReason: 'no-git' });
        expect(systems.find((s) => s.path === 'orig')).toMatchObject({ truncated: true, graphRead: { read: 11, skipped: [{ reason: 'too-large', count: 2 }] } });
        expect(systems.find((s) => s.path === 'other')?.truncated).toBeUndefined();
    });

    it('an ignored file is not in the plan, so an excluded copy is not a system', async () => {
        const manifest = new InMemoryIngestManifest();
        const kept = Object.fromEntries(Object.entries(files).filter(([p]) => !p.startsWith('copy/')));
        await recordSystems({ rootId: 'r', rootName: 'agentic', source: text(kept), manifest });
        expect((await readSystems(manifest, 'r')).map((s) => s.path)).toEqual(['orig', 'other']);
    });

    it('reads nothing when no review recorded systems', async () => {
        expect(await readSystems(new InMemoryIngestManifest(), 'none')).toEqual([]);
    });

    it('counts planned files the graph never listed, with the real count', async () => {
        const manifest = new InMemoryIngestManifest();
        const reads: GraphFileReads = {
            read: ['orig/src/f0.ts', 'orig/src/f1.ts', 'orig/src/f2.ts'],
            skipped: [{ reason: 'unreadable', paths: ['orig/src/f3.ts'] }],
            accepts: (p) => p.endsWith('.ts'),
        };
        noteGraphReads('r', reads);
        // f4..f9 of orig (six) are planned and acceptable but neither read nor skipped; package.json is not a source file.
        await recordSystems({ rootId: 'r', rootName: 'agentic', source: text(files), manifest, plan: planOf(files) });
        const orig = (await readSystems(manifest, 'r')).find((s) => s.path === 'orig')!;
        expect(orig.graphRead).toEqual({ read: 3, skipped: [{ reason: 'listing-truncated', count: 6 }, { reason: 'unreadable', count: 1 }] });
        expect(orig.truncated).toBe(true);
    });

    it('finds a repository from the source on a confirmed plan, with no earlier list()', async () => {
        const manifest = new InMemoryIngestManifest();
        const bare: Record<string, string> = { 'a/x.ts': '1', 'b/y.ts': '2' };
        const source = text(bare, { gitRoots: () => [], hasGit: async (f) => f === 'a' || f === 'b' });
        const systems = await recordSystems({ rootId: 'r', rootName: 'agentic', source, manifest, plan: planOf(bare) });
        expect(systems.map((s) => s.path)).toEqual(['a', 'b']);
    });
});

describe('readRepoGraph — no file cap, skips recorded per file', () => {
    function caps(paths: string[], files: Record<string, { content?: string; truncated?: boolean; ok?: boolean }>, listed: unknown[] = []): CapabilityProvider {
        return {
            repoRead: {
                listFiles: async (_s?: string, _g?: string, opts?: unknown) => { listed.push(opts); return { ok: true, paths }; },
                readFile: async (p: string) => ({ ok: files[p]?.ok ?? true, content: files[p]?.content ?? 'x', truncated: files[p]?.truncated ?? false }),
            },
        } as unknown as CapabilityProvider;
    }
    const port = (added: string[]) => ({
        accepts: (p: string) => p.endsWith('.ts'),
        create: () => ({ addFile: (p: string) => { if (p.endsWith('weird.ts')) return false; added.push(p); return true; }, build: () => ({ graph: { paths: added, out: added.map(() => []) } }) }),
    });

    it('reads far more than 6,000 files, asking for an unbounded listing', async () => {
        const paths = Array.from({ length: 6_500 }, (_, i) => `src/f${i}.ts`);
        const added: string[] = [];
        const listed: unknown[] = [];
        const graph = await readRepoGraph({ caps: caps(paths, {}, listed), repoGraph: port(added) });
        expect(graph?.graph.paths).toHaveLength(6_500);
        expect(listed).toEqual([{ unbounded: true }]);
    });

    it('records each file it read or skipped by reason', async () => {
        const paths = ['one/package.json', 'one/a.ts', 'one/big.ts', 'one/weird.ts', 'two/package.json', 'two/b.ts', 'two/gone.ts'];
        const reads: GraphFileReads[] = [];
        await readRepoGraph({
            caps: caps(paths, { 'one/big.ts': { truncated: true }, 'two/gone.ts': { ok: false } }),
            repoGraph: port([]),
            onReads: (r) => reads.push(r),
        });
        expect(reads[0]).toMatchObject({
            read: ['one/a.ts', 'two/b.ts'],
            skipped: [{ reason: 'too-large', paths: ['one/big.ts'] }, { reason: 'unreadable', paths: ['two/gone.ts'] }, { reason: 'unsupported', paths: ['one/weird.ts'] }],
        });
        expect(reads[0]!.accepts!('one/q.ts')).toBe(true);
        expect(reads[0]!.accepts!('one/q.md')).toBe(false);
    });

    it('files .gitignore and .builderforce/ignore exclude never become file nodes', async () => {
        const paths = ['a.ts', 'gen/b.ts', 'src/c.ts', 'src/secret.ts', '.gitignore'];
        const added: string[] = [];
        await readRepoGraph({
            caps: caps(paths, { '.gitignore': { content: 'gen/\n' }, '.builderforce/ignore': { content: 'src/secret.ts\n' } }),
            repoGraph: port(added),
        });
        expect(added.sort()).toEqual(['a.ts', 'src/c.ts']);
    });

    it('a sub-folder root applies its own ignore files and reports root-relative paths', async () => {
        const reads: GraphFileReads[] = [];
        await readRepoGraph({
            path: 'pkg',
            caps: caps(['pkg/a.ts', 'pkg/skip/b.ts'], { 'pkg/.builderforce/ignore': { content: 'skip/\n' } }),
            repoGraph: port([]),
            onReads: (r) => reads.push(r),
        });
        expect(reads[0]!.read).toEqual(['a.ts']);
    });
});
