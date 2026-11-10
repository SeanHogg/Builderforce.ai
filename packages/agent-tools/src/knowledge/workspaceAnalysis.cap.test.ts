import { beforeEach, describe, expect, it } from 'vitest';
import type { CapabilityProvider } from '../capabilities.js';
import { MAX_LISTED_FILES } from './fsDirectorySource.js';
import { analyseWorkspace, forgetWorkspaceAnalyses, type RepoGraphPort } from './workspaceAnalysis.js';
import type { GraphFileReads } from './graphReads.js';

const files = (n: number): string[] => Array.from({ length: n }, (_, i) => `src/f${String(i).padStart(6, '0')}.ts`);

function caps(paths: string[]): CapabilityProvider {
    return {
        capabilities: new Set(),
        // No repository and every analyzer fails: the snapshot still exists, with failed tools.
        shell: { run: async () => ({ ok: false, exitCode: 1, stdout: '' }) },
        repoRead: { listFiles: async () => ({ ok: true, paths }), readFile: async () => ({ ok: true, content: 'export {};\n' }) },
    } as unknown as CapabilityProvider;
}

function countingPort(): RepoGraphPort & { added: string[] } {
    const added: string[] = [];
    return { added, create: () => ({ addFile: (p: string) => { added.push(p); return true; }, build: () => ({ nodes: [], edges: [] }) as never }), accepts: () => true };
}

describe('the L3 analyzer scope cap (PRD 41 B2 "Large roots")', () => {
    beforeEach(() => forgetWorkspaceAnalyses());

    it('a 25k-file root: the repo map reads every file (A9), and the analysis record is marked truncated', async () => {
        const port = countingPort();
        let reads: GraphFileReads | undefined;
        const over = await analyseWorkspace({ caps: caps(files(25_000)), repoGraph: port, rootId: 'over', onReads: (r) => { reads = r; } });
        expect(port.added).toHaveLength(25_000);
        expect(reads!.read).toHaveLength(25_000);
        expect(reads!.skipped).toEqual([]);
        expect(over.snapshot?.truncated).toBe(true);
    });

    it(`an analysis scope of exactly ${MAX_LISTED_FILES} files is not truncated`, async () => {
        const at = await analyseWorkspace({ caps: caps(files(MAX_LISTED_FILES)), repoGraph: countingPort(), rootId: 'at' });
        expect(at.snapshot).not.toBeNull();
        expect(at.snapshot?.truncated).toBeUndefined();
    });
});
