import { beforeEach, describe, expect, it } from 'vitest';
import type { AnalyzerProgress } from '@seanhogg/builderforce-memory/knowledge';
import type { CapabilityProvider } from '../capabilities.js';
import { ANALYZERS } from '../codeAnalysisTool.js';
import { createAnalysisProgress } from './analysisProgress.js';
import { analyseWorkspace, forgetWorkspaceAnalyses, type RepoGraphPort } from './workspaceAnalysis.js';

const TOOLS = ANALYZERS.length;

function expectSound(reports: AnalyzerProgress[]): void {
    expect(reports.length).toBeGreaterThan(0);
    // Tools may settle before the listing is known, so the first report can already count them.
    expect(reports[0]!.done).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < reports.length; i++) expect(reports[i]!.done).toBeGreaterThanOrEqual(reports[i - 1]!.done);
    const last = reports[reports.length - 1]!;
    expect(last.done).toBe(last.total);
    expect(reports.every((r) => r.done <= r.total)).toBe(true);
}

describe('createAnalysisProgress', () => {
    it('reports nothing before the listing is known, then 0/total, and ends done === total', () => {
        const reports: AnalyzerProgress[] = [];
        const p = createAnalysisProgress((r) => reports.push(r));
        p.toolSettled();
        expect(reports).toEqual([]);
        p.plan(3);
        p.filesRead(3, 'c.ts');
        p.toolSettled();
        p.finish();
        expect(reports[0]).toEqual({ done: 1, total: 3 + TOOLS });
        expect(reports.some((r) => r.path === 'c.ts')).toBe(true);
        expectSound([{ done: 0, total: 3 + TOOLS }, ...reports]);
    });

    it('is just the tool count when no files will be read', () => {
        const reports: AnalyzerProgress[] = [];
        const p = createAnalysisProgress((r) => reports.push(r));
        p.plan(0);
        p.finish();
        expect(reports[0]).toEqual({ done: 0, total: TOOLS });
        expect(reports[reports.length - 1]).toEqual({ done: TOOLS, total: TOOLS });
    });
});

describe('analyseWorkspace progress', () => {
    beforeEach(() => forgetWorkspaceAnalyses());

    const FILES = Array.from({ length: 20 }, (_, i) => `src/f${i}.ts`);

    function fakeCaps(failTool: boolean): CapabilityProvider {
        return {
            capabilities: new Set(),
            // git fails (no repository) and every analyzer command fails: the tools settle as failed / not measured.
            shell: { run: async () => { if (failTool) throw new Error('boom'); return { ok: false, exitCode: 1, stdout: '' }; } },
            repoRead: {
                listFiles: async () => ({ ok: true, paths: FILES }),
                // Every fifth file is unreadable: a failed read still counts as read.
                readFile: async (p: string) => (p.endsWith('5.ts') ? { ok: false } : { ok: true, content: 'export {};\n' }),
            },
        } as unknown as CapabilityProvider;
    }
    const graphPort: RepoGraphPort = {
        create: () => ({ addFile: () => true, build: () => ({ nodes: [], edges: [] }) as never }),
        accepts: () => true,
    };

    it('tools that fail still count', async () => {
        const reports: AnalyzerProgress[] = [];
        await analyseWorkspace({ caps: fakeCaps(true), repoGraph: graphPort, rootId: 'r2', onProgress: (p) => reports.push(p) }).catch(() => undefined);
        expectSound(reports);
        expect(reports[reports.length - 1]!.total).toBe(FILES.length + TOOLS);
    });

    it('totals just the tools without a repo map, and gives a joiner no progress', async () => {
        const first: AnalyzerProgress[] = [];
        const joiner: AnalyzerProgress[] = [];
        const caps = fakeCaps(false);
        const a = analyseWorkspace({ caps, rootId: 'r3', onProgress: (p) => first.push(p) });
        const b = analyseWorkspace({ caps, rootId: 'r3', onProgress: (p) => joiner.push(p) });
        await Promise.all([a, b]);
        expectSound(first);
        expect(first[0]!.total).toBe(TOOLS);
        expect(joiner).toEqual([]);
    });
});
