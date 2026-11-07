/**
 * knowledge/systemsRecord.test.ts — the systems a review records and the repo graph's reading of
 * them (PRD 41 A9): no file-count cap, every skipped file counted by reason, copies found.
 */

import { describe, expect, it } from 'vitest';
import { InMemoryIngestManifest } from '@seanhogg/builderforce-memory/ingest';
import type { DirectorySource } from '@seanhogg/builderforce-memory/knowledge';
import type { CapabilityProvider } from '../capabilities.js';
import { noteGraphReads } from './graphReads.js';
import { readSystems, recordSystems } from './systemsRecord.js';
import { readRepoGraph } from './workspaceAnalysis.js';

const text = (files: Record<string, string>): DirectorySource & { gitRoots(): string[] } => ({
    rootId: 'r', title: 'agentic', gitRoots: () => ['orig', 'other'],
    async *list() { for (const [path, content] of Object.entries(files)) yield { path, hash: `h:${content}`, size: content.length }; },
    async read(path) { return { id: path, tenantId: 'r', content: { kind: 'text', text: files[path] ?? '' } }; },
});

describe('recordSystems', () => {
    const files: Record<string, string> = { 'orig/.git': '', 'other/.git': '', 'copy/package.json': '{"name":"proj"}', 'orig/package.json': '{"name":"proj"}', 'other/package.json': '{"name":"other"}' };
    for (let i = 0; i < 10; i++) { files[`orig/src/f${i}.ts`] = `x${i}`; files[`copy/src/f${i}.ts`] = `x${i}`; files[`other/f${i}.ts`] = `o${i}`; }

    it('records the systems, marks the loose copy, and the graph build reads them back', async () => {
        const manifest = new InMemoryIngestManifest();
        noteGraphReads('r', [{ path: 'orig', read: 11, skipped: [{ reason: 'too-large', count: 2 }] }, { path: 'other', read: 10, skipped: [] }]);
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
});

describe('readRepoGraph — no file cap, skips counted per system', () => {
    function caps(paths: string[], files: Record<string, { content?: string; truncated?: boolean; ok?: boolean }>): CapabilityProvider {
        return {
            repoRead: {
                listFiles: async () => ({ ok: true, paths }),
                readFile: async (p: string) => ({ ok: files[p]?.ok ?? true, content: files[p]?.content ?? 'x', truncated: files[p]?.truncated ?? false }),
            },
        } as unknown as CapabilityProvider;
    }
    const port = (added: string[]) => ({
        accepts: (p: string) => p.endsWith('.ts'),
        create: () => ({ addFile: (p: string) => { if (p.endsWith('weird.ts')) return false; added.push(p); return true; }, build: () => ({ graph: { paths: added, out: added.map(() => []) } }) }),
    });

    it('reads far more than 6,000 files', async () => {
        const paths = Array.from({ length: 6_500 }, (_, i) => `src/f${i}.ts`);
        const added: string[] = [];
        const graph = await readRepoGraph({ caps: caps(paths, {}), repoGraph: port(added) });
        expect(graph?.graph.paths).toHaveLength(6_500);
    });

    it('counts what it did not read, by reason and system', async () => {
        const paths = ['one/package.json', 'one/a.ts', 'one/big.ts', 'one/weird.ts', 'two/package.json', 'two/b.ts', 'two/gone.ts'];
        const reads: unknown[] = [];
        await readRepoGraph(
            {
                caps: caps(paths, {
                    'one/package.json': { content: '{"name":"one"}' }, 'two/package.json': { content: '{"name":"two"}' },
                    'one/big.ts': { truncated: true }, 'two/gone.ts': { ok: false },
                }),
                repoGraph: port([]),
                onReads: (r) => reads.push(...r),
            },
        );
        expect(reads).toEqual([
            { path: 'one', read: 1, skipped: [{ reason: 'too-large', count: 1 }, { reason: 'unsupported', count: 1 }] },
            { path: 'two', read: 1, skipped: [{ reason: 'unreadable', count: 1 }] },
        ]);
    });

    it('a truncated listing is said for every system', async () => {
        const reads: unknown[] = [];
        const c = caps(['a/x.ts'], {});
        (c.repoRead as unknown as { listFiles: () => Promise<unknown> }).listFiles = async () => ({ ok: true, paths: ['a/x.ts'], truncated: true });
        await readRepoGraph({ caps: c, repoGraph: port([]), onReads: (r) => reads.push(...r), onWarn: () => undefined });
        expect(reads).toEqual([{ path: '', read: 1, skipped: [{ reason: 'listing-truncated', count: 0 }] }]);
    });
});
