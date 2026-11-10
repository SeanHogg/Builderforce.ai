import { describe, expect, it } from 'vitest';
import { identityOf, srcRef, type KNode, type KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { unusedCodeRule } from './codeFindings.js';
import { CODE_BADGES, codeFileNode } from './codeNodes.js';

const ROOT = 'r';
const ref = (path: string) => srcRef(ROOT, path);
const graphOf = (nodes: KNode[]): KnowledgeGraph => ({
    scope: { rootId: ROOT, packs: ['code'], digest: 'd' }, nodes, edges: [], findings: [],
    stats: { sources: nodes.length, nodes: nodes.length, edges: 0, stale: 0, truncated: false },
});
const file = (path: string, badges: Record<string, number | string>) => codeFileNode(ROOT, path, { badges });

describe('unusedCodeRule: one finding per unused item (PRD 41 §C3)', () => {
    const g = graphOf([
        file('src/dead.ts', { [CODE_BADGES.unused]: 'file' }),
        file('src/b.ts', { [CODE_BADGES.unusedExports]: 2, [CODE_BADGES.unusedExportNames]: 'y,x' }),
        file('package.json', { [CODE_BADGES.unusedDependencies]: 1, [CODE_BADGES.unusedDependencyNames]: 'left-pad' }),
    ]);
    const found = unusedCodeRule.find(g);

    it('splits unused files, exports and dependencies into one finding each, anchored on the item', () => {
        expect(found.map((f) => [f.kind, f.nodes, f.params, f.anchor, f.anchorKind])).toEqual([
            ['unused-file', [ref('src/dead.ts')], { count: 1, files: 1 }, ref('src/dead.ts'), 'file'],
            ['unused-export', [ref('src/b.ts')], { count: 1, files: 1, name: 'x' }, `${ref('src/b.ts')}#x`, 'symbol'],
            ['unused-export', [ref('src/b.ts')], { count: 1, files: 1, name: 'y' }, `${ref('src/b.ts')}#y`, 'symbol'],
            ['unused-dependency', [ref('package.json')], { count: 1, files: 1, name: 'left-pad' }, `${ref('package.json')}#left-pad`, 'package'],
        ]);
        expect(found.map((f) => f.requestKey)).toEqual([
            'knowledgeGraph.fix.unusedFile', 'knowledgeGraph.fix.unusedExport', 'knowledgeGraph.fix.unusedExport', 'knowledgeGraph.fix.unusedDependency',
        ]);
    });

    it('gives every item its own id and identity anchor; one export going away leaves the other identical', () => {
        expect(new Set(found.map((f) => f.id)).size).toBe(found.length);
        expect(identityOf(found[1]!).anchor).toBe(`unused-export@1:symbol:${ref('src/b.ts')}#x`);
        const after = unusedCodeRule.find(graphOf([file('src/b.ts', { [CODE_BADGES.unusedExports]: 1, [CODE_BADGES.unusedExportNames]: 'y' })]));
        expect(after.map((f) => f.id)).toEqual([found[2]!.id]);
    });

    it('a graph built before names were badged keeps one finding per file with its count', () => {
        const legacy = unusedCodeRule.find(graphOf([file('src/b.ts', { [CODE_BADGES.unusedExports]: 2 })]));
        expect(legacy.map((f) => [f.kind, f.params, f.anchorKind])).toEqual([['unused-export', { count: 2, files: 1 }, 'file']]);
    });
});
