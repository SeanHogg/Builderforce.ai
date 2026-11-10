import { beforeEach, describe, expect, it } from 'vitest';
import type { CapabilityProvider } from '../capabilities.js';
import { MAX_LISTED_FILES } from './fsDirectorySource.js';
import { analyseWorkspace, forgetWorkspaceAnalyses, readRepoGraph, type RepoGraphPort } from './workspaceAnalysis.js';
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

    it('reads the first cap files in sorted order, counts the rest as listing-truncated, and says so', async () => {
        const port = countingPort();
        let truncated = false;
        let reads: GraphFileReads | undefined;
        await readRepoGraph({ caps: caps(files(5).reverse()), repoGraph: port, maxFiles: 3, onTruncated: () => { truncated = true; }, onReads: (r) => { reads = r; } });
        expect(truncated).toBe(true);
        expect(port.added).toEqual(files(3));
        expect(reads!.skipped).toEqual([{ reason: 'listing-truncated', paths: files(5).slice(3) }]);
    });

    it(`an analysis whose scope holds more than ${MAX_LISTED_FILES} files is marked truncated; one at the cap is not`, async () => {
        const over = await analyseWorkspace({ caps: caps(files(MAX_LISTED_FILES + 1)), repoGraph: countingPort(), rootId: 'over' });
        expect(over.snapshot?.truncated).toBe(true);
        const at = await analyseWorkspace({ caps: caps(files(MAX_LISTED_FILES)), repoGraph: countingPort(), rootId: 'at' });
        expect(at.snapshot).not.toBeNull();
        expect(at.snapshot?.truncated).toBeUndefined();
    });
});
