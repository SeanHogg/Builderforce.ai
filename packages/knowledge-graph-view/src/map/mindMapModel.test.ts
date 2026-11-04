import { describe, expect, it } from 'vitest';
import type { Finding, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { buildMindTree, FILES_PER_FOLDER, MAX_FOLDER_DEPTH, mindMap, worstSeverity } from './mindMapModel';

const file = (path: string, importance: number): KNode => ({
    ref: `src:r::${path}` as KNode['ref'], kind: 'file', label: path, pack: 'code', importance, origin: 'extracted',
});
const finding = (severity: Finding['severity'], path: string): Finding => ({
    id: `f:${path}`, kind: 'cycle', pack: 'code', nodes: [`src:r::${path}` as Finding['nodes'][number]], severity, params: {},
});

const pad = (n: number) => String(n).padStart(2, '0');
const many = Array.from({ length: 12 }, (_, i) => file(`a/f${pad(i)}.ts`, 1 - i / 20));
const nodes = [...many, file('b/c/d/e/deep.ts', 0.5), file('top.ts', 0.9)];
const findings = [finding('warn', 'a/f00.ts'), finding('error', 'b/c/d/e/deep.ts'), finding('info', 'a/f01.ts')];

describe('mind map tree', () => {
    const tree = buildMindTree(nodes, findings);
    type Branch = typeof tree;
    const child = (parent: Branch, name: string): Branch => parent.children.find((c) => c.name === name && c.kind !== 'file')!;

    it('is root, then folders (largest first), then the top files and a "+N more" leaf', () => {
        expect(tree.kind).toBe('root');
        expect(tree.count).toBe(14);
        expect(tree.children.map((c) => `${c.kind}:${c.name}`)).toEqual(['folder:a', 'folder:b', 'file:top.ts']);
        const a = child(tree, 'a');
        expect(a.children.filter((c) => c.kind === 'file')).toHaveLength(FILES_PER_FOLDER);
        const more = a.children.at(-1)!;
        expect(more.kind).toBe('more');
        expect(more.count).toBe(12 - FILES_PER_FOLDER);
        expect(more.refs).toHaveLength(12 - FILES_PER_FOLDER);
        // The shown files are the most important ones, in order.
        expect(a.children[0]!.name).toBe('f00.ts');
        expect(a.refs).toHaveLength(12);
    });

    it('folds folders deeper than the depth cap into their ancestor', () => {
        let dir = child(tree, 'b');
        for (const name of ['c', 'd']) dir = child(dir, name);
        expect(MAX_FOLDER_DEPTH).toBe(3);
        expect(dir.children.map((c) => c.name)).toEqual(['deep.ts']);
    });

    it('tones a branch by the worst finding beneath it', () => {
        expect(child(tree, 'a').severity).toBe('warn');
        expect(child(tree, 'b').severity).toBe('error');
        expect(tree.severity).toBe('error');
        expect(tree.children.find((c) => c.name === 'top.ts')!.severity).toBeUndefined();
        expect(worstSeverity(findings).get('src:r::a/f01.ts')).toBe('info');
    });

    it('leaves out facts and anything that is not a file', () => {
        const fact: KNode = { ref: 'fact:x', kind: 'fact', label: 'x', pack: 'docs', importance: 1, origin: 'human' };
        expect(buildMindTree([fact, { ...file('s.md', 1), kind: 'section' }], []).count).toBe(0);
    });
});

describe('mind map layout', () => {
    it('is deterministic whatever the input order', () => {
        const a = mindMap(nodes, findings);
        const b = mindMap([...nodes].reverse(), [...findings].reverse());
        expect(b).toEqual(a);
    });

    it('places the root at the centre and each child one ring further out', () => {
        const { branches, bounds } = mindMap(nodes, findings);
        const root = branches[0]!;
        expect([root.x, root.y, root.depth]).toEqual([0, 0, 0]);
        for (const b of branches.slice(1)) {
            const parent = branches.find((p) => p.id === b.parent)!;
            expect(b.depth).toBe(parent.depth + 1);
        }
        expect(bounds.maxX).toBeGreaterThan(bounds.minX);
    });

    it('gives a branch an angular share proportional to its leaves', () => {
        const { branches } = mindMap(nodes, findings);
        const a = branches.find((b) => b.name === 'a' && b.kind === 'folder')!;
        const b = branches.find((x) => x.name === 'b' && x.kind === 'folder')!;
        expect(a.refs.length).toBeGreaterThan(b.refs.length);
        expect(a.angle).not.toBe(b.angle);
    });
});
